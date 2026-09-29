use crate::council::{build_snapshot, evaluate_council, render_advice};
use crate::dexscreener::AssetCaptures;
use crate::domain::FieldCapture;
use crate::graph::build_graph;
use crate::prestocks::scale_decimal_to_integer;
use crate::pyth::PythUnderlyingRef;
use crate::serve::config;
use std::collections::BTreeMap;

const FIXTURE_AT: &str = "2026-09-23T12:00:00Z";
const SYNTHETIC_SPOT: &str = "100.00";
const SYNTHETIC_CAPTURE_VERSION: &str = "stocklana-demo-fixture-v1";
const SYNTHETIC_REFERENCE_VERSION: &str = "stocklana-demo-prestocks-mark-v1";

#[derive(Clone, Copy)]
enum Scenario {
    Published,
    LowLiquidity,
    MissingPrice,
}

fn fixture(
    assets: &[crate::council::AssetConfig],
    scenario: Scenario,
) -> (
    BTreeMap<String, AssetCaptures>,
    BTreeMap<String, FieldCapture>,
    BTreeMap<String, Option<PythUnderlyingRef>>,
) {
    let mut captures = BTreeMap::new();
    let mut reference_captures = BTreeMap::new();
    let mut references = BTreeMap::new();

    for asset in assets {
        let price_units = scale_decimal_to_integer(SYNTHETIC_SPOT, asset.price_scale)
            .expect("fixed synthetic spot must parse");
        let feed_id = format!("prestocks:{}", asset.underlying);
        let raw_reference = serde_json::json!({
            "feed_id": feed_id,
            "spot": SYNTHETIC_SPOT,
            "publish_time": FIXTURE_AT,
        })
        .to_string();
        let missing_price =
            matches!(scenario, Scenario::MissingPrice) && asset.underlying == "OPENAI";
        let liquidity =
            if matches!(scenario, Scenario::LowLiquidity) && asset.underlying == "OPENAI" {
                "100"
            } else {
                "600000000"
            };

        captures.insert(
            asset.asset_id.clone(),
            AssetCaptures {
                price: if missing_price {
                    FieldCapture::failed(
                        "synthetic-fixture",
                        SYNTHETIC_CAPTURE_VERSION,
                        FIXTURE_AT,
                        "synthetic fixture: price unavailable",
                    )
                } else {
                    FieldCapture::ok(
                        "synthetic-fixture",
                        SYNTHETIC_CAPTURE_VERSION,
                        FIXTURE_AT,
                        serde_json::json!({
                            "synthetic": true,
                            "priceUsd": SYNTHETIC_SPOT,
                        })
                        .to_string(),
                        price_units,
                    )
                },
                liquidity: FieldCapture::ok(
                    "synthetic-fixture",
                    SYNTHETIC_CAPTURE_VERSION,
                    FIXTURE_AT,
                    serde_json::json!({
                        "synthetic": true,
                        "liquidityUsd": liquidity,
                    })
                    .to_string(),
                    liquidity,
                ),
            },
        );
        reference_captures.insert(
            asset.asset_id.clone(),
            FieldCapture::ok(
                "prestocks-issuer",
                SYNTHETIC_REFERENCE_VERSION,
                FIXTURE_AT,
                raw_reference,
                SYNTHETIC_SPOT,
            ),
        );
        references.insert(
            asset.asset_id.clone(),
            Some(PythUnderlyingRef {
                feed_id: format!("prestocks:{}", asset.underlying),
                spot: SYNTHETIC_SPOT.into(),
                publish_time: FIXTURE_AT.into(),
            }),
        );
    }

    (captures, reference_captures, references)
}

/// Render deterministic Stocklana demo scenarios without starting live adapters.
pub fn render_demo() -> String {
    let council_config = config();
    let scenarios = [
        ("Healthy fixture", Scenario::Published),
        ("Low-liquidity fixture", Scenario::LowLiquidity),
        ("Missing-price fixture", Scenario::MissingPrice),
    ];
    let mut lines = vec![
        "FalconOS Stocklana council demo [SYNTHETIC FIXTURE DATA]".to_string(),
        "No market or RPC requests, wallet access, signing, or transactions.".to_string(),
        format!("Fixed fixture timestamp: {FIXTURE_AT}"),
        String::new(),
    ];

    for (name, scenario) in scenarios {
        let (captures, reference_captures, references) = fixture(&council_config.assets, scenario);
        let snapshot = build_snapshot(
            &council_config,
            &captures,
            &reference_captures,
            "2026-09-23T12:00:01Z",
        );
        let verdict = evaluate_council(&council_config, &snapshot, &references);
        let graph = build_graph(&council_config, &snapshot, &verdict, &references);

        lines.push(format!("=== {name} ==="));
        lines.push(render_advice(
            &snapshot,
            &verdict,
            &council_config,
            &references,
        ));
        lines.push(format!(
            "Knowledge graph: {} nodes, {} edges",
            graph.nodes.len(),
            graph.edges.len()
        ));
        lines.push(String::new());
    }

    lines.join("\n")
}
