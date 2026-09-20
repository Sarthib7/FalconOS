use crate::domain::Verdict;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PerpsRegistry {
    pub venue: String,
    pub market_id: String,
    pub contract_version: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PerpsSnapshot {
    pub registry: PerpsRegistry,
    pub captured_at: String,
}

pub fn evaluate_perps(registry: Option<PerpsRegistry>) -> Verdict {
    match registry {
        Some(registry)
            if !registry.venue.is_empty()
                && !registry.market_id.is_empty()
                && !registry.contract_version.is_empty() =>
        {
            Verdict::NoData {
                reasons: vec![format!(
                    "perps source unresolved for {}:{}",
                    registry.venue, registry.market_id
                )],
            }
        }
        _ => Verdict::NoData {
            reasons: vec!["perps registry unresolved".into()],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unresolved_registry_is_no_data() {
        let verdict = evaluate_perps(None);
        assert!(
            matches!(verdict, Verdict::NoData { reasons } if reasons == vec!["perps registry unresolved"])
        );
    }
}
