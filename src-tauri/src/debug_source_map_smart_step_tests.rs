#[test]
fn smart_step_classification_is_exact_and_only_unmapped_loaded_maps_carry_receipts() {
    let root = fixture("smart-step-classification");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.map");
    write(&generated, "compiled();\nsecond();\n");
    write(&source, "source();\n");
    write(
        &map,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
    );
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let prepared = registry
        .loader()
        .prepare_script(
            "loaded",
            &generated_url,
            &file_url_from_path(&map.to_string_lossy()),
        )
        .expect("prepared");
    registry.commit_script(prepared).expect("commit");
    assert!(matches!(
        registry.classify_generated_for_script("loaded", &generated_url, 0, 0),
        GeneratedSourceMapClassification::Mapped
    ));
    let receipt = match registry.classify_generated_for_script("loaded", &generated_url, 1, 0) {
        GeneratedSourceMapClassification::LoadedButUnmapped(receipt) => receipt,
        _ => panic!("expected exact loaded-but-unmapped classification"),
    };
    assert!(registry.is_current_receipt(&receipt));
    assert!(matches!(
        registry.classify_generated_for_script("foreign", &generated_url, 1, 0),
        GeneratedSourceMapClassification::Unknown
    ));

    registry.mark_plain_script("plain", &generated_url);
    assert!(matches!(
        registry.classify_generated_for_script("plain", &generated_url, 0, 0),
        GeneratedSourceMapClassification::Plain
    ));
    registry.mark_failed_script("failed", &generated_url);
    assert!(matches!(
        registry.classify_generated_for_script("failed", &generated_url, 0, 0),
        GeneratedSourceMapClassification::Failed
    ));

    let pending = registry
        .loader()
        .reserve_script(
            "pending",
            &generated_url,
            &file_url_from_path(&map.to_string_lossy()),
        )
        .expect("pending");
    registry
        .mark_pending(pending.settlement())
        .expect("pending admitted");
    assert!(matches!(
        registry.classify_generated_for_script("pending", &generated_url, 0, 0),
        GeneratedSourceMapClassification::Pending
    ));
}

#[test]
fn pending_receipts_fence_replaced_generations_and_complete_exactly() {
    let root = fixture("pending-generation-receipts");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.map");
    write(&generated, "compiled();\n");
    write(&source, "source();\n");
    write(
        &map,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
    );
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let map_url = file_url_from_path(&map.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let loader = registry.loader();
    let request_a = loader
        .reserve_script("script", &generated_url, &map_url)
        .expect("reserve A");
    let settlement_a = request_a.settlement();
    registry
        .mark_pending(settlement_a.clone())
        .expect("mark A pending");
    assert!(!settlement_a.wait_until(Instant::now()));

    let request_b = loader
        .reserve_script("script", &generated_url, &map_url)
        .expect("reserve B");
    let settlement_b = request_b.settlement();
    registry
        .mark_pending(settlement_b.clone())
        .expect("replace with B");

    assert!(settlement_a.wait_until(Instant::now()));
    assert!(!settlement_b.wait_until(Instant::now()));
    assert!(registry
        .pending_settlement("script", "file:///wrong.js")
        .is_none());
    assert!(registry
        .pending_settlement("foreign-script", &generated_url)
        .is_none());

    let error = registry
        .commit_script(request_a.prepare().expect("prepare stale A"))
        .expect_err("A must not replace pending B");
    assert!(error.contains("replaced pending script"));
    assert!(!settlement_b.wait_until(Instant::now()));

    registry
        .commit_script(request_b.prepare().expect("prepare B"))
        .expect("commit exact pending B");
    assert!(settlement_b.wait_until(Instant::now()));
    assert!(registry
        .pending_settlement("script", &generated_url)
        .is_none());
}
