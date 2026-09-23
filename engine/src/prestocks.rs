use crate::dexscreener::AssetCaptures;
use crate::domain::FieldCapture;
use crate::pyth::PythUnderlyingRef;
use reqwest::Client;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

const PRESTOCKS_URL: &str = "https://prestocks.com/api/prestocks";
const RPC_URL: &str = "https://api.mainnet-beta.solana.com";
const MULTIPLIER_PRECISION: u32 = 7;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

async fn bounded_response_bytes(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if body.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err("response body exceeded limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreStockEntry {
    pub mint: String,
    pub symbol: String,
    pub mark_price: String,
    pub token_price: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScaledUiState {
    pub multiplier: String,
    pub new_multiplier: Option<String>,
    pub new_multiplier_effective_timestamp: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct PreStocksData {
    pub refs: BTreeMap<String, Option<PythUnderlyingRef>>,
    pub issuer_prices: BTreeMap<String, Option<String>>,
    pub error: Option<String>,
}

fn decimal(value: &str) -> bool {
    let mut dots = 0;
    let mut digits = 0;
    for ch in value.chars() {
        if ch == '.' {
            dots += 1;
            if dots > 1 {
                return false;
            }
        } else if ch.is_ascii_digit() {
            digits += 1;
        } else {
            return false;
        }
    }
    digits > 0 && !value.starts_with('.') && !value.ends_with('.')
}

fn positive_decimal(value: &str) -> bool {
    decimal(value)
        && !value.split('.').next().unwrap_or("0").is_empty()
        && value.chars().any(|c| c != '0' && c != '.')
}

fn number_decimal(value: &Value) -> Option<String> {
    let Value::Number(number) = value else {
        return None;
    };
    let text = number.to_string();
    if positive_decimal(&text) {
        Some(text)
    } else {
        None
    }
}

pub fn scale_decimal_to_integer(value: &str, scale: u32) -> Option<String> {
    if !decimal(value) {
        return None;
    }
    let mut parts = value.split('.');
    let int_part = parts.next().unwrap_or("0");
    let frac_part = parts.next().unwrap_or("");
    let mut frac = frac_part.to_string();
    frac.push_str(&"0".repeat(scale as usize));
    frac.truncate(scale as usize);
    let mut combined = format!("{int_part}{frac}");
    while combined.len() > 1 && combined.starts_with('0') {
        combined.remove(0);
    }
    Some(combined)
}

pub fn parse_prestocks(value: &Value) -> BTreeMap<String, PreStockEntry> {
    let mut entries = BTreeMap::new();
    let mut invalid_mints = BTreeSet::new();
    let Some(rows) = value.as_array() else {
        return entries;
    };
    for row in rows {
        let Some(object) = row.as_object() else {
            continue;
        };
        let Some(mint) = object
            .get("contract_address")
            .and_then(Value::as_str)
            .filter(|x| !x.is_empty())
        else {
            continue;
        };
        if invalid_mints.contains(mint) {
            continue;
        }
        let parsed = object
            .get("symbol")
            .and_then(Value::as_str)
            .filter(|symbol| !symbol.is_empty())
            .zip(object.get("markPrice").and_then(number_decimal))
            .zip(object.get("tokenPrice").and_then(number_decimal));
        let Some(((symbol, mark_price), token_price)) = parsed else {
            entries.remove(mint);
            invalid_mints.insert(mint.to_string());
            continue;
        };
        let entry = PreStockEntry {
            mint: mint.to_string(),
            symbol: symbol.to_string(),
            mark_price,
            token_price,
        };
        if let Some(existing) = entries.get(mint) {
            if existing != &entry {
                entries.remove(mint);
                invalid_mints.insert(mint.to_string());
            }
        } else {
            entries.insert(mint.to_string(), entry);
        }
    }
    entries
}

#[allow(non_snake_case)]
pub fn parsePreStocks(value: &Value) -> BTreeMap<String, PreStockEntry> {
    parse_prestocks(value)
}

pub fn effective_multiplier(state: &ScaledUiState, now_seconds: i64) -> String {
    if let (Some(new_multiplier), Some(activation)) = (
        &state.new_multiplier,
        state.new_multiplier_effective_timestamp,
    ) && now_seconds >= activation
    {
        return new_multiplier.clone();
    }
    state.multiplier.clone()
}

#[allow(non_snake_case)]
pub fn effectiveMultiplier(state: &ScaledUiState, now_seconds: i64) -> String {
    effective_multiplier(state, now_seconds)
}

pub fn divide_integer_by_decimal(integer_units: &str, multiplier: &str) -> Option<String> {
    if !integer_units.chars().all(|c| c.is_ascii_digit()) || !decimal(multiplier) {
        return None;
    }
    let frac_length = multiplier.split('.').nth(1).map_or(0, str::len);
    let denominator = scale_decimal_to_integer(multiplier, frac_length as u32)?
        .parse::<u128>()
        .ok()?;
    if denominator == 0 {
        return None;
    }
    let numerator = integer_units
        .parse::<u128>()
        .ok()?
        .checked_mul(10u128.checked_pow(frac_length as u32)?)?;
    Some((numerator / denominator).to_string())
}

#[allow(non_snake_case)]
pub fn divideIntegerByDecimal(integer_units: &str, multiplier: &str) -> Option<String> {
    divide_integer_by_decimal(integer_units, multiplier)
}

pub fn multiplier_from_supply(raw_amount: &str, decimals: u32, ui_amount: &str) -> Option<String> {
    multiplier_from_supply_with_precision(raw_amount, decimals, ui_amount, MULTIPLIER_PRECISION)
}

pub fn multiplier_from_supply_with_precision(
    raw_amount: &str,
    decimals: u32,
    ui_amount: &str,
    precision: u32,
) -> Option<String> {
    if !raw_amount.chars().all(|c| c.is_ascii_digit()) || !decimal(ui_amount) {
        return None;
    }
    let raw = raw_amount.parse::<u128>().ok()?;
    if raw == 0 {
        return None;
    }
    let mut parts = ui_amount.split('.');
    let int = parts.next().unwrap_or("0");
    let frac = parts.next().unwrap_or("");
    let ui_int = format!("{int}{frac}").parse::<u128>().ok()?;
    let numerator = ui_int.checked_mul(10u128.checked_pow(decimals)?)?;
    let denominator = raw.checked_mul(10u128.checked_pow(frac.len() as u32)?)?;
    let scaled = numerator.checked_mul(10u128.checked_pow(precision)?)? / denominator;
    let factor = 10u128.pow(precision);
    let int_part = scaled / factor;
    let mut frac_part = format!("{:0width$}", scaled % factor, width = precision as usize);
    while frac_part.ends_with('0') {
        frac_part.pop();
    }
    if frac_part.is_empty() {
        Some(int_part.to_string())
    } else {
        Some(format!("{int_part}.{frac_part}"))
    }
}

#[allow(non_snake_case)]
pub fn multiplierFromSupply(raw_amount: &str, decimals: u32, ui_amount: &str) -> Option<String> {
    multiplier_from_supply(raw_amount, decimals, ui_amount)
}

pub fn multipliers_agree(a: &str, b: &str, max_gap_bps: u32) -> bool {
    let Some(a_units) =
        scale_decimal_to_integer(a, MULTIPLIER_PRECISION).and_then(|x| x.parse::<u128>().ok())
    else {
        return false;
    };
    let Some(b_units) =
        scale_decimal_to_integer(b, MULTIPLIER_PRECISION).and_then(|x| x.parse::<u128>().ok())
    else {
        return false;
    };
    if b_units == 0 {
        return false;
    }
    let Some(gap_bps) = a_units
        .abs_diff(b_units)
        .checked_mul(10_000)
        .map(|scaled| scaled / b_units)
    else {
        return false;
    };
    gap_bps <= u128::from(max_gap_bps)
}

#[allow(non_snake_case)]
pub fn multipliersAgree(a: &str, b: &str, max_gap_bps: u32) -> bool {
    multipliers_agree(a, b, max_gap_bps)
}

fn object(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.as_object()
}

fn positive_decimal_string(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    if positive_decimal(text) {
        Some(text.to_string())
    } else {
        None
    }
}

pub fn parse_scaled_ui_account_state(value: &Value) -> Option<ScaledUiState> {
    let account = object(value)?.get("result")?.get("value")?;
    if account.is_null() {
        return None;
    }
    let data = object(account)?.get("data")?;
    let program = data.get("program")?.as_str()?;
    if program == "spl-token" {
        return Some(ScaledUiState {
            multiplier: "1".into(),
            new_multiplier: None,
            new_multiplier_effective_timestamp: None,
        });
    }
    if program != "spl-token-2022" {
        return None;
    }
    let extensions = data
        .get("parsed")?
        .get("info")?
        .get("extensions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let scaled = extensions.iter().find(|entry| {
        entry.get("extension").and_then(Value::as_str) == Some("scaledUiAmountConfig")
    });
    let Some(scaled) = scaled else {
        return Some(ScaledUiState {
            multiplier: "1".into(),
            new_multiplier: None,
            new_multiplier_effective_timestamp: None,
        });
    };
    let state = scaled.get("state")?;
    let multiplier = positive_decimal_string(state.get("multiplier"))?;
    let pending_key = state.as_object()?.contains_key("newMultiplier");
    let timestamp_key = state
        .as_object()?
        .contains_key("newMultiplierEffectiveTimestamp");
    let pending_raw = state.get("newMultiplier");
    let activation = state
        .get("newMultiplierEffectiveTimestamp")
        .and_then(Value::as_i64);
    if pending_key && !pending_raw.is_none_or(Value::is_null) {
        let pending = positive_decimal_string(pending_raw)?;
        let activation = activation?;
        return Some(ScaledUiState {
            multiplier,
            new_multiplier: Some(pending),
            new_multiplier_effective_timestamp: Some(activation),
        });
    }
    if timestamp_key && activation.is_some() {
        return None;
    }
    Some(ScaledUiState {
        multiplier,
        new_multiplier: None,
        new_multiplier_effective_timestamp: None,
    })
}

#[allow(non_snake_case)]
pub fn parseScaledUiAccountState(value: Value) -> Option<ScaledUiState> {
    parse_scaled_ui_account_state(&value)
}

fn parse_token_supply(value: &Value) -> Option<(String, u32, String)> {
    let supply = object(value)?.get("result")?.get("value")?.as_object()?;
    let amount = supply.get("amount")?.as_str()?.to_string();
    let decimals = u32::try_from(supply.get("decimals")?.as_u64()?).ok()?;
    let ui_amount = supply.get("uiAmountString")?.as_str()?.to_string();
    if !amount.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((amount, decimals, ui_amount))
}

async fn json_request(client: &Client, url: &str, request: Value) -> Result<Value, String> {
    let response = client
        .post(url)
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("http {status}"));
    }
    let bytes = bounded_response_bytes(response)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("response body exceeded limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid json: {e}"))
}

pub async fn fetch_scaled_ui_multipliers(
    mints: &[String],
    rpc_url: Option<&str>,
) -> BTreeMap<String, Option<String>> {
    let endpoint = rpc_url.unwrap_or(RPC_URL).to_string();
    let client = match Client::builder().timeout(Duration::from_secs(6)).build() {
        Ok(client) => client,
        Err(_) => return mints.iter().map(|mint| (mint.clone(), None)).collect(),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |x| x.as_secs() as i64);
    let mut handles = Vec::with_capacity(mints.len());
    for mint in mints {
        let client = client.clone();
        let endpoint = endpoint.clone();
        let mint = mint.clone();
        handles.push(tokio::spawn(async move {
            let account_request = json!({"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":[mint,{"encoding":"jsonParsed"}]});
            let supply_request = json!({"jsonrpc":"2.0","id":1,"method":"getTokenSupply","params":[mint]});
            let (account, supply) = tokio::join!(json_request(&client, &endpoint, account_request), json_request(&client, &endpoint, supply_request));
            let result = account.ok().and_then(|account| {
                let supply = supply.ok()?;
                let state = parse_scaled_ui_account_state(&account)?;
                let (amount, decimals, ui) = parse_token_supply(&supply)?;
                let extension_multiplier = effective_multiplier(&state, now);
                let supply_multiplier = multiplier_from_supply(&amount, decimals, &ui)?;
                if multipliers_agree(&extension_multiplier, &supply_multiplier, 5) { Some(extension_multiplier) } else { None }
            });
            (mint, result)
        }));
    }
    let mut results = BTreeMap::new();
    for handle in handles {
        if let Ok((mint, value)) = handle.await {
            results.insert(mint, value);
        }
    }
    for mint in mints {
        results.entry(mint.clone()).or_insert(None);
    }
    results
}

pub async fn fetch_prestocks(mints: &[String], url: Option<&str>) -> PreStocksData {
    let mut refs = BTreeMap::new();
    let mut issuer_prices = BTreeMap::new();
    for mint in mints {
        refs.insert(mint.clone(), None);
        issuer_prices.insert(mint.clone(), None);
    }
    let client = match Client::builder().timeout(Duration::from_secs(6)).build() {
        Ok(client) => client,
        Err(_) => {
            return PreStocksData {
                refs,
                issuer_prices,
                error: Some("prestocks http client unavailable".into()),
            };
        }
    };
    let response = match client
        .get(url.unwrap_or(PRESTOCKS_URL))
        .header("accept", "application/json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return PreStocksData {
                refs,
                issuer_prices,
                error: Some(format!("prestocks fetch failed: {error}")),
            };
        }
    };
    if !response.status().is_success() {
        return PreStocksData {
            refs,
            issuer_prices,
            error: Some(format!("prestocks http {}", response.status())),
        };
    }
    let received_at = crate::pyth::now_iso();
    let bytes = match bounded_response_bytes(response).await {
        Ok(bytes) if bytes.len() <= MAX_BODY_BYTES => bytes,
        _ => {
            return PreStocksData {
                refs,
                issuer_prices,
                error: Some("prestocks response unreadable".into()),
            };
        }
    };
    let body: Value = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => {
            return PreStocksData {
                refs,
                issuer_prices,
                error: Some("prestocks response was not valid JSON".into()),
            };
        }
    };
    let entries = parse_prestocks(&body);
    for mint in mints {
        if let Some(entry) = entries.get(mint) {
            refs.insert(
                mint.clone(),
                Some(PythUnderlyingRef {
                    feed_id: format!("prestocks:{}", entry.symbol),
                    spot: entry.mark_price.clone(),
                    publish_time: received_at.clone(),
                }),
            );
            issuer_prices.insert(mint.clone(), Some(entry.token_price.clone()));
        }
    }
    PreStocksData {
        refs,
        issuer_prices,
        error: None,
    }
}

pub fn normalize_scaled_price(
    capture: &FieldCapture,
    price_scale: u32,
    multiplier: Option<&str>,
    issuer_price: Option<&str>,
    sanity_bps: u32,
) -> FieldCapture {
    let Some(raw) = capture.value.as_deref() else {
        return capture.clone();
    };
    let Some(multiplier) = multiplier else {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "scaled-ui multiplier unavailable; cannot normalize raw pool price",
        );
    };
    let Some(normalized) = divide_integer_by_decimal(raw, multiplier) else {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "scaled-ui multiplier invalid; cannot normalize raw pool price",
        );
    };
    let Some(issuer) = issuer_price.and_then(|value| scale_decimal_to_integer(value, price_scale))
    else {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "issuer price unavailable; cannot corroborate normalized pool price",
        );
    };
    let Ok(issuer_units) = issuer.parse::<u128>() else {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "issuer price invalid; cannot corroborate normalized pool price",
        );
    };
    if issuer_units == 0 {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "issuer price is zero; cannot corroborate normalized pool price",
        );
    }
    let Ok(pool_units) = normalized.parse::<u128>() else {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "normalized pool price invalid",
        );
    };
    let Some(gap_bps) = pool_units
        .abs_diff(issuer_units)
        .checked_mul(10_000)
        .map(|scaled| scaled / issuer_units)
    else {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            "price sanity gap calculation overflowed",
        );
    };
    if gap_bps > u128::from(sanity_bps) {
        return FieldCapture::failed(
            &capture.source_id,
            &capture.source_version,
            &capture.observed_at,
            format!(
                "source-disagreement: normalized pool {normalized} vs issuer {issuer_units} units differs by {gap_bps}bps (bound {sanity_bps})"
            ),
        );
    }
    FieldCapture::ok(
        &capture.source_id,
        &capture.source_version,
        &capture.observed_at,
        format!(
            "{};scaled-ui-multiplier={multiplier};issuer-price={issuer_price:?}",
            capture.raw_excerpt
        ),
        normalized,
    )
}
pub fn scaled_prestocks_adapter(
    captures: AssetCaptures,
    price_scale: u32,
    multiplier: Option<&str>,
    issuer_price: Option<&str>,
    sanity_bps: u32,
) -> AssetCaptures {
    AssetCaptures {
        price: normalize_scaled_price(
            &captures.price,
            price_scale,
            multiplier,
            issuer_price,
            sanity_bps,
        ),
        liquidity: captures.liquidity,
    }
}
#[allow(non_snake_case)]
pub fn scaledPreStocksAdapter(
    captures: AssetCaptures,
    price_scale: u32,
    multiplier: Option<&str>,
    issuer_price: Option<&str>,
    sanity_bps: u32,
) -> AssetCaptures {
    scaled_prestocks_adapter(captures, price_scale, multiplier, issuer_price, sanity_bps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scaled(state: Value) -> Value {
        json!({"result":{"value":{"data":{"program":"spl-token-2022","parsed":{"info":{"extensions":[{"extension":"scaledUiAmountConfig","state":state}]}}}}}})
    }

    #[test]
    fn v66_state_fail_closed_vectors() {
        assert!(parse_scaled_ui_account_state(&scaled(json!({"multiplier":"0"}))).is_none());
        assert!(parse_scaled_ui_account_state(&scaled(json!({"multiplier":"1","newMultiplier":"bad","newMultiplierEffectiveTimestamp":1781065800}))).is_none());
        assert!(parse_scaled_ui_account_state(&scaled(json!({"multiplier":"1","newMultiplier":"0","newMultiplierEffectiveTimestamp":1781065800}))).is_none());
        assert!(
            parse_scaled_ui_account_state(&scaled(json!({"multiplier":"1","newMultiplier":"5"})))
                .is_none()
        );
        assert!(
            parse_scaled_ui_account_state(&scaled(
                json!({"multiplier":"1","newMultiplierEffectiveTimestamp":1781065800})
            ))
            .is_none()
        );
    }

    #[test]
    fn v66_exact_math_vectors() {
        assert_eq!(
            effective_multiplier(
                &ScaledUiState {
                    multiplier: "1".into(),
                    new_multiplier: Some("5".into()),
                    new_multiplier_effective_timestamp: Some(1781065800)
                },
                1781065799
            ),
            "1"
        );
        assert_eq!(
            effective_multiplier(
                &ScaledUiState {
                    multiplier: "1".into(),
                    new_multiplier: Some("1.4861347".into()),
                    new_multiplier_effective_timestamp: Some(1784305800)
                },
                1784305800
            ),
            "1.4861347"
        );
        assert_eq!(
            multiplier_from_supply("1901951695078", 9, "2826.556411779"),
            Some("1.4861346".into())
        );
        assert_eq!(
            multiplier_from_supply("8742515849291", 9, "43712.579246455"),
            Some("5".into())
        );
        assert!(multipliers_agree("1.4861347", "1.4861346", 5));
        assert!(!multipliers_agree("5", "5.01", 5));
        assert_eq!(
            divide_integer_by_decimal("1477000000", "1.4861347"),
            Some("993853383".into())
        );
        assert_eq!(
            divide_integer_by_decimal("605000000", "5"),
            Some("121000000".into())
        );
    }

    #[test]
    fn v72_conflicting_duplicate_mint_rows_are_omitted() {
        let rows = json!([
            {"symbol":"OPENAI","contract_address":"PreMint1","markPrice":100,"tokenPrice":101},
            {"symbol":"OTHER","contract_address":"PreMint1","markPrice":100,"tokenPrice":101}
        ]);
        assert!(!parse_prestocks(&rows).contains_key("PreMint1"));

        let consistent_rows = json!([
            {"symbol":"OPENAI","contract_address":"PreMint1","markPrice":100,"tokenPrice":101},
            {"symbol":"OPENAI","contract_address":"PreMint1","markPrice":100,"tokenPrice":101}
        ]);
        assert_eq!(
            parse_prestocks(&consistent_rows)["PreMint1"].symbol,
            "OPENAI"
        );
    }

    #[test]
    fn v73_multiplier_gap_overflow_fails_closed() {
        assert!(!multipliers_agree(
            "34028236692093846346337460743176",
            "0.0000001",
            10000
        ));
    }

    #[test]
    fn v73_price_sanity_gap_overflow_returns_failed_capture() {
        let at = "2026-09-22T12:00:00Z";
        let capture = FieldCapture::ok("dexscreener", "v1", at, "raw", "1");
        let normalized = normalize_scaled_price(
            &capture,
            0,
            Some("1"),
            Some("340282366920938463463374607431768211455"),
            500,
        );
        assert!(!normalized.is_ok());
        assert!(normalized.raw_excerpt.contains("overflow"));
    }

    #[test]
    fn v74_supply_decimals_outside_u32_are_rejected() {
        let supply = json!({
            "result": {"value": {
                "amount": "1",
                "decimals": 4294967296u64,
                "uiAmountString": "1"
            }}
        });
        assert!(parse_token_supply(&supply).is_none());
    }

    #[test]
    fn parses_only_valid_numeric_rows() {
        let rows = json!([{ "symbol":"OPENAI", "contract_address":"PreMint1", "markPrice":967.4994641333656, "tokenPrice":983.5880055787931 }, {"symbol":"BAD","markPrice":1,"tokenPrice":1}]);
        let parsed = parse_prestocks(&rows);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed["PreMint1"].mark_price, "967.4994641333656");
    }
}
