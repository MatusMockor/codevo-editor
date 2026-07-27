#[test]
fn forward_lookup_never_leaks_a_mapping_across_an_unmapped_generated_line() {
    let root = fixture("exact-generated-line");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.js.map");
    write(&generated, "mapped();\nhelper();\nmappedAgain();\n");
    write(&source, "first();\nsecond();\n");
    write(
        &map,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA;;AACA"}"#,
    );
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let prepared = registry
        .loader()
        .prepare_script(
            "script",
            &generated_url,
            &file_url_from_path(&map.to_string_lossy()),
        )
        .expect("prepare");
    registry.commit_script(prepared).expect("commit");

    assert!(registry
        .map_generated_for_script("script", &generated_url, 1, 0)
        .is_none());
    assert_eq!(
        registry
            .map_generated_for_script("script", &generated_url, 2, 0)
            .expect("third generated line")
            .line_number,
        2
    );
}
