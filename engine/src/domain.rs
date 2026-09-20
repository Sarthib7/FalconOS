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
    pub sha256: String,
    pub status: SnapshotStatus,
}

impl CanonicalSnapshot {
    pub fn new(captures: BTreeMap<String, FieldCapture>, created_at: impl Into<String>) -> Self {
        let created_at = created_at.into();
        let status = if !captures.is_empty() && captures.values().all(FieldCapture::is_ok) {
            SnapshotStatus::Ready
        } else {
            SnapshotStatus::NoData
        };
        let payload =
            serde_json::json!({ "captures": captures, "created_at": created_at, "status": status });
        let sha256 = sha256_hex(stable_json(&payload).as_bytes());
        Self {
            captures,
            created_at,
            sha256,
            status,
        }
    }

    pub fn canonical_json(&self) -> String {
        let payload = serde_json::json!({ "captures": self.captures, "created_at": self.created_at, "status": self.status });
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
            FieldCapture::failed("x", "1", "t", "outage"),
        )]);
        let snapshot = CanonicalSnapshot::new(captures, "t");
        assert_eq!(snapshot.status, SnapshotStatus::NoData);
        assert!(snapshot.verify_hash());
    }
}
