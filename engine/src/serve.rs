use crate::council::{AssetConfig, CouncilConfig, build_snapshot, evaluate_council, render_advice};
use crate::dexscreener::{AssetCaptures, DexAsset, fetch_asset};
use crate::domain::{CanonicalSnapshot, FieldCapture, Verdict, sha256_hex};
use crate::graph::{KnowledgeGraph, build_graph};
use crate::prestocks::{fetch_prestocks, fetch_scaled_ui_multipliers, normalize_scaled_price};
use crate::pyth::{PythAssetFeeds, PythPriceResult, PythUnderlyingRef, fetch_pyth_prices};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::RwLock;

const PRESTOCKS_REFERENCE_VERSION: &str = "engine-prestocks-reference-v1";

#[derive(Clone, Debug, Serialize)]
pub struct AdviceEvidence {
    pub asset_id: String,
    pub underlying: String,
    pub token_price: Option<String>,
    pub liquidity: Option<String>,
    pub underlying_price: Option<String>,
    pub premium_bps: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdviceCitation {
    pub asset_id: String,
    pub field: String,
    pub source_id: String,
    pub source_version: String,
    pub observed_at: String,
    pub value: String,
    pub raw_excerpt_sha256: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdviceResponse {
    pub status: String,
    pub snapshot_sha256: String,
    pub created_at: String,
    pub execution_ready: bool,
    pub reasons: Vec<String>,
    pub evidence: Vec<AdviceEvidence>,
    pub citations: Vec<AdviceCitation>,
    pub latency_ms: u128,
}

#[derive(Clone, Debug)]
pub struct Evaluation {
    pub snapshot: CanonicalSnapshot,
    pub verdict: Verdict,
    pub references: BTreeMap<String, Option<PythUnderlyingRef>>,
    pub advice: AdviceResponse,
    pub graph: KnowledgeGraph,
    pub rendered: String,
}

pub fn config() -> CouncilConfig {
    CouncilConfig {
        assets: vec![
            AssetConfig {
                asset_id: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF".into(),
                underlying: "OPENAI".into(),
                target_weight_bps: 6000,
                price_scale: 6,
                quantity_scale: 2,
                min_liquidity: "500000".into(),
                max_weight_bps: 8000,
            },
            AssetConfig {
                asset_id: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh".into(),
                underlying: "SPACEX".into(),
                target_weight_bps: 4000,
                price_scale: 6,
                quantity_scale: 2,
                min_liquidity: "500000".into(),
                max_weight_bps: 8000,
            },
        ],
        max_dislocation_bps: 500,
        coherence_cap_ms: 120_000,
    }
}

async fn fetch_dex(config: &CouncilConfig) -> BTreeMap<String, AssetCaptures> {
    let mut handles = Vec::new();
    for asset in &config.assets {
        let dex = DexAsset {
            asset_id: asset.asset_id.clone(),
            price_scale: asset.price_scale,
            quantity_scale: asset.quantity_scale,
        };
        let asset_id = asset.asset_id.clone();
        handles.push(tokio::spawn(async move {
            (asset_id, fetch_asset(&dex, None).await)
        }));
    }
    let mut captures = BTreeMap::new();
    for handle in handles {
        if let Ok((asset_id, asset_captures)) = handle.await {
            captures.insert(asset_id, asset_captures);
        }
    }
    captures
}

fn env_feed(underlying: &str, role: &str) -> String {
    let key = format!("PYTH_{}_{}_FEED_ID", underlying.to_ascii_uppercase(), role);
    std::env::var(key).unwrap_or_default()
}

fn pyth_feeds(config: &CouncilConfig) -> Vec<PythAssetFeeds> {
    config
        .assets
        .iter()
        .map(|asset| PythAssetFeeds {
            asset_id: asset.asset_id.clone(),
            underlying: asset.underlying.clone(),
            price_scale: asset.price_scale,
            tokenized_feed_id: env_feed(&asset.underlying, "TOKENIZED"),
            underlying_feed_id: env_feed(&asset.underlying, "UNDERLYING"),
        })
        .collect()
}

fn fixed(value: &str, scale: u32) -> String {
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

fn premium_bps(
    token: Option<&str>,
    reference: Option<&PythUnderlyingRef>,
    scale: u32,
) -> Option<i64> {
    let token = token?.parse::<i128>().ok()?;
    let underlying = crate::prestocks::scale_decimal_to_integer(&reference?.spot, scale)?
        .parse::<i128>()
        .ok()?;
    if underlying <= 0 {
        return None;
    }
    let gap = (token - underlying)
        .checked_mul(10_000)?
        .checked_div(underlying)?;
    i64::try_from(gap).ok()
}

fn advice(
    config: &CouncilConfig,
    snapshot: &CanonicalSnapshot,
    verdict: &Verdict,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
    latency_ms: u128,
) -> AdviceResponse {
    let evidence = config
        .assets
        .iter()
        .map(|asset| {
            let price = snapshot
                .captures
                .get(&crate::council::capture_key(&asset.asset_id, "price"))
                .and_then(|capture| capture.value.as_deref());
            let liquidity = snapshot
                .captures
                .get(&crate::council::capture_key(&asset.asset_id, "liquidity"))
                .and_then(|capture| capture.value.as_deref());
            let reference = references
                .get(&asset.asset_id)
                .and_then(|value| value.as_ref());
            AdviceEvidence {
                asset_id: asset.asset_id.clone(),
                underlying: asset.underlying.clone(),
                token_price: price.map(|value| fixed(value, asset.price_scale)),
                liquidity: liquidity.map(|value| fixed(value, asset.quantity_scale)),
                underlying_price: reference.map(|value| value.spot.clone()),
                premium_bps: premium_bps(price, reference, asset.price_scale),
            }
        })
        .collect();
    let citations = if matches!(verdict, Verdict::Published(_)) {
        config
            .assets
            .iter()
            .flat_map(|asset| {
                ["price", "liquidity", "reference"]
                    .into_iter()
                    .filter_map(|field| {
                        let capture = snapshot
                            .captures
                            .get(&crate::council::capture_key(&asset.asset_id, field))?;
                        Some(AdviceCitation {
                            asset_id: asset.asset_id.clone(),
                            field: field.to_string(),
                            source_id: capture.source_id.clone(),
                            source_version: capture.source_version.clone(),
                            observed_at: capture.observed_at.clone(),
                            value: capture.value.clone()?,
                            raw_excerpt_sha256: sha256_hex(capture.raw_excerpt.as_bytes()),
                        })
                    })
            })
            .collect()
    } else {
        Vec::new()
    };
    AdviceResponse {
        status: verdict.status().to_string(),
        snapshot_sha256: snapshot.sha256.clone(),
        created_at: snapshot.created_at.clone(),
        execution_ready: false,
        reasons: verdict.reasons().to_vec(),
        evidence,
        citations,
        latency_ms,
    }
}

fn reference_raw(reference: &PythUnderlyingRef) -> String {
    serde_json::json!({
        "feed_id": &reference.feed_id,
        "spot": &reference.spot,
        "publish_time": &reference.publish_time,
    })
    .to_string()
}

fn reference_captures(
    config: &CouncilConfig,
    prestocks: &crate::prestocks::PreStocksData,
    feeds: &[PythAssetFeeds],
    pyth: &BTreeMap<String, PythPriceResult>,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
    observed_at: &str,
) -> BTreeMap<String, FieldCapture> {
    config
        .assets
        .iter()
        .map(|asset| {
            let reference = references.get(&asset.asset_id).and_then(Option::as_ref);
            let configured_feed = feeds.iter().find(|feed| feed.asset_id == asset.asset_id);
            let capture = if let Some(feed) = configured_feed {
                match pyth.get(&asset.asset_id) {
                    Some(result) if result.price.is_ok() => match reference {
                        Some(reference) => FieldCapture::ok(
                            "pyth",
                            result.price.source_version.clone(),
                            result.price.observed_at.clone(),
                            reference_raw(reference),
                            reference.spot.clone(),
                        ),
                        None => FieldCapture::failed(
                            "pyth",
                            result.price.source_version.clone(),
                            result.price.observed_at.clone(),
                            format!(
                                "{} Pyth reference missing underlying value",
                                feed.underlying
                            ),
                        ),
                    },
                    Some(result) => FieldCapture::failed(
                        "pyth",
                        result.price.source_version.clone(),
                        result.price.observed_at.clone(),
                        format!(
                            "{} Pyth reference unavailable: {}",
                            feed.underlying, result.price.raw_excerpt
                        ),
                    ),
                    None => FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        observed_at,
                        format!(
                            "{} Pyth reference unavailable: missing result",
                            feed.underlying
                        ),
                    ),
                }
            } else if let Some(reference) = reference {
                FieldCapture::ok(
                    "prestocks-issuer",
                    PRESTOCKS_REFERENCE_VERSION,
                    reference.publish_time.clone(),
                    reference_raw(reference),
                    reference.spot.clone(),
                )
            } else {
                FieldCapture::failed(
                    "prestocks-issuer",
                    PRESTOCKS_REFERENCE_VERSION,
                    observed_at,
                    prestocks.error.clone().unwrap_or_else(|| {
                        format!("{} issuer reference missing", asset.underlying)
                    }),
                )
            };
            (asset.asset_id.clone(), capture)
        })
        .collect()
}

/// Configured Pyth feeds replace the issuer mark. A missing, failed, or stale
/// result for a configured feed fails the verdict closed. No configured feed
/// leaves the issuer mark alone.
pub fn apply_pyth_references(
    references: &mut BTreeMap<String, Option<PythUnderlyingRef>>,
    feeds: &[PythAssetFeeds],
    pyth: &BTreeMap<String, PythPriceResult>,
) {
    for feed in feeds {
        match pyth.get(&feed.asset_id) {
            Some(result) if result.price.is_ok() && result.underlying.is_some() => {
                references.insert(feed.asset_id.clone(), result.underlying.clone());
            }
            Some(_) => {
                references.insert(feed.asset_id.clone(), None);
            }
            None => {
                references.insert(feed.asset_id.clone(), None);
            }
        }
    }
}

/// One full evaluation. Reference policy mirrors the preipo CLI: the
/// PreStocks issuer mark is the default underlying reference (pre-IPO names
/// have no Pyth equity feed). When an asset's Pyth feed IDs are configured
/// through the environment, Pyth becomes that asset's reference and a
/// configured-but-failing feed fails closed to NO_DATA. Unconfigured Pyth is
/// not an error.
pub async fn evaluate_once(config: &CouncilConfig) -> Evaluation {
    let started = Instant::now();
    let mints = config
        .assets
        .iter()
        .map(|asset| asset.asset_id.clone())
        .collect::<Vec<_>>();
    let feeds: Vec<PythAssetFeeds> = pyth_feeds(config)
        .into_iter()
        .filter(|feed| !feed.tokenized_feed_id.is_empty() || !feed.underlying_feed_id.is_empty())
        .collect();
    let pyth_key = std::env::var("PYTH_API_KEY").ok();
    let (prestocks, multipliers, mut dex_captures, pyth) = tokio::join!(
        fetch_prestocks(&mints, None),
        fetch_scaled_ui_multipliers(&mints, None),
        fetch_dex(config),
        fetch_pyth_prices(&feeds, Duration::from_secs(900), None, pyth_key.as_deref()),
    );
    for asset in &config.assets {
        if let Some(captures) = dex_captures.get_mut(&asset.asset_id) {
            if let Some(error) = &prestocks.error {
                captures.price = FieldCapture::failed(
                    &captures.price.source_id,
                    &captures.price.source_version,
                    &captures.price.observed_at,
                    error.clone(),
                );
                continue;
            }
            let multiplier = multipliers
                .get(&asset.asset_id)
                .and_then(|value| value.as_deref());
            let issuer = prestocks
                .issuer_prices
                .get(&asset.asset_id)
                .and_then(|value| value.as_deref());
            captures.price =
                normalize_scaled_price(&captures.price, asset.price_scale, multiplier, issuer, 500);
        }
    }
    // Issuer-mark refs first; Pyth overlays only assets with configured feeds.
    let mut references: BTreeMap<String, Option<PythUnderlyingRef>> = config
        .assets
        .iter()
        .map(|asset| {
            (
                asset.asset_id.clone(),
                prestocks.refs.get(&asset.asset_id).cloned().flatten(),
            )
        })
        .collect();
    apply_pyth_references(&mut references, &feeds, &pyth);
    let created_at = crate::pyth::now_iso();
    let reference_captures =
        reference_captures(config, &prestocks, &feeds, &pyth, &references, &created_at);
    let snapshot = build_snapshot(config, &dex_captures, &reference_captures, created_at);
    let verdict = evaluate_council(config, &snapshot, &references);
    let latency_ms = started.elapsed().as_millis();
    let rendered = render_advice(&snapshot, &verdict, config, &references);
    let graph = build_graph(config, &snapshot, &verdict, &references);
    let advice = advice(config, &snapshot, &verdict, &references, latency_ms);
    Evaluation {
        snapshot,
        verdict,
        references,
        advice,
        graph,
        rendered,
    }
}

struct SharedState {
    evaluation: RwLock<Evaluation>,
}

async fn read_request(stream: &mut TcpStream) -> Option<String> {
    let mut bytes = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while bytes.len() < 8192 {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    (bytes.len() <= 8192).then(|| String::from_utf8_lossy(&bytes).into_owned())
}

async fn handle_connection(mut stream: TcpStream, state: Arc<SharedState>) {
    let request = read_request(&mut stream).await;
    let (status, body) = if let Some(request) = request {
        let mut parts = request
            .lines()
            .next()
            .unwrap_or_default()
            .split_whitespace();
        let method = parts.next().unwrap_or_default();
        let path = parts
            .next()
            .unwrap_or_default()
            .split('?')
            .next()
            .unwrap_or_default();
        let guard = state.evaluation.read().await;
        match (method, path) {
            ("GET", "/advice") => (
                "200 OK",
                serde_json::to_string(&guard.advice).unwrap_or_else(|_| "{}".into()),
            ),
            ("GET", "/graph") => (
                "200 OK",
                serde_json::to_string(&guard.graph).unwrap_or_else(|_| "{}".into()),
            ),
            _ => ("404 Not Found", r#"{"error":"not found"}"#.to_string()),
        }
    } else {
        ("404 Not Found", r#"{"error":"not found"}"#.to_string())
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

pub async fn run_server(
    config: CouncilConfig,
    port: u16,
    interval: Duration,
) -> std::io::Result<()> {
    let initial = evaluate_once(&config).await;
    let state = Arc::new(SharedState {
        evaluation: RwLock::new(initial),
    });
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let updater_state = Arc::clone(&state);
    let updater_config = config.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(interval).await;
            let next = evaluate_once(&updater_config).await;
            *updater_state.evaluation.write().await = next;
        }
    });
    loop {
        tokio::select! {
            result = listener.accept() => {
                if let Ok((stream, _)) = result {
                    tokio::spawn(handle_connection(stream, Arc::clone(&state)));
                }
            }
            _ = tokio::signal::ctrl_c() => break,
        }
    }
    Ok(())
}

pub async fn write_graph(config: &CouncilConfig, path: &str) -> std::io::Result<()> {
    let evaluation = evaluate_once(config).await;
    let json = serde_json::to_vec_pretty(&evaluation.graph).map_err(std::io::Error::other)?;
    tokio::fs::write(path, json).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::council::{build_snapshot, evaluate_council, render_advice};
    use crate::dexscreener::AssetCaptures;
    use crate::domain::{FieldCapture, Verdict};

    #[test]
    fn stocklana_roster_is_prestocks_only() {
        let cfg = config();
        assert_eq!(cfg.assets.len(), 2);
        for asset in &cfg.assets {
            assert!(asset.asset_id.starts_with("Pre"), "{}", asset.asset_id);
            assert!(matches!(asset.underlying.as_str(), "OPENAI" | "SPACEX"));
            assert!(!asset.underlying.to_ascii_lowercase().contains("tessera"));
        }
    }

    #[test]
    fn missing_price_does_not_publish_a_number() {
        let cfg = config();
        let at = "2026-09-22T12:00:00Z";
        let mut captures = BTreeMap::new();
        for asset in &cfg.assets {
            captures.insert(
                asset.asset_id.clone(),
                AssetCaptures {
                    price: FieldCapture::failed("dexscreener", "v1", at, "outage"),
                    liquidity: FieldCapture::ok("dexscreener", "v1", at, "raw", "500000000"),
                },
            );
        }
        let snapshot = build_snapshot(&cfg, &captures, &BTreeMap::new(), "2026-09-22T12:00:01Z");
        let references = BTreeMap::new();
        let verdict = evaluate_council(&cfg, &snapshot, &references);
        let response = advice(&cfg, &snapshot, &verdict, &references, 1);
        let rendered = render_advice(&snapshot, &verdict, &cfg, &references);
        assert!(matches!(verdict, Verdict::NoData { .. }));
        assert_eq!(response.status, "NO_DATA");
        assert!(!response.execution_ready);
        assert!(response.citations.is_empty());
        assert!(
            response
                .evidence
                .iter()
                .all(|row| row.token_price.is_none())
        );
        assert!(rendered.contains("token=$NO_DATA"));
    }

    fn issuer_ref() -> PythUnderlyingRef {
        PythUnderlyingRef {
            feed_id: "prestocks:OPENAI".into(),
            spot: "1002.30".into(),
            publish_time: "2026-09-22T12:00:00Z".into(),
        }
    }

    #[test]
    fn unconfigured_pyth_keeps_the_issuer_mark() {
        let mint = config().assets[0].asset_id.clone();
        let mut references = BTreeMap::from([(mint.clone(), Some(issuer_ref()))]);
        apply_pyth_references(&mut references, &[], &BTreeMap::new());
        assert_eq!(
            references
                .get(&mint)
                .and_then(|value| value.as_ref())
                .map(|value| value.spot.as_str()),
            Some("1002.30")
        );
    }

    #[test]
    fn configured_pyth_failure_removes_the_issuer_mark_and_good_feed_replaces_it() {
        let asset = &config().assets[0];
        let feed = PythAssetFeeds {
            asset_id: asset.asset_id.clone(),
            underlying: asset.underlying.clone(),
            price_scale: asset.price_scale,
            tokenized_feed_id: "ab".into(),
            underlying_feed_id: "cd".into(),
        };
        let mut missing = BTreeMap::from([(asset.asset_id.clone(), Some(issuer_ref()))]);
        apply_pyth_references(&mut missing, &[feed.clone()], &BTreeMap::new());
        assert!(missing.get(&asset.asset_id).unwrap().is_none());

        let mut failed = BTreeMap::from([(asset.asset_id.clone(), Some(issuer_ref()))]);
        let mut pyth = BTreeMap::from([(
            asset.asset_id.clone(),
            PythPriceResult {
                price: FieldCapture::failed(
                    "pyth",
                    "pyth-hermes-v2",
                    "2026-09-22T12:00:00Z",
                    "stale",
                ),
                underlying: None,
            },
        )]);
        apply_pyth_references(&mut failed, &[feed.clone()], &pyth);

        let mut replaced = BTreeMap::from([(asset.asset_id.clone(), Some(issuer_ref()))]);
        pyth.insert(
            asset.asset_id.clone(),
            PythPriceResult {
                price: FieldCapture::ok(
                    "pyth",
                    "pyth-hermes-v2",
                    "2026-09-22T12:00:00Z",
                    "raw",
                    "1",
                ),
                underlying: Some(PythUnderlyingRef {
                    feed_id: "0xfeed".into(),
                    spot: "55.5".into(),
                    publish_time: "2026-09-22T12:00:00Z".into(),
                }),
            },
        );
        apply_pyth_references(&mut replaced, &[feed], &pyth);
        assert_eq!(
            replaced
                .get(&asset.asset_id)
                .unwrap()
                .as_ref()
                .unwrap()
                .spot,
            "55.5"
        );
        assert!(
            replaced
                .get(&asset.asset_id)
                .unwrap()
                .as_ref()
                .unwrap()
                .feed_id
                .starts_with("0x")
        );
    }

    #[test]
    fn configured_pyth_failure_enters_hashed_snapshot_and_returns_no_data() {
        // V69: a configured Pyth failure is a failed canonical capture.
        let cfg = config();
        let at = "2026-09-22T12:00:00Z";
        let asset = &cfg.assets[0];
        let feed = PythAssetFeeds {
            asset_id: asset.asset_id.clone(),
            underlying: asset.underlying.clone(),
            price_scale: asset.price_scale,
            tokenized_feed_id: "ab".into(),
            underlying_feed_id: "cd".into(),
        };
        let mut references = cfg
            .assets
            .iter()
            .map(|asset| {
                (
                    asset.asset_id.clone(),
                    Some(PythUnderlyingRef {
                        feed_id: format!("prestocks:{}", asset.underlying),
                        spot: "100".into(),
                        publish_time: at.into(),
                    }),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let pyth = BTreeMap::from([(
            asset.asset_id.clone(),
            PythPriceResult {
                price: FieldCapture::failed("pyth", "pyth-hermes-v2", at, "stale feed"),
                underlying: None,
            },
        )]);
        apply_pyth_references(&mut references, &[feed.clone()], &pyth);
        let prestocks = crate::prestocks::PreStocksData {
            refs: BTreeMap::new(),
            issuer_prices: BTreeMap::new(),
            error: None,
        };
        let ref_captures = reference_captures(&cfg, &prestocks, &[feed], &pyth, &references, at);
        assert!(
            ref_captures[&asset.asset_id]
                .raw_excerpt
                .contains("stale feed")
        );

        let dex = cfg
            .assets
            .iter()
            .map(|asset| {
                (
                    asset.asset_id.clone(),
                    AssetCaptures {
                        price: FieldCapture::ok("dexscreener", "v1", at, "price", "100000000"),
                        liquidity: FieldCapture::ok(
                            "dexscreener",
                            "v1",
                            at,
                            "liquidity",
                            "60000000",
                        ),
                    },
                )
            })
            .collect();
        let snapshot = build_snapshot(&cfg, &dex, &ref_captures, "2026-09-22T12:00:01Z");
        assert_eq!(snapshot.status, crate::domain::SnapshotStatus::NoData);
        assert!(
            snapshot.captures[&crate::council::capture_key(&asset.asset_id, "reference")]
                .raw_excerpt
                .contains("stale feed")
        );
        let mut changed_failures = ref_captures.clone();
        changed_failures.insert(
            asset.asset_id.clone(),
            FieldCapture::failed("pyth", "pyth-hermes-v2", at, "provider outage"),
        );
        let changed_snapshot =
            build_snapshot(&cfg, &dex, &changed_failures, "2026-09-22T12:00:01Z");
        assert_ne!(snapshot.sha256, changed_snapshot.sha256);
        let verdict = evaluate_council(&cfg, &snapshot, &references);
        assert!(matches!(verdict, Verdict::NoData { .. }));
        assert!(
            verdict
                .reasons()
                .iter()
                .any(|reason| reason.contains("stale feed"))
        );
    }

    #[test]
    fn published_advice_returns_citations_and_execution_ready_false() {
        // V70: published citations carry capture identity; readiness stays false.
        let cfg = config();
        let at = "2026-09-22T12:00:00Z";
        let references = cfg
            .assets
            .iter()
            .map(|asset| {
                (
                    asset.asset_id.clone(),
                    Some(PythUnderlyingRef {
                        feed_id: format!("prestocks:{}", asset.underlying),
                        spot: "100".into(),
                        publish_time: at.into(),
                    }),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let reference_fields = references
            .iter()
            .map(|(asset_id, reference)| {
                let reference = reference.as_ref().unwrap();
                (
                    asset_id.clone(),
                    FieldCapture::ok(
                        "prestocks-issuer",
                        PRESTOCKS_REFERENCE_VERSION,
                        at,
                        reference_raw(reference),
                        reference.spot.clone(),
                    ),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let dex = cfg
            .assets
            .iter()
            .map(|asset| {
                (
                    asset.asset_id.clone(),
                    AssetCaptures {
                        price: FieldCapture::ok("dexscreener", "v1", at, "price", "100000000"),
                        liquidity: FieldCapture::ok(
                            "dexscreener",
                            "v1",
                            at,
                            "liquidity",
                            "60000000",
                        ),
                    },
                )
            })
            .collect();
        let snapshot = build_snapshot(&cfg, &dex, &reference_fields, "2026-09-22T12:00:01Z");
        let verdict = evaluate_council(&cfg, &snapshot, &references);
        assert!(matches!(verdict, Verdict::Published(_)));
        let response = advice(&cfg, &snapshot, &verdict, &references, 1);
        assert!(!response.execution_ready);
        assert_eq!(response.citations.len(), cfg.assets.len() * 3);
        assert!(response.citations.iter().all(|citation| {
            citation.raw_excerpt_sha256.len() == 64
                && ["price", "liquidity", "reference"].contains(&citation.field.as_str())
        }));
    }
}
