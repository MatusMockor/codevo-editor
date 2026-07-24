use super::{validate_native_node_watch_launch_policy, NativeNodeWatchLaunchPolicy};
use crate::debug_node_launch::{NodeLaunchPlan, NodeLaunchProgram, INSPECT_FLAG};
use crate::debug_support::validate_workspace_file;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const WATCH_FLAG: &str = "--watch";
const WATCH_PRESERVE_OUTPUT_FLAG: &str = "--watch-preserve-output";

/// Maps an already closed native-watch policy to the one backend-owned Node
/// command shape. Runtime support classification remains validation metadata;
/// it cannot influence or extend the command.
pub(crate) fn build_native_node_watch_launch_plan(
    root: &Path,
    policy: NativeNodeWatchLaunchPolicy,
) -> Result<NodeLaunchPlan, String> {
    let policy = validate_native_node_watch_launch_policy(policy).map_err(str::to_string)?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the workspace root: {error}"))?;
    if !root.is_dir() {
        return Err("Native Node watch requires a workspace directory.".to_string());
    }
    let script = validate_workspace_file(&root, &policy.script_path)?;
    let script_path = PathBuf::from(&script);
    if !is_supported_canonical_script(&script_path) {
        return Err("Native Node watch requires a canonical .js, .mjs or .cjs script.".to_string());
    }

    let mut arguments = Vec::with_capacity(if policy.preserve_output.is_some() {
        4
    } else {
        3
    });
    arguments.push(WATCH_FLAG.to_string());
    if policy.preserve_output == Some(true) {
        arguments.push(WATCH_PRESERVE_OUTPUT_FLAG.to_string());
    }
    arguments.push(INSPECT_FLAG.to_string());
    arguments.push(script);

    Ok(NodeLaunchPlan {
        program: NodeLaunchProgram::Node,
        arguments,
        working_directory: root,
        environment: HashMap::new(),
        isolated_environment: false,
        inspect_via_environment: false,
        startup_entry: None,
    })
}

fn is_supported_canonical_script(script: &Path) -> bool {
    script
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension, "js" | "mjs" | "cjs"))
}

#[cfg(test)]
mod tests {
    use super::super::{
        ManagedNodeRuntimeKind, ManagedNodeWatchRuntime, NativeNodeWatchLaunchKind,
        NativeNodeWatchRuntimeSupport,
    };
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        root: PathBuf,
        script: PathBuf,
    }

    impl Fixture {
        fn new(extension: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "codevo-native-watch-plan-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(root.join("src")).expect("create fixture");
            let root = root.canonicalize().expect("canonical root");
            let script = root.join("src").join(format!("server.{extension}"));
            fs::write(&script, "setInterval(() => {}, 1000);\n").expect("write script");
            Self { root, script }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn policy(
        script_path: String,
        major: u8,
        support: NativeNodeWatchRuntimeSupport,
        preserve_output: bool,
    ) -> NativeNodeWatchLaunchPolicy {
        NativeNodeWatchLaunchPolicy {
            kind: NativeNodeWatchLaunchKind::NativeNodeWatch,
            runtime: ManagedNodeWatchRuntime {
                kind: ManagedNodeRuntimeKind::ManagedNode,
                major,
                support,
            },
            script_path,
            watch: true,
            preserve_output: preserve_output.then_some(true),
        }
    }

    #[test]
    fn exact_backend_owned_plan_has_no_user_arguments_environment_or_tool_escape_hatches() {
        let fixture = Fixture::new("mjs");
        let plan = build_native_node_watch_launch_plan(
            &fixture.root,
            policy(
                "src/server.mjs".into(),
                22,
                NativeNodeWatchRuntimeSupport::Supported,
                false,
            ),
        )
        .expect("strict watch plan");

        assert_eq!(plan.program, NodeLaunchProgram::Node);
        assert_eq!(
            plan.arguments,
            [
                WATCH_FLAG,
                INSPECT_FLAG,
                fixture.script.to_string_lossy().as_ref()
            ]
        );
        assert_eq!(plan.working_directory, fixture.root);
        assert!(plan.environment.is_empty());
        assert!(!plan.isolated_environment);
        assert!(!plan.inspect_via_environment);
        assert_eq!(plan.startup_entry, None);
    }

    #[test]
    fn preserve_output_maps_only_to_the_exact_safe_node_flag() {
        let fixture = Fixture::new("cjs");
        let plan = build_native_node_watch_launch_plan(
            &fixture.root,
            policy(
                fixture.script.to_string_lossy().into_owned(),
                24,
                NativeNodeWatchRuntimeSupport::Supported,
                true,
            ),
        )
        .expect("preserve-output plan");

        assert_eq!(
            plan.arguments,
            [
                WATCH_FLAG,
                WATCH_PRESERVE_OUTPUT_FLAG,
                INSPECT_FLAG,
                fixture.script.to_string_lossy().as_ref()
            ]
        );
    }

    #[test]
    fn supported_and_best_effort_versions_never_change_command_construction() {
        let fixture = Fixture::new("js");
        let script = fixture.script.to_string_lossy().into_owned();
        let plans = [
            (22, NativeNodeWatchRuntimeSupport::Supported),
            (24, NativeNodeWatchRuntimeSupport::Supported),
            (26, NativeNodeWatchRuntimeSupport::BestEffort),
        ]
        .map(|(major, support)| {
            build_native_node_watch_launch_plan(
                &fixture.root,
                policy(script.clone(), major, support, false),
            )
            .expect("version policy")
            .arguments
        });

        assert_eq!(plans[0], plans[1]);
        assert_eq!(plans[1], plans[2]);
    }

    #[test]
    fn canonical_workspace_boundary_rejects_missing_directories_and_symlink_escapes() {
        let fixture = Fixture::new("js");
        assert!(build_native_node_watch_launch_plan(
            &fixture.root,
            policy(
                "src/missing.js".into(),
                22,
                NativeNodeWatchRuntimeSupport::Supported,
                false,
            ),
        )
        .is_err());
        assert!(build_native_node_watch_launch_plan(
            &fixture.script,
            policy(
                fixture.script.to_string_lossy().into_owned(),
                22,
                NativeNodeWatchRuntimeSupport::Supported,
                false,
            ),
        )
        .is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outside = Fixture::new("js");
            let link = fixture.root.join("src").join("outside.js");
            symlink(&outside.script, &link).expect("outside symlink");
            assert!(build_native_node_watch_launch_plan(
                &fixture.root,
                policy(
                    link.to_string_lossy().into_owned(),
                    22,
                    NativeNodeWatchRuntimeSupport::Supported,
                    false,
                ),
            )
            .is_err());
        }
    }
}
