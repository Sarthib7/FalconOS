use super::*;

pub(super) fn validate(name: &str, a: &Value) -> Result<(), ToolFailure> {
    let o = json_object(a).ok_or_else(|| ToolFailure::input("Arguments must be an object."))?;
    let allowed: &[&str] = match name {
        "falcon_public_graph" | "falcon_self_test" => &[],
        "falcon_research_case" => &["caseId"],
        "falcon_replay_research_case" => &["caseId"],
        "falcon_research_source" => &["revisionId"],
        "falcon_adopt_research_case" => &["session", "requestId", "publicCaseId"],
        "falcon_review_research_case" => &["session", "requestId", "analysisId"],
        "falcon_connect" => &["wallet"],
        "falcon_connect_verify" => &["challengeId", "signature"],
        "falcon_disconnect"
        | "falcon_yield_opportunities"
        | "falcon_refresh_evidence"
        | "falcon_activity" => &["session"],
        "falcon_reserve_decision" => &[
            "session",
            "analysisId",
            "proposedUsdc",
            "maxUsdc",
            "minBookLiquidityUsdc",
            "maxEvidenceAgeSeconds",
        ],
        "falcon_prepare_transaction" => &[
            "session",
            "action",
            "amountUsdc",
            "amountReceiptTokens",
            "analysisId",
            "decisionId",
        ],
        "falcon_submit_signed" => &[
            "session",
            "intentId",
            "signedTransactionBase64",
            "requestId",
        ],
        "falcon_check_receipt" => &["session", "intentId", "requestId"],
        "falcon_wallet_status" => &["wallet", "forAction", "chain", "network"],
        "falcon_decode_transaction" => &["transactionBase64", "chain", "network"],
        "falcon_cfo_overview" => &["session"],
        "falcon_cfo_capture" => &["session", "requestId"],
        "falcon_cfo_mandate" => &["session", "requestId", "mandate"],
        "falcon_cfo_plan" => &[
            "session",
            "requestId",
            "action",
            "sourceAssetId",
            "targetAssetId",
            "inputBaseUnits",
        ],
        "falcon_cfo_prepare" => &["session", "requestId", "planId"],
        "falcon_cfo_register_signed" => &["session", "requestId", "actionId", "signatureBase64"],
        "falcon_cfo_relay" | "falcon_cfo_reconcile" => &["session", "requestId", "actionId"],
        "falcon_cfo_monitor" => &["session", "requestId", "enabled"],
        "falcon_cfo_record" | "falcon_cfo_decision_trace" => &["session", "recordId"],
        _ => {
            return Err(ToolFailure {
                code: "NOT_FOUND".into(),
                message: "Unknown tool.".into(),
                retry: None,
            });
        }
    };
    if o.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(ToolFailure::input("Unrecognized key in input."));
    }
    let required: &[&str] = match name {
        "falcon_connect" => &["wallet"],
        "falcon_replay_research_case" => &["caseId"],
        "falcon_research_source" => &["revisionId"],
        "falcon_adopt_research_case" => &["session", "requestId", "publicCaseId"],
        "falcon_review_research_case" => &["session", "requestId", "analysisId"],
        "falcon_connect_verify" => &["challengeId", "signature"],
        "falcon_disconnect"
        | "falcon_yield_opportunities"
        | "falcon_refresh_evidence"
        | "falcon_activity" => &["session"],
        "falcon_reserve_decision" => &[
            "session",
            "analysisId",
            "proposedUsdc",
            "maxUsdc",
            "minBookLiquidityUsdc",
            "maxEvidenceAgeSeconds",
        ],
        "falcon_prepare_transaction" => &["session", "action", "analysisId"],
        "falcon_submit_signed" => &["session", "intentId", "signedTransactionBase64"],
        "falcon_check_receipt" => &["session", "intentId"],
        "falcon_wallet_status" => &["wallet"],
        "falcon_decode_transaction" => &["transactionBase64"],
        "falcon_cfo_overview" => &["session"],
        "falcon_cfo_capture" => &["session", "requestId"],
        "falcon_cfo_mandate" => &["session", "requestId", "mandate"],
        "falcon_cfo_plan" => &[
            "session",
            "requestId",
            "action",
            "sourceAssetId",
            "targetAssetId",
            "inputBaseUnits",
        ],
        "falcon_cfo_prepare" => &["session", "requestId", "planId"],
        "falcon_cfo_register_signed" => &["session", "requestId", "actionId", "signatureBase64"],
        "falcon_cfo_relay" | "falcon_cfo_reconcile" => &["session", "requestId", "actionId"],
        "falcon_cfo_monitor" => &["session", "requestId", "enabled"],
        "falcon_cfo_record" | "falcon_cfo_decision_trace" => &["session", "recordId"],
        _ => &[],
    };
    if let Some(k) = required.iter().find(|k| !o.contains_key(**k)) {
        return Err(ToolFailure::input(format!("{k} is required.")));
    }
    let string = |k: &str| {
        a.get(k)
            .and_then(Value::as_str)
            .ok_or_else(|| ToolFailure::input(format!("{k} must be a string.")))
    };
    if let Some(s) = a.get("session") {
        let x = s
            .as_str()
            .ok_or_else(|| ToolFailure::input("session must be a string."))?;
        if x.len() > 256 || !Regex::new(SESSION_RE).unwrap().is_match(x) {
            return Err(ToolFailure::input(
                "Session must be the token returned by falcon_connect_verify.",
            ));
        }
    }
    for k in [
        "analysisId",
        "decisionId",
        "intentId",
        "requestId",
        "challengeId",
        "caseId",
        "publicCaseId",
        "revisionId",
        "planId",
        "actionId",
        "recordId",
    ] {
        if let Some(x) = a.get(k) {
            let s = x
                .as_str()
                .ok_or_else(|| ToolFailure::input(format!("{k} must be a string.")))?;
            if !Regex::new(UUID_RE).unwrap().is_match(s) {
                return Err(ToolFailure::input(format!("{k} must be a UUID.")));
            }
        }
    }
    for k in [
        "proposedUsdc",
        "maxUsdc",
        "minBookLiquidityUsdc",
        "amountUsdc",
        "amountReceiptTokens",
    ] {
        if let Some(x) = a.get(k) {
            let s = x
                .as_str()
                .ok_or_else(|| ToolFailure::input(format!("{k} must be a string.")))?;
            if s.len() > 40 || !Regex::new(USDC_RE).unwrap().is_match(s) || units(s).is_err() {
                return Err(ToolFailure::input(format!(
                    "{k} must be a decimal USDC string with at most 6 decimals, for example \"0.5\"."
                )));
            }
        }
    }
    match name {
        "falcon_connect" => {
            let w = string("wallet")?;
            if !Regex::new(WALLET_RE).unwrap().is_match(w) {
                return Err(ToolFailure::input(
                    "wallet must be a base58 Solana address.",
                ));
            }
        }
        "falcon_connect_verify" => {
            let s = string("signature")?;
            if s.len() > 100 {
                return Err(ToolFailure::input(
                    "signature must be at most 100 characters.",
                ));
            }
        }
        "falcon_reserve_decision" => {
            let n = a["maxEvidenceAgeSeconds"]
                .as_u64()
                .ok_or_else(|| ToolFailure::input("maxEvidenceAgeSeconds must be an integer."))?;
            if n == 0 || n > 300 {
                return Err(ToolFailure::input(
                    "maxEvidenceAgeSeconds must be between 1 and 300.",
                ));
            }
        }
        "falcon_prepare_transaction" => {
            let action = string("action")?;
            if action == "supply" {
                if !a.get("amountUsdc").is_some()
                    || !a.get("decisionId").is_some()
                    || a.get("amountReceiptTokens").is_some()
                {
                    return Err(ToolFailure::input(
                        "Supply requires amountUsdc and decisionId and forbids amountReceiptTokens.",
                    ));
                }
            } else if action == "redeem" {
                if a.get("amountReceiptTokens").is_none()
                    || a.get("amountUsdc").is_some()
                    || a.get("decisionId").is_some()
                {
                    return Err(ToolFailure::input(
                        "Redeem requires amountReceiptTokens and forbids amountUsdc and decisionId.",
                    ));
                }
            } else {
                return Err(ToolFailure::input("action must be supply or redeem."));
            }
            let x = if action == "supply" {
                a["amountUsdc"].as_str().unwrap()
            } else {
                a["amountReceiptTokens"].as_str().unwrap()
            };
            if units(x)? == "0" {
                return Err(ToolFailure::input("Amount must be greater than zero."));
            }
        }
        "falcon_wallet_status" => {
            let w = string("wallet")?;
            if !Regex::new(WALLET_RE).unwrap().is_match(w) {
                return Err(ToolFailure::input(
                    "wallet must be a base58 Solana address.",
                ));
            }
            if a.get("chain").is_some_and(|x| x != "solana")
                || a.get("network").is_some_and(|x| x != "devnet")
            {
                return Err(ToolFailure::input("Only Solana Devnet is supported."));
            }
            if a.get("forAction")
                .is_some_and(|x| !matches!(x.as_str(), Some("supply" | "redeem")))
            {
                return Err(ToolFailure::input("forAction must be supply or redeem."));
            }
        }
        "falcon_decode_transaction" => {
            if a.get("chain").is_some_and(|x| x != "solana")
                || a.get("network").is_some_and(|x| x != "devnet")
            {
                return Err(ToolFailure::input("Only Solana Devnet is supported."));
            }
            let x = string("transactionBase64")?;
            if x.len() < 4
                || x.len() > 1644
                || B64.decode(x).ok().filter(|b| B64.encode(b) == x).is_none()
            {
                return Err(ToolFailure::input(
                    "transactionBase64 must be valid base64 within the size limit.",
                ));
            }
        }
        "falcon_submit_signed" => {
            if string("signedTransactionBase64")?.len() > 4096 {
                return Err(ToolFailure::input(
                    "signedTransactionBase64 must be at most 4096 characters.",
                ));
            }
        }
        "falcon_cfo_mandate" => validate_cfo_mandate(&a["mandate"])?,
        "falcon_cfo_plan" => {
            if !matches!(
                string("action")?,
                "invest" | "redeem" | "rotate" | "reinvest" | "hold"
            ) {
                return Err(ToolFailure::input("action is not a supported CFO action."));
            }
            for key in ["sourceAssetId", "targetAssetId"] {
                let value = &a[key];
                if !value.is_null() && !value.as_str().is_some_and(|asset_id| !asset_id.is_empty())
                {
                    return Err(ToolFailure::input(format!(
                        "{key} must be a non-empty string or null."
                    )));
                }
            }
            let input = &a["inputBaseUnits"];
            if !input.is_null() {
                let amount = input.as_str().ok_or_else(|| {
                    ToolFailure::input("inputBaseUnits must be a string or null.")
                })?;
                if !is_base_units(amount) || amount == "0" {
                    return Err(ToolFailure::input(
                        "inputBaseUnits must be a positive unsigned integer string.",
                    ));
                }
            }
        }
        "falcon_cfo_register_signed" => validate_cfo_signature(string("signatureBase64")?)?,
        "falcon_cfo_monitor" => {
            if !a["enabled"].is_boolean() {
                return Err(ToolFailure::input("enabled must be a boolean."));
            }
        }
        _ => {}
    }
    Ok(())
}
fn is_base_units(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.iter().all(u8::is_ascii_digit)
        && (bytes.len() == 1 || bytes[0] != b'0')
}

fn exact_keys(value: &Value, expected: &[&str]) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
}

fn validate_cfo_mandate(mandate: &Value) -> Result<(), ToolFailure> {
    const MANDATE_KEYS: &[&str] = &[
        "schemaVersion",
        "reserveAssetId",
        "reserveFloorBaseUnits",
        "maxActionReserveBaseUnits",
        "maxPositionBps",
        "slippageBps",
        "maxFeeBps",
        "maxEvidenceAgeSeconds",
        "targets",
        "monitorIntervalSeconds",
        "maxMonitorCycles",
    ];
    if !exact_keys(mandate, MANDATE_KEYS) {
        return Err(ToolFailure::input(
            "mandate must contain only the required wallet-session-bound mandate fields.",
        ));
    }
    if mandate["schemaVersion"].as_u64() != Some(1) {
        return Err(ToolFailure::input("mandate.schemaVersion must be 1."));
    }
    if !mandate["reserveAssetId"]
        .as_str()
        .is_some_and(|asset_id| !asset_id.is_empty())
    {
        return Err(ToolFailure::input(
            "mandate.reserveAssetId must be a non-empty string.",
        ));
    }
    for key in ["reserveFloorBaseUnits", "maxActionReserveBaseUnits"] {
        if !mandate[key].as_str().is_some_and(is_base_units) {
            return Err(ToolFailure::input(format!(
                "mandate.{key} must be an unsigned integer string."
            )));
        }
    }
    for key in [
        "maxPositionBps",
        "slippageBps",
        "maxFeeBps",
        "maxEvidenceAgeSeconds",
        "monitorIntervalSeconds",
        "maxMonitorCycles",
    ] {
        if mandate[key].as_u64().is_none() {
            return Err(ToolFailure::input(format!(
                "mandate.{key} must be a non-negative integer."
            )));
        }
    }
    for key in ["monitorIntervalSeconds", "maxMonitorCycles"] {
        if !mandate[key].as_u64().is_some_and(|value| value > 0) {
            return Err(ToolFailure::input(format!(
                "mandate.{key} must be a positive integer."
            )));
        }
    }
    let targets = mandate["targets"]
        .as_array()
        .ok_or_else(|| ToolFailure::input("mandate.targets must be an array."))?;
    for target in targets {
        if !exact_keys(target, &["assetId", "weightBps"])
            || !target["assetId"]
                .as_str()
                .is_some_and(|asset_id| !asset_id.is_empty())
            || target["weightBps"].as_u64().is_none()
        {
            return Err(ToolFailure::input(
                "Each mandate target must contain only a non-empty assetId and integer weightBps.",
            ));
        }
    }
    Ok(())
}

fn validate_cfo_signature(signature: &str) -> Result<(), ToolFailure> {
    let bytes = B64.decode(signature).map_err(|_| {
        ToolFailure::input("signatureBase64 must be canonical base64 for a 64-byte signature.")
    })?;
    if bytes.len() != 64 || B64.encode(&bytes) != signature {
        return Err(ToolFailure::input(
            "signatureBase64 must be canonical base64 for a 64-byte signature.",
        ));
    }
    Ok(())
}

const CFO_PRIVATE_FIELDS: &[&str] = &[
    "signatureBase64",
    "signature_base64",
    "signature-base64",
    "signatureBase58",
    "signature_base58",
    "signature-base58",
    "signedData",
    "signed_data",
    "signed-data",
    "signedPayload",
    "signed_payload",
    "signed-payload",
    "signedBytes",
    "signed_bytes",
    "signed-bytes",
    "signedMessage",
    "signed_message",
    "signed-message",
    "signedIntent",
    "signed_intent",
    "signed-intent",
    "signedIntentBase64",
    "signed_intent_base64",
    "signed-intent-base64",
    "signedTransactionBase64",
    "signed_transaction_base64",
    "signed-transaction-base64",
    "transactionBase64",
    "transaction_base64",
    "transaction-base64",
    "privateKey",
    "private_key",
    "private-key",
    "relaySecret",
    "relay_secret",
    "relay-secret",
    "secret",
];

pub(super) fn cfo_public_response(mut value: Value, allow_unsigned_payload: bool) -> Value {
    fn redact(value: &mut Value, allow_unsigned_payload: bool, preserve_provider_signature: bool) {
        match value {
            Value::Array(values) => {
                for child in values {
                    redact(child, allow_unsigned_payload, false);
                }
            }
            Value::Object(object) => {
                let quote_envelope = object.get("schemaVersion").and_then(Value::as_u64) == Some(1)
                    && object.get("raw").is_some()
                    && object.get("sha256").and_then(Value::as_str).is_some()
                    && object.get("signatureVerified").and_then(Value::as_bool) == Some(true);
                object.retain(|key, child| {
                    let keep = !(key.eq_ignore_ascii_case("payload") && !allow_unsigned_payload)
                        && !(key.eq_ignore_ascii_case("signature") && !preserve_provider_signature)
                        && !CFO_PRIVATE_FIELDS
                            .iter()
                            .any(|private| key.eq_ignore_ascii_case(private));
                    if keep {
                        redact(
                            child,
                            allow_unsigned_payload,
                            quote_envelope && key == "raw",
                        );
                    }
                    keep
                });
            }
            _ => {}
        }
    }
    redact(&mut value, allow_unsigned_payload, false);
    value
}

fn units(v: &str) -> Result<String, ToolFailure> {
    if !Regex::new(USDC_RE).unwrap().is_match(v) {
        return Err(ToolFailure::input(
            "Amount must be a decimal USDC string with at most 6 decimals, for example \"1.5\".",
        ));
    }
    let (mut whole, frac) = v.split_once('.').unwrap_or((v, ""));
    if whole.is_empty() {
        whole = "0"
    }
    let x = whole
        .parse::<u128>()
        .map_err(|_| ToolFailure::input("Amount exceeds the maximum representable value."))?
        .checked_mul(1_000_000)
        .and_then(|a| {
            a.checked_add(frac.parse::<u128>().unwrap_or(0) * 10u128.pow((6 - frac.len()) as u32))
        })
        .ok_or_else(|| ToolFailure::input("Amount exceeds the maximum representable value."))?;
    if x > u64::MAX as u128 {
        return Err(ToolFailure::input(
            "Amount exceeds the maximum representable value.",
        ));
    }
    Ok(x.to_string())
}
pub(super) fn to_units(v: &str) -> Result<String, ToolFailure> {
    units(v)
}
pub(super) fn normalize_signature(s: &str) -> Result<String, ToolFailure> {
    if !(80..=100).contains(&s.len()) {
        return Err(ToolFailure::input(
            "Signature must be 64 bytes encoded as base64 or base58.",
        ));
    }
    let bytes = if s.contains(['+', '/', '=']) {
        if !Regex::new(r"^[A-Za-z0-9+/]+={0,2}$").unwrap().is_match(s) {
            return Err(ToolFailure::input(
                "Signature must be 64 bytes encoded as base64 or base58.",
            ));
        }
        let decoded = B64.decode(s).map_err(|_| {
            ToolFailure::input("Signature must be 64 bytes encoded as base64 or base58.")
        })?;
        if B64.encode(&decoded) != s {
            return Err(ToolFailure::input("Signature base64 is not canonical."));
        }
        decoded
    } else {
        bs58::decode(s).into_vec().map_err(|_| {
            ToolFailure::input("Signature must decode to exactly 64 bytes (base64 or base58).")
        })?
    };
    if bytes.len() != 64 {
        return Err(ToolFailure::input(
            "Signature must decode to exactly 64 bytes (base64 or base58).",
        ));
    }
    Ok(B64.encode(bytes))
}
fn private_key(k: &str) -> bool {
    let f = k.replace(['-', '_'], "").to_ascii_lowercase();
    f == "content"
        || f.starts_with("raw")
        || f.contains("exchange")
        || f.starts_with("owner")
        || f.starts_with("wallet")
        || f.starts_with("session")
        || f.starts_with("private")
        || f.starts_with("custom")
        || matches!(
            f.as_str(),
            "record" | "records" | "requestbody" | "responsebody" | "bodybase64"
        )
}
fn public_meta(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(public_meta).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(k, _)| !private_key(k))
                .map(|(k, v)| (k.clone(), public_meta(v)))
                .collect(),
        ),
        _ => v.clone(),
    }
}
pub(super) fn project_graph(v: &Value) -> Value {
    json!({"scope":v["scope"],"chain":v["chain"],"network":v["network"],"graph":public_meta(&v["graph"]),"programAnalysis":public_meta(&v["programAnalysis"]),"reserveAnalysis":public_meta(&v["reserveAnalysis"]),"status":v["status"],"policyDefinitionId":v["policyDefinitionId"],"policyVersion":v["policyVersion"],"maxSupplyBaseUnits":v["maxSupplyBaseUnits"],"customGraphsSupported":v["customGraphsSupported"],"executionReady":v["executionReady"]})
}
pub(super) fn project_adoption(v: &Value) -> Value {
    let record = &v["record"];
    let reserve = &v["reserveRecord"];
    let prog = record["analysis"].as_object().cloned().unwrap_or_default();
    let res = reserve["analysis"].as_object().cloned().unwrap_or_default();
    let observed = prog.get("status") == Some(&json!("OBSERVED"))
        && res.get("status") == Some(&json!("OBSERVED"));
    let mut captures = vec![];
    for root in [record, reserve] {
        if let Some(a) = root["graph"]["sources"].as_array() {
            for s in a {
                if let Some(c) = s["capturedAt"].as_str() {
                    captures.push(c.to_string())
                }
            }
        }
    }
    captures.sort();
    let reserve_out=res.get("availableLiquidityUnits").and_then(Value::as_str).and_then(|s|units_from_base(s).map(|usdc|json!({"availableLiquidityUnits":s,"availableLiquidityUsdc":usdc,"slot":res.get("slot")})));
    let mut out = json!({"analysisId":record["id"],"programAnalysisId":record["id"],"reserveAnalysisId":reserve["id"],"graphRevision":v["graphRevision"],"evidenceSource":v["evidenceSource"],"status":if observed{"OBSERVED"}else{"NO_DATA"},"programStatus":prog.get("status"),"reserveStatus":res.get("status"),"summary":if observed{prog.get("summary")}else{res.get("summary").or_else(||prog.get("summary"))},"capturedAt":captures.last(),"programAnalysis":public_meta(&json!(prog)),"reserveAnalysis":public_meta(&json!(res)),"limits":["Evidence is adopted from one public Devnet graph revision and is only usable for about 300 seconds.","Captured liquidity is the unborrowed reserve balance, not freely withdrawable liquidity or execution approval.","Devnet only. Nothing here is guaranteed."],"next":if observed{"Public evidence is observed at the returned graphRevision. Show its technical results to your human, then use the human-provided scenario in falcon_reserve_decision."}else{"The current public evidence is NO_DATA. Do not reuse an older graph or analysis. Inspect falcon_public_graph and adopt only a current observed revision."}});
    if let Some(r) = reserve_out {
        out["reserve"] = r
    }
    out
}
fn units_from_base(s: &str) -> Option<String> {
    if s.len() > 20 || !Regex::new(r"^(0|[1-9][0-9]*)$").ok()?.is_match(s) {
        return None;
    }
    let x = s.parse::<u128>().ok()?;
    let whole = x / 1_000_000;
    let fract = x % 1_000_000;
    if fract == 0 {
        Some(whole.to_string())
    } else {
        Some(
            format!("{whole}.{:06}", fract)
                .trim_end_matches('0')
                .to_string(),
        )
    }
}
pub(super) fn project_decision(v: &Value, args: &Value) -> Value {
    let r = &v["record"];
    let a = &r["analysis"];
    let status = a["status"].as_str().unwrap_or("");
    let next=match status{"REVIEW"=>format!("A supply of up to {} USDC may be prepared with falcon_prepare_transaction using decisionId {} until {}. REVIEW is not approval; your human alone decides, signs, and broadcasts.",args["proposedUsdc"].as_str().unwrap_or(""),r["id"].as_str().unwrap_or(""),a["expiresAt"].as_str().unwrap_or("")),"BLOCKED"=>"Do not prepare a supply. Tell your human which checks failed. A redeem is never blocked by a decision.".into(),_=>"Do not prepare a supply. There is not enough usable evidence. Refresh the public graph and obtain a new explicit decision.".into()};
    json!({"decisionId":r["id"],"status":a["status"],"summary":a["summary"],"checks":a["checks"].as_array().cloned().unwrap_or_default(),"expiresAt":a["expiresAt"],"proposedUsdc":args["proposedUsdc"],"maxUsdc":args["maxUsdc"],"minBookLiquidityUsdc":args["minBookLiquidityUsdc"],"maxEvidenceAgeSeconds":args["maxEvidenceAgeSeconds"],"evidenceSource":a["evidenceSource"],"publicGraphRevision":a["publicGraphRevision"],"sourceAnalysisId":a["sourceAnalysisId"],"decisionGraph":a["decisionGraph"],"limits":a["limits"].as_array().cloned().unwrap_or_default(),"next":next})
}
pub(super) fn public_event(e: &Value) -> Value {
    let mut data = e["data"].as_object().cloned().unwrap_or_default();
    data.remove("transactionBase64");
    if data
        .get("exchanges")
        .is_some_and(|exchanges| !exchanges.is_array())
    {
        data.remove("exchanges");
    }
    if let Some(xs) = data.get_mut("exchanges").and_then(Value::as_array_mut) {
        for x in xs {
            if let Some(o) = x["request"].as_object_mut() {
                o.remove("bodyBase64");
            }
            if let Some(o) = x["response"].as_object_mut() {
                o.remove("bodyBase64");
            }
        }
    }
    json!({"id":e["id"],"requestId":e["requestId"],"intentId":e["intentId"],"createdAt":e["createdAt"],"kind":e["kind"],"data":data})
}

#[cfg(test)]
mod research_input_tests {
    use super::*;
    use serde_json::json;

    const SESSION: &str = "wsi1_12345678901234567890";
    const CASE_ID: &str = "12345678-1234-1234-1234-123456789012";
    const REQUEST_ID: &str = "12345678-1234-1234-1234-123456789013";

    #[test]
    fn public_research_inputs_are_uuid_strict_and_never_accept_sessions() {
        assert!(validate("falcon_research_case", &json!({})).is_ok());
        assert!(validate("falcon_research_case", &json!({"caseId": CASE_ID})).is_ok());
        assert!(validate("falcon_replay_research_case", &json!({"caseId": CASE_ID})).is_ok());
        assert!(validate("falcon_research_source", &json!({"revisionId": CASE_ID})).is_ok());
        for (name, args) in [
            ("falcon_research_case", json!({"caseId": "not-a-uuid"})),
            (
                "falcon_replay_research_case",
                json!({"caseId": CASE_ID, "session": SESSION}),
            ),
            (
                "falcon_research_source",
                json!({"revisionId": "not-a-uuid"}),
            ),
        ] {
            assert_eq!(validate(name, &args).unwrap_err().code, "INVALID_INPUT");
        }
    }

    #[test]
    fn owner_research_calls_require_exact_request_and_analysis_ids() {
        assert!(
            validate(
                "falcon_adopt_research_case",
                &json!({"session": SESSION, "requestId": REQUEST_ID, "publicCaseId": CASE_ID}),
            )
            .is_ok()
        );
        assert!(
            validate(
                "falcon_review_research_case",
                &json!({"session": SESSION, "requestId": REQUEST_ID, "analysisId": CASE_ID}),
            )
            .is_ok()
        );
        for (name, args) in [
            (
                "falcon_adopt_research_case",
                json!({"session": SESSION, "publicCaseId": CASE_ID}),
            ),
            (
                "falcon_review_research_case",
                json!({"session": SESSION, "requestId": REQUEST_ID, "analysisId": "not-a-uuid"}),
            ),
            (
                "falcon_review_research_case",
                json!({"session": SESSION, "requestId": REQUEST_ID, "analysisId": CASE_ID, "owner": "unexpected"}),
            ),
        ] {
            assert_eq!(validate(name, &args).unwrap_err().code, "INVALID_INPUT");
        }
    }
}
