use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    routing::any,
};
use falcon_mcp_rust::{Config, SCHEMA_FINGERPRINT, TOOL_NAMES, create_app};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::{net::TcpListener, sync::Mutex};

const ORIGIN: &str = "http://localhost:8792";
const SESSION: &str = "wsi1_12345678901234567890";
const REQUEST_ID: &str = "12345678-1234-4234-8234-123456789001";
const ACTION_ID: &str = "12345678-1234-4234-8234-123456789002";
const RESERVE: &str = "11111111111111111111111111111111";
const PRIVATE_CUSTOMER: &str = "CUSTOMER_ID_PRIVATE_MARKER";
const PRIVATE_PROVIDER: &str = "PROVIDER_BODY_PRIVATE_MARKER";
const PRIVATE_POLICY: &str = "RAW_POLICY_BODY_PRIVATE_MARKER";
const PRIVATE_SECRET: &str = "PROVIDER_SECRET_PRIVATE_MARKER";
const PRIVATE_SIGNED: &str = "SIGNED_TRANSACTION_PRIVATE_MARKER";
const UNSIGNED_WITHDRAW: &str = "UNSIGNED_WITHDRAW_OWNER_REVIEW_BYTES";
const UNSIGNED_FEE: &str = "UNSIGNED_FEE_OWNER_REVIEW_BYTES";

#[derive(Clone, Default)]
struct FakeMesh {
    calls: Arc<Mutex<Vec<Value>>>,
    deny_pause: bool,
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

    if fake.deny_pause && route == "/v1/lending-bot/pause" {
        return (
            StatusCode::FORBIDDEN,
            Json(
                json!({"error":{"code":"UNAUTHORIZED","message":format!("Rejected provider session {PRIVATE_SECRET}")}}),
            ),
        );
    }
    let response = match route.as_str() {
        "/v1/lending-bot" => json!({
            "schemaVersion": 1,
            "domain": "solana-lending-bot",
            "status": "READY",
            "configuration": {
                "walletProviderConfigured": true,
                "executionEnabled": false,
                "appId": "public-app-id",
                "signerId": "backend-signer-id",
                "feeRecipient": "configured-fee-recipient",
                "feeBps": 100,
                "availableReserves": [],
                "issues": []
            },
            "ownerId": PRIVATE_CUSTOMER,
            "walletLink": {"providerWalletId": PRIVATE_CUSTOMER, "walletAddress": PRIVATE_CUSTOMER},
            "delegation": {
                "status": "ACTIVE",
                "policyIds": ["policy-id-public"],
                "policyHash": "policy-hash-public",
                "rawPolicyBody": PRIVATE_POLICY,
                "secret": PRIVATE_SECRET
            },
            "portfolio": {
                "status": "OBSERVED",
                "wallet": PRIVATE_CUSTOMER,
                "cashBaseUnits": "1230000",
                "history": [{
                    "signedTransactionBase64": PRIVATE_SIGNED,
                    "signatureBase64": PRIVATE_SIGNED,
                    "transactionBase64": PRIVATE_SIGNED,
                    "request": {"bodyBase64": PRIVATE_PROVIDER}
                }]
            },
            "runner": {"state":"STOPPED"},
            "actions": [{"actionId": ACTION_ID, "signature": PRIVATE_SIGNED}],
            "accounting": {"depositsBaseUnits":"2000000", "earnedFeeBaseUnits":"10"}
        }),
        "/v1/lending-bot/capture" => json!({
            "portfolio": {
                "status": "OBSERVED",
                "walletAddress": PRIVATE_CUSTOMER,
                "cashBaseUnits": "1000000",
                "providerResponse": {"bodyBase64": PRIVATE_PROVIDER},
                "policyBody": PRIVATE_POLICY,
                "transactionBase64": PRIVATE_SIGNED
            }
        }),
        "/v1/lending-bot/start" => json!({
            "runner": {"state":"RUNNING", "signedTransactionBase64":PRIVATE_SIGNED, "transactionBase64":PRIVATE_SIGNED}
        }),
        "/v1/lending-bot/pause" => json!({"runner":{"state":"PAUSED"}}),
        "/v1/lending-bot/withdraw" => json!({
            "ownerAction": {
                "actionId": ACTION_ID,
                "prepared": {
                    "schemaVersion": 1,
                    "chain": "solana",
                    "network": "mainnet-beta",
                    "wallet": PRIVATE_CUSTOMER,
                    "action": "redeem",
                    "reserveAddress": RESERVE,
                    "amountBaseUnits": "1000000",
                    "amountUnit": "receipt-base-units",
                    "signature": null,
                    "transactionBase64": UNSIGNED_WITHDRAW,
                    "signedTransactionBase64": PRIVATE_SIGNED,
                    "rawPolicyBody": PRIVATE_POLICY
                }
            },
            "history": [{"transactionBase64":PRIVATE_SIGNED}]
        }),
        "/v1/lending-bot/reconcile" => json!({
            "action": {
                "status":"CONFIRMED",
                "ownerId": PRIVATE_CUSTOMER,
                "transactionBase64": PRIVATE_SIGNED,
                "signedTransactionBase64": PRIVATE_SIGNED,
                "response": {"bodyBase64":PRIVATE_PROVIDER}
            }
        }),
        "/v1/lending-bot/fee-claim" => json!({
            "ownerAction": {
                "actionId": ACTION_ID,
                "prepared": {
                    "schemaVersion": 1,
                    "chain": "solana",
                    "network": "mainnet-beta",
                    "recipient": "configured-fee-recipient",
                    "amountBaseUnits": "10",
                    "amountUnit": "usdc-base-units",
                    "signature": null,
                    "transactionBase64": UNSIGNED_FEE,
                    "signedTransactionBase64": PRIVATE_SIGNED,
                    "secret": PRIVATE_SECRET
                }
            }
        }),
        _ => json!({"error":{"code":"NOT_FOUND","message":"Not found."}}),
    };
    (StatusCode::OK, Json(response))
}

async fn stack(fake: FakeMesh) -> (String, FakeMesh) {
    let upstream = Router::new()
        .route("/{*path}", any(mesh))
        .with_state(fake.clone());
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
    (format!("http://{address}/mcp"), fake)
}

async fn call(client: &reqwest::Client, url: &str, id: u64, name: &str, args: Value) -> Value {
    let response = client
        .post(url)
        .header("origin", ORIGIN)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc":"2.0",
            "id":id,
            "method":"tools/call",
            "params":{"name":name,"arguments":args}
        }))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    response.json::<Value>().await.unwrap()["result"].clone()
}

fn args(request_id: &str) -> Value {
    json!({"session":SESSION,"requestId":request_id})
}

#[tokio::test]
async fn funded_lending_tools_are_fixed_and_reject_identity_or_authority_injection() {
    let (url, fake) = stack(FakeMesh::default()).await;
    let client = reqwest::Client::new();
    let listed = client
        .post(&url)
        .header("origin", ORIGIN)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}))
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    let tools = listed["result"]["tools"].as_array().unwrap();
    let names = tools
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .filter(|name| name.starts_with("falcon_lending_bot_"))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            "falcon_lending_bot_overview",
            "falcon_lending_bot_capture",
            "falcon_lending_bot_start",
            "falcon_lending_bot_pause",
            "falcon_lending_bot_withdraw",
            "falcon_lending_bot_reconcile",
            "falcon_lending_bot_fee_claim"
        ]
    );
    for name in names {
        let tool = tools.iter().find(|tool| tool["name"] == name).unwrap();
        let schema = &tool["inputSchema"];
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().unwrap();
        for forbidden in [
            "owner",
            "wallet",
            "feeRecipient",
            "route",
            "model",
            "accessToken",
        ] {
            assert!(
                !properties.contains_key(forbidden),
                "{name} exposed {forbidden}"
            );
        }
    }
    assert_eq!(fake.calls.lock().await.len(), 0);

    let mut injected = args(REQUEST_ID);
    injected["owner"] = json!("other-owner");
    let rejected = call(&client, &url, 2, "falcon_lending_bot_capture", injected).await;
    assert_eq!(rejected["isError"], true);
    assert_eq!(rejected["structuredContent"]["code"], "INVALID_INPUT");

    let mut bad_withdrawal = args(REQUEST_ID);
    bad_withdrawal["reserveAddress"] = json!(RESERVE);
    bad_withdrawal["receiptBaseUnits"] = json!(100);
    bad_withdrawal["feeRecipient"] = json!("caller-chosen-recipient");
    let rejected = call(
        &client,
        &url,
        3,
        "falcon_lending_bot_withdraw",
        bad_withdrawal,
    )
    .await;
    assert_eq!(rejected["isError"], true);
    assert_eq!(rejected["structuredContent"]["code"], "INVALID_INPUT");
    assert_eq!(fake.calls.lock().await.len(), 0);
}

#[tokio::test]
async fn funded_lending_calls_forward_only_fixed_authenticated_mesh_requests_and_redact_outputs() {
    let (url, fake) = stack(FakeMesh::default()).await;
    let client = reqwest::Client::new();
    let calls = [
        ("falcon_lending_bot_overview", json!({"session":SESSION})),
        ("falcon_lending_bot_capture", args(REQUEST_ID)),
        ("falcon_lending_bot_start", args(REQUEST_ID)),
        ("falcon_lending_bot_pause", args(REQUEST_ID)),
        (
            "falcon_lending_bot_withdraw",
            json!({"session":SESSION,"requestId":REQUEST_ID,"reserveAddress":RESERVE,"receiptBaseUnits":"1000000"}),
        ),
        (
            "falcon_lending_bot_reconcile",
            json!({"session":SESSION,"requestId":REQUEST_ID,"actionId":ACTION_ID}),
        ),
        ("falcon_lending_bot_fee_claim", args(REQUEST_ID)),
    ];
    let mut outputs = Vec::new();
    for (index, (name, arguments)) in calls.iter().enumerate() {
        let result = call(&client, &url, index as u64 + 1, name, arguments.clone()).await;
        assert!(result.get("isError").is_none(), "{result}");
        outputs.push(result["structuredContent"].clone());
    }

    assert_eq!(outputs[0]["domain"], "solana-lending-bot");
    assert_eq!(
        outputs[0]["configuration"]["walletProviderConfigured"],
        true
    );
    assert_eq!(outputs[0]["accounting"]["depositsBaseUnits"], "2000000");
    assert_eq!(outputs[0]["delegation"]["policyHash"], "policy-hash-public");
    assert!(outputs[0]["delegation"].get("rawPolicyBody").is_none());
    assert_eq!(
        outputs[4]["ownerAction"]["prepared"]["transactionBase64"],
        UNSIGNED_WITHDRAW
    );
    assert_eq!(
        outputs[6]["ownerAction"]["prepared"]["transactionBase64"],
        UNSIGNED_FEE
    );
    for index in [1_usize, 2, 3, 5] {
        assert!(!outputs[index].to_string().contains("transactionBase64"));
        assert!(
            !outputs[index]
                .to_string()
                .contains("signedTransactionBase64")
        );
    }
    for output in &outputs {
        let text = output.to_string();
        for private in [
            PRIVATE_CUSTOMER,
            PRIVATE_PROVIDER,
            PRIVATE_POLICY,
            PRIVATE_SECRET,
            PRIVATE_SIGNED,
        ] {
            assert!(
                !text.contains(private),
                "private marker reached model output: {private}"
            );
        }
        assert!(!text.contains("walletAddress"));
        assert!(!text.contains("providerWalletId"));
        assert!(!text.contains("signatureBase64"));
    }

    let forwarded = fake.calls.lock().await;
    assert_eq!(forwarded.len(), calls.len());
    let expected = [
        ("GET", "/v1/lending-bot", Value::Null),
        (
            "POST",
            "/v1/lending-bot/capture",
            json!({"requestId":REQUEST_ID}),
        ),
        (
            "POST",
            "/v1/lending-bot/start",
            json!({"requestId":REQUEST_ID}),
        ),
        (
            "POST",
            "/v1/lending-bot/pause",
            json!({"requestId":REQUEST_ID}),
        ),
        (
            "POST",
            "/v1/lending-bot/withdraw",
            json!({"requestId":REQUEST_ID,"reserveAddress":RESERVE,"receiptBaseUnits":"1000000"}),
        ),
        (
            "POST",
            "/v1/lending-bot/reconcile",
            json!({"requestId":REQUEST_ID,"actionId":ACTION_ID}),
        ),
        (
            "POST",
            "/v1/lending-bot/fee-claim",
            json!({"requestId":REQUEST_ID}),
        ),
    ];
    for (observed, (method, path, body)) in forwarded.iter().zip(expected) {
        assert_eq!(observed["method"], method);
        assert_eq!(observed["path"], path);
        assert_eq!(observed["authorization"], format!("Bearer {SESSION}"));
        assert_eq!(observed["body"], body);
        assert!(observed["body"].get("session").is_none());
        assert!(observed["body"].get("owner").is_none());
        assert!(observed["body"].get("wallet").is_none());
    }
}

#[tokio::test]
async fn funded_lending_upstream_errors_are_redacted() {
    let (url, _) = stack(FakeMesh {
        deny_pause: true,
        ..FakeMesh::default()
    })
    .await;
    let result = call(
        &reqwest::Client::new(),
        &url,
        1,
        "falcon_lending_bot_pause",
        args(REQUEST_ID),
    )
    .await;
    assert_eq!(result["isError"], true);
    assert_eq!(result["structuredContent"]["code"], "UNAUTHORIZED");
    assert_eq!(
        result["structuredContent"]["message"],
        "The Solana lending bot request was rejected."
    );
    assert!(!result.to_string().contains(PRIVATE_SECRET));
}

#[tokio::test]
async fn self_test_keeps_legacy_scopes_separate_and_reports_bot_gates_closed() {
    let (url, fake) = stack(FakeMesh::default()).await;
    let result = call(
        &reqwest::Client::new(),
        &url,
        1,
        "falcon_self_test",
        json!({}),
    )
    .await;
    assert!(result.get("isError").is_none());
    let metadata = &result["structuredContent"];
    assert_eq!(metadata["toolCount"], 37);
    assert_eq!(
        metadata["tools"].as_array().unwrap().len(),
        TOOL_NAMES.len()
    );
    assert_eq!(metadata["schemaFingerprint"], SCHEMA_FINGERPRINT);
    assert_eq!(metadata["readiness"]["lendingBotContext"], "not_checked");
    assert_eq!(metadata["readiness"]["lendingBotProvider"], "not_checked");
    assert_eq!(
        metadata["readiness"]["lendingBotExecution"],
        "default_deny_until_provider_mandate_delegation_and_financial_gates"
    );
    let authority = &metadata["capabilities"]["authority"];
    assert_eq!(authority["delegatedExecution"], true);
    assert_eq!(
        authority["delegatedExecutionScope"],
        "solana-funded-lending-bot-only;customer-installed-policy-limited-signer"
    );
    assert_eq!(authority["custody"], false);
    assert_eq!(
        authority["broadcastScope"],
        "legacy-solana-devnet-human-only;near-mainnet-exact-cfo-relay;solana-mainnet-beta-policy-limited-funded-lending-bot"
    );

    let supported = metadata["capabilities"]["supported"].as_array().unwrap();
    let bot = supported
        .iter()
        .find(|scope| scope["id"] == "solana-funded-lending-bot")
        .unwrap();
    assert_eq!(bot["chain"], "solana");
    assert_eq!(bot["network"], "mainnet-beta");
    assert_eq!(bot["executionReady"], false);
    assert_eq!(
        bot["authorization"]["owner"],
        "authenticated-wallet-session"
    );
    assert_eq!(
        bot["authorization"]["start"],
        "human-approved-mandate-and-actual-customer-owned-installed-policy-limited-delegation"
    );
    let near = supported
        .iter()
        .find(|scope| scope["id"] == "near-cfo")
        .unwrap();
    assert_eq!(near["chain"], "near");
    assert_eq!(near["network"], "mainnet");
    assert_eq!(
        near["authorization"]["ownerSignature"],
        "required-for-every-financial-action"
    );
    assert_eq!(near["authorization"]["defaultRelayGrant"], "deny");
    let legacy = supported
        .iter()
        .find(|scope| scope["id"] == "lending-execution")
        .unwrap();
    assert_eq!(legacy["network"], "devnet");
    assert_eq!(legacy["maxSupplyUsdc"], "1");
    assert_eq!(fake.calls.lock().await.len(), 0);
}
