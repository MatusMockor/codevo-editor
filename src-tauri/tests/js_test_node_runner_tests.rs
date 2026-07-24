#[allow(dead_code)]
#[path = "../src/terminal_task_process.rs"]
mod terminal_task_process;

#[path = "../src/js_test_node_runner.rs"]
mod js_test_node_runner;

use js_test_node_runner::{
    build_node_test_run_plan, discover_node_test_manifest, node_test_launch_readiness,
    probe_node_runtime, run_node_test_plan, NodeTestLaunchReadiness, NodeTestRunStatus,
    NodeTestScope, MAX_PACKAGE_JSON_BYTES,
};
use std::{
    env, fs,
    ops::Deref,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

struct TempDirectory(PathBuf);

impl TempDirectory {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Deref for TempDirectory {
    type Target = Path;

    fn deref(&self) -> &Self::Target {
        self.path()
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let expected_parent = env::temp_dir();
        let safe_name = self
            .0
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("codevo-node-test-"));
        if self.0.parent() == Some(expected_parent.as_path()) && safe_name {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

fn temp_directory(label: &str) -> TempDirectory {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = env::temp_dir().join(format!(
        "codevo-node-test-{label}-{}-{suffix}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("create temp directory");
    TempDirectory(path)
}

fn find_node() -> Option<PathBuf> {
    env::var_os("PATH").and_then(|path| {
        env::split_paths(&path)
            .map(|directory| directory.join(if cfg!(windows) { "node.exe" } else { "node" }))
            .find(|candidate| candidate.is_file())
    })
}

#[test]
fn production_launch_boundary_is_explicitly_fail_closed() {
    assert_eq!(
        node_test_launch_readiness(),
        NodeTestLaunchReadiness::Blocked {
            reason: "Built-in Node test launch needs a retained descriptor-relative workspace/import-graph strategy."
        }
    );
}

#[cfg(unix)]
#[test]
fn version_probe_terminates_a_descendant_that_inherits_its_output_pipes() {
    use std::os::unix::fs::PermissionsExt;

    let root = temp_directory("version-descendant-pipe");
    let executable = root.join("node");
    fs::write(
        &executable,
        "#!/bin/sh\nsleep 60 &\nprintf 'v20.13.1\\n'\nexit 0\n",
    )
    .expect("write fake runtime");
    let mut permissions = fs::metadata(&executable).expect("metadata").permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&executable, permissions).expect("make executable");

    let started = Instant::now();
    let _capability = probe_node_runtime(&executable).expect("bounded version probe");
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "inherited probe pipes must not outlive the leader"
    );
}

#[test]
fn discovers_only_an_explicit_bounded_package_opt_in() {
    let root = temp_directory("discovery");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"unit":"vitest run","test":"node --test","check":"node app.mjs --test"}}"#,
    )
    .expect("write package");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("manifest");
    assert_eq!(manifest.script_names(), ["test"]);

    fs::write(root.join("package.json"), "{").expect("write malformed package");
    assert!(discover_node_test_manifest(&root)
        .expect_err("malformed manifest must fail closed")
        .contains("parse"));

    let oversized = fs::File::create(root.join("package.json")).expect("create package");
    oversized
        .set_len(MAX_PACKAGE_JSON_BYTES + 1)
        .expect("size package");
    assert!(discover_node_test_manifest(&root)
        .expect_err("oversized manifest must fail closed")
        .contains("safety limit"));
}

#[test]
fn plan_confines_files_and_escapes_named_test_patterns() {
    let Some(node) = find_node() else {
        eprintln!("Node runtime is unavailable; skipping runtime-bound plan proof.");
        return;
    };
    let capability = probe_node_runtime(&node).expect("probe supported node");
    let root = temp_directory("plan");
    fs::create_dir(root.join("test")).expect("create test directory");
    fs::write(root.join("test/example.test.mjs"), "").expect("write test");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write package");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("manifest");
    let plan = build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::Test {
            relative_file_path: "test/example.test.mjs".to_string(),
            full_name: "suite [one] / works?".to_string(),
        },
    )
    .expect("build plan");
    assert_eq!(
        plan.args(),
        vec![
            "--test",
            "--test-reporter=tap",
            "--test-reporter-destination=stdout",
            r"--test-name-pattern=^suite \[one\] \/ works\?$",
            "test/example.test.mjs",
        ]
    );
    assert!(build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::File {
            relative_file_path: "../outside.test.mjs".to_string()
        }
    )
    .is_err());
    fs::write(root.join("test/example.test.ts"), "").expect("write TS test");
    assert!(build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::File {
            relative_file_path: "test/example.test.ts".to_string()
        }
    )
    .is_err());
}

#[test]
fn executes_a_real_node_test_with_bounded_tap_output() {
    let Some(node) = find_node() else {
        eprintln!("Node runtime is unavailable; skipping real node:test proof.");
        return;
    };
    let capability = probe_node_runtime(&node).expect("probe supported node");
    let root = temp_directory("real-run");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write package");
    fs::write(
        root.join("example.test.mjs"),
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('works', () => assert.equal(2 + 2, 4));\n",
    )
    .expect("write test");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("explicit opt-in");
    let plan = build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::File {
            relative_file_path: "example.test.mjs".to_string(),
        },
    )
    .expect("build plan");
    let output = run_node_test_plan(
        &plan,
        Duration::from_secs(20),
        Arc::new(AtomicBool::new(false)),
    )
    .expect("run node test");
    assert_eq!(output.status, NodeTestRunStatus::Passed);
    assert_eq!(output.exit_code, Some(0));
    assert!(!output.stdout.truncated);
    assert!(output.stdout.text.contains("works"));
    assert!(output.stdout.text.contains("1..1"));
    assert!(output.stderr.text.is_empty());
}

#[cfg(unix)]
#[test]
fn run_adapter_terminates_a_forked_descendant_holding_output_pipes() {
    use std::os::unix::fs::PermissionsExt;

    let root = temp_directory("run-descendant-pipe");
    let executable = root.join("node");
    fs::write(
        &executable,
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  printf 'v20.13.1\\n'\n  exit 0\nfi\nsleep 60 &\nprintf 'TAP version 13\\n1..0\\n'\nexit 0\n",
    )
    .expect("write fake runtime");
    let mut permissions = fs::metadata(&executable).expect("metadata").permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&executable, permissions).expect("make executable");
    let capability = probe_node_runtime(&executable).expect("probe supported runtime");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write package");
    fs::write(root.join("descendant.test.mjs"), "export {};\n").expect("write test");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("manifest");
    let plan = build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::File {
            relative_file_path: "descendant.test.mjs".to_string(),
        },
    )
    .expect("plan");

    let started = Instant::now();
    let output = run_node_test_plan(
        &plan,
        Duration::from_secs(5),
        Arc::new(AtomicBool::new(false)),
    )
    .expect("run");
    assert_eq!(output.status, NodeTestRunStatus::Passed);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "inherited runner pipes must not outlive the leader"
    );
}

#[test]
fn refuses_a_plan_after_its_manifest_evidence_changes() {
    let Some(node) = find_node() else {
        return;
    };
    let capability = probe_node_runtime(&node).expect("probe supported node");
    let root = temp_directory("manifest-revalidation");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write package");
    fs::write(root.join("example.test.mjs"), "").expect("write test");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("manifest");
    let plan = build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::File {
            relative_file_path: "example.test.mjs".to_string(),
        },
    )
    .expect("plan");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test test/*.test.mjs"}}"#,
    )
    .expect("replace package");
    assert!(run_node_test_plan(
        &plan,
        Duration::from_secs(5),
        Arc::new(AtomicBool::new(false))
    )
    .expect_err("stale evidence must fail closed")
    .contains("manifest changed"));
}

#[test]
fn cancellation_reaps_the_real_node_process_group() {
    let Some(node) = find_node() else {
        return;
    };
    let capability = probe_node_runtime(&node).expect("probe supported node");
    let root = temp_directory("cancel");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write package");
    fs::write(
        root.join("slow.test.mjs"),
        "import test from 'node:test';\ntest('slow', async () => new Promise(resolve => setTimeout(resolve, 60000)));\n",
    )
    .expect("write test");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("manifest");
    let plan = build_node_test_run_plan(
        &root,
        &manifest,
        &capability,
        &NodeTestScope::File {
            relative_file_path: "slow.test.mjs".to_string(),
        },
    )
    .expect("plan");
    let cancellation = Arc::new(AtomicBool::new(false));
    cancellation.store(true, Ordering::Release);
    let output = run_node_test_plan(&plan, Duration::from_secs(5), cancellation).expect("cancel");
    assert_eq!(output.status, NodeTestRunStatus::Cancelled);
}

#[cfg(unix)]
#[test]
fn rejects_a_symlinked_package_manifest() {
    use std::os::unix::fs::symlink;

    let root = temp_directory("manifest-symlink");
    let outside = temp_directory("manifest-outside");
    fs::write(
        outside.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write outside package");
    symlink(outside.join("package.json"), root.join("package.json")).expect("create symlink");
    assert!(discover_node_test_manifest(&root).is_err());
}

#[test]
fn all_scope_does_not_add_an_unproven_file_argument() {
    let Some(node) = find_node() else {
        return;
    };
    let capability = probe_node_runtime(&node).expect("probe supported node");
    let root = temp_directory("all-plan");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"test":"node --test"}}"#,
    )
    .expect("write package");
    let manifest = discover_node_test_manifest(&root)
        .expect("discover")
        .expect("manifest");
    let plan = build_node_test_run_plan(root.path(), &manifest, &capability, &NodeTestScope::All)
        .expect("plan");
    assert_eq!(
        plan.args(),
        vec![
            "--test",
            "--test-reporter=tap",
            "--test-reporter-destination=stdout"
        ]
    );
}
