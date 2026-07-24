use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

/// JavaScript's largest exactly representable integer. Keeping the wire count within this bound
/// prevents a TypeScript client from silently rounding a valid Rust `u64`.
pub(crate) const MAX_DEBUG_HIT_COUNT: u64 = 9_007_199_254_740_991;
pub(crate) const PHP_HIT_CONDITION_UNSUPPORTED_ERROR: &str =
    "Hit conditions are only available for Node.js breakpoints.";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DebugHitCondition {
    Equals { count: u64 },
    GreaterOrEqual { count: u64 },
    Multiple { count: u64 },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum RawDebugHitCondition {
    Equals { count: u64 },
    GreaterOrEqual { count: u64 },
    Multiple { count: u64 },
}

impl<'de> Deserialize<'de> for DebugHitCondition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let condition = match RawDebugHitCondition::deserialize(deserializer)? {
            RawDebugHitCondition::Equals { count } => Self::Equals { count },
            RawDebugHitCondition::GreaterOrEqual { count } => Self::GreaterOrEqual { count },
            RawDebugHitCondition::Multiple { count } => Self::Multiple { count },
        };
        condition.validate().map_err(D::Error::custom)?;
        Ok(condition)
    }
}

impl DebugHitCondition {
    pub(crate) fn count(self) -> u64 {
        match self {
            Self::Equals { count } | Self::GreaterOrEqual { count } | Self::Multiple { count } => {
                count
            }
        }
    }

    pub(crate) fn matches(self, hits: u64) -> bool {
        match self {
            Self::Equals { count } => hits == count,
            Self::GreaterOrEqual { count } => hits >= count,
            Self::Multiple { count } if count != 0 => hits.is_multiple_of(count),
            Self::Multiple { .. } => false,
        }
    }

    pub(crate) fn validate(self) -> Result<(), String> {
        let count = self.count();
        if (1..=MAX_DEBUG_HIT_COUNT).contains(&count) {
            Ok(())
        } else {
            Err(format!(
                "Debug hit count must be between 1 and {MAX_DEBUG_HIT_COUNT}."
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_is_closed_bounded_and_camel_case() {
        for (value, wire) in [
            (
                DebugHitCondition::Equals { count: 2 },
                serde_json::json!({"kind":"equals", "count":2}),
            ),
            (
                DebugHitCondition::GreaterOrEqual { count: 3 },
                serde_json::json!({"kind":"greaterOrEqual", "count":3}),
            ),
            (
                DebugHitCondition::Multiple { count: 4 },
                serde_json::json!({"kind":"multiple", "count":4}),
            ),
        ] {
            assert_eq!(serde_json::to_value(value).unwrap(), wire);
            assert_eq!(
                serde_json::from_value::<DebugHitCondition>(wire).unwrap(),
                value
            );
        }
        for invalid in [
            serde_json::json!({"kind":"equals", "count":0}),
            serde_json::json!({"kind":"equals", "count":MAX_DEBUG_HIT_COUNT + 1}),
            serde_json::json!({"kind":"unknown", "count":1}),
            serde_json::json!({"kind":"multiple", "count":1, "extra":true}),
            serde_json::json!({"kind":"multiple"}),
            serde_json::json!({"kind":"multiple", "count":1.5}),
        ] {
            assert!(serde_json::from_value::<DebugHitCondition>(invalid).is_err());
        }
    }

    #[test]
    fn predicates_cover_equals_threshold_and_multiples() {
        assert!(DebugHitCondition::Equals { count: 3 }.matches(3));
        assert!(!DebugHitCondition::Equals { count: 3 }.matches(4));
        assert!(!DebugHitCondition::GreaterOrEqual { count: 3 }.matches(2));
        assert!(DebugHitCondition::GreaterOrEqual { count: 3 }.matches(3));
        assert!(DebugHitCondition::GreaterOrEqual { count: 3 }.matches(9));
        assert!(!DebugHitCondition::Multiple { count: 3 }.matches(2));
        assert!(DebugHitCondition::Multiple { count: 3 }.matches(3));
        assert!(DebugHitCondition::Multiple { count: 3 }.matches(6));
    }
}
