use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// One value retained from one versioned source. `value == None` is an explicit
/// outage/parse failure; callers must never substitute a guessed value.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FieldCapture {
    pub source_id: String,
    pub source_version: String,
    pub observed_at: String,
    pub raw_excerpt: String,
    pub value: Option<String>,
}

impl FieldCapture {
    pub fn ok(
        source_id: impl Into<String>,
        source_version: impl Into<String>,
        observed_at: impl Into<String>,
        raw_excerpt: impl Into<String>,
        value: impl Into<String>,
    ) -> Self {
        Self {
            source_id: source_id.into(),
            source_version: source_version.into(),
            observed_at: observed_at.into(),
            raw_excerpt: raw_excerpt.into(),
            value: Some(value.into()),
        }
    }

    pub fn failed(
        source_id: impl Into<String>,
        source_version: impl Into<String>,
        observed_at: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            source_id: source_id.into(),
            source_version: source_version.into(),
            observed_at: observed_at.into(),
            raw_excerpt: reason.into(),
            value: None,
        }
    }

    pub fn is_ok(&self) -> bool {
        self.value.is_some()
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum SnapshotStatus {
    Ready,
    NoData,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalSnapshot {
    pub captures: BTreeMap<String, FieldCapture>,
    pub created_at: String,
    pub conflicts: Vec<String>,
    pub sha256: String,
    pub status: SnapshotStatus,
}

/// Parse a UTC ISO-8601 timestamp (`YYYY-MM-DDTHH:MM:SS[.mmm]Z`) to epoch
/// milliseconds. Mirrors the TS `Date.parse` + `isoTime` validation: any
/// unparseable timestamp is a typed failure, never a guessed time.
pub fn parse_iso_ms(value: &str) -> Option<i64> {
    let rest = value.strip_suffix('Z')?;
    let (date, time) = rest.split_at(rest.find('T')?);
    let time = &time[1..];
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    if date_parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (hms, millis) = match time.split_once('.') {
        Some((hms, frac)) => {
            if frac.is_empty() || frac.len() > 3 || frac.bytes().any(|b| !b.is_ascii_digit()) {
                return None;
            }
            let scale = 10_i64.pow(3 - frac.len() as u32);
            (hms, frac.parse::<i64>().ok()? * scale)
        }
        None => (time, 0),
    };
    let mut time_parts = hms.split(':');
    let hour: i64 = time_parts.next()?.parse().ok()?;
    let minute: i64 = time_parts.next()?.parse().ok()?;
    let second: i64 = time_parts.next()?.parse().ok()?;
    if time_parts.next().is_some() || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    // Days since Unix epoch via civil-date algorithm (Howard Hinnant).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1_000 + millis)
}

impl CanonicalSnapshot {
    /// Freeze one snapshot. Fail closed (V61/I10 parity with the TS basket
    /// contract): every capture needs a parseable UTC timestamp that is not
    /// after local receipt (`created_at`), and the spread of capture times
    /// must stay within `coherence_cap_ms` (TS `basket.coherence-cap`).
    pub fn new(
        captures: BTreeMap<String, FieldCapture>,
        created_at: impl Into<String>,
        coherence_cap_ms: u64,
    ) -> Self {
        let created_at = created_at.into();
        let mut conflicts = Vec::new();
        let created_ms = parse_iso_ms(&created_at);
        if created_ms.is_none() {
            conflicts.push("snapshot.created-at-invalid".to_string());
        }
        let mut observed: Vec<i64> = Vec::with_capacity(captures.len());
        for (key, capture) in &captures {
            match parse_iso_ms(&capture.observed_at) {
                None => conflicts.push(format!("capture.time-invalid:{key}")),
                Some(ms) => {
                    if let Some(created) = created_ms
                        && ms > created
                    {
                        conflicts.push(format!("capture.time-future:{key}"));
                    }
                    observed.push(ms);
                }
            }
        }
        if let (Some(min), Some(max)) = (observed.iter().min(), observed.iter().max())
            && (max - min) as u128 > u128::from(coherence_cap_ms)
        {
            conflicts.push("basket.coherence-cap".to_string());
        }
        conflicts.sort();
        conflicts.dedup();
        let status = if !captures.is_empty()
            && captures.values().all(FieldCapture::is_ok)
            && conflicts.is_empty()
        {
            SnapshotStatus::Ready
        } else {
            SnapshotStatus::NoData
        };
        let payload = serde_json::json!({
            "captures": captures,
            "conflicts": conflicts,
            "created_at": created_at,
            "status": status,
        });
        let sha256 = sha256_hex(stable_json(&payload).as_bytes());
        Self {
            captures,
            created_at,
            conflicts,
            sha256,
            status,
        }
    }

    pub fn canonical_json(&self) -> String {
        let payload = serde_json::json!({
            "captures": self.captures,
            "conflicts": self.conflicts,
            "created_at": self.created_at,
            "status": self.status,
        });
        stable_json(&payload)
    }

    pub fn verify_hash(&self) -> bool {
        sha256_hex(self.canonical_json().as_bytes()) == self.sha256
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalLeg {
    pub asset_id: String,
    pub underlying: String,
    pub target_weight_bps: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Proposal {
    pub proposal_id: String,
    pub legs: Vec<ProposalLeg>,
    pub snapshot_sha256: String,
    pub expires_at: String,
    pub authority: String,
    pub execution_ready: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE", tag = "status")]
pub enum Verdict {
    Published(Proposal),
    Blocked { reasons: Vec<String> },
    NoData { reasons: Vec<String> },
}

impl Verdict {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Published(_) => "PUBLISHED",
            Self::Blocked { .. } => "BLOCKED",
            Self::NoData { .. } => "NO_DATA",
        }
    }

    pub fn reasons(&self) -> &[String] {
        match self {
            Self::Published(_) => &[],
            Self::Blocked { reasons } | Self::NoData { reasons } => reasons,
        }
    }
}

/// JSON serialization that recursively sorts object keys, matching the
/// TypeScript stableStringify contract (array order remains significant).
pub fn stable_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        Value::String(v) => serde_json::to_string(v).expect("string serialization cannot fail"),
        Value::Array(values) => {
            let mut out = String::from("[");
            for (index, item) in values.iter().enumerate() {
                if index != 0 {
                    out.push(',');
                }
                out.push_str(&stable_json(item));
            }
            out.push(']');
            out
        }
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort();
            let mut out = String::from("{");
            for (index, key) in keys.iter().enumerate() {
                if index != 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).expect("key serialization cannot fail"));
                out.push(':');
                out.push_str(&stable_json(
                    object.get(*key).expect("key came from object"),
                ));
            }
            out.push('}');
            out
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Convert an arbitrary serializable value to the canonical bytes used by the
/// snapshot hash. Kept public for parity tests and audit tooling.
pub fn stable_json_of<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let value = serde_json::to_value(value)?;
    Ok(stable_json(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_keys_and_hash_are_order_independent() {
        let a: Value = serde_json::from_str(r#"{"b":2,"a":{"z":1,"y":0}}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"a":{"y":0,"z":1},"b":2}"#).unwrap();
        assert_eq!(stable_json(&a), stable_json(&b));
        assert_eq!(
            sha256_hex(stable_json(&a).as_bytes()),
            sha256_hex(stable_json(&b).as_bytes())
        );
    }

    #[test]
    fn snapshot_fails_closed_when_a_capture_is_missing() {
        let captures = BTreeMap::from([(
            "price".to_string(),
            FieldCapture::failed("x", "1", "2026-09-20T12:00:00Z", "outage"),
        )]);
        let snapshot = CanonicalSnapshot::new(captures, "2026-09-20T12:00:01Z", 120_000);
        assert_eq!(snapshot.status, SnapshotStatus::NoData);
        assert!(snapshot.verify_hash());
    }

    #[test]
    fn iso_parser_accepts_utc_and_rejects_garbage() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("1970-01-01T00:00:01.500Z"), Some(1_500));
        assert_eq!(
            parse_iso_ms("2026-09-20T17:27:16Z"),
            Some(1_789_925_236_000)
        );
        for bad in ["t", "", "2026-09-20", "2026-09-20T17:27:16", "2026-13-01T00:00:00Z", "2026-09-20T24:00:00Z", "2026-09-20T17:27:16.1234Z"] {
            assert_eq!(parse_iso_ms(bad), None, "{bad} must be rejected");
        }
    }

    #[test]
    fn coherence_cap_and_timestamp_validity_fail_closed() {
        let ok = |at: &str| FieldCapture::ok("src", "1", at, "raw", "1");
        let base = BTreeMap::from([
            ("a".to_string(), ok("2026-09-20T12:00:00Z")),
            ("b".to_string(), ok("2026-09-20T12:02:00.001Z")),
        ]);
        let spread = CanonicalSnapshot::new(base, "2026-09-20T12:02:01Z", 120_000);
        assert_eq!(spread.status, SnapshotStatus::NoData);
        assert!(spread.conflicts.contains(&"basket.coherence-cap".to_string()));

        let future = CanonicalSnapshot::new(
            BTreeMap::from([("a".to_string(), ok("2026-09-20T12:00:05Z"))]),
            "2026-09-20T12:00:00Z",
            120_000,
        );
        assert_eq!(future.status, SnapshotStatus::NoData);
        assert!(future.conflicts.contains(&"capture.time-future:a".to_string()));

        let invalid = CanonicalSnapshot::new(
            BTreeMap::from([("a".to_string(), ok("t"))]),
            "2026-09-20T12:00:00Z",
            120_000,
        );
        assert_eq!(invalid.status, SnapshotStatus::NoData);
        assert!(invalid.conflicts.contains(&"capture.time-invalid:a".to_string()));

        let ready = CanonicalSnapshot::new(
            BTreeMap::from([
                ("a".to_string(), ok("2026-09-20T12:00:00Z")),
                ("b".to_string(), ok("2026-09-20T12:01:59Z")),
            ]),
            "2026-09-20T12:02:00Z",
            120_000,
        );
        assert_eq!(ready.status, SnapshotStatus::Ready);
        assert!(ready.verify_hash());
    }
}
