use axum::{Json, Router, extract::State, routing::any};
use falcon_mcp_rust::{Config, create_app};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::net::TcpListener;

async fn mesh(State(calls): State<Arc<AtomicUsize>>) -> Json<Value> {
    calls.fetch_add(1, Ordering::SeqCst);
    Json(json!({"status":"not_ready"}))
}
#[tokio::test]
async fn self_test_is_metadata_only_and_never_calls_mesh() {
    let calls = Arc::new(AtomicUsize::new(0));
    let fake = Router::new()
        .route("/{*path}", any(mesh))
        .with_state(calls.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fake_addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
    let config = Config {
        mesh_url: format!("http://{fake_addr}"),
        origin: "http://localhost:8792".into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60000,
        rate_session: 60,
        rate_connect: 10,
        rate_global: 300,
    };
    let app = create_app(config).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let response=reqwest::Client::new().post(format!("http://{addr}/mcp")).header("origin","http://localhost:8792").header("accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"falcon_self_test","arguments":{}}})).send().await.unwrap();
    assert!(response.status().is_success());
    let body = response.json::<Value>().await.unwrap();
    let content: Value =
        serde_json::from_str(body["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    for field in ["signer", "funding", "transaction", "researchReviewGrant"] {
        assert_eq!(content["readiness"][field], "not_checked");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}
