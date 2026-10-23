use axum::{Json, Router, extract::Path, routing::any};
use falcon_mcp_rust::{Config, create_app};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tower::ServiceExt;

async fn fake_mesh(Path(path): Path<String>) -> Json<Value> {
    match path.as_str() {
        "readyz" => Json(json!({"status":"ready"})),
        "v1/public/graph/live" => Json(
            json!({"scope":"fixed-kamino-reserve","chain":"solana","network":"devnet","graph":{"safe":true,"walletSecret":"never"},"programAnalysis":{"status":"OBSERVED","owner":"hide"},"reserveAnalysis":{"status":"OBSERVED"},"status":"OBSERVED","policyDefinitionId":"policy","policyVersion":1,"maxSupplyBaseUnits":"1000000","customGraphsSupported":false,"executionReady":false}),
        ),
        _ => Json(json!({"error":{"code":"NOT_FOUND","message":"Not found."}})),
    }
}
fn cfg(mesh: String) -> Config {
    Config {
        mesh_url: mesh,
        origin: "http://localhost:8792".into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60000,
        rate_session: 60,
        rate_connect: 10,
        rate_global: 300,
    }
}
async fn json_rpc(
    client: &reqwest::Client,
    url: &str,
    id: Value,
    method: &str,
    params: Value,
) -> (reqwest::StatusCode, Value) {
    let r = client
        .post(url)
        .header("origin", "http://localhost:8792")
        .header("accept", "application/json, text/event-stream")
        .json(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
        .send()
        .await
        .unwrap();
    let status = r.status();
    let body = r.json().await.unwrap_or(Value::Null);
    (status, body)
}
#[tokio::test]
async fn actual_mcp_call_has_projected_data_and_rejects_bad_boundaries() {
    let mesh = Router::new().route("/{*path}", any(fake_mesh));
    let ml = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ma = ml.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(ml, mesh).await.unwrap() });
    let app = create_app(cfg(format!("http://{ma}"))).unwrap();
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let a = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    let client = reqwest::Client::new();
    let url = format!("http://{a}/mcp");
    let (s, good) = json_rpc(
        &client,
        &url,
        json!(1),
        "tools/call",
        json!({"name":"falcon_public_graph","arguments":{}}),
    )
    .await;
    assert!(s.is_success(), "{s}: {good}");
    let result = &good["result"];
    assert!(
        result["structuredContent"]["graph"]["safe"]
            .as_bool()
            .unwrap()
    );
    assert!(
        result["structuredContent"]["graph"]
            .get("walletSecret")
            .is_none()
    );
    assert!(result.get("isError").is_none());
    let (s,bad)=json_rpc(&client,&url,json!(2),"tools/call",json!({"name":"falcon_prepare_transaction","arguments":{"session":"wsi1_12345678901234567890","action":"supply","analysisId":"12345678-1234-1234-1234-123456789012","amountUsdc":"0.5","extra":true}})).await;
    assert!(s.is_success(), "{s}: {bad}");
    let r = &bad["result"];
    assert_eq!(r["isError"], true);
    assert_eq!(r["structuredContent"]["code"], "INVALID_INPUT");
    let (s,redeem)=json_rpc(&client,&url,json!(3),"tools/call",json!({"name":"falcon_prepare_transaction","arguments":{"session":"wsi1_12345678901234567890","action":"redeem","analysisId":"12345678-1234-1234-1234-123456789012","amountReceiptTokens":"0.5","decisionId":"12345678-1234-1234-1234-123456789012"}})).await;
    assert!(s.is_success(), "{s}: {redeem}");
    assert_eq!(redeem["result"]["isError"], true);
    assert_eq!(
        redeem["result"]["structuredContent"]["code"],
        "INVALID_INPUT"
    );
    let health = client
        .get(format!("http://{a}/healthz"))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), reqwest::StatusCode::OK);
    assert_eq!(
        health.json::<Value>().await.unwrap(),
        json!({"status":"alive"})
    );
    let ready = client
        .get(format!("http://{a}/readyz"))
        .send()
        .await
        .unwrap();
    assert_eq!(ready.status(), reqwest::StatusCode::OK);
}
#[tokio::test]
async fn host_origin_and_body_guards_fail_closed() {
    let app = create_app(cfg("http://127.0.0.1:9".into())).unwrap();
    let resp = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", "evil.example")
                .header("origin", "http://localhost:8792")
                .body(axum::body::Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: evil.example"},"id":null})
    );
    let resp = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", "localhost:8792")
                .header("origin", "http://evil.example")
                .body(axum::body::Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Origin: evil.example"},"id":null})
    );
}
