use axum::{Json, Router, extract::Path, routing::any};
use falcon_mcp_rust::{Config, TOOL_NAMES, create_app};
use rmcp::{ServiceExt, model::CallToolRequestParams, transport::StreamableHttpClientTransport};
use serde_json::{Value, json};
use tokio::net::TcpListener;

async fn fake_mesh(Path(path): Path<String>) -> Json<Value> {
    if path == "v1/public/graph/live" {
        return Json(json!({
            "scope":"test", "chain":"solana", "network":"devnet",
            "graph":{"safe":true,"walletSecret":"private"},
            "programAnalysis":{},"reserveAnalysis":{},"status":"OBSERVED",
            "policyDefinitionId":"policy","policyVersion":1,"maxSupplyBaseUnits":"1000000",
            "customGraphsSupported":false,"executionReady":false
        }));
    }
    if path.ends_with("/submit") {
        return Json(json!({"event":{
            "id":"12345678-1234-1234-1234-123456789012",
            "requestId":"12345678-1234-1234-1234-123456789013",
            "intentId":"12345678-1234-1234-1234-123456789014",
            "createdAt":"2030-01-01T00:00:00.000Z","kind":"SIGNED_REGISTERED",
            "data":{"transactionBase64":"private-wire-bytes","exchanges":[
                {"request":{"bodyBase64":"private-request"},"response":{"bodyBase64":"private-response"}}
            ]}
        },"ignored":"mesh"}));
    }
    Json(json!({"status":"ready"}))
}

#[tokio::test]
async fn rmcp_client_smokes_listing_calls_and_human_authority() {
    let upstream = Router::new().route("/{*path}", any(fake_mesh));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fake_addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });

    let config = Config {
        mesh_url: format!("http://{fake_addr}"),
        origin: "http://localhost:8792".into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60_000,
        rate_session: 60,
        rate_connect: 10,
        rate_global: 300,
    };
    let app = create_app(config).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let transport = StreamableHttpClientTransport::from_uri(format!("http://{addr}/mcp"));
    let client = ().serve(transport).await.unwrap();
    let tools = client.peer().list_all_tools().await.unwrap();
    assert_eq!(
        tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>(),
        TOOL_NAMES
    );

    let positive = client
        .peer()
        .call_tool(CallToolRequestParams::new("falcon_public_graph"))
        .await
        .unwrap();
    assert_eq!(positive.is_error, None);
    assert_eq!(
        positive.structured_content.as_ref().unwrap()["graph"]["safe"],
        true
    );
    assert!(
        positive.structured_content.as_ref().unwrap()["graph"]
            .get("walletSecret")
            .is_none()
    );

    let invalid = json!({
        "session":"wsi1_12345678901234567890", "action":"supply",
        "analysisId":"12345678-1234-1234-1234-123456789012", "amountUsdc":"0.5", "extra":true
    })
    .as_object()
    .unwrap()
    .clone();
    let negative = client
        .peer()
        .call_tool(CallToolRequestParams::new("falcon_prepare_transaction").with_arguments(invalid))
        .await
        .unwrap();
    assert_eq!(negative.is_error, Some(true));
    assert_eq!(
        negative.structured_content.as_ref().unwrap()["code"],
        "INVALID_INPUT"
    );

    let signed = json!({
        "session":"wsi1_12345678901234567890",
        "intentId":"12345678-1234-1234-1234-123456789014",
        "signedTransactionBase64":"c2lnbmVk"
    })
    .as_object()
    .unwrap()
    .clone();
    let registered = client
        .peer()
        .call_tool(CallToolRequestParams::new("falcon_submit_signed").with_arguments(signed))
        .await
        .unwrap();
    assert_eq!(registered.is_error, None);
    let output = registered.structured_content.as_ref().unwrap();
    assert!(
        output["next"]
            .as_str()
            .unwrap()
            .contains("has not broadcast")
    );
    assert!(
        output["next"]
            .as_str()
            .unwrap()
            .contains("human alone reviews and broadcasts")
    );
    assert!(output["event"]["data"].get("transactionBase64").is_none());
    assert!(
        output["event"]["data"]["exchanges"][0]["request"]
            .get("bodyBase64")
            .is_none()
    );
    assert!(
        output["event"]["data"]["exchanges"][0]["response"]
            .get("bodyBase64")
            .is_none()
    );
}
