use super::*;
use chrono::{DateTime, SecondsFormat, Utc};

const GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const RPC_HOST: &str = "api.devnet.solana.com";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_U64: i128 = u64::MAX as i128;
const BASE64_RE: &str = r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$";
const UNSIGNED_RE: &str = r"^(0|[1-9][0-9]*)$";
const SIGNED_RE: &str = r"^(0|-?[1-9][0-9]*)$";

fn exact_keys(value: &Value, expected: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
    })
}

fn safe_integer(value: &Value) -> Option<u64> {
    value.as_u64().filter(|number| *number <= MAX_SAFE_INTEGER)
}

fn decimal(value: &Value, signed: bool) -> Option<i128> {
    let text = value.as_str()?;
    if text.len() > 40
        || !Regex::new(if signed { SIGNED_RE } else { UNSIGNED_RE })
            .ok()?
            .is_match(text)
    {
        return None;
    }
    let number = text.parse::<i128>().ok()?;
    (number <= MAX_U64 && number >= -MAX_U64).then_some(number)
}

fn timestamp(value: &Value) -> Option<DateTime<Utc>> {
    let text = value.as_str()?;
    if !Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        .ok()?
        .is_match(text)
    {
        return None;
    }
    let parsed = DateTime::parse_from_rfc3339(text).ok()?.with_timezone(&Utc);
    (parsed.to_rfc3339_opts(SecondsFormat::Millis, true) == text).then_some(parsed)
}

fn address(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    let bytes = bs58::decode(text).into_vec().ok()?;
    (bytes.len() == 32 && bs58::encode(bytes).into_string() == text).then(|| text.to_owned())
}

fn message_from_transaction(value: &Value) -> Option<(Vec<u8>, String, String)> {
    let text = value.as_str()?;
    if text.is_empty() || text.len() > 1_644 || !Regex::new(BASE64_RE).ok()?.is_match(text) {
        return None;
    }
    let bytes = B64.decode(text).ok()?;
    if B64.encode(&bytes) != text || bytes.len() > 1_232 || bytes.len() < 134 || bytes[0] != 1 {
        return None;
    }
    if bytes[1..65].iter().any(|byte| *byte != 0) {
        return None;
    }
    let message = bytes[65..].to_vec();
    let header = usize::from(message[0] & 0x80 != 0);
    if (header == 1 && message[0] != 0x80) || message[header] != 1 || message[header + 1] != 0 {
        return None;
    }
    let key_count = message[header + 3] as usize;
    if key_count == 0 || message[header + 2] >= key_count as u8 {
        return None;
    }
    let key_offset = header + 4;
    let blockhash_offset = key_offset.checked_add(key_count.checked_mul(32)?)?;
    if message.len() < blockhash_offset.checked_add(33)? {
        return None;
    }
    let wallet = bs58::encode(&message[key_offset..key_offset + 32]).into_string();
    let blockhash = bs58::encode(&message[blockhash_offset..blockhash_offset + 32]).into_string();
    Some((message, wallet, blockhash))
}

fn verified_preflight(
    intent: &Value,
    created_at: &Value,
    action: &str,
    wallet: &str,
    amount_base_units: &str,
) -> Option<Value> {
    let preflight = &intent["preflight"];
    if !exact_keys(
        preflight,
        &[
            "schemaVersion",
            "status",
            "verification",
            "messageSha256",
            "checkedAt",
            "network",
            "simulation",
            "costs",
            "validity",
        ],
    ) || preflight["schemaVersion"] != 1
        || preflight["status"] != "VERIFIED"
        || preflight["verification"] != "falcon-rpc"
        || !Regex::new(r"^[a-f0-9]{64}$")
            .ok()?
            .is_match(preflight["messageSha256"].as_str()?)
    {
        return None;
    }

    let network = &preflight["network"];
    let snapshot_slot = safe_integer(&network["snapshotSlot"])?;
    if !exact_keys(
        network,
        &["chain", "network", "genesisHash", "rpcHost", "snapshotSlot"],
    ) || network["chain"] != "solana"
        || network["network"] != "devnet"
        || network["genesisHash"] != GENESIS
        || network["rpcHost"] != RPC_HOST
    {
        return None;
    }

    let simulation = &preflight["simulation"];
    let simulation_slot = safe_integer(&simulation["slot"])?;
    let units_consumed = &simulation["unitsConsumed"];
    if !exact_keys(
        simulation,
        &[
            "slot",
            "err",
            "unitsConsumed",
            "liquidityDeltaBaseUnits",
            "receiptDeltaBaseUnits",
            "vaultLiquidityDeltaBaseUnits",
        ],
    ) || simulation["err"] != Value::Null
        || simulation_slot < snapshot_slot
        || !(units_consumed.is_null() || safe_integer(units_consumed).is_some())
    {
        return None;
    }
    let liquidity = decimal(&simulation["liquidityDeltaBaseUnits"], true)?;
    let receipt = decimal(&simulation["receiptDeltaBaseUnits"], true)?;
    let vault = decimal(&simulation["vaultLiquidityDeltaBaseUnits"], true)?;

    let costs = &preflight["costs"];
    let fee_quote_slot = safe_integer(&costs["feeQuoteSlot"])?;
    let fee = decimal(&costs["feeLamports"], false)?;
    let rent = decimal(&costs["rentLamports"], false)?;
    let total = decimal(&costs["totalSolLamports"], false)?;
    let balance = decimal(&costs["walletSolBalanceLamports"], false)?;
    let creates_destination_ata = costs["createsDestinationAta"].as_bool()?;
    if !exact_keys(
        costs,
        &[
            "feeLamports",
            "feeQuoteSlot",
            "rentLamports",
            "totalSolLamports",
            "walletSolBalanceLamports",
            "destinationAta",
            "createsDestinationAta",
            "accountSize",
        ],
    ) || costs["accountSize"] != 165
        || address(&costs["destinationAta"]).is_none()
        || fee_quote_slot < snapshot_slot
        || fee.checked_add(rent)? > MAX_U64
        || fee + rent != total
        || balance < total
        || (!creates_destination_ata && rent != 0)
        || (creates_destination_ata && rent == 0)
    {
        return None;
    }

    let validity = &preflight["validity"];
    let last_valid_height = safe_integer(&validity["lastValidBlockHeight"])?;
    let observed_height = safe_integer(&validity["observedBlockHeight"])?;
    if !exact_keys(
        validity,
        &[
            "blockhash",
            "lastValidBlockHeight",
            "observedBlockHeight",
            "oraclePublishTime",
            "oracleExpiresAt",
            "intentExpiresAt",
            "decisionExpiresAt",
            "expiresAt",
        ],
    ) || address(&validity["blockhash"]).is_none()
        || observed_height > last_valid_height
    {
        return None;
    }

    let checked_at = timestamp(&preflight["checkedAt"])?;
    let published_at = timestamp(&validity["oraclePublishTime"])?;
    let oracle_expires = timestamp(&validity["oracleExpiresAt"])?;
    let intent_expires = timestamp(&validity["intentExpiresAt"])?;
    let decision_expires = if validity["decisionExpiresAt"].is_null() {
        None
    } else {
        Some(timestamp(&validity["decisionExpiresAt"])?)
    };
    let expires = timestamp(&validity["expiresAt"])?;
    let committed_at = timestamp(created_at)?;
    let now = Utc::now();
    let earliest = decision_expires
        .map(|decision| decision.min(oracle_expires).min(intent_expires))
        .unwrap_or_else(|| oracle_expires.min(intent_expires));
    if committed_at > now + chrono::Duration::seconds(5)
        || checked_at > committed_at + chrono::Duration::seconds(5)
        || intent_expires <= committed_at
        || intent_expires > committed_at + chrono::Duration::seconds(120)
        || published_at > checked_at
        || oracle_expires <= checked_at
        || oracle_expires - published_at > chrono::Duration::seconds(180)
        || expires != earliest
        || expires <= now
        || checked_at > now + chrono::Duration::seconds(5)
        || now - checked_at > chrono::Duration::seconds(120)
    {
        return None;
    }

    let (message, wire_wallet, wire_blockhash) =
        message_from_transaction(&intent["transactionBase64"])?;
    let message_hash = hex(&Sha256::digest(message));
    let amount = amount_base_units.parse::<i128>().ok()?;
    if message_hash != preflight["messageSha256"]
        || wire_wallet != wallet
        || wire_blockhash != validity["blockhash"]
        || intent["messageSha256"] != preflight["messageSha256"]
        || intent["action"] != action
        || intent["wallet"] != wallet
        || intent["inputBaseUnits"] != amount.to_string()
        || vault != -liquidity
    {
        return None;
    }
    if action == "supply" {
        if liquidity >= 0 || -liquidity > amount || receipt <= 0 || decision_expires.is_none() {
            return None;
        }
    } else if liquidity <= 0 || receipt != -amount || decision_expires.is_some() {
        return None;
    }

    Some(json!({
        "schemaVersion": 1,
        "status": preflight["status"],
        "verification": preflight["verification"],
        "messageSha256": preflight["messageSha256"],
        "checkedAt": preflight["checkedAt"],
        "network": {
            "chain": network["chain"], "network": network["network"], "genesisHash": network["genesisHash"],
            "rpcHost": network["rpcHost"], "snapshotSlot": network["snapshotSlot"]
        },
        "simulation": {
            "slot": simulation["slot"], "err": null, "unitsConsumed": simulation["unitsConsumed"],
            "liquidityDeltaBaseUnits": simulation["liquidityDeltaBaseUnits"],
            "receiptDeltaBaseUnits": simulation["receiptDeltaBaseUnits"],
            "vaultLiquidityDeltaBaseUnits": simulation["vaultLiquidityDeltaBaseUnits"]
        },
        "costs": {
            "feeLamports": costs["feeLamports"], "feeQuoteSlot": costs["feeQuoteSlot"], "rentLamports": costs["rentLamports"],
            "totalSolLamports": costs["totalSolLamports"], "walletSolBalanceLamports": costs["walletSolBalanceLamports"],
            "destinationAta": costs["destinationAta"], "createsDestinationAta": costs["createsDestinationAta"], "accountSize": 165
        },
        "validity": {
            "blockhash": validity["blockhash"], "lastValidBlockHeight": validity["lastValidBlockHeight"],
            "observedBlockHeight": validity["observedBlockHeight"], "oraclePublishTime": validity["oraclePublishTime"],
            "oracleExpiresAt": validity["oracleExpiresAt"], "intentExpiresAt": validity["intentExpiresAt"],
            "decisionExpiresAt": validity["decisionExpiresAt"], "expiresAt": validity["expiresAt"]
        }
    }))
}

fn amount_from_base_units(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    if text.len() > 20 || !Regex::new(r"^(0|[1-9][0-9]*)$").ok()?.is_match(text) {
        return None;
    }
    let units = text.parse::<u128>().ok()?;
    let whole = units / 1_000_000;
    let fraction = units % 1_000_000;
    if fraction == 0 {
        Some(whole.to_string())
    } else {
        Some(
            format!("{whole}.{:06}", fraction)
                .trim_end_matches('0')
                .to_owned(),
        )
    }
}

fn preflight_error() -> ToolFailure {
    ToolFailure {
        code: "PREFLIGHT_UNAVAILABLE".into(),
        message: "Falcon could not verify a complete, current Devnet transaction preflight. Do not sign this transaction.".into(),
        retry: None,
    }
}

pub(super) async fn prepare(mesh: &Mesh, args: &Value) -> Result<Value, ToolFailure> {
    let action = args["action"].as_str().expect("validated action");
    let amount = if action == "supply" {
        args["amountUsdc"].as_str().expect("validated supply")
    } else {
        args["amountReceiptTokens"]
            .as_str()
            .expect("validated redeem")
    };
    let amount_base_units = to_units(amount)?;
    let session = args["session"].as_str().expect("validated session");
    let wallet_response = mesh
        .get("/v1/auth/wallet/session", Some(session), 15_000)
        .await?;
    let wallet = wallet_response["walletAddress"]
        .as_str()
        .ok_or_else(ToolFailure::unavailable)?;
    let mut body = json!({
        "requestId": Uuid::new_v4().to_string(),
        "analysisId": args["analysisId"],
        "wallet": wallet,
        "action": action,
        "inputBaseUnits": amount_base_units,
    });
    if let Some(decision_id) = args.get("decisionId") {
        body["decisionId"] = decision_id.clone();
    }
    let response = mesh
        .post("/v1/public/lending/intents", body, Some(session), 60_000)
        .await?;
    let record = &response["record"];
    let intent = &record["intent"];
    let decision_id = args.get("decisionId").cloned().unwrap_or(Value::Null);
    let stored_decision_id = record["request"]
        .get("decisionId")
        .cloned()
        .unwrap_or(Value::Null);
    if decision_id != stored_decision_id {
        return Err(preflight_error());
    }
    let preflight = verified_preflight(
        intent,
        &record["createdAt"],
        action,
        wallet,
        &amount_base_units,
    )
    .ok_or_else(preflight_error)?;
    let expires_at = timestamp(&preflight["validity"]["expiresAt"]).expect("verified expiry");
    let expires_in_seconds =
        ((expires_at.timestamp_millis() - Utc::now().timestamp_millis()).max(0) as f64 / 1000.0)
            .ceil() as u64;
    let estimated_usdc = if action == "redeem" {
        amount_from_base_units(&intent["estimatedAmounts"]["liquidityBaseUnits"])
    } else {
        None
    };
    let mut output = json!({
        "intentId": record["id"], "action": action, "wallet": wallet,
        "unsignedTransactionBase64": intent["transactionBase64"], "messageSha256": intent["messageSha256"],
        "preflight": preflight,
        "preflightTrust": "Falcon RPC verified for Devnet; this is not independent verification and not human approval.",
        "expiresInSeconds": expires_in_seconds, "decisionId": decision_id,
        "evidenceSource": intent["evidenceSource"], "publicGraphRevision": intent["publicGraphRevision"],
        "sourceAnalysisId": intent["sourceAnalysisId"],
    });
    if action == "supply" {
        output["amountUsdc"] = json!(amount);
        output["summary"] = json!(format!(
            "Unsigned Devnet supply of {amount} USDC for wallet {wallet}. Nothing has been signed or sent."
        ));
    } else {
        output["amountReceiptTokens"] = json!(amount);
        output["estimatedUsdc"] = estimated_usdc
            .clone()
            .map(Value::from)
            .unwrap_or(Value::Null);
        output["summary"] = json!(format!(
            "Unsigned Devnet redeem burns {amount} receipt tokens for wallet {wallet}; estimated {} USDC output. Nothing has been signed or sent.",
            estimated_usdc.unwrap_or_else(|| "unknown".into())
        ));
    }
    output["next"] = json!(format!(
        "Devnet only. Show the action, amount and wallet to your human. Only the human may choose to sign with signTransaction (not signAndSendTransaction) within {expires_in_seconds} seconds. Then call falcon_submit_signed with intentId and those human-signed base64 bytes; the human alone broadcasts them."
    ));
    Ok(output)
}
