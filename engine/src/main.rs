use falcon_engine::council::{
    AssetConfig, CouncilConfig, build_snapshot, evaluate_council, render_advice,
};
use falcon_engine::dexscreener::{AssetCaptures, DexAsset, fetch_asset};
use falcon_engine::prestocks::{
    fetch_prestocks, fetch_scaled_ui_multipliers, normalize_scaled_price,
};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

fn config() -> CouncilConfig {
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

async fn run_once(config: &CouncilConfig) -> String {
    let started = Instant::now();
    let mints = config
        .assets
        .iter()
        .map(|asset| asset.asset_id.clone())
        .collect::<Vec<_>>();
    // All independent providers start together. The normalization stage begins only
    // after issuer, RPC, and DEX evidence have each returned.
    let (prestocks, multipliers, mut dex_captures) = tokio::join!(
        fetch_prestocks(&mints, None),
        fetch_scaled_ui_multipliers(&mints, None),
        fetch_dex(config)
    );
    for asset in &config.assets {
        if let Some(captures) = dex_captures.get_mut(&asset.asset_id) {
            let multiplier = multipliers.get(&asset.asset_id).and_then(|x| x.as_deref());
            let issuer = prestocks
                .issuer_prices
                .get(&asset.asset_id)
                .and_then(|x| x.as_deref());
            captures.price =
                normalize_scaled_price(&captures.price, asset.price_scale, multiplier, issuer, 500);
        }
    }
    let created_at = falcon_engine::pyth::now_iso();
    let snapshot = build_snapshot(config, &dex_captures, created_at);
    let verdict = evaluate_council(config, &snapshot, &prestocks.refs);
    let mut rendered = render_advice(&snapshot, &verdict, config, &prestocks.refs);
    rendered.push_str(&format!(
        "\ntick latency_ms={}",
        started.elapsed().as_millis()
    ));
    rendered
}

async fn run_preipo(watch: bool, interval: Duration) {
    loop {
        println!("{}", run_once(&config()).await);
        if !watch {
            break;
        }
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("\nwatch stopped");
                break;
            }
            _ = tokio::time::sleep(interval) => {}
        }
    }
}

#[tokio::main]
async fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) != Some("preipo") {
        eprintln!("usage: falcon-engine preipo [--watch] [--interval-ms N]");
        return;
    }
    let watch = args.iter().any(|arg| arg == "--watch");
    let interval_ms = args
        .iter()
        .position(|arg| arg == "--interval-ms")
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(2000);
    run_preipo(watch, Duration::from_millis(interval_ms.max(1))).await;
}
