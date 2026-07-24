use super::*;

#[test]
fn disabled_source_maps_launch_emitted_typescript_without_map_runtime_flag() {
    let root = fixture("script-without-source-map");
    let source = root.join("src/index.ts");
    let generated = root.join("dist/index.js");
    write(&source, "const value: number = 1;");
    write(&generated, "const value = 1;");
    write(
        &root.join("tsconfig.json"),
        r#"{"compilerOptions":{"rootDir":"src","outDir":"dist"}}"#,
    );
    let plan = build_launch_plan_with_source_maps(
        &root,
        &DebugLaunchTarget::NodeConfiguredScript {
            script_path: source.to_string_lossy().into_owned(),
            args: Vec::new(),
            cwd: None,
            env: HashMap::new(),
            just_my_code: None,
        },
        false,
    )
    .expect("map-less launch plan");
    assert_eq!(
        plan.arguments,
        vec![INSPECT_FLAG, generated.to_str().unwrap()]
    );
    assert!(!plan
        .arguments
        .iter()
        .any(|argument| argument == "--enable-source-maps"));
}
