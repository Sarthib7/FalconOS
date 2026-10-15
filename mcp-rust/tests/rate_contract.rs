use axum::{
    Json, Router,
    extract::{Path, State},
    routing::any,
};
use falcon_mcp_rust::{Config, create_app};
use reqwest::Client;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::net::TcpListener;

const ORIGIN: &str = "http://localhost:8792";
const SESSION_A: &str = "wsi1_12345678901234567890";
const SESSION_B: &str = "wsi1_abcdefghijklmnopqrst";
const WALLET_A: &str = "11111111111111111111111111111111";
const WALLET_B: &str = "22222222222222222222222222222222";

async fn mesh(
    State(calls): axum::extract::State<Arc<AtomicUsize>>,
    Path(_path): Path<String>,
) -> Json<Value> {
    calls.fetch_add(1, Ordering::SeqCst);
    Json(json!({"opportunities": []}))
}

async fn server(
    per_session: u32,
    per_connect: u32,
    global: u32,
) -> (Client, String, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let upstream = Router::new()
        .route("/{*path}", any(mesh))
        .with_state(calls.clone());
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(upstream_listener, upstream).await.unwrap() });

    let app = create_app(Config {
        mesh_url: format!("http://{upstream_addr}"),
        origin: ORIGIN.into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60_000,
        rate_session: per_session,
        rate_connect: per_connect,
        rate_global: global,
    })
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (Client::new(), format!("http://{addr}/mcp"), calls)
}

async fn call(client: &Client, url: &str, id: u64, name: &str, arguments: Value) -> Value {
    let response = client
        .post(url)
        .header("origin", ORIGIN)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }))
        .send()
        .await
        .unwrap();
    let status = response.status();
    let body = response.json::<Value>().await.unwrap();
    assert!(status.is_success(), "MCP response {status}: {body}");
    body
}

fn assert_allowed(body: &Value) {
    assert!(body["result"].get("isError").is_none());
}

fn assert_limited(body: &Value) {
    assert_eq!(body["result"]["isError"], true);
    assert_eq!(body["result"]["structuredContent"]["code"], "RATE_LIMITED");
}

#[tokio::test]
async fn session_rate_limit_allows_the_boundary_and_isolated_sessions() {
    let (client, url, mesh_calls) = server(2, 10, 100).await;
    for id in 1..=2 {
        let response = call(
            &client,
            &url,
            id,
            "falcon_yield_opportunities",
            json!({"session": SESSION_A}),
        )
        .await;
        assert_allowed(&response);
    }
    let rejected = call(
        &client,
        &url,
        3,
        "falcon_yield_opportunities",
        json!({"session": SESSION_A}),
    )
    .await;
    assert_limited(&rejected);

    let other_session = call(
        &client,
        &url,
        4,
        "falcon_yield_opportunities",
        json!({"session": SESSION_B}),
    )
    .await;
    assert_allowed(&other_session);
    assert_eq!(mesh_calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn wallet_rate_limit_allows_the_boundary_and_isolated_wallets() {
    let (client, url, mesh_calls) = server(10, 2, 100).await;
    for id in 1..=2 {
        let response = call(
            &client,
            &url,
            id,
            "falcon_wallet_status",
            json!({"wallet": WALLET_A}),
        )
        .await;
        assert_allowed(&response);
    }
    let rejected = call(
        &client,
        &url,
        3,
        "falcon_wallet_status",
        json!({"wallet": WALLET_A}),
    )
    .await;
    assert_limited(&rejected);

    let other_wallet = call(
        &client,
        &url,
        4,
        "falcon_wallet_status",
        json!({"wallet": WALLET_B}),
    )
    .await;
    assert_allowed(&other_wallet);
    assert_eq!(mesh_calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn global_rate_limit_spans_sessions_and_wallets() {
    let (client, url, mesh_calls) = server(10, 10, 2).await;
    let first = call(
        &client,
        &url,
        1,
        "falcon_yield_opportunities",
        json!({"session": SESSION_A}),
    )
    .await;
    assert_allowed(&first);
    let second = call(
        &client,
        &url,
        2,
        "falcon_wallet_status",
        json!({"wallet": WALLET_A}),
    )
    .await;
    assert_allowed(&second);

    let third = call(
        &client,
        &url,
        3,
        "falcon_yield_opportunities",
        json!({"session": SESSION_B}),
    )
    .await;
    assert_limited(&third);
    let fourth = call(
        &client,
        &url,
        4,
        "falcon_wallet_status",
        json!({"wallet": WALLET_B}),
    )
    .await;
    assert_limited(&fourth);
    assert_eq!(mesh_calls.load(Ordering::SeqCst), 2);
}
