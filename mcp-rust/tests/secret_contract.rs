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
use std::sync::Arc;
use tokio::{net::TcpListener, sync::Mutex};

const ORIGIN: &str = "http://localhost:8792";
const WALLET: &str = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SESSION: &str = "wsi1_Zk3Q9xLmN2pR7vTbY1cDfGh4JkLmNoPqRsTuVwXyZ0";
const CHALLENGE_ID: &str = "11111111-1111-4111-8111-111111111111";
const PRIVATE_MARKER: &str = "private-key-and-rpc-secret-marker";

#[derive(Clone)]
struct FakeMesh(Arc<Mutex<FakeState>>);

struct FakeState {
    graph_response: Value,
    verify_response: Value,
    yield_response: (StatusCode, Value),
    calls: Vec<Value>,
}

impl FakeMesh {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(FakeState {
            graph_response: graph_response(),
            verify_response: json!({
                "sessionToken": SESSION,
                "walletAddress": WALLET,
                "expiresAt": "2030-01-01T00:00:00.000Z"
            }),
            yield_response: (StatusCode::OK, json!({"opportunities": [], "limits": []})),
            calls: Vec::new(),
        })))
    }

    async fn set_yield_response(&self, status: StatusCode, body: Value) {
        self.0.lock().await.yield_response = (status, body);
    }

    async fn calls(&self) -> Vec<Value> {
        self.0.lock().await.calls.clone()
    }
}

async fn fake_mesh(
    State(fake): State<FakeMesh>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> (StatusCode, Json<Value>) {
    let method = request.method().to_string();
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = axum::body::to_bytes(request.into_body(), 65_536)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    let route = format!("/{path}");

    let mut state = fake.0.lock().await;
    state.calls.push(json!({
        "method": method,
        "route": route,
        "origin": origin,
        "authorization": authorization,
        "body": body,
    }));
    let (status, payload) = match route.as_str() {
        "/v1/auth/wallet/verify" => (StatusCode::OK, state.verify_response.clone()),
        "/v1/public/graph/live" => (StatusCode::OK, state.graph_response.clone()),
        "/v1/yield/opportunities" => state.yield_response.clone(),
        _ => (StatusCode::OK, json!({"ok": true})),
    };
    (status, Json(payload))
}

async fn start_http(router: Router) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}")
}

async fn start_mesh(fake: FakeMesh) -> String {
    let router = Router::new()
        .route("/{*path}", any(fake_mesh))
        .with_state(fake);
    start_http(router).await
}

async fn start_app(mesh_url: String) -> String {
    let app = create_app(Config {
        mesh_url,
        origin: ORIGIN.into(),
        host: "127.0.0.1".into(),
        allowed_hosts: vec![],
        port: 0,
        rate_window: 60_000,
        rate_session: 60,
        rate_connect: 10,
        rate_global: 300,
    })
    .unwrap();
    start_http(app).await
}

async fn rpc(client: &reqwest::Client, url: &str, id: u64, name: &str, arguments: Value) -> Value {
    let response = client
        .post(format!("{url}/mcp"))
        .header("origin", ORIGIN)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments}
        }))
        .send()
        .await
        .unwrap();
    let status = response.status();
    let text = response.text().await.unwrap();
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("MCP response {status}: {text}; {error}"))
}

fn graph_response() -> Value {
    json!({
        "scope": "public-market-evidence",
        "chain": "solana",
        "network": "devnet",
        "graph": {
            "revisionId": "55555555-5555-4555-8555-555555555555",
            "sources": [{
                "sourceKey": "live:solana-devnet-klend",
                "revisionId": "source-revision-1",
                "content": PRIVATE_MARKER,
                "rawExchanges": [{"requestBody": PRIVATE_MARKER, "responseBody": PRIVATE_MARKER}],
                "exchanges": [{"bodyBase64": PRIVATE_MARKER}],
                "ownerRecord": {"id": PRIVATE_MARKER},
                "record": {"id": PRIVATE_MARKER},
                "wallet": WALLET,
                "session": SESSION,
                "customGraphId": PRIVATE_MARKER,
                "privateKey": PRIVATE_MARKER
            }],
            "nodes": [{
                "id": "market",
                "kind": "source",
                "properties": {
                    "status": "OBSERVED",
                    "content": PRIVATE_MARKER,
                    "ownerId": PRIVATE_MARKER,
                    "privateGraphData": PRIVATE_MARKER,
                    "customData": PRIVATE_MARKER
                }
            }],
            "edges": [],
            "issues": []
        },
        "programAnalysis": {
            "status": "OBSERVED",
            "summary": "Program observed.",
            "policyVersion": "mesh-public-evidence/1",
            "content": PRIVATE_MARKER
        },
        "reserveAnalysis": {
            "status": "OBSERVED",
            "summary": "Reserve observed.",
            "availableLiquidityUnits": "5000000",
            "slot": 123,
            "policyVersion": "mesh-reserve-liquidity/1"
        },
        "status": "OBSERVED",
        "policyDefinitionId": "decision:mesh-reserve-scenario/1",
        "policyVersion": "mesh-reserve-scenario/2",
        "maxSupplyBaseUnits": "1000000",
        "customGraphsSupported": false,
        "executionReady": false,
        "privateGraph": {"id": PRIVATE_MARKER}
    })
}

fn tool_result(response: &Value) -> &Value {
    &response["result"]
}

#[tokio::test]
async fn login_accepts_canonical_64_byte_signatures_and_rejects_malformed_encodings() {
    let fake = FakeMesh::new();
    let app_url = start_app(start_mesh(fake.clone()).await).await;
    let client = reqwest::Client::new();
    let bytes = (0..64)
        .map(|index| ((index * 7 + 3) % 256) as u8)
        .collect::<Vec<_>>();
    let canonical_base64 = BASE64.encode(&bytes);
    let base58 = bs58::encode(&bytes).into_string();

    for (id, signature) in [(1, canonical_base64.as_str()), (2, base58.as_str())] {
        let response = rpc(
            &client,
            &app_url,
            id,
            "falcon_connect_verify",
            json!({"challengeId": CHALLENGE_ID, "signature": signature}),
        )
        .await;
        let result = tool_result(&response);
        assert!(result.get("isError").is_none(), "{response}");
        assert_eq!(result["structuredContent"]["session"], SESSION);
        assert_eq!(result["structuredContent"]["walletAddress"], WALLET);
    }

    let valid_calls = fake
        .calls()
        .await
        .into_iter()
        .filter(|call| call["route"] == "/v1/auth/wallet/verify")
        .collect::<Vec<_>>();
    assert_eq!(valid_calls.len(), 2);
    for call in valid_calls {
        assert_eq!(call["body"]["challengeId"], CHALLENGE_ID);
        assert_eq!(call["body"]["signature"], canonical_base64);
        assert_eq!(call["origin"], ORIGIN);
        assert!(call["authorization"].is_null());
    }

    let malformed_base64 = format!("{}B==", &canonical_base64[..canonical_base64.len() - 3]);
    let malformed_short_signature = bs58::encode(vec![9; 63]).into_string();
    let malformed_characters = "O".repeat(88);
    for (id, signature) in [
        (3, malformed_base64.as_str()),
        (4, malformed_short_signature.as_str()),
        (5, malformed_characters.as_str()),
    ] {
        let response = rpc(
            &client,
            &app_url,
            id,
            "falcon_connect_verify",
            json!({"challengeId": CHALLENGE_ID, "signature": signature}),
        )
        .await;
        let result = tool_result(&response);
        assert_eq!(result["isError"], true, "{response}");
        assert_eq!(result["structuredContent"]["code"], "INVALID_INPUT");
        assert!(!response.to_string().contains(signature));
    }
    assert_eq!(
        fake.calls().await.len(),
        2,
        "malformed input must stop before Mesh"
    );
}

#[tokio::test]
async fn unknown_private_fields_are_rejected_and_public_graph_redacts_private_metadata() {
    let fake = FakeMesh::new();
    let app_url = start_app(start_mesh(fake.clone()).await).await;
    let client = reqwest::Client::new();

    let private_key_input = rpc(
        &client,
        &app_url,
        1,
        "falcon_connect",
        json!({"wallet": WALLET, "privateKey": PRIVATE_MARKER}),
    )
    .await;
    assert_eq!(tool_result(&private_key_input)["isError"], true);
    assert_eq!(
        tool_result(&private_key_input)["structuredContent"]["code"],
        "INVALID_INPUT"
    );
    assert!(!private_key_input.to_string().contains(PRIVATE_MARKER));

    let unknown_selector = rpc(
        &client,
        &app_url,
        2,
        "falcon_public_graph",
        json!({"graphId": "caller-selected-graph"}),
    )
    .await;
    assert_eq!(tool_result(&unknown_selector)["isError"], true);
    assert_eq!(
        tool_result(&unknown_selector)["structuredContent"]["code"],
        "INVALID_INPUT"
    );
    assert!(fake.calls().await.is_empty());

    let response = rpc(&client, &app_url, 3, "falcon_public_graph", json!({})).await;
    let result = tool_result(&response);
    assert!(result.get("isError").is_none(), "{response}");
    let graph = &result["structuredContent"];
    assert_eq!(graph["status"], "OBSERVED");
    assert_eq!(
        graph["graph"]["sources"][0],
        json!({
            "sourceKey": "live:solana-devnet-klend",
            "revisionId": "source-revision-1"
        })
    );
    assert_eq!(
        graph["graph"]["nodes"][0]["properties"],
        json!({"status": "OBSERVED"})
    );
    assert_eq!(graph["programAnalysis"]["summary"], "Program observed.");
    let visible = response.to_string();
    for secret in [
        PRIVATE_MARKER,
        WALLET,
        SESSION,
        "privateKey",
        "privateGraphData",
    ] {
        assert!(
            !visible.contains(secret),
            "public graph leaked {secret}: {response}"
        );
    }

    let calls = fake.calls().await;
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["route"], "/v1/public/graph/live");
    assert!(calls[0]["authorization"].is_null());
    assert!(calls[0]["body"].is_null());
}

#[tokio::test]
async fn stale_conflicting_and_unauthorized_mesh_errors_remain_actionable() {
    let fake = FakeMesh::new();
    let app_url = start_app(start_mesh(fake.clone()).await).await;
    let client = reqwest::Client::new();
    let arguments = json!({"session": SESSION});

    for (id, code) in [(1, "STALE_EVIDENCE"), (2, "CONFLICT")] {
        fake.set_yield_response(
            StatusCode::CONFLICT,
            json!({"error": {"code": code, "message": "The observed evidence changed."}}),
        )
        .await;
        let response = rpc(
            &client,
            &app_url,
            id,
            "falcon_yield_opportunities",
            arguments.clone(),
        )
        .await;
        let result = tool_result(&response);
        assert_eq!(result["isError"], true, "{response}");
        assert_eq!(result["structuredContent"]["code"], code);
    }

    fake.set_yield_response(
        StatusCode::UNAUTHORIZED,
        json!({"error": {"code": "UNAUTHORIZED", "message": "A valid wallet session is required."}}),
    )
    .await;
    let response = rpc(
        &client,
        &app_url,
        3,
        "falcon_yield_opportunities",
        arguments,
    )
    .await;
    let result = tool_result(&response);
    assert_eq!(result["isError"], true, "{response}");
    assert_eq!(result["structuredContent"]["code"], "UNAUTHORIZED");
    let message = result["structuredContent"]["message"].as_str().unwrap();
    assert!(message.contains("falcon_connect"));
    assert!(message.contains("falcon_connect_verify"));
}
