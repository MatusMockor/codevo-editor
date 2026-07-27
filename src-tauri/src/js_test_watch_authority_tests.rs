use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

fn retained_watch_fixture(label: &str, runner_name: &str) -> (PathBuf, File, JsTestWatchCommand) {
    use std::os::unix::fs::symlink;

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "js-test-watch-authority-{label}-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::SeqCst)
    ));
    let package = root.join("packages/example");
    let runner_package = package.join(format!("node_modules/{runner_name}"));
    let bin = package.join("node_modules/.bin");
    fs::create_dir_all(&runner_package).unwrap();
    fs::create_dir_all(&bin).unwrap();
    fs::write(
        runner_package.join("runner.sh"),
        "#!/bin/sh\nprintf '%s\\n' \"$@\"\n",
    )
    .unwrap();
    symlink(format!("../{runner_name}/runner.sh"), bin.join(runner_name)).unwrap();
    let root_descriptor = File::open(&root).unwrap();
    let command = match runner_name {
        "vitest" => JsTestWatchCommand::VitestWatch {
            package_root_relative_path: "packages/example".to_string(),
            scope: JsTestWatchScope::All,
        },
        "jest" => JsTestWatchCommand::JestWatch {
            package_root_relative_path: "packages/example".to_string(),
            scope: JsTestWatchScope::All,
        },
        _ => unreachable!(),
    };
    (root, root_descriptor, command)
}

#[test]
fn retained_watch_plan_accepts_exact_npm_alias_for_vitest_and_jest() {
    for runner in ["vitest", "jest"] {
        let (root, root_descriptor, command) = retained_watch_fixture("valid-alias", runner);
        let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
        plan.authority.ensure_spawn_identity().unwrap();
        let output = plan
            .authority
            .into_command(plan.args)
            .output()
            .expect("execute retained watch runner");
        assert!(output.status.success(), "{:?}", output.stderr);
        let arguments = String::from_utf8(output.stdout).expect("utf8 runner output");
        let expected = if runner == "vitest" {
            "--watch"
        } else {
            "--watchAll"
        };
        assert_eq!(arguments.lines().collect::<Vec<_>>(), [expected]);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn watch_runner_alias_escape_is_rejected() {
    use std::os::unix::fs::symlink;

    let (root, root_descriptor, command) = retained_watch_fixture("alias-escape", "vitest");
    let outside = root.with_extension("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("runner.sh"), "#!/bin/sh\nexit 0\n").unwrap();
    let alias = root.join("packages/example/node_modules/.bin/vitest");
    fs::remove_file(&alias).unwrap();
    symlink(outside.join("runner.sh"), &alias).unwrap();

    assert!(prepare_watch_plan(&root_descriptor, &command).is_err());
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}

#[test]
fn retained_watch_authority_rejects_alias_leaf_and_parent_replacement() {
    use std::os::unix::fs::symlink;

    let (root, root_descriptor, command) = retained_watch_fixture("path-replacement", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let package = root.join("packages/example");
    let alias = package.join("node_modules/.bin/vitest");
    let runner_parent = package.join("node_modules/vitest");
    fs::write(runner_parent.join("replacement.sh"), "#!/bin/sh\nexit 0\n").unwrap();
    fs::remove_file(&alias).unwrap();
    symlink("../vitest/replacement.sh", &alias).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());

    fs::remove_dir_all(root).unwrap();
    let (root, root_descriptor, command) = retained_watch_fixture("leaf-replacement", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let runner = root.join("packages/example/node_modules/vitest/runner.sh");
    let original_runner = runner.with_extension("original");
    fs::rename(&runner, &original_runner).unwrap();
    fs::write(&runner, "#!/bin/sh\nexit 0\n").unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());

    fs::remove_dir_all(root).unwrap();
    let (root, root_descriptor, command) = retained_watch_fixture("parent-replacement", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let package = root.join("packages/example");
    let alias = package.join("node_modules/.bin/vitest");
    let runner_parent = package.join("node_modules/vitest");
    let original_parent = package.join("node_modules/vitest-original");
    fs::rename(&runner_parent, &original_parent).unwrap();
    fs::create_dir_all(&runner_parent).unwrap();
    fs::write(runner_parent.join("replacement.sh"), "#!/bin/sh\nexit 0\n").unwrap();
    fs::remove_file(&alias).unwrap();
    symlink("../vitest/replacement.sh", &alias).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());

    fs::remove_dir_all(root).unwrap();
    let (root, root_descriptor, command) =
        retained_watch_fixture("intermediate-replacement", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let package = root.join("packages/example");
    let node_modules = package.join("node_modules");
    let original_node_modules = package.join("node_modules-original");
    fs::rename(&node_modules, &original_node_modules).unwrap();
    fs::create_dir_all(node_modules.join("vitest")).unwrap();
    fs::create_dir_all(node_modules.join(".bin")).unwrap();
    fs::write(
        node_modules.join("vitest/replacement.sh"),
        "#!/bin/sh\nexit 0\n",
    )
    .unwrap();
    symlink("../vitest/replacement.sh", node_modules.join(".bin/vitest")).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn retained_watch_authority_rejects_runner_leaf_and_intermediate_a_b_a() {
    let (root, root_descriptor, command) = retained_watch_fixture("runner-leaf-aba", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let runner = root.join("packages/example/node_modules/vitest/runner.sh");
    let original = runner.with_extension("original");
    fs::rename(&runner, &original).unwrap();
    fs::write(&runner, "#!/bin/sh\nexit 0\n").unwrap();
    fs::remove_file(&runner).unwrap();
    fs::rename(&original, &runner).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());
    fs::remove_dir_all(&root).unwrap();

    let (root, root_descriptor, command) =
        retained_watch_fixture("runner-intermediate-aba", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let package = root.join("packages/example");
    let node_modules = package.join("node_modules");
    let original = package.join("node_modules-original");
    fs::rename(&node_modules, &original).unwrap();
    fs::create_dir_all(&node_modules).unwrap();
    fs::remove_dir_all(&node_modules).unwrap();
    fs::rename(&original, &node_modules).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn retained_watch_authority_rejects_root_a_b_a_even_after_original_is_restored() {
    let (root, root_descriptor, command) = retained_watch_fixture("root-aba", "vitest");
    let plan = prepare_watch_plan(&root_descriptor, &command).unwrap();
    let original = root.with_extension("original-a");
    fs::rename(&root, &original).unwrap();
    fs::create_dir_all(&root).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());
    fs::remove_dir_all(&root).unwrap();
    fs::rename(&original, &root).unwrap();
    assert!(plan.authority.ensure_spawn_identity().is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn scoped_native_watch_fails_closed_with_explicit_one_shot_guidance() {
    for runner in ["vitest", "jest"] {
        let (root, root_descriptor, _) = retained_watch_fixture("scoped-fail-closed", runner);
        let marker = root.join("runner-started");
        fs::write(
            root.join(format!("packages/example/node_modules/{runner}/runner.sh")),
            format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
        )
        .unwrap();
        for scope in [
            JsTestWatchScope::File {
                relative_file_path: "packages/example/app.test.js".to_string(),
            },
            JsTestWatchScope::Suite {
                relative_file_path: "packages/example/app.test.js".to_string(),
                full_name: "suite".to_string(),
            },
            JsTestWatchScope::Test {
                relative_file_path: "packages/example/app.test.js".to_string(),
                full_name: "suite test".to_string(),
                name_match: None,
            },
        ] {
            let command = match runner {
                "vitest" => JsTestWatchCommand::VitestWatch {
                    package_root_relative_path: "packages/example".to_string(),
                    scope,
                },
                "jest" => JsTestWatchCommand::JestWatch {
                    package_root_relative_path: "packages/example".to_string(),
                    scope,
                },
                _ => unreachable!(),
            };
            let error = match prepare_watch_plan(&root_descriptor, &command) {
                Ok(_) => panic!("scoped native watch must fail closed"),
                Err(error) => error,
            };
            assert!(error.contains("only the full package"), "{error}");
            assert!(error.contains("one-shot"), "{error}");
            assert!(!marker.exists(), "rejected watch must not start a runner");
        }
        fs::remove_dir_all(root).unwrap();
    }
}
