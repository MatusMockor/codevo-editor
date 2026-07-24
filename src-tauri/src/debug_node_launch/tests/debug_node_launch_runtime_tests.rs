use super::*;

#[test]
fn configured_wrapper_is_workspace_local_and_fail_closed() {
    let root = fixture("configured-wrapper");
    let script = root.join("src/server.ts");
    write(&script, "console.log('server');");
    write_executable(&root.join("node_modules/.bin/tsx"), "#!/usr/bin/env node\n");
    let target = |runtime| DebugLaunchTarget::NodeConfiguredRuntimeScript {
        script_path: script.to_string_lossy().to_string(),
        args: vec!["--port".to_string(), "4100".to_string()],
        cwd: None,
        env: HashMap::new(),
        runtime,
        just_my_code: None,
    };
    let plan =
        build_launch_plan(&root, &target(NodeConfiguredScriptRuntime::Tsx)).expect("wrapper plan");
    assert_eq!(
        plan.program,
        NodeLaunchProgram::WorkspaceTool(
            root.join("node_modules/.bin/tsx").canonicalize().unwrap()
        )
    );
    assert_eq!(
        plan.arguments,
        [
            script.to_string_lossy().to_string(),
            "--port".into(),
            "4100".into()
        ]
    );
    assert!(plan.inspect_via_environment);
    assert_eq!(plan.startup_entry, Some(script.clone()));

    let missing = build_launch_plan(&root, &target(NodeConfiguredScriptRuntime::TsNode))
        .expect_err("missing wrapper");
    assert!(missing.contains(
        root.join("node_modules/.bin/ts-node")
            .to_string_lossy()
            .as_ref()
    ));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/bin/sh", root.join("node_modules/.bin/ts-node")).unwrap();
        assert!(
            build_launch_plan(&root, &target(NodeConfiguredScriptRuntime::TsNode))
                .expect_err("escaping wrapper")
                .contains("workspace")
        );
    }
}

#[test]
fn npm_wrapper_remains_a_workspace_tool() {
    let root = fixture("npm-wrapper");
    write(
        &root.join("package.json"),
        r#"{"scripts":{"dev":"tsx src/server.ts --watch"}}"#,
    );
    write(&root.join("src/server.ts"), "console.log('server');");
    write_executable(&root.join("node_modules/.bin/tsx"), "#!/usr/bin/env node\n");
    let plan = build_launch_plan(
        &root,
        &DebugLaunchTarget::NodeNpmScript {
            script: "dev".to_string(),
            package_root_path: root.to_string_lossy().to_string(),
            args: vec!["--port".to_string(), "4100".to_string()],
            cwd: None,
            env: HashMap::new(),
            just_my_code: None,
        },
    )
    .expect("wrapper plan");

    assert_eq!(
        plan.program,
        NodeLaunchProgram::WorkspaceTool(
            root.join("node_modules/.bin/tsx").canonicalize().unwrap()
        )
    );
    assert_eq!(
        plan.arguments,
        [
            root.join("src/server.ts").to_string_lossy().to_string(),
            "--watch".into(),
            "--port".into(),
            "4100".into(),
        ]
    );
    assert!(plan.inspect_via_environment);
}
