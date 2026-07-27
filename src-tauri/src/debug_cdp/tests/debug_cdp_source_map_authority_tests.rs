use super::*;
use crate::debug_cdp::transport::{
    complete_breakpoint_resolution, generated_script_identity, prepare_breakpoint_resolution,
    GeneratedScriptIdentity,
};

#[test]
fn immediate_and_async_breakpoint_resolutions_report_typescript_line() {
    let root = temp_root("typescript-breakpoint-resolution");
    let source = root.join("src/index.ts");
    let emitted = root.join("dist/index.js");
    let map = root.join("dist/index.js.map");
    write_file(&source, "const first = 1;\nconst second = 2;\n");
    write_file(&emitted, "const first = 1;\nconst second = 2;\n");
    write_file(
        &map,
        r#"{"version":3,"file":"index.js","sources":["../src/index.ts"],"names":[],"mappings":"AAAA;AACA"}"#,
    );
    let source_path = source.to_string_lossy().to_string();
    let generated_url = file_url_from_path(&emitted.to_string_lossy());
    let mut source_maps = SourceMapRegistry::new(&root).expect("registry");
    source_maps
        .register_script(&generated_url, &file_url_from_path(&map.to_string_lossy()))
        .expect("source map");
    let mut state = CdpShared::new(Some(source_maps));
    let target = BreakpointResolutionTarget {
        breakpoint_id: "source-bp".to_string(),
        column_number: None,
        file_path: source_path.clone(),
        generated_url: generated_url.clone(),
        source_path: source_path.clone(),
    };
    let generated = GeneratedPosition {
        line: 1,
        column: 0,
        script_identity: GeneratedScriptIdentity::Absent,
    };

    assert_eq!(original_breakpoint_line(&state, &target, &generated), 2);

    state.breakpoints_by_file.insert(
        source_path.clone(),
        vec![breakpoint(&source_path, "source-bp", 2, None, true)],
    );
    state.resolution_index.insert("cdp-bp".to_string(), target);
    let (_, resolved) =
        apply_breakpoint_resolution(&mut state, "cdp-bp", generated).expect("async resolution");
    assert!(resolved[0].verified);
    assert_eq!(resolved[0].line_number, 2);
}

#[test]
fn immediate_and_async_breakpoint_resolution_use_exact_same_url_script_identity() {
    let root = temp_root("typescript-breakpoint-script-identity");
    let source = root.join("src/index.ts");
    let emitted = root.join("dist/index.js");
    let map_a = root.join("dist/a.map");
    let map_b = root.join("dist/b.map");
    write_file(&source, "first();\nsecond();\nthird();\n");
    write_file(&emitted, "compiled();\n");
    write_file(
        &map_a,
        r#"{"version":3,"file":"index.js","sources":["../src/index.ts"],"names":[],"mappings":"AAAA"}"#,
    );
    write_file(
        &map_b,
        r#"{"version":3,"file":"index.js","sources":["../src/index.ts"],"names":[],"mappings":"AAEA"}"#,
    );
    let source_path = source.to_string_lossy().to_string();
    let generated_url = file_url_from_path(&emitted.to_string_lossy());
    let mut source_maps = SourceMapRegistry::new(&root).expect("registry");
    let loader = source_maps.loader();
    for (script_id, map) in [("A", &map_a), ("B", &map_b)] {
        source_maps
            .commit_script(
                loader
                    .prepare_script(
                        script_id,
                        &generated_url,
                        &file_url_from_path(&map.to_string_lossy()),
                    )
                    .expect("prepare exact map"),
            )
            .expect("commit exact map");
    }
    let mut state = CdpShared::new(Some(source_maps));
    let target = BreakpointResolutionTarget {
        breakpoint_id: "source-bp".to_string(),
        column_number: None,
        file_path: source_path.clone(),
        generated_url: generated_url.clone(),
        source_path: source_path.clone(),
    };
    let exact_a = GeneratedPosition {
        line: 0,
        column: 0,
        script_identity: GeneratedScriptIdentity::Exact("A".to_string()),
    };
    assert_eq!(original_breakpoint_line(&state, &target, &exact_a), 1);
    assert_eq!(
        original_breakpoint_line(
            &state,
            &target,
            &GeneratedPosition {
                line: 0,
                column: 0,
                script_identity: GeneratedScriptIdentity::Exact("unknown".to_string()),
            },
        ),
        1
    );
    assert_eq!(
        original_breakpoint_line(
            &state,
            &target,
            &GeneratedPosition {
                line: 0,
                column: 0,
                script_identity: GeneratedScriptIdentity::Invalid,
            },
        ),
        1,
        "a present invalid script identity must use generated fallback"
    );

    state.breakpoints_by_file.insert(
        source_path.clone(),
        vec![breakpoint(&source_path, "source-bp", 1, None, true)],
    );
    state.resolution_index.insert("cdp-bp".to_string(), target);
    let (_, resolved) =
        apply_breakpoint_resolution(&mut state, "cdp-bp", exact_a).expect("async exact resolution");
    assert!(resolved[0].verified);
    assert_eq!(resolved[0].line_number, 1);
}

#[test]
fn breakpoint_script_identity_parser_distinguishes_absent_exact_and_invalid() {
    assert_eq!(
        generated_script_identity(None),
        GeneratedScriptIdentity::Absent
    );
    assert_eq!(
        generated_script_identity(Some(&json!("script-A"))),
        GeneratedScriptIdentity::Exact("script-A".to_string())
    );
    for invalid in [
        json!(""),
        json!("bad\nidentity"),
        json!("x".repeat(4 * 1024 + 1)),
        json!(42),
    ] {
        assert_eq!(
            generated_script_identity(Some(&invalid)),
            GeneratedScriptIdentity::Invalid
        );
    }
}

#[test]
fn breakpoint_resolution_two_phase_commit_rejects_a_replaced_receipt() {
    let mut state = CdpShared::new(None);
    let file_path = "/workspace/app.ts".to_string();
    state.breakpoints_by_file.insert(
        file_path.clone(),
        vec![breakpoint(&file_path, "logical", 1, None, false)],
    );
    state.resolution_index.insert(
        "cdp".to_string(),
        BreakpointResolutionTarget {
            breakpoint_id: "logical".to_string(),
            column_number: None,
            file_path: file_path.clone(),
            generated_url: "file:///workspace/app.js".to_string(),
            source_path: file_path.clone(),
        },
    );
    let prepared = prepare_breakpoint_resolution(
        &mut state,
        "cdp",
        GeneratedPosition {
            line: 4,
            column: 0,
            script_identity: GeneratedScriptIdentity::Absent,
        },
    )
    .expect("prepared receipt");
    state.resolution_index.insert(
        "cdp".to_string(),
        BreakpointResolutionTarget {
            breakpoint_id: "replacement".to_string(),
            column_number: None,
            file_path: file_path.clone(),
            generated_url: "file:///workspace/replacement.js".to_string(),
            source_path: file_path.clone(),
        },
    );

    assert!(complete_breakpoint_resolution(&mut state, prepared.resolve()).is_none());
    assert!(!state.breakpoints_by_file[&file_path][0].verified);
}

#[test]
fn breakpoint_resolution_two_phase_commit_rejects_replaced_map_generation() {
    let root = temp_root("breakpoint-map-generation-receipt");
    let source = root.join("src/app.ts");
    let generated = root.join("dist/app.js");
    let map_a = root.join("dist/a.map");
    let map_b = root.join("dist/b.map");
    write_file(&source, "first();\nsecond();\nthird();\n");
    write_file(&generated, "compiled();\n");
    write_file(
        &map_a,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
    );
    write_file(
        &map_b,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAEA"}"#,
    );
    let source_path = source.to_string_lossy().to_string();
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let map_b_url = file_url_from_path(&map_b.to_string_lossy());
    let mut source_maps = SourceMapRegistry::new(&root).expect("registry");
    let loader = source_maps.loader();
    source_maps
        .commit_script(
            loader
                .prepare_script(
                    "script",
                    &generated_url,
                    &file_url_from_path(&map_a.to_string_lossy()),
                )
                .expect("map A"),
        )
        .expect("commit A");
    let replacement = loader
        .reserve_script("script", &generated_url, &map_b_url)
        .expect("reserve B");
    let replacement_settlement = replacement.settlement();
    let mut state = CdpShared::new(Some(source_maps));
    state.breakpoints_by_file.insert(
        source_path.clone(),
        vec![breakpoint(&source_path, "logical", 1, None, false)],
    );
    state.resolution_index.insert(
        "cdp".to_string(),
        BreakpointResolutionTarget {
            breakpoint_id: "logical".to_string(),
            column_number: None,
            file_path: source_path.clone(),
            generated_url: generated_url.clone(),
            source_path: source_path.clone(),
        },
    );
    let prepared = prepare_breakpoint_resolution(
        &mut state,
        "cdp",
        GeneratedPosition {
            line: 0,
            column: 0,
            script_identity: GeneratedScriptIdentity::Exact("script".to_string()),
        },
    )
    .expect("prepared generation A");
    state
        .source_maps
        .as_mut()
        .expect("source maps")
        .mark_pending(replacement_settlement)
        .expect("generation B pending");

    assert!(complete_breakpoint_resolution(&mut state, prepared.resolve()).is_none());
    assert!(!state.breakpoints_by_file[&source_path][0].verified);
}
