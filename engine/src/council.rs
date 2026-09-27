use crate::dexscreener::AssetCaptures;
use crate::domain::{
    CanonicalSnapshot, FieldCapture, Proposal, ProposalLeg, SnapshotStatus, Verdict, sha256_hex,
};
use crate::prestocks::scale_decimal_to_integer;
use crate::pyth::PythUnderlyingRef;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct AssetConfig {
    pub asset_id: String,
    pub underlying: String,
    pub target_weight_bps: u32,
    pub price_scale: u32,
    pub quantity_scale: u32,
    pub min_liquidity: String,
    pub max_weight_bps: u32,
}

#[derive(Clone, Debug)]
pub struct CouncilConfig {
    pub assets: Vec<AssetConfig>,
    pub max_dislocation_bps: u32,
    pub coherence_cap_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct CouncilCheck {
    pub id: String,
    pub scope: String,
    pub asset_id: Option<String>,
    pub status: String,
    pub observed: Option<String>,
    pub threshold: Option<String>,
    pub unit: Option<String>,
    pub evidence_capture_keys: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CouncilEvaluation {
    pub verdict: Verdict,
    pub checks: Vec<CouncilCheck>,
}

pub fn capture_key(asset_id: &str, field: &str) -> String {
    format!("{asset_id}.{field}")
}

pub fn build_snapshot(
    config: &CouncilConfig,
    captures: &BTreeMap<String, AssetCaptures>,
    references: &BTreeMap<String, FieldCapture>,
    created_at: impl Into<String>,
) -> CanonicalSnapshot {
    let created_at = created_at.into();
    let mut fields = BTreeMap::new();
    for asset in &config.assets {
        if let Some(asset_captures) = captures.get(&asset.asset_id) {
            fields.insert(
                capture_key(&asset.asset_id, "price"),
                asset_captures.price.clone(),
            );
            fields.insert(
                capture_key(&asset.asset_id, "liquidity"),
                asset_captures.liquidity.clone(),
            );
        } else {
            fields.insert(
                capture_key(&asset.asset_id, "price"),
                FieldCapture::failed(
                    "missing",
                    "engine-v1",
                    created_at.clone(),
                    "asset capture missing",
                ),
            );
            // The created timestamp is owned by the snapshot; this branch is only reached on a missing asset.
            fields.insert(
                capture_key(&asset.asset_id, "liquidity"),
                FieldCapture::failed(
                    "missing",
                    "engine-v1",
                    created_at.clone(),
                    "asset capture missing",
                ),
            );
        }
        fields.insert(
            capture_key(&asset.asset_id, "reference"),
            references.get(&asset.asset_id).cloned().unwrap_or_else(|| {
                FieldCapture::failed(
                    "missing",
                    "engine-v1",
                    created_at.clone(),
                    "reference capture missing",
                )
            }),
        );
    }
    CanonicalSnapshot::new(fields, created_at, config.coherence_cap_ms)
}

/// Deterministic council: a lead proposal is assembled only for a READY
/// snapshot, then the independent reviewer can veto on liquidity or dislocation.
pub fn evaluate_council(
    config: &CouncilConfig,
    snapshot: &CanonicalSnapshot,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
) -> Verdict {
    evaluate_council_with_checks(config, snapshot, references).verdict
}

pub fn evaluate_council_with_checks(
    config: &CouncilConfig,
    snapshot: &CanonicalSnapshot,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
) -> CouncilEvaluation {
    let mut checks = initial_checks(config);
    if !snapshot.revalidate(config.coherence_cap_ms) {
        record_check(
            &mut checks,
            "snapshot-integrity",
            None,
            "NO_DATA",
            Some("invalid".into()),
            Some("hash, status, and conflicts re-derive from captures".into()),
            None,
            Vec::new(),
            Some("snapshot readiness mismatch".into()),
        );
        let reasons = vec![String::from(
            "snapshot readiness mismatch: hash, status, or conflicts do not re-derive from captures",
        )];
        return finish_no_data(checks, reasons);
    }
    record_check(
        &mut checks,
        "snapshot-integrity",
        None,
        "PASS",
        Some("valid".into()),
        Some("hash, status, and conflicts re-derive from captures".into()),
        None,
        Vec::new(),
        None,
    );
    if snapshot.status != SnapshotStatus::Ready {
        let reasons = missing_reasons(snapshot);
        record_check(
            &mut checks,
            "snapshot-ready",
            None,
            "NO_DATA",
            Some(format!("{:?}", snapshot.status)),
            Some("READY".into()),
            None,
            Vec::new(),
            Some(reasons.join("; ")),
        );
        return finish_no_data(checks, reasons);
    }
    record_check(
        &mut checks,
        "snapshot-ready",
        None,
        "PASS",
        Some("READY".into()),
        Some("READY".into()),
        None,
        Vec::new(),
        None,
    );
    if config.assets.is_empty() {
        let reasons = vec![String::from("no assets configured")];
        record_check(
            &mut checks,
            "asset-roster",
            None,
            "NO_DATA",
            Some("0".into()),
            Some("at least 1".into()),
            Some("assets".into()),
            Vec::new(),
            Some(reasons[0].clone()),
        );
        return finish_no_data(checks, reasons);
    }
    record_check(
        &mut checks,
        "asset-roster",
        None,
        "PASS",
        Some(config.assets.len().to_string()),
        Some("at least 1".into()),
        Some("assets".into()),
        Vec::new(),
        None,
    );
    let weight_sum: u32 = config
        .assets
        .iter()
        .map(|asset| asset.target_weight_bps)
        .sum();
    if weight_sum != 10_000 {
        let reasons = vec![String::from("proposal weights must sum to 10000 bps")];
        record_check(
            &mut checks,
            "allocation-total",
            None,
            "NO_DATA",
            Some(weight_sum.to_string()),
            Some("10000".into()),
            Some("weight_bps".into()),
            Vec::new(),
            Some(reasons[0].clone()),
        );
        return finish_no_data(checks, reasons);
    }
    record_check(
        &mut checks,
        "allocation-total",
        None,
        "PASS",
        Some(weight_sum.to_string()),
        Some("10000".into()),
        Some("weight_bps".into()),
        Vec::new(),
        None,
    );
    for asset in &config.assets {
        if asset.target_weight_bps == 0 || asset.target_weight_bps > asset.max_weight_bps {
            let reasons = vec![format!(
                "{} target weight exceeds registry cap",
                asset.underlying
            )];
            record_check(
                &mut checks,
                "target-weight",
                Some(&asset.asset_id),
                "NO_DATA",
                Some(asset.target_weight_bps.to_string()),
                Some(asset.max_weight_bps.to_string()),
                Some("weight_bps".into()),
                Vec::new(),
                Some(reasons[0].clone()),
            );
            return finish_no_data(checks, reasons);
        }
        record_check(
            &mut checks,
            "target-weight",
            Some(&asset.asset_id),
            "PASS",
            Some(asset.target_weight_bps.to_string()),
            Some(asset.max_weight_bps.to_string()),
            Some("weight_bps".into()),
            Vec::new(),
            None,
        );
        for field in ["price", "liquidity"] {
            let key = capture_key(&asset.asset_id, field);
            if !snapshot.captures.contains_key(&key) {
                let reasons = vec![format!("{}.{} capture missing", asset.underlying, field)];
                record_check(
                    &mut checks,
                    &format!("{field}-capture"),
                    Some(&asset.asset_id),
                    "NO_DATA",
                    Some("missing".into()),
                    Some("present".into()),
                    None,
                    vec![key],
                    Some(reasons[0].clone()),
                );
                return finish_no_data(checks, reasons);
            }
            record_check(
                &mut checks,
                &format!("{field}-capture"),
                Some(&asset.asset_id),
                "PASS",
                Some("present".into()),
                Some("present".into()),
                None,
                vec![key],
                None,
            );
        }
        let reference_key = capture_key(&asset.asset_id, "reference");
        let reference_capture = snapshot
            .captures
            .get(&reference_key);
        let reference = references.get(&asset.asset_id).and_then(Option::as_ref);
        if !matches!((reference_capture, reference), (Some(capture), Some(reference)) if reference_capture_matches(capture, reference, &asset.underlying))
        {
            let reasons = vec![format!(
                "{} reference unavailable or not bound to snapshot",
                asset.underlying
            )];
            record_check(
                &mut checks,
                "reference-binding",
                Some(&asset.asset_id),
                "NO_DATA",
                Some("unbound".into()),
                Some("snapshot-bound".into()),
                None,
                vec![reference_key],
                Some(reasons[0].clone()),
            );
            return finish_no_data(checks, reasons);
        }
        record_check(
            &mut checks,
            "reference-binding",
            Some(&asset.asset_id),
            "PASS",
            Some("bound".into()),
            Some("snapshot-bound".into()),
            None,
            vec![reference_key.clone()],
            None,
        );
        let reference_units = reference
            .and_then(|reference| {
                scale_decimal_to_integer(&reference.spot, asset.price_scale)
                    .and_then(|value| value.parse::<u128>().ok())
            });
        if reference_units.is_none_or(|value| value == 0) {
            let reasons = vec![format!(
                "{} underlying reference unavailable or invalid",
                asset.underlying
            )];
            record_check(
                &mut checks,
                "reference-price",
                Some(&asset.asset_id),
                "NO_DATA",
                reference.map(|item| item.spot.clone()),
                Some("positive numeric mark".into()),
                Some("USD".into()),
                vec![reference_key],
                Some(reasons[0].clone()),
            );
            return finish_no_data(checks, reasons);
        }
        record_check(
            &mut checks,
            "reference-price",
            Some(&asset.asset_id),
            "PASS",
            reference_units.map(|value| from_units(&value.to_string(), asset.price_scale)),
            Some("> 0".into()),
            Some("USD".into()),
            vec![reference_key],
            None,
        );
    }
    for asset in &config.assets {
        let price_key = capture_key(&asset.asset_id, "price");
        let price = snapshot
            .captures
            .get(&price_key)
            .and_then(|capture| capture.value.as_deref());
        if price.and_then(|value| value.parse::<u128>().ok()).is_none() {
            let reasons = vec![format!(
                "{} token price unavailable or unparseable",
                asset.underlying
            )];
            record_check(
                &mut checks,
                "token-price",
                Some(&asset.asset_id),
                "NO_DATA",
                price.map(str::to_string),
                Some("parseable numeric mark".into()),
                Some("USD".into()),
                vec![price_key],
                Some(reasons[0].clone()),
            );
            return finish_no_data(checks, reasons);
        }
        record_check(
            &mut checks,
            "token-price",
            Some(&asset.asset_id),
            "PASS",
            price.map(|value| from_units(value, asset.price_scale)),
            Some("parseable numeric mark".into()),
            Some("USD".into()),
            vec![price_key],
            None,
        );
    }
    let mut vetoes = Vec::new();
    for asset in &config.assets {
        let liquidity_key = capture_key(&asset.asset_id, "liquidity");
        let liquidity = snapshot
            .captures
            .get(&liquidity_key)
            .and_then(|capture| capture.value.as_deref())
            .and_then(|value| value.parse::<u128>().ok());
        let floor = asset.min_liquidity.parse::<u128>().ok();
        match (liquidity, floor) {
            (Some(value), Some(floor)) if value < floor => {
                let reason = format!("{} pool liquidity below floor", asset.underlying);
                vetoes.push(reason.clone());
                record_check(
                    &mut checks,
                    "liquidity-floor",
                    Some(&asset.asset_id),
                    "BLOCK",
                    Some(from_units(&value.to_string(), asset.quantity_scale)),
                    Some(from_units(&floor.to_string(), asset.quantity_scale)),
                    Some("USD".into()),
                    vec![liquidity_key.clone()],
                    Some(reason),
                );
            }
            (None, _) => {
                let reasons = vec![format!("{} liquidity unavailable", asset.underlying)];
                record_check(
                    &mut checks,
                    "liquidity-floor",
                    Some(&asset.asset_id),
                    "NO_DATA",
                    None,
                    asset.min_liquidity.parse::<u128>().ok().map(|value| from_units(&value.to_string(), asset.quantity_scale)),
                    Some("USD".into()),
                    vec![liquidity_key.clone()],
                    Some(reasons[0].clone()),
                );
                return finish_no_data(checks, reasons);
            }
            (_, None) => {
                let reasons = vec![format!("{} liquidity floor invalid", asset.underlying)];
                record_check(
                    &mut checks,
                    "liquidity-floor",
                    Some(&asset.asset_id),
                    "NO_DATA",
                    liquidity.map(|value| from_units(&value.to_string(), asset.quantity_scale)),
                    Some(asset.min_liquidity.clone()),
                    Some("USD".into()),
                    vec![liquidity_key.clone()],
                    Some(reasons[0].clone()),
                );
                return finish_no_data(checks, reasons);
            }
            (Some(value), Some(floor)) => record_check(
                &mut checks,
                "liquidity-floor",
                Some(&asset.asset_id),
                "PASS",
                Some(from_units(&value.to_string(), asset.quantity_scale)),
                Some(from_units(&floor.to_string(), asset.quantity_scale)),
                Some("USD".into()),
                vec![liquidity_key.clone()],
                None,
            ),
        }
        let price_key = capture_key(&asset.asset_id, "price");
        let reference_key = capture_key(&asset.asset_id, "reference");
        let price = snapshot
            .captures
            .get(&price_key)
            .and_then(|capture| capture.value.as_deref());
        if let (Some(price), Some(reference)) = (
            price,
            references.get(&asset.asset_id).and_then(|x| x.as_ref()),
        ) {
            let Some(underlying_units) =
                scale_decimal_to_integer(&reference.spot, asset.price_scale)
                    .and_then(|value| value.parse::<u128>().ok())
            else {
                let reasons = vec![format!("{} underlying mark unparseable", asset.underlying)];
                record_check(
                    &mut checks,
                    "dislocation-cap",
                    Some(&asset.asset_id),
                    "NO_DATA",
                    None,
                    Some(config.max_dislocation_bps.to_string()),
                    Some("bps".into()),
                    vec![price_key, reference_key],
                    Some(reasons[0].clone()),
                );
                return finish_no_data(checks, reasons);
            };
            let Ok(token_units) = price.parse::<u128>() else {
                let reasons = vec![format!("{} token price unparseable", asset.underlying)];
                record_check(
                    &mut checks,
                    "dislocation-cap",
                    Some(&asset.asset_id),
                    "NO_DATA",
                    None,
                    Some(config.max_dislocation_bps.to_string()),
                    Some("bps".into()),
                    vec![price_key, reference_key],
                    Some(reasons[0].clone()),
                );
                return finish_no_data(checks, reasons);
            };
            let Some(gap_bps) = token_units
                .abs_diff(underlying_units)
                .checked_mul(10_000)
                .and_then(|scaled| scaled.checked_div(underlying_units))
            else {
                let reasons = vec![format!(
                    "{} dislocation gap calculation overflowed",
                    asset.underlying
                )];
                record_check(
                    &mut checks,
                    "dislocation-cap",
                    Some(&asset.asset_id),
                    "NO_DATA",
                    Some("overflow".into()),
                    Some(config.max_dislocation_bps.to_string()),
                    Some("bps".into()),
                    vec![price_key, reference_key],
                    Some(reasons[0].clone()),
                );
                return finish_no_data(checks, reasons);
            };
            if gap_bps > u128::from(config.max_dislocation_bps) {
                let reason = format!(
                    "{} token dislocated {gap_bps}bps from underlying",
                    asset.underlying
                );
                vetoes.push(reason.clone());
                record_check(
                    &mut checks,
                    "dislocation-cap",
                    Some(&asset.asset_id),
                    "BLOCK",
                    Some(gap_bps.to_string()),
                    Some(config.max_dislocation_bps.to_string()),
                    Some("bps".into()),
                    vec![price_key, reference_key],
                    Some(reason),
                );
            } else {
                record_check(
                    &mut checks,
                    "dislocation-cap",
                    Some(&asset.asset_id),
                    "PASS",
                    Some(gap_bps.to_string()),
                    Some(config.max_dislocation_bps.to_string()),
                    Some("bps".into()),
                    vec![price_key, reference_key],
                    None,
                );
            }
        }
    }
    if !vetoes.is_empty() {
        return CouncilEvaluation {
            verdict: Verdict::Blocked { reasons: vetoes },
            checks,
        };
    }
    let legs = config
        .assets
        .iter()
        .map(|asset| ProposalLeg {
            asset_id: asset.asset_id.clone(),
            underlying: asset.underlying.clone(),
            target_weight_bps: asset.target_weight_bps,
        })
        .collect();
    CouncilEvaluation {
        verdict: Verdict::Published(Proposal {
            proposal_id: format!("engine-{}", &snapshot.sha256[..12]),
            legs,
            snapshot_sha256: snapshot.sha256.clone(),
            expires_at: snapshot.created_at.clone(),
            authority: "advisory-only".into(),
            execution_ready: false,
        }),
        checks,
    }
}

fn initial_checks(config: &CouncilConfig) -> Vec<CouncilCheck> {
    let mut checks = vec![
        new_check("snapshot-integrity", "snapshot", None),
        new_check("snapshot-ready", "snapshot", None),
        new_check("asset-roster", "portfolio", None),
        new_check("allocation-total", "portfolio", None),
    ];
    for asset in &config.assets {
        for id in [
            "target-weight",
            "price-capture",
            "liquidity-capture",
            "reference-binding",
            "reference-price",
            "token-price",
            "liquidity-floor",
            "dislocation-cap",
        ] {
            checks.push(new_check(id, "asset", Some(&asset.asset_id)));
        }
    }
    checks
}

fn new_check(id: &str, scope: &str, asset_id: Option<&str>) -> CouncilCheck {
    CouncilCheck {
        id: id.into(),
        scope: scope.into(),
        asset_id: asset_id.map(str::to_string),
        status: "NO_DATA".into(),
        observed: None,
        threshold: None,
        unit: None,
        evidence_capture_keys: Vec::new(),
        reason: Some("Not evaluated".into()),
    }
}

#[allow(clippy::too_many_arguments)]
fn record_check(
    checks: &mut [CouncilCheck],
    id: &str,
    asset_id: Option<&str>,
    status: &str,
    observed: Option<String>,
    threshold: Option<String>,
    unit: Option<String>,
    evidence_capture_keys: Vec<String>,
    reason: Option<String>,
) {
    if let Some(check) = checks.iter_mut().find(|check| {
        check.id == id && check.asset_id.as_deref() == asset_id
    }) {
        check.status = status.into();
        check.observed = observed;
        check.threshold = threshold;
        check.unit = unit;
        check.evidence_capture_keys = evidence_capture_keys;
        check.reason = reason;
    }
}

fn finish_no_data(mut checks: Vec<CouncilCheck>, reasons: Vec<String>) -> CouncilEvaluation {
    let stop_reason = reasons
        .first()
        .map(String::as_str)
        .unwrap_or("council evaluation stopped");
    for check in &mut checks {
        if check.reason.as_deref() == Some("Not evaluated") {
            check.reason = Some(format!("Not evaluated after: {stop_reason}"));
        }
    }
    CouncilEvaluation {
        verdict: Verdict::NoData { reasons },
        checks,
    }
}

fn reference_capture_matches(
    capture: &FieldCapture,
    reference: &PythUnderlyingRef,
    expected_underlying: &str,
) -> bool {
    let expected_source = if let Some(symbol) = reference.feed_id.strip_prefix("prestocks:") {
        if symbol != expected_underlying {
            return false;
        }
        "prestocks-issuer"
    } else {
        "pyth"
    };
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(&capture.raw_excerpt) else {
        return false;
    };
    capture.source_id == expected_source
        && capture.value.as_deref() == Some(reference.spot.as_str())
        && raw.get("feed_id").and_then(serde_json::Value::as_str)
            == Some(reference.feed_id.as_str())
        && raw.get("spot").and_then(serde_json::Value::as_str) == Some(reference.spot.as_str())
        && raw.get("publish_time").and_then(serde_json::Value::as_str)
            == Some(reference.publish_time.as_str())
}

pub fn evaluate(
    config: &CouncilConfig,
    snapshot: &CanonicalSnapshot,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
) -> Verdict {
    evaluate_council(config, snapshot, references)
}

fn missing_reasons(snapshot: &CanonicalSnapshot) -> Vec<String> {
    let mut reasons = snapshot
        .captures
        .iter()
        .filter(|(_, capture)| !capture.is_ok())
        .map(|(key, capture)| format!("{key}: {}", capture.raw_excerpt))
        .collect::<Vec<_>>();
    reasons.extend(snapshot.conflicts.iter().cloned());
    if reasons.is_empty() {
        reasons.push("snapshot is not READY".into());
    }
    reasons
}

pub fn render_advice(
    snapshot: &CanonicalSnapshot,
    verdict: &Verdict,
    config: &CouncilConfig,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
) -> String {
    let mut lines = vec![
        "FalconOS · Stocks council   [advisory-only · executionReady=false]".to_string(),
        format!(
            "snapshot={}  advice={}  createdAt={}  hash={}",
            match snapshot.status {
                SnapshotStatus::Ready => "READY",
                SnapshotStatus::NoData => "NO_DATA",
            },
            verdict.status(),
            snapshot.created_at,
            &snapshot.sha256[..12]
        ),
        String::new(),
        "Evidence".into(),
    ];
    for asset in &config.assets {
        let price = snapshot
            .captures
            .get(&capture_key(&asset.asset_id, "price"))
            .and_then(|x| x.value.as_deref())
            .map(|x| from_units(x, asset.price_scale))
            .unwrap_or_else(|| "NO_DATA".into());
        let liquidity = snapshot
            .captures
            .get(&capture_key(&asset.asset_id, "liquidity"))
            .and_then(|x| x.value.as_deref())
            .map(|x| from_units(x, asset.quantity_scale))
            .unwrap_or_else(|| "NO_DATA".into());
        let mut extra = String::new();
        if let (Some(price_units), Some(reference)) = (
            snapshot
                .captures
                .get(&capture_key(&asset.asset_id, "price"))
                .and_then(|capture| capture.value.as_deref()),
            references
                .get(&asset.asset_id)
                .and_then(|value| value.as_ref()),
        ) && let Some(underlying_units) =
            scale_decimal_to_integer(&reference.spot, asset.price_scale)
            && let (Ok(token), Ok(underlying)) = (
                price_units.parse::<u128>(),
                underlying_units.parse::<u128>(),
            )
            && underlying > 0
            && let Some(gap) = token
                .abs_diff(underlying)
                .checked_mul(10_000)
                .and_then(|scaled| scaled.checked_div(underlying))
        {
            let sign = if token < underlying { '-' } else { '+' };
            extra = format!(
                "  underlying=${}  premium={sign}{gap}bps",
                from_units(&underlying_units, asset.price_scale)
            );
        }
        lines.push(format!(
            "  {:<10} token=${:<16} liquidity=${}{extra}",
            asset.underlying, price, liquidity
        ));
    }
    lines.push(String::new());
    lines.push("Proposal".into());
    if let Verdict::Published(proposal) = verdict {
        for leg in &proposal.legs {
            lines.push(format!(
                "  {:<10} {:.2}%",
                leg.underlying,
                leg.target_weight_bps as f64 / 100.0
            ));
        }
    } else {
        lines.push("  none published".into());
    }
    lines.push(String::new());
    match verdict {
        Verdict::Published(_) => lines.push("Risk review: PASS (veto-only)".into()),
        Verdict::Blocked { reasons } => {
            lines.push("Risk review: BLOCK [veto]".into());
            for reason in reasons {
                lines.push(format!("  - {reason}"));
            }
        }
        Verdict::NoData { reasons } => {
            lines.push("Risk review: unavailable (NO_DATA)".into());
            for reason in reasons {
                lines.push(format!("  - {reason}"));
            }
        }
    }
    lines.push(String::new());
    lines.push("Citations".into());
    if !matches!(verdict, Verdict::Published(_)) {
        lines.push("  none (advice not published)".into());
    } else {
        for asset in &config.assets {
            for field in ["price", "liquidity", "reference"] {
                if let Some(capture) = snapshot.captures.get(&capture_key(&asset.asset_id, field)) {
                    lines.push(format!(
                        "  {:<10} {:<10} {}@{}  sha256={}",
                        asset.underlying,
                        field,
                        capture.source_id,
                        capture.source_version,
                        &sha256_hex(capture.raw_excerpt.as_bytes())[..12]
                    ));
                }
            }
        }
    }
    lines.join("\n")
}

fn from_units(value: &str, scale: u32) -> String {
    if scale == 0 {
        return value.to_string();
    }
    let mut digits = value.to_string();
    while digits.len() <= scale as usize {
        digits.insert(0, '0');
    }
    let cut = digits.len() - scale as usize;
    format!("{}.{}", &digits[..cut], &digits[cut..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dexscreener::AssetCaptures;
    use crate::domain::FieldCapture;

    fn config() -> CouncilConfig {
        CouncilConfig {
            assets: vec![AssetConfig {
                asset_id: "mintA".into(),
                underlying: "AAPLx".into(),
                target_weight_bps: 10_000,
                price_scale: 6,
                quantity_scale: 2,
                min_liquidity: "100000".into(),
                max_weight_bps: 10_000,
            }],
            max_dislocation_bps: 500,
            coherence_cap_ms: 120_000,
        }
    }
    fn captures(price: Option<&str>, liquidity: Option<&str>) -> BTreeMap<String, AssetCaptures> {
        let at = "2026-09-20T12:00:00Z";
        BTreeMap::from([(
            "mintA".into(),
            AssetCaptures {
                price: price.map_or_else(
                    || FieldCapture::failed("fixture", "1", at, "outage"),
                    |x| FieldCapture::ok("fixture", "1", at, "raw", x),
                ),
                liquidity: liquidity.map_or_else(
                    || FieldCapture::failed("fixture", "1", at, "outage"),
                    |x| FieldCapture::ok("fixture", "1", at, "raw", x),
                ),
            },
        )])
    }

    fn reference(at: &str, spot: &str) -> PythUnderlyingRef {
        PythUnderlyingRef {
            feed_id: "prestocks:AAPLx".into(),
            spot: spot.into(),
            publish_time: at.into(),
        }
    }

    fn reference_captures(at: &str, spot: &str) -> BTreeMap<String, FieldCapture> {
        let reference = reference(at, spot);
        BTreeMap::from([(
            "mintA".into(),
            FieldCapture::ok(
                "prestocks-issuer",
                "engine-prestocks-reference-v1",
                at,
                serde_json::json!({
                    "feed_id": reference.feed_id,
                    "spot": reference.spot,
                    "publish_time": reference.publish_time,
                })
                .to_string(),
                spot,
            ),
        )])
    }

    #[test]
    fn published_blocked_nodata_transitions() {
        let cfg = config();
        let observed = "2026-09-20T12:00:00Z";
        let refs = BTreeMap::from([("mintA".into(), Some(reference(observed, "150")))]);
        let ref_captures = reference_captures(observed, "150");
        let ready = build_snapshot(
            &cfg,
            &captures(Some("150000000"), Some("500000000")),
            &ref_captures,
            "2026-09-20T12:00:01Z",
        );
        assert!(matches!(
            evaluate_council(&cfg, &ready, &refs),
            Verdict::Published(_)
        ));
        let blocked = build_snapshot(
            &cfg,
            &captures(Some("150000000"), Some("5")),
            &ref_captures,
            "2026-09-20T12:00:01Z",
        );
        assert!(matches!(
            evaluate_council(&cfg, &blocked, &refs),
            Verdict::Blocked { .. }
        ));
        let no_data = build_snapshot(
            &cfg,
            &captures(None, Some("500000000")),
            &ref_captures,
            "2026-09-20T12:00:01Z",
        );
        assert!(matches!(
            evaluate_council(&cfg, &no_data, &refs),
            Verdict::NoData { .. }
        ));
    }

    #[test]
    fn dislocation_is_veto_only() {
        let cfg = config();
        let observed = "2026-09-20T12:00:00Z";
        let refs = BTreeMap::from([("mintA".into(), Some(reference(observed, "100")))]);
        let snap = build_snapshot(
            &cfg,
            &captures(Some("150000000"), Some("500000000")),
            &reference_captures(observed, "100"),
            "2026-09-20T12:00:01Z",
        );
        let verdict = evaluate_council(&cfg, &snap, &refs);
        assert!(matches!(verdict, Verdict::Blocked { .. }));
    }

    #[test]
    fn published_verdict_requires_reference_bytes_bound_to_the_snapshot() {
        // V69: the council reference must match the hash-bound capture.
        let cfg = config();
        let at = "2026-09-20T12:00:00Z";
        let refs = BTreeMap::from([("mintA".into(), Some(reference(at, "150")))]);
        let reference_fields = reference_captures(at, "149");
        let snapshot = build_snapshot(
            &cfg,
            &captures(Some("150000000"), Some("500000000")),
            &reference_fields,
            "2026-09-20T12:00:01Z",
        );
        assert_eq!(snapshot.status, SnapshotStatus::Ready);
        let verdict = evaluate_council(&cfg, &snapshot, &refs);
        assert!(matches!(verdict, Verdict::NoData { .. }));
        assert!(verdict.reasons()[0].contains("not bound to snapshot"));
    }

    #[test]
    fn v72_prestocks_symbol_must_match_the_configured_underlying() {
        let cfg = config();
        let at = "2026-09-20T12:00:00Z";
        let wrong_reference = PythUnderlyingRef {
            feed_id: "prestocks:OTHER".into(),
            spot: "150".into(),
            publish_time: at.into(),
        };
        let raw = serde_json::json!({
            "feed_id": wrong_reference.feed_id,
            "spot": wrong_reference.spot,
            "publish_time": wrong_reference.publish_time,
        })
        .to_string();
        let references = BTreeMap::from([("mintA".into(), Some(wrong_reference))]);
        let reference_fields = BTreeMap::from([(
            "mintA".into(),
            FieldCapture::ok("prestocks-issuer", "v1", at, raw, "150"),
        )]);
        let snapshot = build_snapshot(
            &cfg,
            &captures(Some("150000000"), Some("500000000")),
            &reference_fields,
            "2026-09-20T12:00:01Z",
        );
        assert!(matches!(
            evaluate_council(&cfg, &snapshot, &references),
            Verdict::NoData { .. }
        ));
    }

    #[test]
    fn v73_dislocation_gap_overflow_returns_no_data_and_renders() {
        let mut cfg = config();
        cfg.assets[0].price_scale = 0;
        let at = "2026-09-20T12:00:00Z";
        let references = BTreeMap::from([("mintA".into(), Some(reference(at, "1")))]);
        let snapshot = build_snapshot(
            &cfg,
            &captures(
                Some("340282366920938463463374607431768211455"),
                Some("500000000"),
            ),
            &reference_captures(at, "1"),
            "2026-09-20T12:00:01Z",
        );
        let verdict = evaluate_council(&cfg, &snapshot, &references);
        assert!(matches!(verdict, Verdict::NoData { .. }));
        assert!(
            render_advice(&snapshot, &verdict, &cfg, &references)
                .contains("Risk review: unavailable (NO_DATA)")
        );
    }
}

#[cfg(test)]
mod ingress_tests {
    use super::*;
    use crate::domain::{FieldCapture, SnapshotStatus};

    fn cfg() -> CouncilConfig {
        CouncilConfig {
            assets: vec![AssetConfig {
                asset_id: "mintA".into(),
                underlying: "AAPLx".into(),
                target_weight_bps: 10_000,
                max_weight_bps: 10_000,
                min_liquidity: "10".into(),
                price_scale: 6,
                quantity_scale: 2,
            }],
            max_dislocation_bps: 500,
            coherence_cap_ms: 120_000,
        }
    }

    fn fresh_captures(at: &str) -> BTreeMap<String, AssetCaptures> {
        BTreeMap::from([(
            "mintA".into(),
            AssetCaptures {
                price: FieldCapture::ok("fixture", "1", at, "raw", "150000000"),
                liquidity: FieldCapture::ok("fixture", "1", at, "raw", "500000000"),
            },
        )])
    }

    fn reference_captures(at: &str, spot: &str) -> BTreeMap<String, FieldCapture> {
        let reference = PythUnderlyingRef {
            feed_id: "prestocks:AAPLx".into(),
            spot: spot.into(),
            publish_time: at.into(),
        };
        BTreeMap::from([(
            "mintA".into(),
            FieldCapture::ok(
                "prestocks-issuer",
                "engine-prestocks-reference-v1",
                at,
                serde_json::json!({
                    "feed_id": reference.feed_id,
                    "spot": reference.spot,
                    "publish_time": reference.publish_time,
                })
                .to_string(),
                spot,
            ),
        )])
    }

    #[test]
    fn day_old_captures_cannot_publish() {
        let cfg = cfg();
        let refs = BTreeMap::new();
        let snapshot = build_snapshot(
            &cfg,
            &fresh_captures("2026-09-19T12:00:00Z"),
            &reference_captures("2026-09-19T12:00:00Z", "150"),
            "2026-09-20T12:00:00Z",
        );
        assert_eq!(snapshot.status, SnapshotStatus::NoData);
        let verdict = evaluate_council(&cfg, &snapshot, &refs);
        assert!(matches!(verdict, Verdict::NoData { .. }));
        assert!(
            verdict
                .reasons()
                .iter()
                .any(|reason| reason.contains("capture.time-stale"))
        );
    }

    #[test]
    fn forged_ready_status_is_rejected_at_ingress() {
        let cfg = cfg();
        let refs = BTreeMap::new();
        let honest = build_snapshot(
            &cfg,
            &fresh_captures("2026-09-19T12:00:00Z"),
            &reference_captures("2026-09-19T12:00:00Z", "150"),
            "2026-09-20T12:00:00Z",
        );
        let mut forged = honest.clone();
        forged.status = SnapshotStatus::Ready;
        forged.conflicts.clear();
        // Attacker recomputes a self-consistent hash over the forged payload.
        forged.sha256 = crate::domain::sha256_hex(forged.canonical_json().as_bytes());
        assert!(forged.verify_hash(), "forgery is hash self-consistent");
        let verdict = evaluate_council(&cfg, &forged, &refs);
        assert!(matches!(verdict, Verdict::NoData { .. }));
        assert!(verdict.reasons()[0].contains("readiness mismatch"));
    }
}
