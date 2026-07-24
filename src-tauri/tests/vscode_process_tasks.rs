#[path = "../src/vscode_process_tasks.rs"]
mod vscode_process_tasks;

use vscode_process_tasks::{
    vscode_tasks_config_revision, ProcessTaskGroup, VscodeTaskDiagnosticCode,
    VscodeTasksConfigError, VscodeTasksParser, MAX_VSCODE_TASKS_CONFIG_BYTES,
};

#[test]
fn parses_strict_jsonc_process_tasks_and_exact_bytes_revision() {
    let bytes = br#"{
      // Supported VS Code process task.
      "version": "2.0.0",
      "tasks": [{
        "label": "test",
        "type": "process",
        "command": "node",
        "args": ["--test",],
        "options": {"cwd": "${workspaceFolder}", "env": {"NODE_ENV": "test"},},
        "group": {"kind": "test", "isDefault": true},
        "problemMatcher": ["$tsc"],
      },],
    }"#;
    let parsed = VscodeTasksParser::parse(bytes).expect("valid config");
    assert_eq!(parsed.revision, vscode_tasks_config_revision(bytes));
    assert_eq!(parsed.tasks.len(), 1);
    assert!(parsed.diagnostics.is_empty());
    assert_eq!(parsed.tasks[0].command, "node");
    assert_eq!(parsed.tasks[0].args, ["--test"]);
    assert_eq!(
        parsed.tasks[0].group,
        Some(ProcessTaskGroup::Definition {
            kind: "test".to_string(),
            is_default: true,
        })
    );
    assert_eq!(parsed.tasks[0].options.env["NODE_ENV"], "test");

    let differently_spaced = br#"{"version":"2.0.0","tasks":[]}"#;
    assert_ne!(
        parsed.revision,
        vscode_tasks_config_revision(differently_spaced)
    );
    assert_eq!(
        vscode_tasks_config_revision(bytes),
        vscode_tasks_config_revision(bytes)
    );
    assert_eq!(parsed.revision.len(), 71);
    assert!(parsed.revision.starts_with("sha256:"));
}

#[test]
fn revision_is_sha256_deterministic_and_changes_with_exact_bytes() {
    assert_eq!(
        vscode_tasks_config_revision(b""),
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        vscode_tasks_config_revision(b"a"),
        vscode_tasks_config_revision(b"a")
    );
    assert_ne!(
        vscode_tasks_config_revision(b"a"),
        vscode_tasks_config_revision(b"a ")
    );
}

#[test]
fn rejects_json5_and_invalid_root_contracts() {
    for source in [
        b"{version:'2.0.0',tasks:[]}".as_slice(),
        br#"{"version":"2.0.0","tasks":[],"inputs":[]}"#.as_slice(),
        br#"{"version":"2.0.0"}"#.as_slice(),
        br#"{"version":"2.1.0","tasks":[]}"#.as_slice(),
        b"/* unterminated".as_slice(),
    ] {
        assert!(VscodeTasksParser::parse(source).is_err(), "{source:?}");
    }
}

#[test]
fn reports_unsupported_and_invalid_tasks_without_rejecting_valid_siblings() {
    let source = br#"{
      "version": "2.0.0",
      "tasks": [
        {"label":"ok","type":"process","command":"node"},
        {"label":"shell","type":"shell","command":"npm test"},
        {"label":"depends","type":"process","command":"node","dependsOn":"build","dependsOrder":"parallel"},
        {"label":"custom","type":"process","command":"node","problemMatcher":{"owner":"x"}},
        {"label":"bad","type":"process","command":"node\u0000evil"},
        42
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(source).expect("root remains valid");
    assert_eq!(parsed.tasks.len(), 1);
    assert_eq!(parsed.tasks[0].label, "ok");
    assert_eq!(parsed.diagnostics.len(), 5);
    assert_eq!(
        parsed.diagnostics[0].code,
        VscodeTaskDiagnosticCode::UnsupportedTask
    );
    assert_eq!(
        parsed.diagnostics[1].code,
        VscodeTaskDiagnosticCode::UnsupportedTask
    );
    assert_eq!(
        parsed.diagnostics[2].code,
        VscodeTaskDiagnosticCode::InvalidTask
    );
}

#[test]
fn duplicate_labels_make_every_duplicate_non_executable() {
    let source = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"same","type":"process","command":"one"},
        {"label":"unique","type":"process","command":"ok"},
        {"label":"same","type":"process","command":"two"}
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(source).expect("valid root");
    assert_eq!(
        parsed
            .tasks
            .iter()
            .map(|task| task.label.as_str())
            .collect::<Vec<_>>(),
        ["unique"]
    );
    assert_eq!(parsed.diagnostics.len(), 2);
    assert!(parsed
        .diagnostics
        .iter()
        .all(|diagnostic| diagnostic.code == VscodeTaskDiagnosticCode::DuplicateLabel));
}

#[test]
fn a_valid_task_is_not_executable_when_an_invalid_sibling_reuses_its_label() {
    let source = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"same","type":"process","command":"one"},
        {"label":"same","type":"shell","command":"two"}
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(source).expect("valid root");
    assert!(parsed.tasks.is_empty());
    assert!(parsed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == VscodeTaskDiagnosticCode::DuplicateLabel));
    assert!(parsed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == VscodeTaskDiagnosticCode::UnsupportedTask));
}

#[test]
fn enforces_file_task_and_collection_bounds() {
    let oversized = vec![b' '; MAX_VSCODE_TASKS_CONFIG_BYTES + 1];
    assert!(matches!(
        VscodeTasksParser::parse(&oversized),
        Err(VscodeTasksConfigError::TooLarge { .. })
    ));

    let tasks = (0..129)
        .map(|index| format!(r#"{{"label":"{index}","type":"process","command":"node"}}"#))
        .collect::<Vec<_>>()
        .join(",");
    let source = format!(r#"{{"version":"2.0.0","tasks":[{tasks}]}}"#);
    assert!(matches!(
        VscodeTasksParser::parse(source.as_bytes()),
        Err(VscodeTasksConfigError::InvalidRoot(_))
    ));
}

#[test]
fn enforces_string_array_and_environment_bounds_as_task_diagnostics() {
    let too_many_args = vec!["\"x\""; 129].join(",");
    let too_many_env = (0..129)
        .map(|index| format!(r#""KEY_{index}":"value""#))
        .collect::<Vec<_>>()
        .join(",");
    for task in [
        format!(r#"{{"label":"args","type":"process","command":"node","args":[{too_many_args}]}}"#),
        format!(
            r#"{{"label":"env","type":"process","command":"node","options":{{"env":{{{too_many_env}}}}}}}"#
        ),
        format!(
            r#"{{"label":"long","type":"process","command":"{}"}}"#,
            "x".repeat(4_097)
        ),
        r#"{"label":"control","type":"process","command":"node","args":["bad\u0000arg"]}"#
            .to_string(),
        r#"{"label":"shell-option","type":"process","command":"node","options":{"shell":true}}"#
            .to_string(),
    ] {
        let source = format!(r#"{{"version":"2.0.0","tasks":[{task}]}}"#);
        let parsed = VscodeTasksParser::parse(source.as_bytes()).expect("valid root");
        assert!(parsed.tasks.is_empty(), "{task}");
        assert_eq!(parsed.diagnostics.len(), 1, "{task}");
    }
}

#[test]
fn rejects_all_known_execution_expansion_fields_as_task_diagnostics() {
    for field in [
        r#""shell":{"executable":"bash"}"#,
        r#""dependsOrder":"sequence""#,
        r#""isBackground":true"#,
        r#""windows":{"command":"cmd"}"#,
        r#""linux":{"command":"sh"}"#,
        r#""osx":{"command":"zsh"}"#,
        r#""presentation":{"reveal":"always"}"#,
        r#""runOptions":{"instanceLimit":2}"#,
    ] {
        let source = format!(
            r#"{{"version":"2.0.0","tasks":[{{"label":"x","type":"process","command":"node",{field}}}]}}"#
        );
        let parsed = VscodeTasksParser::parse(source.as_bytes()).expect("valid root");
        assert!(parsed.tasks.is_empty(), "{field}");
        assert_eq!(
            parsed.diagnostics[0].code,
            VscodeTaskDiagnosticCode::UnsupportedTask,
            "{field}"
        );
    }
}

#[test]
fn accepts_only_bounded_explicit_sequential_dependencies() {
    let source = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"lint","type":"process","command":"node"},
        {"label":"test","type":"process","command":"node"},
        {
          "label":"build",
          "type":"process",
          "command":"node",
          "dependsOn":["lint","test"],
          "dependsOrder":"sequence"
        }
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(source).expect("valid dependency graph");
    assert!(parsed.diagnostics.is_empty());
    assert_eq!(parsed.tasks[2].depends_on, ["lint", "test"]);
    assert!(parsed.tasks[0].depends_on.is_empty());

    for dependency_fields in [
        r#""dependsOn":"lint","dependsOrder":"parallel""#,
        r#""dependsOn":["lint"]"#,
        r#""dependsOn":[],"dependsOrder":"sequence""#,
        r#""dependsOn":["lint","lint"],"dependsOrder":"sequence""#,
        r#""dependsOn":42,"dependsOrder":"sequence""#,
    ] {
        let source = format!(
            r#"{{"version":"2.0.0","tasks":[
              {{"label":"lint","type":"process","command":"node"}},
              {{"label":"build","type":"process","command":"node",{dependency_fields}}}
            ]}}"#
        );
        let parsed = VscodeTasksParser::parse(source.as_bytes()).expect("valid root");
        assert_eq!(
            parsed
                .tasks
                .iter()
                .map(|task| task.label.as_str())
                .collect::<Vec<_>>(),
            ["lint"],
            "{dependency_fields}"
        );
    }

    let string_dependency = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"lint","type":"process","command":"node"},
        {"label":"build","type":"process","command":"node","dependsOn":"lint"}
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(string_dependency).expect("valid string dependency");
    assert_eq!(parsed.tasks.len(), 2);
    assert_eq!(parsed.tasks[1].depends_on, ["lint"]);
}

#[test]
fn rejects_ambiguous_dependency_graphs_but_preserves_safe_siblings() {
    let source = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"safe","type":"process","command":"node"},
        {"label":"self","type":"process","command":"node","dependsOn":"self","dependsOrder":"sequence"},
        {"label":"missing","type":"process","command":"node","dependsOn":"absent","dependsOrder":"sequence"},
        {"label":"cycle-a","type":"process","command":"node","dependsOn":"cycle-b","dependsOrder":"sequence"},
        {"label":"cycle-b","type":"process","command":"node","dependsOn":"cycle-a","dependsOrder":"sequence"},
        {"label":"transitive","type":"process","command":"node","dependsOn":"cycle-a","dependsOrder":"sequence"},
        {"label":"duplicate","type":"process","command":"one"},
        {"label":"duplicate","type":"process","command":"two"},
        {"label":"duplicate-user","type":"process","command":"node","dependsOn":"duplicate","dependsOrder":"sequence"}
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(source).expect("valid root");
    assert_eq!(
        parsed
            .tasks
            .iter()
            .map(|task| task.label.as_str())
            .collect::<Vec<_>>(),
        ["safe"]
    );
    assert!(parsed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.message.contains("cycle")));
    assert!(parsed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.label.as_deref() == Some("transitive")));
    assert!(parsed
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.label.as_deref() == Some("duplicate-user")));
}

#[test]
fn enforces_dependency_collection_bound() {
    let dependencies = (0..33)
        .map(|index| format!(r#""dependency-{index}""#))
        .collect::<Vec<_>>()
        .join(",");
    let source = format!(
        r#"{{"version":"2.0.0","tasks":[{{
          "label":"build",
          "type":"process",
          "command":"node",
          "dependsOn":[{dependencies}],
          "dependsOrder":"sequence"
        }}]}}"#
    );
    let parsed = VscodeTasksParser::parse(source.as_bytes()).expect("valid root");
    assert!(parsed.tasks.is_empty());
    assert!(parsed.diagnostics[0].message.contains("limit of 32"));
}

#[test]
fn enforces_total_dependency_edge_bound() {
    let leaves = (0..32)
        .map(|index| format!(r#"{{"label":"leaf-{index}","type":"process","command":"node"}}"#))
        .collect::<Vec<_>>();
    let dependencies = (0..32)
        .map(|index| format!(r#""leaf-{index}""#))
        .collect::<Vec<_>>()
        .join(",");
    let roots = (0..17)
        .map(|index| {
            format!(
                r#"{{"label":"root-{index}","type":"process","command":"node","dependsOn":[{dependencies}],"dependsOrder":"sequence"}}"#
            )
        })
        .collect::<Vec<_>>();
    let tasks = leaves
        .into_iter()
        .chain(roots)
        .collect::<Vec<_>>()
        .join(",");
    let source = format!(r#"{{"version":"2.0.0","tasks":[{tasks}]}}"#);
    assert!(matches!(
        VscodeTasksParser::parse(source.as_bytes()),
        Err(VscodeTasksConfigError::InvalidRoot(message))
            if message.contains("limit of 512 edges")
    ));
}

#[test]
fn produces_a_stable_postorder_plan_and_runs_diamond_dependencies_once() {
    let source = br#"{
      "version":"2.0.0",
      "tasks":[
        {"label":"base","type":"process","command":"node"},
        {"label":"left","type":"process","command":"node","dependsOn":"base"},
        {"label":"right","type":"process","command":"node","dependsOn":"base"},
        {
          "label":"target",
          "type":"process",
          "command":"node",
          "dependsOn":["left","right"],
          "dependsOrder":"sequence"
        }
      ]
    }"#;
    let parsed = VscodeTasksParser::parse(source).expect("valid diamond");
    assert_eq!(
        parsed
            .resolve_sequential_chain("target")
            .expect("target")
            .into_iter()
            .map(|task| task.label.as_str())
            .collect::<Vec<_>>(),
        ["base", "left", "right", "target"]
    );
    assert_eq!(
        parsed.resolve_sequential_chain("missing"),
        Err(vscode_process_tasks::VscodeTaskGraphError::TaskNotFound)
    );
}
