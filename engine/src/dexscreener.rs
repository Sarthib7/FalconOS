use crate::domain::FieldCapture;
use reqwest::Client;
use serde_json::Value;
use std::cmp::Ordering;
use std::time::Duration;

const BASE_URL: &str = "https://api.dexscreener.com";
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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
    if text.len() > 256 {
        return None;
    }
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
    let Some(pair) = select_pair(pairs, &asset.asset_id) else {
        return failed(&observed, "no indexed solana pool for mint");
    };
    let Some(liquidity) = pair_liquidity(pair) else {
        return failed(&observed, "null liquidity in selected pool");
    };
    let Some(price) = pair.get("priceUsd").and_then(decimal) else {
        return failed(&observed, "null price in selected pool");
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
    let quote_token = pair.get("quoteToken").unwrap_or(&Value::Null);
    let raw = serde_json::json!({
        "pairAddress": pair_address,
        "baseTokenAddress": pair.get("baseToken").and_then(|token| token.get("address")).and_then(Value::as_str),
        "quoteTokenAddress": quote_token.get("address").and_then(Value::as_str),
        "quoteTokenSymbol": quote_token.get("symbol").and_then(Value::as_str),
        "priceUsd": price,
        "liquidityUsd": liquidity
    })
    .to_string();
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

fn pair_liquidity(pair: &Value) -> Option<String> {
    pair.get("liquidity")
        .and_then(|value| value.get("usd"))
        .and_then(decimal)
}

/// Prefer the deepest USDC-quoted pool. A non-USD quote makes `priceUsd` depend on that quote token.
/// Fall back to the deepest pool only when no USDC quote exists.
fn select_pair<'a>(pairs: &'a [Value], asset_id: &str) -> Option<&'a Value> {
    let mut usdc: Option<&Value> = None;
    let mut usdc_liq: Option<String> = None;
    let mut any: Option<&Value> = None;
    let mut any_liq: Option<String> = None;
    for pair in pairs {
        if pair.get("chainId").and_then(Value::as_str) != Some("solana")
            || pair
                .get("baseToken")
                .and_then(|value| value.get("address"))
                .and_then(Value::as_str)
                != Some(asset_id)
        {
            continue;
        }
        let liquidity = pair_liquidity(pair);
        let quote_usdc = pair
            .get("quoteToken")
            .and_then(|value| value.get("address"))
            .and_then(Value::as_str)
            == Some(USDC_MINT);
        if quote_usdc
            && let Some(next) = liquidity.as_deref()
            && match &usdc_liq {
                None => true,
                Some(current) => compare_decimals(next, current) == Ordering::Greater,
            }
        {
            usdc = Some(pair);
            usdc_liq = liquidity.clone();
        }
        let replace = match (&any_liq, &liquidity) {
            (None, Some(_)) => true,
            (Some(current), Some(next)) => compare_decimals(next, current) == Ordering::Greater,
            _ => any.is_none(),
        };
        if replace {
            any = Some(pair);
            any_liq = liquidity;
        }
    }
    usdc.or(any)
}

fn compare_decimals(left: &str, right: &str) -> Ordering {
    let (left_whole, left_fraction) = left.split_once('.').unwrap_or((left, ""));
    let (right_whole, right_fraction) = right.split_once('.').unwrap_or((right, ""));
    let left_whole = left_whole.trim_start_matches('0');
    let right_whole = right_whole.trim_start_matches('0');
    let left_whole = if left_whole.is_empty() {
        "0"
    } else {
        left_whole
    };
    let right_whole = if right_whole.is_empty() {
        "0"
    } else {
        right_whole
    };

    match left_whole.len().cmp(&right_whole.len()) {
        Ordering::Equal => {}
        ordering => return ordering,
    }
    match left_whole.cmp(right_whole) {
        Ordering::Equal => {}
        ordering => return ordering,
    }

    for index in 0..left_fraction.len().max(right_fraction.len()) {
        let left_digit = left_fraction.as_bytes().get(index).copied().unwrap_or(b'0');
        let right_digit = right_fraction
            .as_bytes()
            .get(index)
            .copied()
            .unwrap_or(b'0');
        match left_digit.cmp(&right_digit) {
            Ordering::Equal => {}
            ordering => return ordering,
        }
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_math_is_integer_based() {
        assert_eq!(scale_decimal("1.25", 6), Some("1250000".into()));
        assert_eq!(compare_decimals("100.50", "100.5"), Ordering::Equal);
        assert_eq!(compare_decimals("100.09", "100.01"), Ordering::Greater);
        assert_eq!(compare_decimals("0.9", "0.89"), Ordering::Greater);
        assert_eq!(
            compare_decimals("999999999999999999999999", "1000000000000000000000000"),
            Ordering::Less
        );
    }

    #[test]
    fn usdc_quote_beats_a_deeper_non_usd_pool() {
        // V67: a deeper non-USDC quote must not beat a liquid USDC quote.
        let mint = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
        let pairs = vec![
            serde_json::json!({
                "chainId": "solana",
                "baseToken": {"address": mint},
                "quoteToken": {"address": "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", "symbol": "SPCXx"},
                "liquidity": {"usd": 117709.46},
                "priceUsd": "541.74"
            }),
            serde_json::json!({
                "chainId": "solana",
                "baseToken": {"address": "PreC1KtJ"},
                "quoteToken": {"address": mint, "symbol": "SPACEX"},
                "liquidity": {"usd": 900000.0},
                "priceUsd": "78.45"
            }),
            serde_json::json!({
                "chainId": "solana",
                "baseToken": {"address": mint},
                "quoteToken": {"address": USDC_MINT, "symbol": "USDC"},
                "liquidity": {"usd": 51377.8},
                "priceUsd": "573.41"
            }),
        ];
        let selected = select_pair(&pairs, mint).expect("pair");
        assert_eq!(
            selected.get("priceUsd").and_then(Value::as_str),
            Some("573.41")
        );
    }

    #[test]
    fn exact_liquidity_comparison_keeps_fractional_and_large_values() {
        // V68: ranking must preserve fractional precision and avoid integer overflow.
        let mint = "mint-a";
        let pairs = vec![
            serde_json::json!({
                "chainId": "solana",
                "baseToken": {"address": mint},
                "quoteToken": {"address": USDC_MINT, "symbol": "USDC"},
                "liquidity": {"usd": "900000000000000000000000.01"},
                "priceUsd": "10"
            }),
            serde_json::json!({
                "chainId": "solana",
                "baseToken": {"address": mint},
                "quoteToken": {"address": USDC_MINT, "symbol": "USDC"},
                "liquidity": {"usd": "900000000000000000000000.09"},
                "priceUsd": "11"
            }),
        ];
        let selected = select_pair(&pairs, mint).expect("pair");
        assert_eq!(selected.get("priceUsd").and_then(Value::as_str), Some("11"));
    }
}
