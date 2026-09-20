use crate::domain::FieldCapture;
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

const BASE_URL: &str = "https://api.dexscreener.com";
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

#[derive(Clone, Debug)]
pub struct DexAsset {
    pub asset_id: String,
    pub price_scale: u32,
    pub quantity_scale: u32,
}

#[derive(Clone, Debug)]
pub struct AssetCaptures {
    pub price: FieldCapture,
    pub liquidity: FieldCapture,
}

fn decimal(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    let mut dots = 0;
    let mut digits = 0;
    for ch in text.chars() {
        if ch == '.' {
            dots += 1;
            if dots > 1 {
                return None;
            }
        } else if ch.is_ascii_digit() {
            digits += 1;
        } else {
            return None;
        }
    }
    (digits > 0 && !text.starts_with('.') && !text.ends_with('.')).then_some(text)
}

fn scale_decimal(value: &str, scale: u32) -> Option<String> {
    let mut parts = value.split('.');
    let int = parts.next().unwrap_or("0");
    let frac = parts.next().unwrap_or("");
    let mut frac = format!("{frac}{}", "0".repeat(scale as usize));
    frac.truncate(scale as usize);
    let mut output = format!("{int}{frac}");
    while output.len() > 1 && output.starts_with('0') {
        output.remove(0);
    }
    Some(output)
}

fn failed(at: &str, reason: impl Into<String>) -> AssetCaptures {
    let reason = reason.into();
    AssetCaptures {
        price: FieldCapture::failed(
            "dexscreener",
            "dexscreener-token-pairs-v1",
            at,
            reason.clone(),
        ),
        liquidity: FieldCapture::failed("dexscreener", "dexscreener-token-pairs-v1", at, reason),
    }
}

pub async fn fetch_asset(asset: &DexAsset, base_url: Option<&str>) -> AssetCaptures {
    let observed = crate::pyth::now_iso();
    let client = match Client::builder().timeout(Duration::from_secs(6)).build() {
        Ok(client) => client,
        Err(_) => return failed(&observed, "unable to construct HTTP client"),
    };
    let url = format!(
        "{}/token-pairs/v1/solana/{}",
        base_url.unwrap_or(BASE_URL),
        asset.asset_id
    );
    let response = match client
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return failed(&observed, format!("fetch failed: {error}")),
    };
    let status = response.status();
    if !status.is_success() {
        return failed(&observed, format!("http {status}"));
    }
    let bytes = match bounded_response_bytes(response).await {
        Ok(bytes) if bytes.len() <= MAX_BODY_BYTES => bytes,
        _ => return failed(&observed, "response body exceeded limit or unreadable"),
    };
    let body: Value = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => return failed(&observed, "response was not valid JSON"),
    };
    let Some(pairs) = body.as_array() else {
        return failed(&observed, "response was not a pair array");
    };
    let mut deepest: Option<&Value> = None;
    let mut deepest_liquidity: Option<String> = None;
    for pair in pairs {
        if pair.get("chainId").and_then(Value::as_str) != Some("solana")
            || pair
                .get("baseToken")
                .and_then(|v| v.get("address"))
                .and_then(Value::as_str)
                != Some(asset.asset_id.as_str())
        {
            continue;
        }
        let candidate = pair
            .get("liquidity")
            .and_then(|v| v.get("usd"))
            .and_then(decimal);
        let replace = match (&deepest_liquidity, &candidate) {
            (None, Some(_)) => true,
            (Some(current), Some(next)) => decimal_units(next, 0) > decimal_units(current, 0),
            _ => deepest.is_none(),
        };
        if replace {
            deepest = Some(pair);
            deepest_liquidity = candidate;
        }
    }
    let Some(pair) = deepest else {
        return failed(&observed, "no indexed solana pool for mint");
    };
    let Some(liquidity) = deepest_liquidity else {
        return failed(&observed, "null liquidity in deepest pool");
    };
    let Some(price) = pair.get("priceUsd").and_then(decimal) else {
        return failed(&observed, "null price in deepest pool");
    };
    let Some(price_value) = scale_decimal(&price, asset.price_scale) else {
        return failed(&observed, "unparseable pool price");
    };
    let Some(liquidity_value) = scale_decimal(&liquidity, asset.quantity_scale) else {
        return failed(&observed, "unparseable pool liquidity");
    };
    let pair_address = pair
        .get("pairAddress")
        .and_then(Value::as_str)
        .unwrap_or("");
    let raw = format!(
        r#"{{"pairAddress":{pair_address:?},"priceUsd":{price:?},"liquidityUsd":{liquidity:?}}}"#
    );
    AssetCaptures {
        price: FieldCapture::ok(
            "dexscreener",
            "dexscreener-token-pairs-v1",
            observed.clone(),
            raw.clone(),
            price_value,
        ),
        liquidity: FieldCapture::ok(
            "dexscreener",
            "dexscreener-token-pairs-v1",
            observed,
            raw,
            liquidity_value,
        ),
    }
}

fn decimal_units(value: &str, scale: u32) -> u128 {
    scale_decimal(value, scale)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_math_is_integer_based() {
        assert_eq!(decimal_units("100.50", 0), 100);
        assert_eq!(scale_decimal("1.25", 6), Some("1250000".into()));
    }
}
