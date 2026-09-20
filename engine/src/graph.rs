use crate::council::{capture_key, AssetConfig, CouncilConfig};
use crate::domain::{CanonicalSnapshot, Verdict};
use crate::pyth::PythUnderlyingRef;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
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
    let mut add_node = |id: String, kind: &str, label: String| {
        nodes.entry(id.clone()).or_insert_with(|| GraphNode {
            id,
            kind: kind.to_string(),
            label,
        });
    };
    let mut add_edge = |from: String, to: String, kind: &str| {
        edges.insert((from, to, kind.to_string()));
    };

    let issuer = "issuer:prestocks".to_string();
    add_node(issuer.clone(), "issuer", "PreStocks".to_string());
    for fixed in ["dexscreener", "prestocks-issuer", "solana-rpc", "pyth"] {
        add_node(source_id(fixed), "source", fixed.to_string());
    }
    add_node("venue:solana".to_string(), "venue", "Solana".to_string());

    for asset in &config.assets {
        let aid = asset_id(asset);
        let underlying = format!("underlying:{}", asset.underlying);
        add_node(aid.clone(), "asset", asset.asset_id.clone());
        // The graph contract has no separate `underlying` kind; symbols are
        // represented as asset-kind nodes and linked with asset-underlying.
        add_node(underlying.clone(), "asset", asset.underlying.clone());
        add_edge(aid.clone(), issuer.clone(), "asset-issuer");
        add_edge(aid.clone(), underlying, "asset-underlying");
        add_edge(aid.clone(), "venue:solana".to_string(), "asset-venue");

        let feed = references
            .get(&asset.asset_id)
            .and_then(|value| value.as_ref())
            .map(|value| value.feed_id.clone())
            .unwrap_or_else(|| format!("unavailable:{}", asset.asset_id));
        let feed_node = source_id(&format!("pyth-feed:{feed}"));
        add_node(feed_node.clone(), "source", format!("Pyth feed {feed}"));
        add_edge(aid.clone(), source_id("pyth"), "asset-source");
        add_edge(aid, feed_node, "asset-source");
    }

    let verdict_id = format!("verdict:{}", verdict.status());
    add_node(verdict_id.clone(), "verdict", verdict.status().to_string());
    let basket_intent = "intent:propose-pre-ipo-basket".to_string();
    add_node(basket_intent.clone(), "intent", "propose pre-IPO basket".to_string());
    add_edge(basket_intent, verdict_id.clone(), "intent-verdict");

    for asset in &config.assets {
        let aid = asset_id(asset);
        let intent = format!("intent:monitor:{}", asset.underlying);
        add_node(intent.clone(), "intent", format!("monitor {} dislocation", asset.underlying));
        add_edge(intent.clone(), aid.clone(), "intent-asset");
        add_edge(intent, verdict_id.clone(), "intent-verdict");

        for field in ["price", "liquidity"] {
            let key = capture_key(&asset.asset_id, field);
            let capture_id = format!("evidence:{key}");
            add_node(capture_id.clone(), "evidence", format!("{} {} capture", asset.underlying, field));
            let source = snapshot
                .captures
                .get(&key)
                .map(|capture| capture.source_id.as_str())
                .unwrap_or("missing");
            let source_node = source_id(source);
            add_node(source_node.clone(), "source", source.to_string());
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
    use crate::council::{build_snapshot, AssetConfig, CouncilConfig};
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
                    liquidity: FieldCapture::ok("dexscreener", "v1", observed, "liquidity", "600000"),
                },
            );
        }
        let snapshot = build_snapshot(&config, &captures, observed);
        let verdict = Verdict::NoData { reasons: vec!["test".into()] };
        let refs = [
            ("mint-a".to_string(), Some(PythUnderlyingRef { feed_id: "0xfeed-a".into(), spot: "100".into(), publish_time: observed.into() })),
            ("mint-b".to_string(), Some(PythUnderlyingRef { feed_id: "0xfeed-b".into(), spot: "200".into(), publish_time: observed.into() })),
        ]
        .into_iter()
        .collect();
        let graph = build_graph(&config, &snapshot, &verdict, &refs);
        assert!(graph.nodes.len() >= 20, "nodes={}", graph.nodes.len());
        assert!(graph.edges.len() >= 20, "edges={}", graph.edges.len());
        let ids = graph.nodes.iter().map(|node| node.id.as_str()).collect::<BTreeSet<_>>();
        assert!(graph.edges.iter().all(|edge| ids.contains(edge.from.as_str()) && ids.contains(edge.to.as_str())));
    }
}
