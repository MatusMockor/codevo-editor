#![allow(dead_code)] // Closed contract for the future native Node watch launch slice.

use serde::{Deserialize, Serialize};

#[path = "debug_node_watch_launch_plan.rs"]
pub(crate) mod launch_plan;

const MAX_SCRIPT_PATH_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum NativeNodeWatchRuntimeSupport {
    Supported,
    BestEffort,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ManagedNodeWatchRuntime {
    kind: ManagedNodeRuntimeKind,
    major: u8,
    support: NativeNodeWatchRuntimeSupport,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ManagedNodeRuntimeKind {
    ManagedNode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeNodeWatchLaunchPolicy {
    kind: NativeNodeWatchLaunchKind,
    runtime: ManagedNodeWatchRuntime,
    script_path: String,
    watch: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_true"
    )]
    preserve_output: Option<bool>,
}

impl NativeNodeWatchLaunchPolicy {
    pub(crate) fn runtime_major(&self) -> u8 {
        self.runtime.major
    }

    pub(crate) fn requests_preserve_output(&self) -> bool {
        self.preserve_output == Some(true)
    }

    pub(crate) fn from_detected_runtime(
        script_path: String,
        major: u8,
        preserve_output: bool,
    ) -> Result<Self, &'static str> {
        let support = support_for_major(major)?;
        Ok(Self {
            kind: NativeNodeWatchLaunchKind::NativeNodeWatch,
            runtime: ManagedNodeWatchRuntime {
                kind: ManagedNodeRuntimeKind::ManagedNode,
                major,
                support,
            },
            script_path,
            watch: true,
            preserve_output: preserve_output.then_some(true),
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test(script_path: String, major: u8) -> Result<Self, &'static str> {
        Self::from_detected_runtime(script_path, major, false)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum NativeNodeWatchLaunchKind {
    NativeNodeWatch,
}

/// Validates the private semantic recipe before internal process mapping.
///
/// The private launch-plan builder maps an accepted value only to the
/// editor-managed Node executable and the fixed argument sequence `--watch`, optional
/// `--watch-preserve-output`, an editor-owned loopback inspector flag, then
/// `script_path`. It must not accept raw runtime arguments, a shell, npm,
/// nodemon or tsx. This policy is intentionally not a `DebugLaunchTarget` and
/// is not registered as a Tauri command.
pub(crate) fn validate_native_node_watch_launch_policy(
    policy: NativeNodeWatchLaunchPolicy,
) -> Result<NativeNodeWatchLaunchPolicy, &'static str> {
    let expected_support = support_for_major(policy.runtime.major)?;
    if policy.runtime.support != expected_support {
        return Err("managed Node runtime support policy does not match its major version");
    }
    if !policy.watch {
        return Err("native Node watch must be enabled");
    }
    if !is_supported_script_path(&policy.script_path) {
        return Err("native Node watch requires a bounded .js, .mjs or .cjs script path");
    }
    Ok(policy)
}

impl NativeNodeWatchLaunchPolicy {
    pub(crate) fn script_path(&self) -> &str {
        &self.script_path
    }
}

fn support_for_major(major: u8) -> Result<NativeNodeWatchRuntimeSupport, &'static str> {
    match major {
        22 | 24 => Ok(NativeNodeWatchRuntimeSupport::Supported),
        26 => Ok(NativeNodeWatchRuntimeSupport::BestEffort),
        _ => Err("unsupported managed Node runtime"),
    }
}

fn is_supported_script_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_SCRIPT_PATH_BYTES
        && !path.contains('\0')
        && [".js", ".mjs", ".cjs"]
            .iter()
            .any(|extension| path.ends_with(extension))
}

fn deserialize_optional_true<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error as _;

    if bool::deserialize(deserializer)? {
        Ok(Some(true))
    } else {
        Err(D::Error::custom("preserveOutput must be true when present"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn parse(value: Value) -> Result<NativeNodeWatchLaunchPolicy, String> {
        let wire = serde_json::from_value(value).map_err(|error| error.to_string())?;
        validate_native_node_watch_launch_policy(wire).map_err(str::to_string)
    }

    fn recipe(major: u8, support: &str) -> Value {
        json!({
            "kind": "native-node-watch",
            "runtime": {
                "kind": "managed-node",
                "major": major,
                "support": support
            },
            "scriptPath": "/workspace/server.mjs",
            "watch": true
        })
    }

    #[test]
    fn wire_round_trip_is_exact_and_preserve_output_is_optional() {
        let mut value = recipe(22, "supported");
        value["preserveOutput"] = json!(true);
        let policy = parse(value.clone()).expect("valid private watch recipe");

        assert_eq!(
            serde_json::to_value(policy).expect("serialize private watch recipe"),
            value
        );
        assert!(parse(recipe(24, "supported")).is_ok());
        assert!(parse(recipe(26, "best-effort")).is_ok());
    }

    #[test]
    fn validator_pins_runtime_major_support_policy() {
        for value in [
            recipe(20, "supported"),
            recipe(23, "supported"),
            recipe(24, "best-effort"),
            recipe(26, "supported"),
        ] {
            assert!(parse(value).is_err());
        }
    }

    #[test]
    fn wire_rejects_raw_launch_escape_hatches_and_unknown_runtime_fields() {
        for (key, value) in [
            ("runtimeArgs", json!(["--watch"])),
            ("shell", json!("/bin/sh")),
            ("npm", json!("dev")),
            ("nodemon", json!(true)),
            ("tsx", json!(true)),
        ] {
            let mut value_with_escape_hatch = recipe(22, "supported");
            value_with_escape_hatch[key] = value;
            assert!(parse(value_with_escape_hatch).is_err(), "{key}");
        }

        let mut runtime_escape_hatch = recipe(22, "supported");
        runtime_escape_hatch["runtime"]["executable"] = json!("/usr/bin/node");
        assert!(parse(runtime_escape_hatch).is_err());
    }

    #[test]
    fn wire_rejects_disabled_flags_and_non_javascript_entrypoints() {
        let mut disabled = recipe(22, "supported");
        disabled["watch"] = json!(false);
        assert!(parse(disabled).is_err());

        let mut false_preserve = recipe(22, "supported");
        false_preserve["preserveOutput"] = json!(false);
        assert!(parse(false_preserve).is_err());

        for script_path in [
            "",
            "/workspace/server.ts",
            "/workspace/server.JS",
            "/workspace/server.js\0ignored",
        ] {
            let mut value = recipe(22, "supported");
            value["scriptPath"] = json!(script_path);
            assert!(parse(value).is_err(), "{script_path:?}");
        }
    }

    #[test]
    fn script_limit_counts_utf8_bytes() {
        let mut accepted = recipe(22, "supported");
        accepted["scriptPath"] = json!(format!("/{}x.js", "💾".repeat(1_022)));
        assert!(parse(accepted).is_ok());

        let mut rejected = recipe(22, "supported");
        rejected["scriptPath"] = json!(format!("/{}x.js", "💾".repeat(1_023)));
        assert!(parse(rejected).is_err());
    }
}
