use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    routing::any,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use falcon_mcp_rust::{Config, create_app};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use tokio::{net::TcpListener, sync::Mutex};

const ORIGIN: &str = "http://localhost:8792";
const SESSION: &str = "wsi1_12345678901234567890";
const REQUEST_ID: &str = "12345678-1234-1234-1234-123456789001";
const PLAN_ID: &str = "12345678-1234-1234-1234-123456789002";
const ACTION_ID: &str = "12345678-1234-1234-1234-123456789003";
const RECORD_ID: &str = "12345678-1234-1234-1234-123456789004";
const PRIVATE_BYTES: &str = "signed-payload-private-marker";

#[derive(Clone, Default)]
struct FakeMesh {
    calls: Arc<Mutex<Vec<Value>>>,
    overrides: Arc<Mutex<HashMap<String, (StatusCode, Value)>>>,
}

impl FakeMesh {
    async fn set_response(&self, path: &str, status: StatusCode, value: Value) {
        self.overrides
            .lock()
            .await
            .insert(path.to_owned(), (status, value));
    }
}

async fn mesh(
    State(fake): State<FakeMesh>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> (StatusCode, Json<Value>) {
    let method = request.method().to_string();
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = axum::body::to_bytes(request.into_body(), 64 * 1024)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    let route = format!("/{path}");
    fake.calls.lock().await.push(json!({
        "method": method,
        "path": route,
        "authorization": authorization,
        "body": body,
    }));

    if let Some(response) = fake.overrides.lock().await.get(&route).cloned() {
        return (response.0, Json(response.1));
    }
    let response = match route.as_str() {
        "/v1/cfo" => json!({
            "contextStatus": "NOT_CHECKED",
            "executionReady": false,
            "quotes": [{
                "schemaVersion": 1,
                "capturedAt": "2030-01-01T00:00:00.000Z",
                "raw": {
                    "signature": "provider-quote-signature-public",
                    "quote": {"amountIn": "1000000"}
                },
                "sha256": "quote-envelope-hash",
                "signatureVerified": true
            }],
            "history": [{
                "payload": PRIVATE_BYTES,
                "signatureBase64": PRIVATE_BYTES,
                "signedData": PRIVATE_BYTES,
                "status": "SUBMISSION_UNKNOWN"
            }]
        }),
        "/v1/cfo/mandate" => json!({"saved": true, "mandateHash": "hash-1"}),
        "/v1/cfo/capture" => json!({"status": "NO_DATA", "reasons": ["no account evidence"]}),
        "/v1/cfo/plans" => {
            json!({"status": "BLOCKED", "checks": [{"id": "freshness", "status": "BLOCKED"}]})
        }
        "/v1/cfo/prepare" => json!({
            "actionId": ACTION_ID,
            "standard": "raw_ed25519",
            "payload": "unsigned-owner-review-payload",
            "expiresAt": "2030-01-01T00:00:00.000Z"
        }),
        "/v1/cfo/signatures" => json!({
            "actionId": ACTION_ID,
            "status": "SIGNED_REGISTERED",
            "signatureBase64": PRIVATE_BYTES,
            "signedData": PRIVATE_BYTES,
            "payload": PRIVATE_BYTES
        }),
        "/v1/cfo/relay" => json!({
            "actionId": ACTION_ID,
            "status": "SUBMISSION_UNKNOWN",
            "intentHash": "intent-hash-1",
            "correlationId": "correlation-1",
            "reconciliationRequired": true,
            "signedPayload": PRIVATE_BYTES
        }),
        "/v1/cfo/reconcile" => json!({
            "actionId": ACTION_ID,
            "status": "PENDING",
            "providerStatus": "FUTURE_PROVIDER_STATUS",
            "nearTxHashes": [],
            "signedData": PRIVATE_BYTES
        }),
        "/v1/cfo/monitor" => json!({"enabled": false, "executionReady": false}),
        _ if route.starts_with("/v1/cfo/records/") => json!({
            "record": {
                "id": RECORD_ID,
                "kind": "ACTION_RELAYED",
                "data": {
                    "status": "SUBMISSION_UNKNOWN",
                    "payload": PRIVATE_BYTES,
                    "signature": PRIVATE_BYTES,
                    "signatureBase64": PRIVATE_BYTES,
                    "signedData": PRIVATE_BYTES,
                    "relaySecret": PRIVATE_BYTES,
                    "intentHash": "intent-hash-1"
                }
            }
        }),
        _ => json!({"error": {"code": "NOT_FOUND", "message": "Not found."}}),
    };
    (StatusCode::OK, Json(response))
}

async fn stack(fake: FakeMesh) -> String {
    let upstream = Router::new().route("/{*path}", any(mesh)).with_state(fake);
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_address = upstream_listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(upstream_listener, upstream).await.unwrap() });

    let app = create_app(Config {
        mesh_url: format!("http://{upstream_address}"),
        origin: ORIGIN.into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60_000,
        rate_session: 1_000,
        rate_connect: 1_000,
        rate_global: 10_000,
    })
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{address}/mcp")
}

async fn rpc(client: &reqwest::Client, url: &str, id: u64, method: &str, params: Value) -> Value {
    let response = client
        .post(url)
        .header("origin", ORIGIN)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .send()
        .await
        .unwrap();
    let status = response.status();
    let body = response.json::<Value>().await.unwrap();
    assert!(status.is_success(), "MCP response {status}: {body}");
    body
}

async fn call(client: &reqwest::Client, url: &str, id: u64, name: &str, arguments: Value) -> Value {
    rpc(
        client,
        url,
        id,
        "tools/call",
        json!({"name": name, "arguments": arguments}),
    )
    .await
}

fn plan_args(input_base_units: Value) -> Value {
    json!({
        "session": SESSION,
        "requestId": REQUEST_ID,
        "action": "invest",
        "sourceAssetId": "solana:usdc",
        "targetAssetId": "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near",
        "inputBaseUnits": input_base_units
    })
}

fn mandate_args() -> Value {
    json!({
        "session": SESSION,
        "requestId": REQUEST_ID,
        "mandate": {
            "schemaVersion": 1,
            "reserveAssetId": "solana:usdc",
            "reserveFloorBaseUnits": "1000000",
            "maxActionReserveBaseUnits": "5000000",
            "maxPositionBps": 2500,
            "slippageBps": 100,
            "maxFeeBps": 25,
            "maxEvidenceAgeSeconds": 300,
            "targets": [{
                "assetId": "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near",
                "weightBps": 3000
            }],
            "monitorIntervalSeconds": 60,
            "maxMonitorCycles": 12
        }
    })
}

fn tool_error(response: &Value) -> &Value {
    assert_eq!(response["result"]["isError"], true, "{response}");
    &response["result"]["structuredContent"]
}

#[tokio::test]
async fn cfo_tools_are_discoverable_with_closed_identity_schemas() {
    let fake = FakeMesh::default();
    let url = stack(fake.clone()).await;
    let client = reqwest::Client::new();
    let response = rpc(&client, &url, 1, "tools/list", json!({})).await;
    let tools = response["result"]["tools"].as_array().unwrap();
    let cfo_names = [
        "falcon_cfo_overview",
        "falcon_cfo_mandate",
        "falcon_cfo_capture",
        "falcon_cfo_plan",
        "falcon_cfo_prepare",
        "falcon_cfo_register_signed",
        "falcon_cfo_relay",
        "falcon_cfo_reconcile",
        "falcon_cfo_monitor",
        "falcon_cfo_record",
    ];
    for name in cfo_names {
        let tool = tools
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("missing discovered tool {name}"));
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
        assert!(tool["inputSchema"]["properties"].get("owner").is_none());
        assert!(tool["inputSchema"]["properties"].get("wallet").is_none());
    }
    let mandate = tools
        .iter()
        .find(|tool| tool["name"] == "falcon_cfo_mandate")
        .unwrap();
    let mandate_schema = &mandate["inputSchema"]["properties"]["mandate"];
    assert_eq!(mandate_schema["additionalProperties"], false);
    assert!(mandate_schema["properties"].get("wallet").is_none());
    let plan = tools
        .iter()
        .find(|tool| tool["name"] == "falcon_cfo_plan")
        .unwrap();
    assert_eq!(
        plan["inputSchema"]["properties"]["inputBaseUnits"]["anyOf"][0]["type"],
        "string"
    );
    assert!(fake.calls.lock().await.is_empty());
}

#[tokio::test]
async fn invalid_amounts_and_identity_or_grant_injection_stop_before_mesh() {
    let fake = FakeMesh::default();
    let url = stack(fake.clone()).await;
    let client = reqwest::Client::new();
    let mut id = 1;
    for amount in [
        json!("1.5"),
        json!(1),
        json!("01"),
        json!("0"),
        json!("-1"),
        json!("1e3"),
    ] {
        let response = call(&client, &url, id, "falcon_cfo_plan", plan_args(amount)).await;
        id += 1;
        assert_eq!(tool_error(&response)["code"], "INVALID_INPUT");
    }

    let mut owner_injection = plan_args(json!("100"));
    owner_injection["owner"] = json!("other-owner");
    let response = call(&client, &url, id, "falcon_cfo_plan", owner_injection).await;
    id += 1;
    assert_eq!(tool_error(&response)["code"], "INVALID_INPUT");

    let mut wallet_injection = mandate_args();
    wallet_injection["mandate"]["wallet"] = json!("11111111111111111111111111111111");
    let response = call(&client, &url, id, "falcon_cfo_mandate", wallet_injection).await;
    assert_eq!(tool_error(&response)["code"], "INVALID_INPUT");
    id += 1;
    let response = call(
        &client,
        &url,
        id,
        "falcon_cfo_register_signed",
        json!({
            "session": SESSION,
            "requestId": REQUEST_ID,
            "actionId": ACTION_ID,
            "signatureBase64": BASE64.encode([4_u8; 63])
        }),
    )
    .await;
    assert_eq!(tool_error(&response)["code"], "INVALID_INPUT");
    id += 1;
    let response = call(
        &client,
        &url,
        id,
        "falcon_cfo_relay",
        json!({
            "session": SESSION,
            "requestId": REQUEST_ID,
            "actionId": ACTION_ID,
            "executionGrant": {"grantId": "not-caller-selectable"}
        }),
    )
    .await;
    assert_eq!(tool_error(&response)["code"], "INVALID_INPUT");
    assert!(fake.calls.lock().await.is_empty());
}

#[tokio::test]
async fn cfo_responses_redact_signed_bytes_but_preserve_unsigned_owner_review() {
    let fake = FakeMesh::default();
    let url = stack(fake.clone()).await;
    let client = reqwest::Client::new();
    let signature = BASE64.encode([7_u8; 64]);

    let calls = [
        ("falcon_cfo_overview", json!({"session": SESSION})),
        ("falcon_cfo_mandate", mandate_args()),
        (
            "falcon_cfo_capture",
            json!({"session": SESSION, "requestId": REQUEST_ID}),
        ),
        ("falcon_cfo_plan", plan_args(json!("1000000"))),
        (
            "falcon_cfo_prepare",
            json!({"session": SESSION, "requestId": REQUEST_ID, "planId": PLAN_ID}),
        ),
        (
            "falcon_cfo_register_signed",
            json!({
                "session": SESSION,
                "requestId": REQUEST_ID,
                "actionId": ACTION_ID,
                "signatureBase64": signature
            }),
        ),
        (
            "falcon_cfo_relay",
            json!({"session": SESSION, "requestId": REQUEST_ID, "actionId": ACTION_ID}),
        ),
        (
            "falcon_cfo_reconcile",
            json!({"session": SESSION, "requestId": REQUEST_ID, "actionId": ACTION_ID}),
        ),
        (
            "falcon_cfo_monitor",
            json!({"session": SESSION, "requestId": REQUEST_ID, "enabled": false}),
        ),
        (
            "falcon_cfo_record",
            json!({"session": SESSION, "recordId": RECORD_ID}),
        ),
    ];
    let mut outputs = Vec::new();
    for (index, (name, arguments)) in calls.into_iter().enumerate() {
        let response = call(&client, &url, index as u64 + 1, name, arguments).await;
        assert!(response["result"].get("isError").is_none(), "{response}");
        outputs.push(response["result"]["structuredContent"].clone());
    }

    assert_eq!(outputs[4]["payload"], "unsigned-owner-review-payload");
    assert_eq!(
        outputs[0]["quotes"][0]["raw"]["signature"],
        "provider-quote-signature-public"
    );
    assert_eq!(outputs[0]["quotes"][0]["sha256"], "quote-envelope-hash");
    for output in &outputs {
        assert!(!output.to_string().contains(PRIVATE_BYTES), "{output}");
    }
    assert!(
        outputs[4]
            .to_string()
            .contains("unsigned-owner-review-payload")
    );
}

#[tokio::test]
async fn upstream_denials_stay_errors_and_registration_error_redacts_signature() {
    let fake = FakeMesh::default();
    let signature = BASE64.encode([9_u8; 64]);
    fake.set_response(
        "/v1/cfo/relay",
        StatusCode::FORBIDDEN,
        json!({"error": {"code": "UNAUTHORIZED", "message": "Exact owner and trial grant required."}}),
    )
    .await;
    fake.set_response(
        "/v1/cfo/signatures",
        StatusCode::CONFLICT,
        json!({"error": {"code": "CONFLICT", "message": format!("Rejected signature {signature}")}}),
    )
    .await;
    let url = stack(fake.clone()).await;
    let client = reqwest::Client::new();

    let denied = call(
        &client,
        &url,
        1,
        "falcon_cfo_relay",
        json!({"session": SESSION, "requestId": REQUEST_ID, "actionId": ACTION_ID}),
    )
    .await;
    assert_eq!(tool_error(&denied)["code"], "UNAUTHORIZED");
    assert!(
        !denied
            .to_string()
            .contains("Exact owner and trial grant required.")
    );
    assert!(
        denied
            .to_string()
            .contains("The NEAR CFO request was rejected.")
    );

    let rejected = call(
        &client,
        &url,
        2,
        "falcon_cfo_register_signed",
        json!({
            "session": SESSION,
            "requestId": REQUEST_ID,
            "actionId": ACTION_ID,
            "signatureBase64": signature
        }),
    )
    .await;
    assert_eq!(tool_error(&rejected)["code"], "CONFLICT");
    assert!(!rejected.to_string().contains(&signature));
    assert!(
        rejected
            .to_string()
            .contains("The NEAR CFO request was rejected.")
    );

    let forwarded = fake.calls.lock().await;
    assert_eq!(forwarded.len(), 2);
    assert_eq!(forwarded[0]["path"], "/v1/cfo/relay");
    assert_eq!(
        forwarded[0]["body"],
        json!({"requestId": REQUEST_ID, "actionId": ACTION_ID})
    );
    assert_eq!(forwarded[1]["path"], "/v1/cfo/signatures");
    assert_eq!(forwarded[1]["body"]["signatureBase64"], signature);
}
