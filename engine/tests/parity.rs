use falcon_engine::council::{AssetConfig, CouncilConfig, build_snapshot, evaluate_council};
use falcon_engine::dexscreener::AssetCaptures;
use falcon_engine::domain::{FieldCapture, SnapshotStatus, Verdict};
use falcon_engine::perps::evaluate_perps;
use falcon_engine::prestocks::{
    divide_integer_by_decimal, effective_multiplier, multiplier_from_supply, multipliers_agree,
    parse_scaled_ui_account_state,
};
use serde_json::json;
use std::collections::BTreeMap;

fn scaled(state: serde_json::Value) -> serde_json::Value {
    json!({"result":{"value":{"data":{"program":"spl-token-2022","parsed":{"info":{"extensions":[{"extension":"scaledUiAmountConfig","state":state}]}}}}}})
}

#[test]
fn v66_inline_json_vectors_match_typescript() {
    for state in [
        json!({"multiplier":"0"}),
        json!({"multiplier":"1","newMultiplier":"bad","newMultiplierEffectiveTimestamp":1781065800}),
        json!({"multiplier":"1","newMultiplier":"0","newMultiplierEffectiveTimestamp":1781065800}),
        json!({"multiplier":"1","newMultiplier":"5"}),
        json!({"multiplier":"1","newMultiplierEffectiveTimestamp":1781065800}),
    ] {
        assert!(parse_scaled_ui_account_state(&scaled(state)).is_none());
    }
    assert_eq!(
        effective_multiplier(
            &falcon_engine::prestocks::ScaledUiState {
                multiplier: "1".into(),
                new_multiplier: Some("5".into()),
                new_multiplier_effective_timestamp: Some(1781065800)
            },
            1781065799
        ),
        "1"
    );
    assert_eq!(
        effective_multiplier(
            &falcon_engine::prestocks::ScaledUiState {
                multiplier: "1".into(),
                new_multiplier: Some("1.4861347".into()),
                new_multiplier_effective_timestamp: Some(1784305800)
            },
            1784305800
        ),
        "1.4861347"
    );
    assert_eq!(
        multiplier_from_supply("1901951695078", 9, "2826.556411779"),
        Some("1.4861346".into())
    );
    assert_eq!(
        multiplier_from_supply("8742515849291", 9, "43712.579246455"),
        Some("5".into())
    );
    assert!(multipliers_agree("1.4861347", "1.4861346", 5));
    assert!(!multipliers_agree("5", "5.01", 5));
    assert_eq!(
        divide_integer_by_decimal("1477000000", "1.4861347"),
        Some("993853383".into())
    );
    assert_eq!(
        divide_integer_by_decimal("605000000", "5"),
        Some("121000000".into())
    );
}

fn config() -> CouncilConfig {
    CouncilConfig {
        assets: vec![AssetConfig {
            asset_id: "mint".into(),
            underlying: "OPENAI".into(),
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
        "mint".into(),
        AssetCaptures {
            price: price.map_or_else(
                || FieldCapture::failed("fixture", "1", "2026-09-20T12:00:00Z", "outage"),
                |v| FieldCapture::ok("fixture", "1", "2026-09-20T12:00:00Z", "raw", v),
            ),
            liquidity: liquidity.map_or_else(
                || FieldCapture::failed("fixture", "1", "2026-09-20T12:00:00Z", "outage"),
                |v| FieldCapture::ok("fixture", "1", "2026-09-20T12:00:00Z", "raw", v),
            ),
        },
    )])
}

#[test]
fn council_status_transitions_remain_fail_closed() {
    let cfg = config();
    let refs = BTreeMap::new();
    let published = evaluate_council(
        &cfg,
        &build_snapshot(&cfg, &captures(Some("100000000"), Some("500000000")), "2026-09-20T12:00:01Z"),
        &refs,
    );
    assert!(matches!(published, Verdict::Published(_)));
    let blocked = evaluate_council(
        &cfg,
        &build_snapshot(&cfg, &captures(Some("100000000"), Some("1")), "2026-09-20T12:00:01Z"),
        &refs,
    );
    assert!(matches!(blocked, Verdict::Blocked { .. }));
    let no_data = evaluate_council(
        &cfg,
        &build_snapshot(&cfg, &captures(None, Some("500000000")), "2026-09-20T12:00:01Z"),
        &refs,
    );
    assert!(matches!(no_data, Verdict::NoData { .. }));
}

#[test]
fn perps_missing_registry_is_no_data() {
    assert!(matches!(evaluate_perps(None), Verdict::NoData { .. }));
}

#[test]
fn snapshot_ready_only_when_every_capture_has_value() {
    let cfg = config();
    assert_eq!(
        build_snapshot(&cfg, &captures(Some("100"), Some("100000")), "2026-09-20T12:00:01Z").status,
        SnapshotStatus::Ready
    );
    assert_eq!(
        build_snapshot(&cfg, &captures(Some("100"), None), "2026-09-20T12:00:01Z").status,
        SnapshotStatus::NoData
    );
}
