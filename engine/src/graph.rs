use crate::council::{AssetConfig, CouncilConfig, capture_key};
use crate::domain::{CanonicalSnapshot, Verdict};
use crate::pyth::PythUnderlyingRef;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    /// Value, source id, or failure reason. Never empty.
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct KnowledgeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

fn asset_id(asset: &AssetConfig) -> String {
    format!("asset:{}", asset.asset_id)
}

fn source_id(source: &str) -> String {
    format!("source:{source}")
}

/// Emit the deterministic graph for one canonical evaluation. IDs are derived
/// only from stable domain identifiers, and BTree collections keep JSON order
/// stable for artifacts and downstream consumers.
pub fn build_graph(
    config: &CouncilConfig,
    snapshot: &CanonicalSnapshot,
    verdict: &Verdict,
    references: &BTreeMap<String, Option<PythUnderlyingRef>>,
) -> KnowledgeGraph {
    let mut nodes = BTreeMap::<String, GraphNode>::new();
    let mut edges = BTreeSet::<(String, String, String)>::new();
    let mut add_node = |id: String, kind: &str, label: String, detail: String| {
        nodes.entry(id.clone()).or_insert_with(|| GraphNode {
            id,
            kind: kind.to_string(),
            label,
            detail,
        });
    };
    let mut add_edge = |from: String, to: String, kind: &str| {
        edges.insert((from, to, kind.to_string()));
    };

    let issuer = "issuer:prestocks".to_string();
    add_node(
        issuer.clone(),
        "issuer",
        "PreStocks".to_string(),
        "issuer registry".to_string(),
    );
    for (fixed, detail) in [
        ("dexscreener", "Solana token-pair market data"),
        ("prestocks-issuer", "mark and token price"),
        ("solana-rpc", "token-2022 supply"),
    ] {
        add_node(
            source_id(fixed),
            "source",
            fixed.to_string(),
            detail.to_string(),
        );
    }
    add_node(
        "venue:solana".to_string(),
        "venue",
        "Solana".to_string(),
        "market data".to_string(),
    );

    for asset in &config.assets {
        let aid = asset_id(asset);
        let underlying = format!("underlying:{}", asset.underlying);
        add_node(
            aid.clone(),
            "asset",
            asset.asset_id.clone(),
            asset.underlying.clone(),
        );
        // The graph contract has no separate `underlying` kind; symbols are
        // represented as asset-kind nodes and linked with asset-underlying.
        add_node(
            underlying.clone(),
            "asset",
            asset.underlying.clone(),
            "underlying symbol".to_string(),
        );
        add_edge(aid.clone(), issuer.clone(), "asset-issuer");
        add_edge(aid.clone(), underlying, "asset-underlying");
        add_edge(aid.clone(), "venue:solana".to_string(), "asset-venue");

        // Reference provenance comes from the actual reference used, never a
        // hardcoded provider: issuer marks attribute to prestocks-issuer, Pyth
        // feeds to a lazily added pyth source, absence stays visible.
        match references
            .get(&asset.asset_id)
            .and_then(|value| value.as_ref())
        {
            Some(reference) if reference.feed_id.starts_with("prestocks:") => {
                let mark_node = source_id(&format!("issuer-mark:{}", asset.underlying));
                add_node(
                    mark_node.clone(),
                    "source",
                    format!("PreStocks mark {}", asset.underlying),
                    reference.spot.clone(),
                );
                add_edge(aid.clone(), mark_node.clone(), "asset-reference");
                add_edge(mark_node, source_id("prestocks-issuer"), "reference-source");
            }
            Some(reference) => {
                add_node(
                    source_id("pyth"),
                    "source",
                    "pyth".to_string(),
                    "hermes".to_string(),
                );
                let feed_node = source_id(&format!("pyth-feed:{}", reference.feed_id));
                add_node(
                    feed_node.clone(),
                    "source",
                    format!("Pyth feed {}", reference.feed_id),
                    reference.spot.clone(),
                );
                add_edge(aid.clone(), feed_node.clone(), "asset-reference");
                add_edge(feed_node, source_id("pyth"), "reference-source");
            }
            None => {
                let missing_node = format!("evidence:reference-missing:{}", asset.underlying);
                let detail = snapshot
                    .captures
                    .get(&capture_key(&asset.asset_id, "reference"))
                    .map(|capture| capture.raw_excerpt.clone())
                    .unwrap_or_else(|| "reference capture missing".to_string());
                add_node(
                    missing_node.clone(),
                    "evidence",
                    format!("{} reference unavailable", asset.underlying),
                    detail,
                );
                add_edge(aid, missing_node, "asset-reference");
            }
        }
    }

    let verdict_id = format!("verdict:{}", verdict.status());
    let verdict_detail = verdict
        .reasons()
        .first()
        .cloned()
        .unwrap_or_else(|| verdict.status().to_string());
    add_node(
        verdict_id.clone(),
        "verdict",
        verdict.status().to_string(),
        verdict_detail,
    );
    let basket_intent = "intent:propose-pre-ipo-basket".to_string();
    add_node(
        basket_intent.clone(),
        "intent",
        "propose pre-IPO basket".to_string(),
        "advisory only".to_string(),
    );
    add_edge(basket_intent, verdict_id.clone(), "intent-verdict");
    let snapshot_node = format!("snapshot:{}", &snapshot.sha256[..12]);
    add_node(
        snapshot_node.clone(),
        "evidence",
        format!("snapshot {}", &snapshot.sha256[..12]),
        match snapshot.status {
            crate::domain::SnapshotStatus::Ready => "READY".to_string(),
            crate::domain::SnapshotStatus::NoData => "NO_DATA".to_string(),
        },
    );
    add_edge(verdict_id.clone(), snapshot_node, "verdict-snapshot");

    for asset in &config.assets {
        let aid = asset_id(asset);
        let intent = format!("intent:monitor:{}", asset.underlying);
        add_node(
            intent.clone(),
            "intent",
            format!("monitor {} dislocation", asset.underlying),
            "basis points".to_string(),
        );
        add_edge(intent.clone(), aid.clone(), "intent-asset");
        add_edge(intent, verdict_id.clone(), "intent-verdict");

        for field in ["price", "liquidity", "reference"] {
            let key = capture_key(&asset.asset_id, field);
            let capture_id = format!("evidence:{key}");
            let capture = snapshot.captures.get(&key);
            let source = capture
                .map(|item| item.source_id.as_str())
                .unwrap_or("missing");
            let detail = match capture {
                Some(item) => match item.value.as_deref() {
                    Some(value) => format!("{source} {value}"),
                    None => format!("{source} {}", item.raw_excerpt),
                },
                None => format!("{source} missing"),
            };
            add_node(
                capture_id.clone(),
                "evidence",
                format!("{} {} capture", asset.underlying, field),
                detail,
            );
            let source_node = source_id(source);
            add_node(
                source_node.clone(),
                "source",
                source.to_string(),
                source.to_string(),
            );
            add_edge(capture_id.clone(), source_node, "capture-source");
            add_edge(capture_id.clone(), aid.clone(), "capture-asset");
            add_edge(verdict_id.clone(), capture_id, "verdict-snapshot-evidence");
        }
    }

    KnowledgeGraph {
        nodes: nodes.into_values().collect(),
        edges: edges
            .into_iter()
            .map(|(from, to, kind)| GraphEdge { from, to, kind })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::council::{AssetConfig, CouncilConfig, build_snapshot};
    use crate::dexscreener::AssetCaptures;
    use crate::domain::FieldCapture;

    fn config() -> CouncilConfig {
        CouncilConfig {
            assets: vec![
                AssetConfig {
                    asset_id: "mint-a".into(),
                    underlying: "OPENAI".into(),
                    target_weight_bps: 6000,
                    price_scale: 6,
                    quantity_scale: 2,
                    min_liquidity: "500000".into(),
                    max_weight_bps: 8000,
                },
                AssetConfig {
                    asset_id: "mint-b".into(),
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

    #[test]
    fn graph_has_expected_density_and_closed_edges() {
        let config = config();
        let observed = "2026-09-20T12:00:00.000Z";
        let mut captures = BTreeMap::new();
        for mint in ["mint-a", "mint-b"] {
            captures.insert(
                mint.to_string(),
                AssetCaptures {
                    price: FieldCapture::ok("dexscreener", "v1", observed, "price", "1000000"),
                    liquidity: FieldCapture::ok(
                        "dexscreener",
                        "v1",
                        observed,
                        "liquidity",
                        "600000",
                    ),
                },
            );
        }
        let snapshot = build_snapshot(&config, &captures, &BTreeMap::new(), observed);
        let verdict = Verdict::NoData {
            reasons: vec!["test".into()],
        };
        let refs = [
            (
                "mint-a".to_string(),
                Some(PythUnderlyingRef {
                    feed_id: "0xfeed-a".into(),
                    spot: "100".into(),
                    publish_time: observed.into(),
                }),
            ),
            (
                "mint-b".to_string(),
                Some(PythUnderlyingRef {
                    feed_id: "0xfeed-b".into(),
                    spot: "200".into(),
                    publish_time: observed.into(),
                }),
            ),
        ]
        .into_iter()
        .collect();
        let graph = build_graph(&config, &snapshot, &verdict, &refs);
        assert!(graph.nodes.len() >= 20, "nodes={}", graph.nodes.len());
        assert!(graph.edges.len() >= 20, "edges={}", graph.edges.len());
        let ids = graph
            .nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<BTreeSet<_>>();
        assert!(
            graph
                .edges
                .iter()
                .all(|edge| ids.contains(edge.from.as_str()) && ids.contains(edge.to.as_str()))
        );
    }

    #[test]
    fn issuer_mark_references_never_claim_pyth() {
        let config = config();
        let observed = "2026-09-20T12:00:00.000Z";
        let captures = BTreeMap::new();
        let verdict = Verdict::NoData {
            reasons: vec!["test".into()],
        };
        let reference_captures = BTreeMap::from([(
            "mint-b".to_string(),
            FieldCapture::failed(
                "prestocks-issuer",
                "engine-prestocks-reference-v1",
                observed,
                "PreStocks API omitted reference",
            ),
        )]);
        let refs = [
            (
                "mint-a".to_string(),
                Some(PythUnderlyingRef {
                    feed_id: "prestocks:OPENAI".into(),
                    spot: "100".into(),
                    publish_time: observed.into(),
                }),
            ),
            ("mint-b".to_string(), None),
        ]
        .into_iter()
        .collect();
        let snapshot = build_snapshot(&config, &captures, &reference_captures, observed);
        let graph = build_graph(&config, &snapshot, &verdict, &refs);
        let labels = graph
            .nodes
            .iter()
            .map(|node| node.label.clone())
            .collect::<Vec<_>>();
        assert!(
            !labels
                .iter()
                .any(|label| label.to_lowercase().contains("pyth")),
            "issuer-only graph must not claim Pyth: {labels:?}"
        );
        assert!(labels.iter().any(|label| label == "PreStocks mark OPENAI"));
        let missing = graph
            .nodes
            .iter()
            .find(|node| node.label == "SPACEX reference unavailable")
            .expect("missing reference node");
        assert_eq!(missing.detail, "PreStocks API omitted reference");
    }

    #[test]
    fn configured_pyth_references_attribute_to_pyth() {
        let config = config();
        let observed = "2026-09-20T12:00:00.000Z";
        let captures = BTreeMap::new();
        let verdict = Verdict::NoData {
            reasons: vec!["test".into()],
        };
        let refs = [
            (
                "mint-a".to_string(),
                Some(PythUnderlyingRef {
                    feed_id: "0xfeed-a".into(),
                    spot: "100".into(),
                    publish_time: observed.into(),
                }),
            ),
            (
                "mint-b".to_string(),
                Some(PythUnderlyingRef {
                    feed_id: "0xfeed-b".into(),
                    spot: "200".into(),
                    publish_time: observed.into(),
                }),
            ),
        ]
        .into_iter()
        .collect();
        let snapshot = build_snapshot(&config, &captures, &BTreeMap::new(), observed);
        let graph = build_graph(&config, &snapshot, &verdict, &refs);
        let labels = graph
            .nodes
            .iter()
            .map(|node| node.label.clone())
            .collect::<Vec<_>>();
        assert!(labels.iter().any(|label| label == "Pyth feed 0xfeed-a"));
        assert!(!labels.iter().any(|label| label.contains("PreStocks mark")));
    }

    #[test]
    fn every_node_detail_is_a_value_source_or_reason() {
        let config = config();
        let observed = "2026-09-20T12:00:00.000Z";
        let mut captures = BTreeMap::new();
        captures.insert(
            "mint-a".into(),
            AssetCaptures {
                price: FieldCapture::ok("dexscreener", "v1", observed, "price", "1000000"),
                liquidity: FieldCapture::failed("dexscreener", "v1", observed, "thin book"),
            },
        );
        captures.insert(
            "mint-b".into(),
            AssetCaptures {
                price: FieldCapture::failed("dexscreener", "v1", observed, "outage"),
                liquidity: FieldCapture::ok("dexscreener", "v1", observed, "liq", "600000"),
            },
        );
        let snapshot = build_snapshot(&config, &captures, &BTreeMap::new(), observed);
        let verdict = Verdict::NoData {
            reasons: vec!["mint-b price outage".into()],
        };
        let refs = BTreeMap::from([
            (
                "mint-a".to_string(),
                Some(PythUnderlyingRef {
                    feed_id: "prestocks:OPENAI".into(),
                    spot: "1002.30".into(),
                    publish_time: observed.into(),
                }),
            ),
            ("mint-b".to_string(), None),
        ]);
        let graph = build_graph(&config, &snapshot, &verdict, &refs);
        assert!(graph.nodes.iter().all(|node| !node.detail.is_empty()));
        let price = graph
            .nodes
            .iter()
            .find(|node| node.label == "OPENAI price capture")
            .expect("price node");
        assert!(price.detail.contains("dexscreener") && price.detail.contains("1000000"));
        let verdict_node = graph
            .nodes
            .iter()
            .find(|node| node.kind == "verdict")
            .expect("verdict");
        assert_eq!(verdict_node.detail, "mint-b price outage");
        let mark = graph
            .nodes
            .iter()
            .find(|node| node.label == "PreStocks mark OPENAI")
            .expect("mark");
        assert_eq!(mark.detail, "1002.30");
    }
}
