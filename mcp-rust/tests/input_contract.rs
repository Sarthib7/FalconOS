use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::Request,
    routing::any,
};
use falcon_mcp_rust::{Config, create_app};
use reqwest::Client;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::{net::TcpListener, sync::Mutex};

const ORIGIN: &str = "http://localhost:8792";
const SESSION: &str = "wsi1_12345678901234567890";
const ANALYSIS: &str = "12345678-1234-1234-1234-123456789012";
const DECISION: &str = "12345678-1234-1234-1234-123456789013";

#[derive(Clone)]
struct FakeMesh {
    calls: Arc<Mutex<Vec<Value>>>,
    activity_response: Option<Value>,
}

async fn mesh(
    State(fake): State<FakeMesh>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Json<Value> {
    let method = request.method().to_string();
    let bytes = axum::body::to_bytes(request.into_body(), 64 * 1024)
        .await
        .unwrap();
    let body = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
    fake.calls.lock().await.push(json!({
        "method": method,
        "path": format!("/{path}"),
        "body": body,
    }));

    if path == "v1/activity" {
        Json(fake.activity_response.clone().unwrap_or_else(|| {
            json!({
                "trail": [],
                "counts": {"decisions": 0, "intents": 0},
                "limit": 20,
                "research": {
                    "schemaVersion": 1, "briefing": null, "adopted": [], "reviews": [],
                    "limit": 20, "executionReady": false
                }
            })
        }))
    } else {
        Json(json!({"ok": true}))
    }
}

async fn stack(activity_response: Option<Value>) -> (String, Arc<Mutex<Vec<Value>>>) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let upstream = Router::new()
        .route("/{*path}", any(mesh))
        .with_state(FakeMesh {
            calls: calls.clone(),
            activity_response,
        });
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
        rate_session: 1_000,
        rate_connect: 1_000,
        rate_global: 10_000,
    })
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/mcp"), calls)
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

fn assert_tool_error(body: &Value, code: &str) {
    assert_eq!(body["result"]["isError"], true);
    assert_eq!(body["result"]["structuredContent"]["code"], code);
}

fn decision_args(proposed: Value, max: Value, minimum: Value) -> Value {
    json!({
        "session": SESSION,
        "analysisId": ANALYSIS,
        "proposedUsdc": proposed,
        "maxUsdc": max,
        "minBookLiquidityUsdc": minimum,
        "maxEvidenceAgeSeconds": 300,
    })
}

#[tokio::test]
async fn reserve_amounts_keep_exact_precision_through_the_u64_boundary() {
    let (url, calls) = stack(None).await;
    let client = Client::new();
    let response = call(
        &client,
        &url,
        1,
        "falcon_reserve_decision",
        decision_args(
            json!("18446744073709.551615"),
            json!("0"),
            json!("0.000001"),
        ),
    )
    .await;
    assert!(response["result"].get("isError").is_none());

    let calls = calls.lock().await;
    let forwarded = calls
        .iter()
        .find(|entry| entry["path"] == "/v1/public/decisions/reserve")
        .unwrap();
    assert_eq!(
        forwarded["body"]["scenario"],
        json!({
            "proposedUnits": "18446744073709551615",
            "maxProposedUnits": "0",
            "minBookLiquidityUnits": "1",
            "maxObservationAgeSeconds": 300,
        })
    );
}

#[tokio::test]
async fn malformed_and_overflowing_reserve_amounts_are_rejected_before_mesh() {
    let (url, calls) = stack(None).await;
    let client = Client::new();
    let invalid = [
        json!("1e3"),
        json!("1E3"),
        json!("-1"),
        json!("+1"),
        json!("1.1234567"),
        json!(""),
        json!("01"),
        json!("00.5"),
        json!(".5"),
        json!("1."),
        json!(" 1"),
        json!("1 "),
        json!("1,5"),
        json!("0x10"),
        json!("NaN"),
        json!("Infinity"),
        json!("1_000"),
        json!("18446744073709.551616"),
        json!("99999999999999999999"),
        json!(1),
        json!(1.5),
        Value::Null,
        json!({}),
    ];

    for (index, amount) in invalid.into_iter().enumerate() {
        let response = call(
            &client,
            &url,
            index as u64 + 1,
            "falcon_reserve_decision",
            decision_args(amount, json!("1"), json!("0.1")),
        )
        .await;
        assert_tool_error(&response, "INVALID_INPUT");
    }
    assert!(calls.lock().await.is_empty());
}

fn supply_args(amount: Value) -> Value {
    json!({
        "session": SESSION,
        "action": "supply",
        "analysisId": ANALYSIS,
        "decisionId": DECISION,
        "amountUsdc": amount,
    })
}

fn redeem_args(amount: Value) -> Value {
    json!({
        "session": SESSION,
        "action": "redeem",
        "analysisId": ANALYSIS,
        "amountReceiptTokens": amount,
    })
}

#[tokio::test]
async fn prepare_amounts_are_positive_and_follow_action_specific_inputs() {
    let (url, calls) = stack(None).await;
    let client = Client::new();
    let invalid = [
        supply_args(json!("0")),
        supply_args(json!("0.000000")),
        redeem_args(json!("0")),
        redeem_args(json!("0.000000")),
        json!({
            "session": SESSION,
            "action": "supply",
            "analysisId": ANALYSIS,
            "amountUsdc": "0.5",
        }),
        json!({
            "session": SESSION,
            "action": "supply",
            "analysisId": ANALYSIS,
            "decisionId": DECISION,
            "amountReceiptTokens": "0.5",
        }),
        json!({
            "session": SESSION,
            "action": "redeem",
            "analysisId": ANALYSIS,
        }),
        json!({
            "session": SESSION,
            "action": "redeem",
            "analysisId": ANALYSIS,
            "amountReceiptTokens": "0.5",
            "amountUsdc": "0.5",
        }),
    ];
    for (index, arguments) in invalid.into_iter().enumerate() {
        let response = call(
            &client,
            &url,
            index as u64 + 1,
            "falcon_prepare_transaction",
            arguments,
        )
        .await;
        assert_tool_error(&response, "INVALID_INPUT");
    }

    // Positive one-base-unit inputs pass validation for both actions. The fake Mesh
    // deliberately lacks a session wallet, so preparation stops at that real boundary.
    for (id, arguments) in [
        (20, supply_args(json!("0.000001"))),
        (21, redeem_args(json!("0.000001"))),
    ] {
        let response = call(&client, &url, id, "falcon_prepare_transaction", arguments).await;
        assert_tool_error(&response, "MESH_UNAVAILABLE");
    }
    let forwarded = calls.lock().await;
    assert_eq!(forwarded.len(), 2);
    assert!(
        forwarded.iter().all(|entry| {
            entry["method"] == "GET" && entry["path"] == "/v1/auth/wallet/session"
        })
    );
}

#[tokio::test]
async fn activity_delegates_to_mesh_projection_and_keeps_research() {
    let cases = [
        ("zero", "supply", json!("0"), json!("0")),
        ("one", "redeem", json!("1"), json!("0.000001")),
        ("whole", "supply", json!("1000000"), json!("1")),
        ("fraction", "redeem", json!("1500000"), json!("1.5")),
        (
            "maximum",
            "supply",
            json!("18446744073709551615"),
            json!("18446744073709.551615"),
        ),
        ("leading-zero", "supply", json!("01"), Value::Null),
        ("numeric", "redeem", json!(5), Value::Null),
    ];
    let trail = cases
        .iter()
        .enumerate()
        .map(|(index, (_, action, _, expected))| {
            let created_at = "2030-01-01T00:00:00.000Z";
            let amount_key = if *action == "redeem" {
                "amountReceiptTokens"
            } else {
                "amountUsdc"
            };
            let mut intent = json!({
                "id": format!("00000000-0000-0000-0000-{index:012x}"),
                "createdAt": created_at,
                "action": action,
                "wallet": "11111111111111111111111111111111",
                "status": "READY",
                "transactionSignature": null,
            });
            intent[amount_key] = expected.clone();
            json!({"at": created_at, "decision": null, "intent": intent})
        })
        .collect::<Vec<_>>();
    let activity = json!({
        "trail": trail,
        "counts": {"decisions": 0, "intents": cases.len()},
        "limit": 20,
        "research": {
            "schemaVersion": 1, "briefing": null, "adopted": [], "reviews": [],
            "limit": 20, "executionReady": false
        }
    });
    let (url, calls) = stack(Some(activity.clone())).await;
    let response = call(
        &Client::new(),
        &url,
        1,
        "falcon_activity",
        json!({"session": SESSION}),
    )
    .await;
    assert!(response["result"].get("isError").is_none());
    assert_eq!(response["result"]["structuredContent"], activity);
    let forwarded = calls.lock().await;
    assert_eq!(forwarded.len(), 1);
    assert_eq!(forwarded[0]["method"], "GET");
    assert_eq!(forwarded[0]["path"], "/v1/activity");
    assert_eq!(forwarded[0]["body"], Value::Null);
}
