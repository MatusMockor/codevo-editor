use crate::debug_adapter::{
    DebugBreakpoint, DebugExceptionPauseMode, DebugFunctionBreakpoint, DebugJustMyCodePolicy,
    DebugLaunchTarget, DebugSessionRegistry, DebugStartResponse, NodeConfiguredScriptRuntime,
    NodeDebugRuntimePolicy,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::{Deserialize, Deserializer};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

pub(crate) const MAX_NODE_DEBUG_ENV_FILE_BYTES: usize = 64 * 1024;
const MAX_NODE_DEBUG_ENV_FILE_PATH_BYTES: usize = 4 * 1024;
const NODE_DEBUG_ENV_FILE_READ_ERROR: &str =
    "Unable to read Node debug envFile safely inside the workspace.";

#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum NodeDebugLaunchWire {
    ConfiguredScript(NodeConfiguredScriptLaunchWire),
    SourceMapped(NodeSourceMappedLaunchWire),
    Existing(DebugLaunchTarget),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct NodeConfiguredScriptLaunchWire {
    kind: NodeConfiguredScriptKind,
    script_path: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    env_file: Option<String>,
    just_my_code: Option<DebugJustMyCodePolicy>,
    runtime: Option<NodeConfiguredScriptRuntime>,
    #[serde(default, deserialize_with = "deserialize_optional_bool")]
    source_maps: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_bool")]
    smart_step: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_bool")]
    stop_on_entry: Option<bool>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum NodeSourceMappedLaunchWire {
    #[serde(rename = "node-attach", rename_all = "camelCase")]
    Attach {
        port: u16,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        source_maps: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        smart_step: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        stop_on_entry: Option<bool>,
    },
    #[serde(rename = "node-script", rename_all = "camelCase")]
    Script {
        script_path: String,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        source_maps: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        smart_step: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        stop_on_entry: Option<bool>,
    },
    #[serde(rename = "node-npm-script", rename_all = "camelCase")]
    NpmScript {
        script: String,
        package_root_path: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        just_my_code: Option<DebugJustMyCodePolicy>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        source_maps: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        smart_step: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_bool")]
        stop_on_entry: Option<bool>,
    },
}

pub(crate) fn deserialize_optional_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    bool::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
enum NodeConfiguredScriptKind {
    #[serde(rename = "node-configured-script")]
    NodeConfiguredScript,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn debug_start(
    root_path: String,
    launch: NodeDebugLaunchWire,
    breakpoints: Vec<DebugBreakpoint>,
    function_breakpoints: Vec<DebugFunctionBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: Vec<String>,
    app: AppHandle,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<DebugStartResponse, String> {
    crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(
        exception_type_filter.clone(),
    )?;
    let retained_root =
        crate::debug_session_registry::retain_workspace_root(&workspace_registry, &root_path)?;
    let workspace = retained_root.try_clone_directory()?;
    let (launch, runtime_policy, stop_on_entry) =
        decode_node_launch_with_env_file(&workspace, launch)?;
    crate::debug_commands::debug_start(
        root_path,
        launch,
        breakpoints,
        function_breakpoints,
        exception_pause_mode,
        exception_type_filter,
        runtime_policy,
        stop_on_entry,
        app,
        registry,
        workspace_registry,
        trust,
    )
    .await
}

fn decode_node_launch_with_env_file(
    workspace: &File,
    launch: NodeDebugLaunchWire,
) -> Result<(DebugLaunchTarget, NodeDebugRuntimePolicy, bool), String> {
    let configured = match launch {
        NodeDebugLaunchWire::ConfiguredScript(configured) => configured,
        NodeDebugLaunchWire::SourceMapped(source_mapped) => {
            return decode_source_mapped_launch(source_mapped)
        }
        NodeDebugLaunchWire::Existing(existing) => {
            return Ok((existing, NodeDebugRuntimePolicy::default(), false))
        }
    };
    let NodeConfiguredScriptLaunchWire {
        kind: NodeConfiguredScriptKind::NodeConfiguredScript,
        script_path,
        args,
        cwd,
        env,
        env_file,
        just_my_code,
        runtime,
        source_maps,
        smart_step,
        stop_on_entry,
    } = configured;
    let mut environment = env;
    if let Some(env_file) = env_file {
        if env_file.is_empty() || env_file.len() > MAX_NODE_DEBUG_ENV_FILE_PATH_BYTES {
            return Err(
                "Node debug envFile must be a bounded workspace-relative path.".to_string(),
            );
        }
        let mut merged = load_node_debug_env_file(workspace, &env_file)?;
        merged.extend(environment);
        crate::debug_node_launch::validate_environment(&merged)?;
        environment = merged;
    }
    if let Some(runtime) = runtime {
        return Ok((
            DebugLaunchTarget::NodeConfiguredRuntimeScript {
                script_path,
                args,
                cwd,
                env: environment,
                runtime,
                just_my_code,
            },
            NodeDebugRuntimePolicy {
                source_maps_enabled: source_maps.unwrap_or(true),
                smart_step_enabled: smart_step.unwrap_or(true),
            },
            stop_on_entry.unwrap_or(false),
        ));
    }
    Ok((
        DebugLaunchTarget::NodeConfiguredScript {
            script_path,
            args,
            cwd,
            env: environment,
            just_my_code,
        },
        NodeDebugRuntimePolicy {
            source_maps_enabled: source_maps.unwrap_or(true),
            smart_step_enabled: smart_step.unwrap_or(true),
        },
        stop_on_entry.unwrap_or(false),
    ))
}

fn decode_source_mapped_launch(
    value: NodeSourceMappedLaunchWire,
) -> Result<(DebugLaunchTarget, NodeDebugRuntimePolicy, bool), String> {
    match value {
        NodeSourceMappedLaunchWire::Attach {
            port,
            source_maps,
            smart_step,
            stop_on_entry,
        } => {
            if stop_on_entry == Some(true) {
                return Err("stopOnEntry is not available for Node attach configurations.".into());
            }
            Ok((
                DebugLaunchTarget::NodeAttach { port },
                NodeDebugRuntimePolicy {
                    source_maps_enabled: source_maps.unwrap_or(true),
                    smart_step_enabled: smart_step.unwrap_or(true),
                },
                false,
            ))
        }
        NodeSourceMappedLaunchWire::Script {
            script_path,
            source_maps,
            smart_step,
            stop_on_entry,
        } => Ok((
            DebugLaunchTarget::NodeScript { script_path },
            NodeDebugRuntimePolicy {
                source_maps_enabled: source_maps.unwrap_or(true),
                smart_step_enabled: smart_step.unwrap_or(true),
            },
            stop_on_entry.unwrap_or(false),
        )),
        NodeSourceMappedLaunchWire::NpmScript {
            script,
            package_root_path,
            args,
            cwd,
            env,
            just_my_code,
            source_maps,
            smart_step,
            stop_on_entry,
        } => Ok((
            DebugLaunchTarget::NodeNpmScript {
                script,
                package_root_path,
                args,
                cwd,
                env,
                just_my_code,
            },
            NodeDebugRuntimePolicy {
                source_maps_enabled: source_maps.unwrap_or(true),
                smart_step_enabled: smart_step.unwrap_or(true),
            },
            stop_on_entry.unwrap_or(false),
        )),
    }
}

pub(crate) fn load_node_debug_env_file(
    workspace: &File,
    relative_path: &str,
) -> Result<HashMap<String, String>, String> {
    let mut file =
        crate::workspace_registry::open_file_relative_to(workspace, Path::new(relative_path))
            .map_err(|_| NODE_DEBUG_ENV_FILE_READ_ERROR.to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| NODE_DEBUG_ENV_FILE_READ_ERROR.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_NODE_DEBUG_ENV_FILE_BYTES as u64 {
        return Err(NODE_DEBUG_ENV_FILE_READ_ERROR.to_string());
    }
    let mut bytes = Vec::with_capacity((metadata.len() as usize).min(8 * 1024));
    file.by_ref()
        .take((MAX_NODE_DEBUG_ENV_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| NODE_DEBUG_ENV_FILE_READ_ERROR.to_string())?;
    if bytes.len() > MAX_NODE_DEBUG_ENV_FILE_BYTES {
        return Err(NODE_DEBUG_ENV_FILE_READ_ERROR.to_string());
    }
    let source =
        String::from_utf8(bytes).map_err(|_| "Node debug envFile must be UTF-8.".to_string())?;
    parse_node_debug_env_file(&source)
}

fn parse_node_debug_env_file(source: &str) -> Result<HashMap<String, String>, String> {
    let mut environment = HashMap::new();
    for (index, raw_line) in source.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let assignment = line.strip_prefix("export ").unwrap_or(line);
        let (raw_name, raw_value) = assignment.split_once('=').ok_or_else(|| {
            format!(
                "Node debug envFile line {} must be a KEY=value assignment.",
                index + 1
            )
        })?;
        let name = raw_name.trim();
        if !valid_environment_name(name) {
            return Err(format!(
                "Node debug envFile line {} has an invalid environment name.",
                index + 1
            ));
        }
        let value = dotenv_value(raw_value.trim(), index + 1)?;
        environment.insert(name.to_string(), value);
    }
    Ok(environment)
}

fn dotenv_value(value: &str, line_number: usize) -> Result<String, String> {
    if value.starts_with('\'') || value.ends_with('\'') {
        return matching_quoted_value(value, '\'', line_number);
    }
    if value.starts_with('"') || value.ends_with('"') {
        return matching_quoted_value(value, '"', line_number);
    }
    Ok(value.to_string())
}

fn matching_quoted_value(value: &str, quote: char, line_number: usize) -> Result<String, String> {
    if value.len() < 2 || !value.starts_with(quote) || !value.ends_with(quote) {
        return Err(format!(
            "Node debug envFile line {line_number} has an unterminated quoted value."
        ));
    }
    Ok(value[1..value.len() - 1].to_string())
}

fn valid_environment_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte == b'_' || byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::fs::OpenOptions;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        directory: File,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "editor-node-debug-env-file-{label}-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir_all(root.join("config")).unwrap();
            let directory = OpenOptions::new().read(true).open(&root).unwrap();
            Self { root, directory }
        }

        fn write(&self, relative: &str, source: &[u8]) {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, source).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn loads_supported_dotenv_subset_without_expansion() {
        let fixture = Fixture::new("grammar");
        fixture.write(
            "config/dev.env",
            b"\
# ignored
export API_URL=https://localhost/#literal
PLAIN=value
SINGLE='single value'
DOUBLE=\"double value\"
EMPTY=
REFERENCE=${PLAIN}
",
        );

        let environment = load_node_debug_env_file(&fixture.directory, "config/dev.env").unwrap();

        assert_eq!(
            environment.get("API_URL").unwrap(),
            "https://localhost/#literal"
        );
        assert_eq!(environment.get("PLAIN").unwrap(), "value");
        assert_eq!(environment.get("SINGLE").unwrap(), "single value");
        assert_eq!(environment.get("DOUBLE").unwrap(), "double value");
        assert_eq!(environment.get("EMPTY").unwrap(), "");
        assert_eq!(environment.get("REFERENCE").unwrap(), "${PLAIN}");
    }

    #[test]
    fn rejects_invalid_names_and_multiline_or_unclosed_quotes() {
        for source in [
            b"BAD-NAME=value\n".as_slice(),
            b"1BAD=value\n".as_slice(),
            b"KEY=\"unterminated\n".as_slice(),
            b"KEY='unterminated\n".as_slice(),
        ] {
            let fixture = Fixture::new("invalid");
            fixture.write("config/dev.env", source);
            let error = load_node_debug_env_file(&fixture.directory, "config/dev.env").unwrap_err();
            assert!(error.contains("envFile"));
        }
    }

    #[test]
    fn rejects_missing_escaping_symlinked_and_oversized_files() {
        let fixture = Fixture::new("bounds");
        fixture.write(
            "config/large.env",
            &vec![b'A'; MAX_NODE_DEBUG_ENV_FILE_BYTES + 1],
        );
        let outside = fixture.root.with_extension("outside");
        fs::write(&outside, b"SECRET=outside\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, fixture.root.join("config/link.env")).unwrap();

        let missing =
            load_node_debug_env_file(&fixture.directory, "config/missing.env").unwrap_err();
        assert_eq!(missing, NODE_DEBUG_ENV_FILE_READ_ERROR);
        for relative in ["../outside.env", "/tmp/outside.env", "config/large.env"] {
            assert!(
                load_node_debug_env_file(&fixture.directory, relative).is_err(),
                "{relative}"
            );
        }
        #[cfg(unix)]
        assert!(load_node_debug_env_file(&fixture.directory, "config/link.env").is_err());
        fs::remove_file(outside).unwrap();
    }

    #[test]
    fn env_file_values_merge_before_inline_environment() {
        let fixture = Fixture::new("merge");
        fixture.write("config/dev.env", b"FROM_FILE=file\nOVERRIDE=file\n");
        let launch = serde_json::json!({
            "kind": "node-configured-script",
            "scriptPath": fixture.root.join("server.js").to_string_lossy(),
            "args": [],
            "env": {
                "INLINE": "inline",
                "OVERRIDE": "inline"
            },
            "envFile": "config/dev.env"
        });
        let wire = serde_json::from_value(launch).unwrap();

        let (decoded, runtime_policy, stop_on_entry) =
            decode_node_launch_with_env_file(&fixture.directory, wire).unwrap();

        let environment = match decoded {
            DebugLaunchTarget::NodeConfiguredScript { env, .. } => Some(env),
            _ => None,
        };
        assert!(environment.is_some());
        let environment = environment.unwrap_or_default();
        assert_eq!(environment.get("FROM_FILE").unwrap(), "file");
        assert_eq!(environment.get("INLINE").unwrap(), "inline");
        assert_eq!(environment.get("OVERRIDE").unwrap(), "inline");
        assert!(runtime_policy.source_maps_enabled);
        assert!(runtime_policy.smart_step_enabled);
        assert!(!stop_on_entry);
    }

    #[test]
    fn configured_script_runtime_wire_is_closed_and_typed() {
        let fixture = Fixture::new("runtime-wire");
        for (wire_name, runtime) in [
            ("tsx", NodeConfiguredScriptRuntime::Tsx),
            ("ts-node", NodeConfiguredScriptRuntime::TsNode),
        ] {
            let launch = serde_json::json!({
                "kind": "node-configured-script",
                "scriptPath": fixture.root.join("server.ts").to_string_lossy(),
                "args": [],
                "env": {},
                "runtime": wire_name
            });
            let wire = serde_json::from_value(launch).expect("runtime wire");
            let (decoded, runtime_policy, stop_on_entry) =
                decode_node_launch_with_env_file(&fixture.directory, wire).expect("runtime target");
            assert!(matches!(
                decoded,
                DebugLaunchTarget::NodeConfiguredRuntimeScript {
                    runtime: decoded_runtime,
                    ..
                } if decoded_runtime == runtime
            ));
            assert!(runtime_policy.source_maps_enabled);
            assert!(runtime_policy.smart_step_enabled);
            assert!(!stop_on_entry);
        }

        for launch in [
            serde_json::json!({
                "kind": "node-configured-script",
                "scriptPath": fixture.root.join("server.ts").to_string_lossy(),
                "args": [],
                "env": {},
                "runtime": "nodemon"
            }),
            serde_json::json!({
                "kind": "node-configured-script",
                "scriptPath": fixture.root.join("server.ts").to_string_lossy(),
                "args": [],
                "env": {},
                "runtime": "tsx",
                "runtimeArgs": ["--esm"]
            }),
            serde_json::json!({
                "kind": "node-configured-runtime-script",
                "scriptPath": fixture.root.join("server.ts").to_string_lossy(),
                "args": [],
                "env": {},
                "runtime": "tsx"
            }),
        ] {
            assert!(serde_json::from_value::<NodeDebugLaunchWire>(launch).is_err());
        }
    }

    #[test]
    fn source_maps_wire_defaults_enabled_preserves_false_and_rejects_non_boolean_values() {
        let fixture = Fixture::new("source-maps-wire");
        for (source_maps, expected) in [
            (serde_json::Value::Null, true),
            (serde_json::json!(true), true),
            (serde_json::json!(false), false),
        ] {
            let mut launch = serde_json::json!({
                "kind": "node-script",
                "scriptPath": fixture.root.join("server.js").to_string_lossy()
            });
            if !source_maps.is_null() {
                launch["sourceMaps"] = source_maps;
            }
            let wire = serde_json::from_value(launch).expect("source maps wire");
            let (_, runtime_policy, _) =
                decode_node_launch_with_env_file(&fixture.directory, wire).expect("launch");
            assert_eq!(runtime_policy.source_maps_enabled, expected);
            assert!(runtime_policy.smart_step_enabled);
        }

        let invalid = serde_json::json!({
            "kind": "node-attach",
            "port": 9229,
            "sourceMaps": "false"
        });
        assert!(serde_json::from_value::<NodeDebugLaunchWire>(invalid).is_err());
        let null = serde_json::json!({
            "kind": "node-script",
            "scriptPath": fixture.root.join("server.js").to_string_lossy(),
            "sourceMaps": null
        });
        assert!(serde_json::from_value::<NodeDebugLaunchWire>(null).is_err());
    }

    #[test]
    fn smart_step_wire_defaults_enabled_and_preserves_exact_boolean_policy() {
        let fixture = Fixture::new("smart-step-wire");
        for (smart_step, expected) in [
            (serde_json::Value::Null, true),
            (serde_json::json!(true), true),
            (serde_json::json!(false), false),
        ] {
            let mut launch = serde_json::json!({
                "kind": "node-script",
                "scriptPath": fixture.root.join("server.js").to_string_lossy()
            });
            if !smart_step.is_null() {
                launch["smartStep"] = smart_step;
            }
            let wire = serde_json::from_value(launch).expect("smart-step wire");
            let (_, runtime_policy, _) =
                decode_node_launch_with_env_file(&fixture.directory, wire).expect("launch");
            assert!(runtime_policy.source_maps_enabled);
            assert_eq!(runtime_policy.smart_step_enabled, expected);
        }
        for invalid in [
            serde_json::json!("false"),
            serde_json::json!(null),
            serde_json::json!(1),
        ] {
            assert!(
                serde_json::from_value::<NodeDebugLaunchWire>(serde_json::json!({
                    "kind": "node-attach",
                    "port": 9229,
                    "smartStep": invalid
                }))
                .is_err()
            );
        }
    }

    #[test]
    fn stop_on_entry_wire_defaults_disabled_preserves_boolean_and_rejects_invalid_values() {
        let fixture = Fixture::new("stop-on-entry-wire");
        for (kind, extra) in [
            ("node-script", serde_json::json!({})),
            (
                "node-configured-script",
                serde_json::json!({"args": [], "env": {}, "runtime": "tsx"}),
            ),
            (
                "node-npm-script",
                serde_json::json!({
                    "script": "dev",
                    "packageRootPath": fixture.root.to_string_lossy(),
                    "args": [],
                    "env": {}
                }),
            ),
        ] {
            for (stop_on_entry, expected) in [
                (None, false),
                (Some(serde_json::json!(false)), false),
                (Some(serde_json::json!(true)), true),
            ] {
                let mut launch = if kind == "node-npm-script" {
                    serde_json::json!({"kind": kind})
                } else {
                    serde_json::json!({
                        "kind": kind,
                        "scriptPath": fixture.root.join("server.ts").to_string_lossy()
                    })
                };
                launch
                    .as_object_mut()
                    .expect("launch object")
                    .extend(extra.as_object().expect("extra object").clone());
                if let Some(value) = stop_on_entry {
                    launch["stopOnEntry"] = value;
                }
                let wire = serde_json::from_value(launch).expect("stopOnEntry wire");
                let (_, _, decoded) =
                    decode_node_launch_with_env_file(&fixture.directory, wire).expect("launch");
                assert_eq!(decoded, expected);
            }
        }

        for invalid in [serde_json::Value::Null, serde_json::json!("true")] {
            let launch = serde_json::json!({
                "kind": "node-script",
                "scriptPath": fixture.root.join("server.js").to_string_lossy(),
                "stopOnEntry": invalid
            });
            assert!(serde_json::from_value::<NodeDebugLaunchWire>(launch).is_err());
        }
    }

    #[test]
    fn attach_rejects_enabled_stop_on_entry() {
        let fixture = Fixture::new("attach-stop-on-entry");
        for stop_on_entry in [None, Some(false)] {
            let mut launch = serde_json::json!({"kind": "node-attach", "port": 9229});
            if let Some(value) = stop_on_entry {
                launch["stopOnEntry"] = serde_json::json!(value);
            }
            let wire = serde_json::from_value(launch).expect("attach wire");
            let (_, _, decoded) =
                decode_node_launch_with_env_file(&fixture.directory, wire).expect("attach");
            assert!(!decoded);
        }

        let wire = serde_json::from_value(serde_json::json!({
            "kind": "node-attach",
            "port": 9229,
            "stopOnEntry": true
        }))
        .expect("typed attach wire");
        let error = decode_node_launch_with_env_file(&fixture.directory, wire).unwrap_err();
        assert_eq!(
            error,
            "stopOnEntry is not available for Node attach configurations."
        );
    }

    #[test]
    fn non_script_env_file_is_rejected_and_merged_values_are_revalidated() {
        let fixture = Fixture::new("revalidation");
        fixture.write("config/dev.env", b"PATH=/unsafe\n");
        let npm = serde_json::json!({
            "kind": "node-npm-script",
            "script": "dev",
            "packageRootPath": fixture.root.to_string_lossy(),
            "args": [],
            "env": {},
            "envFile": "config/dev.env"
        });
        let script = serde_json::json!({
            "kind": "node-configured-script",
            "scriptPath": fixture.root.join("server.js").to_string_lossy(),
            "args": [],
            "env": {},
            "envFile": "config/dev.env"
        });

        assert!(serde_json::from_value::<NodeDebugLaunchWire>(npm).is_err());
        let wire = serde_json::from_value(script).unwrap();
        let error = decode_node_launch_with_env_file(&fixture.directory, wire).unwrap_err();
        assert_eq!(
            error,
            "Configured debug environment exceeds the safe bounds."
        );
    }
}
