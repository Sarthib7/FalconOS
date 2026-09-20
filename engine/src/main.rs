use falcon_engine::serve::{config, evaluate_once, run_server, write_graph};
use std::time::Duration;

async fn run_preipo(watch: bool, interval: Duration) {
    loop {
        let evaluation = evaluate_once(&config()).await;
        println!("{}\ntick latency_ms={}", evaluation.rendered, evaluation.advice.latency_ms);
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

fn option_u64(args: &[String], name: &str, default: u64) -> u64 {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

#[tokio::main]
async fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("preipo") => {
            let watch = args.iter().any(|arg| arg == "--watch");
            let interval_ms = option_u64(&args, "--interval-ms", 2000);
            run_preipo(watch, Duration::from_millis(interval_ms.max(1))).await;
        }
        Some("serve") => {
            let port = option_u64(&args, "--port", 8787).min(u64::from(u16::MAX)) as u16;
            let interval_ms = option_u64(&args, "--interval-ms", 2000);
            if let Err(error) = run_server(config(), port, Duration::from_millis(interval_ms.max(1))).await {
                eprintln!("server error: {error}");
            }
        }
        Some("graph") => {
            let Some(index) = args.iter().position(|arg| arg == "--out") else {
                eprintln!("usage: falcon-engine graph --out PATH");
                return;
            };
            let Some(path) = args.get(index + 1) else {
                eprintln!("usage: falcon-engine graph --out PATH");
                return;
            };
            if let Err(error) = write_graph(&config(), path).await {
                eprintln!("graph error: {error}");
            }
        }
        _ => {
            eprintln!("usage: falcon-engine <preipo|serve|graph>");
        }
    }
}
