use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::any,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::{DateTime, SecondsFormat, Utc};
use falcon_mcp_rust::{Config, create_app};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::{net::TcpListener, sync::Mutex};

const ORIGIN: &str = "http://localhost:8792";
const WALLET: &str = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER: &str = "11111111111111111111111111111111";
const SESSION: &str = "wsi1_Zk3Q9xLmN2pR7vTbY1cDfGh4JkLmNoPqRsTuVwXyZ0";
const ANALYSIS_ID: &str = "22222222-2222-4222-8222-222222222222";
const DECISION_ID: &str = "33333333-3333-4333-8333-333333333333";
const INTENT_ID: &str = "44444444-4444-4444-8444-444444444444";

#[derive(Clone)]
struct FakeMesh(Arc<Mutex<Value>>);

impl FakeMesh {
    fn new(prepare_response: Value) -> Self {
        Self(Arc::new(Mutex::new(prepare_response)))
    }

    async fn set_prepare_response(&self, response: Value) {
        *self.0.lock().await = response;
    }
}

async fn fake_mesh(
    State(fake): State<FakeMesh>,
    Path(path): Path<String>,
) -> (StatusCode, Json<Value>) {
    let payload = match path.as_str() {
        "v1/auth/wallet/session" => json!({
            "walletAddress": WALLET,
            "ownerId": "owner-test",
            "expiresAt": "2030-01-01T00:00:00.000Z"
        }),
        "v1/public/lending/intents" => fake.0.lock().await.clone(),
        _ => json!({"ok": true}),
    };
    (StatusCode::OK, Json(payload))
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

fn timestamp(milliseconds: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(milliseconds)
        .unwrap()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn unsigned_transaction() -> Vec<u8> {
    let wallet = bs58::decode(WALLET).into_vec().unwrap();
    let mut message = vec![1, 0, 0, 1];
    message.extend_from_slice(&wallet);
    message.extend_from_slice(&[0; 32]);
    message.push(0);

    let mut transaction = vec![1];
    transaction.extend_from_slice(&[0; 64]);
    transaction.extend_from_slice(&message);
    transaction
}

fn message_hash(transaction: &[u8]) -> String {
    Sha256::digest(&transaction[65..])
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_prepare_response(base_ms: i64) -> Value {
    let transaction = unsigned_transaction();
    let hash = message_hash(&transaction);
    json!({
        "record": {
            "id": INTENT_ID,
            "createdAt": timestamp(base_ms),
            "request": {"decisionId": DECISION_ID},
            "intent": {
                "action": "supply",
                "wallet": WALLET,
                "inputBaseUnits": "500000",
                "transactionBase64": BASE64.encode(&transaction),
                "messageSha256": hash,
                "evidenceSource": "public",
                "publicGraphRevision": "55555555-5555-4555-8555-555555555555",
                "sourceAnalysisId": ANALYSIS_ID,
                "preflight": {
                    "schemaVersion": 1,
                    "status": "VERIFIED",
                    "verification": "falcon-rpc",
                    "messageSha256": hash,
                    "checkedAt": timestamp(base_ms - 1000),
                    "network": {
                        "chain": "solana",
                        "network": "devnet",
                        "genesisHash": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
                        "rpcHost": "api.devnet.solana.com",
                        "snapshotSlot": 100
                    },
                    "simulation": {
                        "slot": 101,
                        "err": null,
                        "unitsConsumed": 1000,
                        "liquidityDeltaBaseUnits": "-500000",
                        "receiptDeltaBaseUnits": "450000",
                        "vaultLiquidityDeltaBaseUnits": "500000"
                    },
                    "costs": {
                        "feeLamports": "5000",
                        "feeQuoteSlot": 101,
                        "rentLamports": "0",
                        "totalSolLamports": "5000",
                        "walletSolBalanceLamports": "10000000",
                        "destinationAta": OTHER,
                        "createsDestinationAta": false,
                        "accountSize": 165
                    },
                    "validity": {
                        "blockhash": OTHER,
                        "lastValidBlockHeight": 200,
                        "observedBlockHeight": 199,
                        "oraclePublishTime": timestamp(base_ms - 2000),
                        "oracleExpiresAt": timestamp(base_ms + 110_000),
                        "intentExpiresAt": timestamp(base_ms + 120_000),
                        "decisionExpiresAt": timestamp(base_ms + 80_000),
                        "expiresAt": timestamp(base_ms + 80_000)
                    }
                }
            }
        }
    })
}

fn prepare_arguments() -> Value {
    json!({
        "session": SESSION,
        "action": "supply",
        "amountUsdc": "0.5",
        "analysisId": ANALYSIS_ID,
        "decisionId": DECISION_ID
    })
}

fn assert_preflight_rejected(response: &Value, label: &str) {
    let result = &response["result"];
    assert_eq!(result["isError"], true, "{label}: {response}");
    assert_eq!(
        result["structuredContent"]["code"], "PREFLIGHT_UNAVAILABLE",
        "{label}: {response}"
    );
}

#[tokio::test]
async fn valid_preflight_is_bound_to_signer_blockhash_effects_expiry_and_cost_proof() {
    let base_ms = Utc::now().timestamp_millis();
    let valid = valid_prepare_response(base_ms);
    let transaction = unsigned_transaction();
    let expected_unsigned = BASE64.encode(&transaction);
    let fake = FakeMesh::new(valid.clone());
    let app_url = start_app(start_mesh(fake.clone()).await).await;
    let client = reqwest::Client::new();

    let accepted = rpc(
        &client,
        &app_url,
        1,
        "falcon_prepare_transaction",
        prepare_arguments(),
    )
    .await;
    let accepted_result = &accepted["result"];
    assert!(accepted_result.get("isError").is_none(), "{accepted}");
    let output = &accepted_result["structuredContent"];
    assert_eq!(output["unsignedTransactionBase64"], expected_unsigned);
    assert_eq!(output["preflight"]["status"], "VERIFIED");
    assert_eq!(output["preflight"]["costs"]["totalSolLamports"], "5000");

    let mut wrong_signer = valid.clone();
    let mut tampered_transaction = transaction.clone();
    let other_wallet = bs58::decode(OTHER).into_vec().unwrap();
    tampered_transaction[69..101].copy_from_slice(&other_wallet);
    let tampered_hash = message_hash(&tampered_transaction);
    wrong_signer["record"]["intent"]["transactionBase64"] =
        json!(BASE64.encode(&tampered_transaction));
    wrong_signer["record"]["intent"]["messageSha256"] = json!(tampered_hash);
    wrong_signer["record"]["intent"]["preflight"]["messageSha256"] = json!(tampered_hash);

    let mut wrong_blockhash = valid.clone();
    wrong_blockhash["record"]["intent"]["preflight"]["validity"]["blockhash"] = json!(WALLET);

    let mut wrong_liquidity = valid.clone();
    wrong_liquidity["record"]["intent"]["preflight"]["simulation"]["liquidityDeltaBaseUnits"] =
        json!("0");
    wrong_liquidity["record"]["intent"]["preflight"]["simulation"]["vaultLiquidityDeltaBaseUnits"] =
        json!("0");

    let mut missing_receipt_effect = valid.clone();
    missing_receipt_effect["record"]["intent"]["preflight"]["simulation"]["receiptDeltaBaseUnits"] =
        json!("0");

    let mut wrong_vault_effect = valid.clone();
    wrong_vault_effect["record"]["intent"]["preflight"]["simulation"]["vaultLiquidityDeltaBaseUnits"] =
        json!("499999");

    let mut expired = valid.clone();
    expired["record"]["intent"]["preflight"]["validity"]["intentExpiresAt"] =
        json!(timestamp(base_ms - 1));
    expired["record"]["intent"]["preflight"]["validity"]["decisionExpiresAt"] =
        json!(timestamp(base_ms - 2));
    expired["record"]["intent"]["preflight"]["validity"]["expiresAt"] =
        json!(timestamp(base_ms - 2));

    let mut costs_do_not_reconcile = valid.clone();
    costs_do_not_reconcile["record"]["intent"]["preflight"]["costs"]["feeLamports"] = json!("5001");

    let mut wallet_cannot_cover_cost = valid.clone();
    wallet_cannot_cover_cost["record"]["intent"]["preflight"]["costs"]["walletSolBalanceLamports"] =
        json!("4999");

    let mut cost_overflows_u64 = valid.clone();
    cost_overflows_u64["record"]["intent"]["preflight"]["costs"]["feeLamports"] =
        json!("18446744073709551616");
    cost_overflows_u64["record"]["intent"]["preflight"]["costs"]["totalSolLamports"] =
        json!("18446744073709551616");
    cost_overflows_u64["record"]["intent"]["preflight"]["costs"]["walletSolBalanceLamports"] =
        json!("18446744073709551616");

    let private_trace = "https://user:pass@secret.invalid/rpc?key=private-marker";
    let mut unexpected_private_field = valid;
    unexpected_private_field["record"]["intent"]["preflight"]["privateRpcTrace"] =
        json!(private_trace);

    let invalid = [
        ("transaction signer", wrong_signer),
        ("blockhash", wrong_blockhash),
        ("liquidity effect", wrong_liquidity),
        ("receipt-token effect", missing_receipt_effect),
        ("vault liquidity effect", wrong_vault_effect),
        ("expired intent", expired),
        ("cost arithmetic", costs_do_not_reconcile),
        ("wallet cost coverage", wallet_cannot_cover_cost),
        ("lamport bound", cost_overflows_u64),
        ("unknown private trace", unexpected_private_field),
    ];
    for (index, (label, response)) in invalid.into_iter().enumerate() {
        fake.set_prepare_response(response).await;
        let rejected = rpc(
            &client,
            &app_url,
            index as u64 + 2,
            "falcon_prepare_transaction",
            prepare_arguments(),
        )
        .await;
        assert_preflight_rejected(&rejected, label);
        let visible = rejected.to_string();
        assert!(!visible.contains("secret.invalid"), "{label}: {rejected}");
        assert!(!visible.contains("privateRpcTrace"), "{label}: {rejected}");
        assert!(!visible.contains("private-marker"), "{label}: {rejected}");
    }
}

#[tokio::test]
async fn signed_and_noncanonical_transaction_framing_is_not_returned_as_unsigned() {
    let base_ms = Utc::now().timestamp_millis();
    let valid = valid_prepare_response(base_ms);
    let canonical = unsigned_transaction();
    let fake = FakeMesh::new(valid.clone());
    let app_url = start_app(start_mesh(fake.clone()).await).await;
    let client = reqwest::Client::new();

    let mut signed = valid.clone();
    let mut signed_transaction = canonical.clone();
    signed_transaction[1] = 1;
    signed["record"]["intent"]["transactionBase64"] = json!(BASE64.encode(&signed_transaction));

    let mut noncanonical_shortvec = valid;
    let mut noncanonical_transaction = vec![0x81, 0x00];
    noncanonical_transaction.extend_from_slice(&canonical[1..]);
    noncanonical_shortvec["record"]["intent"]["transactionBase64"] =
        json!(BASE64.encode(&noncanonical_transaction));

    for (index, (label, response)) in [
        ("nonzero signature slot", signed),
        ("noncanonical signature count", noncanonical_shortvec),
    ]
    .into_iter()
    .enumerate()
    {
        fake.set_prepare_response(response).await;
        let rejected = rpc(
            &client,
            &app_url,
            index as u64 + 1,
            "falcon_prepare_transaction",
            prepare_arguments(),
        )
        .await;
        assert_preflight_rejected(&rejected, label);
        assert!(
            rejected["result"]["structuredContent"]
                .get("unsignedTransactionBase64")
                .is_none(),
            "{label}: {rejected}"
        );
    }
}
