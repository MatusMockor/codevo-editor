use serde::{de::DeserializeOwned, de::Error as _, Deserialize, Deserializer, Serialize};
use serde_json::Value;

const NOT_CANONICAL: &str = "Invalid request";

pub(super) fn canonical<T: DeserializeOwned + Serialize>(value: Value) -> Option<T> {
    let parsed: T = serde_json::from_value(value.clone()).ok()?;
    let echoed = serde_json::to_value(&parsed).ok()?;
    (echoed == value).then_some(parsed)
}

pub struct Canonical<T>(pub T);

impl<'de, T: DeserializeOwned + Serialize> Deserialize<'de> for Canonical<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        canonical(Value::deserialize(deserializer)?)
            .map(Canonical)
            .ok_or_else(|| D::Error::custom(NOT_CANONICAL))
    }
}
