use axum::{Json, Router, extract::Path, routing::any};
use falcon_mcp_rust::{Config, SCHEMA_FINGERPRINT, TOOL_NAMES, create_app};
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
async fn fixture_order_schema_and_self_test_match_node_040() {
    let fixture: Vec<Value> =
        serde_json::from_str(include_str!("../fixtures/node-0.4.0.json")).unwrap();
    let names = fixture
        .iter()
        .map(|x| x["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(names.len(), 14);
    assert_eq!(names, TOOL_NAMES);
    let prep = &fixture[7]["inputSchema"];
    assert_eq!(prep["additionalProperties"], false);
    assert!(prep["allOf"].as_array().unwrap().iter().any(|x| {
        x["if"]["properties"]["action"]["const"] == "supply"
            && x["then"]["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "decisionId")
    }));
    assert!(prep["allOf"].as_array().unwrap().iter().any(|x| {
        x["if"]["properties"]["action"]["const"] == "redeem"
            && x["then"]["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "amountReceiptTokens")
    }));
    let cap: Value = serde_json::from_str(include_str!("../fixtures/capabilities.json")).unwrap();
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
    let (s,init)=json_rpc(&client,&url,json!(1),"initialize",json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"offline-test","version":"1"}})).await;
    assert!(s.is_success(), "{s}: {init}");
    assert_eq!(init["result"]["serverInfo"]["name"], "falcon-mcp");
    assert_eq!(init["result"]["serverInfo"]["version"], "0.4.0");
    let _ = client
        .post(&url)
        .header("origin", "http://localhost:8792")
        .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .send()
        .await
        .unwrap();
    let (s, list) = json_rpc(&client, &url, json!(2), "tools/list", json!({})).await;
    assert!(s.is_success(), "{s}: {list}");
    let live = list["result"]["tools"].as_array().unwrap();
    assert_eq!(live.len(), 14);
    for (got, want) in live.iter().zip(&fixture) {
        assert_eq!(got["name"], want["name"]);
        assert_eq!(got["title"], want["title"]);
        assert_eq!(got["description"], want["description"]);
        assert_eq!(got["inputSchema"], want["inputSchema"]);
        assert_eq!(got["annotations"], want["annotations"])
    }
    let (s, test) = json_rpc(
        &client,
        &url,
        json!(3),
        "tools/call",
        json!({"name":"falcon_self_test","arguments":{}}),
    )
    .await;
    assert!(s.is_success(), "{s}: {test}");
    let r = &test["result"];
    let body: Value = serde_json::from_str(r["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(body["schemaFingerprint"], SCHEMA_FINGERPRINT);
    assert_eq!(body["tools"], json!(TOOL_NAMES));
    assert_eq!(body["toolCount"], 14);
    assert_eq!(body["capabilities"], cap);
    assert_eq!(
        body["readiness"],
        json!({"signer":"not_checked","funding":"not_checked","transaction":"not_checked"})
    );
    let expected: Value =
        serde_json::from_str(include_str!("../fixtures/node-self-test-0.4.0.json")).unwrap();
    assert_eq!(body, expected);
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
