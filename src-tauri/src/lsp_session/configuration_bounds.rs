use serde_json::Value;
use std::fmt;
use std::io::{self, Write};

pub(crate) const MAX_CONFIGURATION_BYTES: usize = 256 * 1024;
pub(crate) const MAX_CONFIGURATION_DEPTH: usize = 16;
pub(crate) const MAX_CONFIGURATION_NODES: usize = 4_096;
pub(crate) const MAX_CONFIGURATION_CONTAINER_ITEMS: usize = 256;
pub(crate) const MAX_CONFIGURATION_STRING_BYTES: usize = 16 * 1024;
pub(crate) const MAX_CONFIGURATION_QUERY_ITEMS: usize = 128;
pub(crate) const MAX_CONFIGURATION_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ConfigurationBoundsError {
    RootNotObject,
    SerializedBytes,
    Depth,
    Nodes,
    ContainerItems,
    StringBytes,
}

impl fmt::Display for ConfigurationBoundsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RootNotObject => {
                formatter.write_str("Language server settings must be a JSON object.")
            }
            Self::SerializedBytes => write!(
                formatter,
                "Language server settings exceed {MAX_CONFIGURATION_BYTES} serialized bytes."
            ),
            Self::Depth => write!(
                formatter,
                "Language server settings exceed depth {MAX_CONFIGURATION_DEPTH}."
            ),
            Self::Nodes => write!(
                formatter,
                "Language server settings exceed {MAX_CONFIGURATION_NODES} JSON nodes."
            ),
            Self::ContainerItems => write!(
                formatter,
                "Language server settings contain more than \
                 {MAX_CONFIGURATION_CONTAINER_ITEMS} items in one container."
            ),
            Self::StringBytes => write!(
                formatter,
                "Language server settings contain a string longer than \
                 {MAX_CONFIGURATION_STRING_BYTES} bytes."
            ),
        }
    }
}

pub(crate) fn validate_settings(value: &Value) -> Result<(), ConfigurationBoundsError> {
    if !value.is_object() {
        return Err(ConfigurationBoundsError::RootNotObject);
    }

    let mut nodes = 0;
    validate_value(value, 1, &mut nodes)?;
    serialized_size_with_limit(value, MAX_CONFIGURATION_BYTES)
        .map(|_| ())
        .map_err(|()| ConfigurationBoundsError::SerializedBytes)
}

pub(crate) fn validate_query_string(value: &str) -> Result<(), ()> {
    (value.len() <= MAX_CONFIGURATION_STRING_BYTES)
        .then_some(())
        .ok_or(())
}

pub(crate) fn serialized_size_with_limit(value: &Value, limit: usize) -> Result<usize, ()> {
    let mut writer = CappedWriter { limit, written: 0 };
    serde_json::to_writer(&mut writer, value).map_err(|_| ())?;
    Ok(writer.written)
}

fn validate_value(
    value: &Value,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), ConfigurationBoundsError> {
    if depth > MAX_CONFIGURATION_DEPTH {
        return Err(ConfigurationBoundsError::Depth);
    }

    *nodes = nodes
        .checked_add(1)
        .ok_or(ConfigurationBoundsError::Nodes)?;
    if *nodes > MAX_CONFIGURATION_NODES {
        return Err(ConfigurationBoundsError::Nodes);
    }

    match value {
        Value::String(value) => validate_string(value),
        Value::Array(values) => {
            validate_container_len(values.len())?;
            for value in values {
                validate_value(value, depth + 1, nodes)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            validate_container_len(values.len())?;
            for (key, value) in values {
                validate_string(key)?;
                validate_value(value, depth + 1, nodes)?;
            }
            Ok(())
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
    }
}

fn validate_container_len(len: usize) -> Result<(), ConfigurationBoundsError> {
    if len > MAX_CONFIGURATION_CONTAINER_ITEMS {
        Err(ConfigurationBoundsError::ContainerItems)
    } else {
        Ok(())
    }
}

fn validate_string(value: &str) -> Result<(), ConfigurationBoundsError> {
    if value.len() > MAX_CONFIGURATION_STRING_BYTES {
        Err(ConfigurationBoundsError::StringBytes)
    } else {
        Ok(())
    }
}

struct CappedWriter {
    limit: usize,
    written: usize,
}

impl Write for CappedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let next = self
            .written
            .checked_add(bytes.len())
            .ok_or_else(capacity_error)?;
        if next > self.limit {
            return Err(capacity_error());
        }
        self.written = next;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn capacity_error() -> io::Error {
    io::Error::other("bounded JSON capacity exceeded")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};

    #[test]
    fn settings_accept_exact_string_container_depth_and_node_boundaries() {
        let string = "é".repeat(MAX_CONFIGURATION_STRING_BYTES / 2);
        assert_eq!(string.len(), MAX_CONFIGURATION_STRING_BYTES);
        validate_settings(&json!({ "value": string })).expect("exact string boundary");

        let container = Value::Object(
            (0..MAX_CONFIGURATION_CONTAINER_ITEMS)
                .map(|index| (format!("k{index}"), Value::Null))
                .collect(),
        );
        validate_settings(&container).expect("exact container boundary");

        let mut depth = Value::Null;
        for _ in 1..MAX_CONFIGURATION_DEPTH {
            depth = json!({ "nested": depth });
        }
        validate_settings(&depth).expect("exact depth boundary");

        let nodes = Value::Object(
            (0..MAX_CONFIGURATION_CONTAINER_ITEMS)
                .map(|outer| {
                    let child_count = if outer + 1 == MAX_CONFIGURATION_CONTAINER_ITEMS {
                        14
                    } else {
                        15
                    };
                    (
                        format!("k{outer}"),
                        Value::Array(
                            (0..child_count)
                                .map(|inner| Value::from((outer * 15 + inner) as u64))
                                .collect(),
                        ),
                    )
                })
                .collect(),
        );
        validate_settings(&nodes).expect("bounded node graph");
    }

    #[test]
    fn settings_reject_each_n_plus_one_structural_boundary() {
        assert_eq!(
            validate_settings(&json!({ "value": "x".repeat(MAX_CONFIGURATION_STRING_BYTES + 1) })),
            Err(ConfigurationBoundsError::StringBytes)
        );

        let mut wide = Map::new();
        for index in 0..=MAX_CONFIGURATION_CONTAINER_ITEMS {
            wide.insert(format!("k{index}"), Value::Null);
        }
        assert_eq!(
            validate_settings(&Value::Object(wide)),
            Err(ConfigurationBoundsError::ContainerItems)
        );

        let mut deep = Value::Null;
        for _ in 0..MAX_CONFIGURATION_DEPTH {
            deep = json!({ "nested": deep });
        }
        assert_eq!(
            validate_settings(&deep),
            Err(ConfigurationBoundsError::Depth)
        );

        let many_nodes = Value::Object(
            (0..MAX_CONFIGURATION_CONTAINER_ITEMS)
                .map(|outer| {
                    (
                        format!("k{outer}"),
                        Value::Array((0..16).map(|_| Value::Null).collect()),
                    )
                })
                .collect(),
        );
        assert_eq!(
            validate_settings(&many_nodes),
            Err(ConfigurationBoundsError::Nodes)
        );
    }

    #[test]
    fn settings_reject_non_object_and_serialized_byte_overflow() {
        assert_eq!(
            validate_settings(&Value::Array(Vec::new())),
            Err(ConfigurationBoundsError::RootNotObject)
        );

        let payload = Value::Object(
            (0..17)
                .map(|index| {
                    (
                        format!("k{index}"),
                        Value::String("x".repeat(MAX_CONFIGURATION_STRING_BYTES)),
                    )
                })
                .collect(),
        );
        assert_eq!(
            validate_settings(&payload),
            Err(ConfigurationBoundsError::SerializedBytes)
        );
    }

    #[test]
    fn settings_serialized_byte_limit_accepts_exact_n_and_rejects_n_plus_one() {
        let mut values = vec![Value::String("x".repeat(MAX_CONFIGURATION_STRING_BYTES)); 15];
        values.push(Value::String(String::new()));
        let base = json!({ "payload": values });
        let base_size =
            serialized_size_with_limit(&base, MAX_CONFIGURATION_BYTES).expect("base size");
        let filler_bytes = MAX_CONFIGURATION_BYTES - base_size;
        assert!(filler_bytes <= MAX_CONFIGURATION_STRING_BYTES);

        let mut exact = base;
        exact["payload"][15] = Value::String("x".repeat(filler_bytes));
        assert_eq!(
            serialized_size_with_limit(&exact, MAX_CONFIGURATION_BYTES),
            Ok(MAX_CONFIGURATION_BYTES)
        );
        validate_settings(&exact).expect("exact serialized byte boundary");

        exact["payload"][15] = Value::String("x".repeat(filler_bytes + 1));
        assert_eq!(
            validate_settings(&exact),
            Err(ConfigurationBoundsError::SerializedBytes)
        );
    }
}
