use crate::domain::FieldCapture;
use crate::prestocks::scale_decimal_to_integer;
use reqwest::Client;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const HERMES_BASE: &str = "https://pyth.dourolabs.app/hermes";
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
pub struct PythUnderlyingRef {
    pub feed_id: String,
    pub spot: String,
    pub publish_time: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PythAssetFeeds {
    pub asset_id: String,
    pub underlying: String,
    pub price_scale: u32,
    pub tokenized_feed_id: String,
    pub underlying_feed_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PythPriceResult {
    pub price: FieldCapture,
    pub underlying: Option<PythUnderlyingRef>,
}

pub fn pyth_to_decimal(price: &str, expo: i32) -> Option<String> {
    if !price.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let digits = price.trim_start_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    if expo >= 0 {
        return Some(format!("{digits}{}", "0".repeat(expo as usize)));
    }
    let places = expo.unsigned_abs() as usize;
    if digits.len() <= places {
        Some(format!("0.{}{}", "0".repeat(places - digits.len()), digits))
    } else {
        let cut = digits.len() - places;
        Some(format!("{}.{}", &digits[..cut], &digits[cut..]))
    }
}

#[allow(non_snake_case)]
pub fn pythToDecimal(price: &str, expo: i32) -> Option<String> {
    pyth_to_decimal(price, expo)
}

pub fn now_iso() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    unix_seconds_to_iso(seconds)
}

pub fn unix_seconds_to_iso(seconds: i64) -> String {
    // Howard Hinnant's civil-from-days conversion, kept local to avoid a time dependency.
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let d = doy - (153 * mp + 2).div_euclid(5) + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

fn feed_id(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    (text.len() == 66
        && text.starts_with("0x")
        && text[2..]
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
    .then(|| text.to_string())
}

fn parse_price_entry(entry: &Value) -> Option<(String, String, i64, String)> {
    let id = entry.get("id").and_then(feed_id)?;
    let price = entry.get("price")?;
    let price_int = price.get("price")?.as_str()?.to_string();
    let expo = price.get("expo")?.as_i64()? as i32;
    let publish_time = price.get("publish_time")?.as_i64()?;
    let decimal = pyth_to_decimal(&price_int, expo)?;
    Some((id, decimal, publish_time, price_int))
}

pub async fn fetch_pyth_prices(
    assets: &[PythAssetFeeds],
    max_age: Duration,
    base_url: Option<&str>,
    api_key: Option<&str>,
) -> BTreeMap<String, PythPriceResult> {
    let mut result = BTreeMap::new();
    let client = match Client::builder().timeout(Duration::from_secs(6)).build() {
        Ok(client) => client,
        Err(_) => return result,
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    for asset in assets {
        let Some(token_id) = feed_id(&Value::String(asset.tokenized_feed_id.clone())) else {
            result.insert(
                asset.asset_id.clone(),
                PythPriceResult {
                    price: FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        now_iso(),
                        "invalid tokenized feed id",
                    ),
                    underlying: None,
                },
            );
            continue;
        };
        let Some(underlying_id) = feed_id(&Value::String(asset.underlying_feed_id.clone())) else {
            result.insert(
                asset.asset_id.clone(),
                PythPriceResult {
                    price: FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        now_iso(),
                        "invalid underlying feed id",
                    ),
                    underlying: None,
                },
            );
            continue;
        };
        let url = format!(
            "{}/v2/updates/price/latest?ids[]={token_id}&ids[]={underlying_id}",
            base_url.unwrap_or(HERMES_BASE)
        );
        let mut request = client.get(url).header("accept", "application/json");
        if let Some(key) = api_key {
            request = request.bearer_auth(key);
        }
        let observed = now_iso();
        let response = match request.send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                result.insert(
                    asset.asset_id.clone(),
                    PythPriceResult {
                        price: FieldCapture::failed(
                            "pyth",
                            "pyth-hermes-v2",
                            observed,
                            format!("http {}", response.status()),
                        ),
                        underlying: None,
                    },
                );
                continue;
            }
            Err(error) => {
                result.insert(
                    asset.asset_id.clone(),
                    PythPriceResult {
                        price: FieldCapture::failed(
                            "pyth",
                            "pyth-hermes-v2",
                            observed,
                            format!("fetch failed: {error}"),
                        ),
                        underlying: None,
                    },
                );
                continue;
            }
        };
        let bytes = match bounded_response_bytes(response).await {
            Ok(bytes) if bytes.len() <= MAX_BODY_BYTES => bytes,
            _ => {
                result.insert(
                    asset.asset_id.clone(),
                    PythPriceResult {
                        price: FieldCapture::failed(
                            "pyth",
                            "pyth-hermes-v2",
                            observed,
                            "response body exceeded limit or unreadable",
                        ),
                        underlying: None,
                    },
                );
                continue;
            }
        };
        let body: Value = match serde_json::from_slice(&bytes) {
            Ok(body) => body,
            Err(_) => {
                result.insert(
                    asset.asset_id.clone(),
                    PythPriceResult {
                        price: FieldCapture::failed(
                            "pyth",
                            "pyth-hermes-v2",
                            observed,
                            "invalid Hermes JSON",
                        ),
                        underlying: None,
                    },
                );
                continue;
            }
        };
        let entries = body
            .get("parsed")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut parsed = BTreeMap::new();
        for entry in entries {
            if let Some((id, decimal, published, raw_price)) = parse_price_entry(&entry) {
                parsed.insert(id, (decimal, published, raw_price));
            }
        }
        let Some((token_decimal, token_time, token_raw)) = parsed.get(&token_id).cloned() else {
            result.insert(
                asset.asset_id.clone(),
                PythPriceResult {
                    price: FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        observed,
                        "tokenized feed missing",
                    ),
                    underlying: None,
                },
            );
            continue;
        };
        let Some((underlying_decimal, underlying_time, _)) = parsed.get(&underlying_id).cloned()
        else {
            result.insert(
                asset.asset_id.clone(),
                PythPriceResult {
                    price: FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        observed,
                        "underlying feed missing",
                    ),
                    underlying: None,
                },
            );
            continue;
        };
        if now.saturating_sub(token_time) > max_age.as_secs() as i64
            || now.saturating_sub(underlying_time) > max_age.as_secs() as i64
        {
            result.insert(
                asset.asset_id.clone(),
                PythPriceResult {
                    price: FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        observed,
                        "stale Pyth publish time",
                    ),
                    underlying: None,
                },
            );
            continue;
        }
        let Some(normalized) = scale_decimal_to_integer(&token_decimal, asset.price_scale) else {
            result.insert(
                asset.asset_id.clone(),
                PythPriceResult {
                    price: FieldCapture::failed(
                        "pyth",
                        "pyth-hermes-v2",
                        observed,
                        "unparseable Pyth price",
                    ),
                    underlying: None,
                },
            );
            continue;
        };
        result.insert(
            asset.asset_id.clone(),
            PythPriceResult {
                price: FieldCapture::ok(
                    "pyth",
                    "pyth-hermes-v2",
                    observed.clone(),
                    format!("{token_id}:{token_raw}"),
                    normalized,
                ),
                underlying: Some(PythUnderlyingRef {
                    feed_id: underlying_id.clone(),
                    spot: underlying_decimal,
                    publish_time: unix_seconds_to_iso(underlying_time),
                }),
            },
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_fixed_point_conversion() {
        assert_eq!(pyth_to_decimal("12345", -2), Some("123.45".into()));
        assert_eq!(pyth_to_decimal("12", -4), Some("0.0012".into()));
        assert_eq!(pyth_to_decimal("12", 2), Some("1200".into()));
    }
}
