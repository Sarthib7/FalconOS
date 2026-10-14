use super::*;

pub(super) fn validate(name: &str, a: &Value) -> Result<(), ToolFailure> {
    let o = json_object(a).ok_or_else(|| ToolFailure::input("Arguments must be an object."))?;
    let allowed: &[&str] = match name {
        "falcon_public_graph" | "falcon_self_test" => &[],
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
        _ => {}
    }
    Ok(())
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
pub(super) fn activity(d: &Value, i: &Value) -> Value {
    let ds = d["records"].as_array().cloned().unwrap_or_default();
    let its = i["records"].as_array().cloned().unwrap_or_default();
    let mut by = BTreeMap::new();
    for x in &ds {
        by.insert(x["id"].as_str().unwrap_or("").to_string(),json!({"id":x["id"],"createdAt":x["createdAt"],"status":x["analysis"]["status"],"summary":x["analysis"]["summary"],"expiresAt":x["analysis"]["expiresAt"]}));
    }
    let mut used = std::collections::HashSet::new();
    let mut trail = vec![];
    for x in &its {
        let did = x["request"]["decisionId"].as_str();
        let decision = did.map(|id| {
            used.insert(id.to_string());
            by.get(id).cloned().unwrap_or(
                json!({"id":id,"createdAt":null,"status":null,"summary":null,"expiresAt":null}),
            )
        });
        let action = x["request"]["action"].as_str().unwrap_or("");
        let mut intent = json!({"id":x["id"],"createdAt":x["createdAt"],"action":x["request"]["action"],"wallet":x["request"]["wallet"],"status":x["status"],"transactionSignature":x["signature"]});
        intent[if action == "redeem" {
            "amountReceiptTokens"
        } else {
            "amountUsdc"
        }] = x["request"]["inputBaseUnits"]
            .as_str()
            .and_then(units_from_base)
            .map(Value::from)
            .unwrap_or(Value::Null);
        trail.push(json!({"at":x["createdAt"],"decision":decision,"intent":intent}));
    }
    for (id, dec) in by {
        if !used.contains(&id) {
            trail.push(json!({"at":dec["createdAt"],"decision":dec,"intent":null}))
        }
    }
    trail.sort_by(|a, b| {
        b["at"]
            .as_str()
            .unwrap_or("")
            .cmp(a["at"].as_str().unwrap_or(""))
    });
    json!({"trail":trail,"counts":{"decisions":ds.len(),"intents":its.len()},"limit":20})
}
