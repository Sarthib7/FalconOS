use crate::dexscreener::AssetCaptures;
use crate::domain::{
    CanonicalSnapshot, FieldCapture, Proposal, ProposalLeg, SnapshotStatus, Verdict, sha256_hex,
};
use crate::prestocks::scale_decimal_to_integer;
use crate::pyth::PythUnderlyingRef;
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

pub fn capture_key(asset_id: &str, field: &str) -> String {
    format!("{asset_id}.{field}")
}

pub fn build_snapshot(
    config: &CouncilConfig,
    captures: &BTreeMap<String, AssetCaptures>,
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
    }
    CanonicalSnapshot::new(fields, created_at)
}

/// Deterministic council: a lead proposal is assembled only for a READY
/// snapshot, then the independent reviewer can veto on liquidity or dislocation.
pub fn evaluate_council(
    config: &CouncilConfig,
    snapshot: &CanonicalSnapshot,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
) -> Verdict {
    if !snapshot.verify_hash() {
        return Verdict::NoData {
            reasons: vec!["snapshot hash verification failed".into()],
        };
    }
    if snapshot.status != SnapshotStatus::Ready {
        return Verdict::NoData {
            reasons: missing_reasons(snapshot),
        };
    }
    if config.assets.is_empty() {
        return Verdict::NoData {
            reasons: vec!["no assets configured".into()],
        };
    }
    let weight_sum: u32 = config
        .assets
        .iter()
        .map(|asset| asset.target_weight_bps)
        .sum();
    if weight_sum != 10_000 {
        return Verdict::NoData {
            reasons: vec!["proposal weights must sum to 10000 bps".into()],
        };
    }
    for asset in &config.assets {
        if asset.target_weight_bps == 0 || asset.target_weight_bps > asset.max_weight_bps {
            return Verdict::NoData {
                reasons: vec![format!(
                    "{} target weight exceeds registry cap",
                    asset.underlying
                )],
            };
        }
        for field in ["price", "liquidity"] {
            if !snapshot
                .captures
                .contains_key(&capture_key(&asset.asset_id, field))
            {
                return Verdict::NoData {
                    reasons: vec![format!("{}.{} capture missing", asset.underlying, field)],
                };
            }
        }
    }
    for asset in &config.assets {
        let price = snapshot
            .captures
            .get(&capture_key(&asset.asset_id, "price"))
            .and_then(|capture| capture.value.as_deref());
        if price.and_then(|value| value.parse::<u128>().ok()).is_none() {
            return Verdict::NoData {
                reasons: vec![format!(
                    "{} token price unavailable or unparseable",
                    asset.underlying
                )],
            };
        }
    }
    let mut vetoes = Vec::new();
    for asset in &config.assets {
        let liquidity = snapshot
            .captures
            .get(&capture_key(&asset.asset_id, "liquidity"))
            .and_then(|capture| capture.value.as_deref())
            .and_then(|value| value.parse::<u128>().ok());
        let floor = asset.min_liquidity.parse::<u128>().ok();
        match (liquidity, floor) {
            (Some(value), Some(floor)) if value < floor => {
                vetoes.push(format!("{} pool liquidity below floor", asset.underlying))
            }
            (None, _) => {
                return Verdict::NoData {
                    reasons: vec![format!("{} liquidity unavailable", asset.underlying)],
                };
            }
            (_, None) => {
                return Verdict::NoData {
                    reasons: vec![format!("{} liquidity floor invalid", asset.underlying)],
                };
            }
            _ => {}
        }
        let price = snapshot
            .captures
            .get(&capture_key(&asset.asset_id, "price"))
            .and_then(|capture| capture.value.as_deref());
        if let (Some(price), Some(reference)) = (
            price,
            references.get(&asset.asset_id).and_then(|x| x.as_ref()),
        ) {
            let Some(underlying_units) =
                scale_decimal_to_integer(&reference.spot, asset.price_scale)
                    .and_then(|value| value.parse::<u128>().ok())
            else {
                return Verdict::NoData {
                    reasons: vec![format!("{} underlying mark unparseable", asset.underlying)],
                };
            };
            let Ok(token_units) = price.parse::<u128>() else {
                return Verdict::NoData {
                    reasons: vec![format!("{} token price unparseable", asset.underlying)],
                };
            };
            if let Some(gap_bps) =
                (token_units.abs_diff(underlying_units) * 10_000).checked_div(underlying_units)
                && gap_bps > u128::from(config.max_dislocation_bps)
            {
                vetoes.push(format!(
                    "{} token dislocated {gap_bps}bps from underlying",
                    asset.underlying
                ));
            }
        }
    }
    if !vetoes.is_empty() {
        return Verdict::Blocked { reasons: vetoes };
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
    Verdict::Published(Proposal {
        proposal_id: format!("engine-{}", &snapshot.sha256[..12]),
        legs,
        snapshot_sha256: snapshot.sha256.clone(),
        expires_at: snapshot.created_at.clone(),
        authority: "advisory-only".into(),
        execution_ready: false,
    })
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
        "FalconOS · Stocks live dashboard   [advisory-only · executionReady=false]".to_string(),
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
            && let Some(gap) = (token.abs_diff(underlying) * 10_000).checked_div(underlying)
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
            for field in ["price", "liquidity"] {
                if let Some(capture) = snapshot.captures.get(&capture_key(&asset.asset_id, field)) {
                    lines.push(format!(
                        "  {:<10} {:<10} {}  sha256={}",
                        asset.underlying,
                        field,
                        capture.source_id,
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
        BTreeMap::from([(
            "mintA".into(),
            AssetCaptures {
                price: price.map_or_else(
                    || FieldCapture::failed("fixture", "1", "t", "outage"),
                    |x| FieldCapture::ok("fixture", "1", "t", "raw", x),
                ),
                liquidity: liquidity.map_or_else(
                    || FieldCapture::failed("fixture", "1", "t", "outage"),
                    |x| FieldCapture::ok("fixture", "1", "t", "raw", x),
                ),
            },
        )])
    }

    #[test]
    fn published_blocked_nodata_transitions() {
        let cfg = config();
        let refs = BTreeMap::new();
        let ready = build_snapshot(&cfg, &captures(Some("150000000"), Some("500000000")), "t");
        assert!(matches!(
            evaluate_council(&cfg, &ready, &refs),
            Verdict::Published(_)
        ));
        let blocked = build_snapshot(&cfg, &captures(Some("150000000"), Some("5")), "t");
        assert!(matches!(
            evaluate_council(&cfg, &blocked, &refs),
            Verdict::Blocked { .. }
        ));
        let no_data = build_snapshot(&cfg, &captures(None, Some("500000000")), "t");
        assert!(matches!(
            evaluate_council(&cfg, &no_data, &refs),
            Verdict::NoData { .. }
        ));
    }

    #[test]
    fn dislocation_is_veto_only() {
        let cfg = config();
        let mut refs = BTreeMap::new();
        refs.insert(
            "mintA".into(),
            Some(PythUnderlyingRef {
                feed_id: "x".into(),
                spot: "100".into(),
                publish_time: "t".into(),
            }),
        );
        let snap = build_snapshot(&cfg, &captures(Some("150000000"), Some("500000000")), "t");
        let verdict = evaluate_council(&cfg, &snap, &refs);
        assert!(matches!(verdict, Verdict::Blocked { .. }));
    }
}
