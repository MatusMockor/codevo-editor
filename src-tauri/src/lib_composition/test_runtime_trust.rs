#[test]
fn parse_php_file_outline_extracts_symbols_off_thread() {
    let outline = tauri::async_runtime::block_on(parse_php_file_outline(
        "/workspace/src/User.php".to_string(),
        "<?php\n\nnamespace App;\n\nclass User\n{\n    public function name() {}\n}\n".to_string(),
    ))
    .expect("outline result");

    let class = outline
        .nodes
        .iter()
        .find(|node| node.label == "User")
        .expect("class node");
    assert_eq!(class.kind, PhpFileOutlineNodeKind::Class);
    assert!(
        class.children.iter().any(|child| child.label == "name"),
        "expected method node under the class"
    );
}

#[test]
fn untrusted_workspace_blocks_eslint_analysis() {
    let root = temp_workspace("eslint-untrusted");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let response = tauri::async_runtime::block_on(run_eslint_analysis_with_trust(
        path_string(&root),
        None,
        &trust,
        Arc::new(crate::eslint::EslintProcessRegistry::default()),
    ))
    .expect("eslint response");

    assert_eq!(
        response,
        EslintAnalysisResponse::Unavailable {
            message: Some("Trust this workspace to run ESLint.".to_string()),
        }
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn untrusted_workspace_blocks_javascript_typescript_language_server_start_plan() {
    let root = temp_workspace("typescript-language-server-untrusted");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let plan = build_javascript_typescript_language_server_plan(
        &trust,
        &JavaScriptTypeScriptLanguageServerOptions {
            root_path: path_string(&root),
            type_script_version_preference: Some("workspace".to_string()),
            ..Default::default()
        },
    )
    .expect("language server plan");

    assert!(matches!(
        plan.status,
        crate::lsp::LanguageServerPlanStatus::Blocked
    ));
    assert_eq!(
        plan.message,
        "Trust this workspace to enable the TypeScript language server."
    );
    assert!(plan.command.is_none());
    assert!(plan.initialize_request.is_none());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn trusted_workspace_keeps_javascript_typescript_language_server_start_plan_ready() {
    let root = temp_workspace("typescript-language-server-trusted");
    let language_server = root
        .join("node_modules")
        .join(".bin")
        .join("typescript-language-server");
    let typescript_server = root
        .join("node_modules")
        .join("typescript")
        .join("lib")
        .join("tsserver.js");
    fs::create_dir_all(language_server.parent().expect("language server directory"))
        .expect("create language server directory");
    fs::create_dir_all(
        typescript_server
            .parent()
            .expect("TypeScript server directory"),
    )
    .expect("create TypeScript server directory");
    fs::write(&language_server, "#!/bin/sh\n").expect("write language server");
    fs::write(&typescript_server, "").expect("write TypeScript server");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(&language_server)
            .expect("language server metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&language_server, permissions)
            .expect("make language server executable");
    }

    let mut service =
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service");
    service
        .set(&path_string(&root), true)
        .expect("trust workspace");
    let trust = Mutex::new(service);

    let plan = build_javascript_typescript_language_server_plan(
        &trust,
        &JavaScriptTypeScriptLanguageServerOptions {
            root_path: path_string(&root),
            type_script_version_preference: Some("workspace".to_string()),
            ..Default::default()
        },
    )
    .expect("language server plan");

    assert!(matches!(
        plan.status,
        crate::lsp::LanguageServerPlanStatus::Ready
    ));
    let command = plan.command.expect("language server command");
    assert!(command.executable.ends_with("node"));
    assert_eq!(command.args[1], "--stdio");
    assert!(command.args[0].ends_with("node_modules/typescript-language-server/lib/cli.mjs"));
    let request = plan.initialize_request.expect("initialize request");
    let preferences = &request.params["initializationOptions"]["preferences"];
    assert_eq!(preferences["includeCompletionsForImportStatements"], true);
    assert_eq!(preferences["includeCompletionsForModuleExports"], true);
    assert_eq!(preferences["includePackageJsonAutoImports"], "auto");
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn trusted_workspace_dispatches_eslint_analysis() {
    let root = temp_workspace("eslint-trusted");
    let mut service =
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service");
    service
        .set(&path_string(&root), true)
        .expect("trust workspace");
    let trust = Mutex::new(service);

    let response = tauri::async_runtime::block_on(run_eslint_analysis_with_trust(
        path_string(&root),
        None,
        &trust,
        Arc::new(crate::eslint::EslintProcessRegistry::default()),
    ))
    .expect("eslint response");

    assert_eq!(
        response,
        EslintAnalysisResponse::Unavailable { message: None }
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn untrusted_workspace_blocks_phpstan_analysis() {
    let root = temp_workspace("phpstan-untrusted");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let response = tauri::async_runtime::block_on(run_phpstan_analysis_with_trust(
        path_string(&root),
        None,
        None,
        &trust,
    ))
    .expect("phpstan response");

    assert_eq!(
        response,
        PhpStanAnalysisResponse::Unavailable {
            message: Some("Trust this workspace to run PHPStan.".to_string()),
        }
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn untrusted_workspace_blocks_pint_before_dispatch() {
    use std::os::unix::fs::PermissionsExt;

    let root = temp_workspace("pint-untrusted");
    let binary = root.join("vendor/bin/pint");
    let marker = root.join("pint-ran");
    fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary directory");
    fs::write(
        &binary,
        format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
    )
    .expect("write pint sentinel");
    let mut permissions = fs::metadata(&binary).expect("pint metadata").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&binary, permissions).expect("make pint executable");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let response = tauri::async_runtime::block_on(run_pint_format_with_trust(
        path_string(&root),
        None,
        &trust,
    ))
    .expect("pint response");

    assert_eq!(
        response,
        PintFormatResponse::Unavailable {
            message: Some("Trust this workspace to run Pint.".to_string()),
        }
    );
    assert!(!marker.exists());
    fs::remove_dir_all(root).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn untrusted_workspace_blocks_prettier_before_dispatch() {
    use std::os::unix::fs::PermissionsExt;

    let root = temp_workspace("prettier-untrusted");
    let binary = root.join("node_modules/.bin/prettier");
    let marker = root.join("prettier-ran");
    fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary directory");
    fs::write(
        &binary,
        format!("#!/bin/sh\ntouch '{}'\ncat\n", marker.display()),
    )
    .expect("write prettier sentinel");
    let mut permissions = fs::metadata(&binary)
        .expect("prettier metadata")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&binary, permissions).expect("make prettier executable");
    fs::write(root.join(".prettierrc"), "{}").expect("write prettier config");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let response = tauri::async_runtime::block_on(run_prettier_format_with_trust(
        path_string(&root),
        "src/app.ts".to_string(),
        "const value=1".to_string(),
        &trust,
    ))
    .expect("prettier response");

    assert_eq!(
        response,
        PrettierFormatResponse::Unavailable {
            message: Some("Trust this workspace to run Prettier.".to_string()),
        }
    );
    assert!(!marker.exists());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn untrusted_workspace_blocks_artisan_route_list() {
    let root = temp_workspace("artisan-untrusted");
    fs::write(root.join("artisan"), "<?php").expect("write artisan");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let response = tauri::async_runtime::block_on(run_artisan_route_list_with_trust(
        path_string(&root),
        &trust,
    ))
    .expect("artisan response");

    assert_eq!(
        response,
        ArtisanRoutesResponse::Unavailable {
            message: "Trust this workspace to inspect Artisan routes.".to_string(),
        }
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn php_test_untrusted_workspace_blocks_dispatch() {
    let root = temp_workspace("php-test-untrusted");
    let marker = root.join("php-tests-ran");
    fs::write(
        root.join("artisan"),
        format!("<?php touch('{}');", marker.display()),
    )
    .expect("write artisan sentinel");
    let trust = Mutex::new(
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service"),
    );

    let response = tauri::async_runtime::block_on(run_php_tests_junit_with_trust(
        path_string(&root),
        root.join("app-data"),
        None,
        &trust,
    ))
    .expect("php test response");

    assert_eq!(
        response,
        PhpTestRunResponse::Unavailable {
            message: "Trust this workspace to run PHP tests.".to_string(),
        }
    );
    assert!(!marker.exists());
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn trusted_workspace_dispatches_phpstan_analysis() {
    let root = temp_workspace("phpstan-trusted");
    let mut service =
        WorkspaceTrustService::load(root.join("trust.json")).expect("load trust service");
    service
        .set(&path_string(&root), true)
        .expect("trust workspace");
    let trust = Mutex::new(service);

    let response = tauri::async_runtime::block_on(run_phpstan_analysis_with_trust(
        path_string(&root),
        None,
        None,
        &trust,
    ))
    .expect("phpstan response");

    assert_eq!(
        response,
        PhpStanAnalysisResponse::Unavailable { message: None }
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn parse_php_file_outline_surfaces_signature_metadata_off_thread() {
    let outline = tauri::async_runtime::block_on(parse_php_file_outline(
        "/workspace/src/User.php".to_string(),
        concat!(
            "<?php\n\nnamespace App;\n\nclass User\n{\n",
            "    protected static function find(string $id, $fallback): ?User\n",
            "    {\n        return null;\n    }\n}\n",
        )
        .to_string(),
    ))
    .expect("outline result");

    let method = outline
        .nodes
        .iter()
        .find(|node| node.label == "User")
        .and_then(|class| class.children.iter().find(|child| child.label == "find"))
        .expect("method node");

    let value = serde_json::to_value(method).expect("serialize node");
    assert_eq!(value["visibility"], "protected");
    assert_eq!(value["isStatic"], true);
    assert_eq!(value["returnType"], "?User");
    assert_eq!(value["parameters"][0]["name"], "$id");
    assert_eq!(value["parameters"][0]["type"], "string");
    assert_eq!(value["parameters"][1]["name"], "$fallback");
    assert!(
        value["parameters"][1].get("type").is_none(),
        "untyped parameter should omit the type key, got {:?}",
        value["parameters"][1]
    );
}

#[test]
fn parse_php_syntax_reports_no_diagnostics_for_valid_source_off_thread() {
    let diagnostics =
        tauri::async_runtime::block_on(parse_php_syntax("<?php\n\necho 'ok';\n".to_string()))
            .expect("syntax result");

    assert!(
        diagnostics.is_empty(),
        "valid PHP should produce no syntax diagnostics, got {diagnostics:?}"
    );
}

#[test]
fn parse_php_syntax_reports_diagnostics_for_unclosed_function_off_thread() {
    let diagnostics = tauri::async_runtime::block_on(parse_php_syntax(
        "<?php\n\nfunction codevoQaBroken(\n".to_string(),
    ))
    .expect("syntax result");

    assert!(
        !diagnostics.is_empty(),
        "incomplete PHP function should produce syntax diagnostics"
    );
}

#[test]
fn parse_php_file_outline_handles_concurrent_requests_off_thread() {
    let first_future = parse_php_file_outline(
        "/workspace/src/First.php".to_string(),
        "<?php\nclass First {}\n".to_string(),
    );
    let second_future = parse_php_file_outline(
        "/workspace/src/Second.php".to_string(),
        "<?php\nclass Second {}\n".to_string(),
    );

    // Spawn both on the runtime so they are genuinely in flight together on
    // the blocking pool, then join them.
    let first_task = tauri::async_runtime::spawn(first_future);
    let second_task = tauri::async_runtime::spawn(second_future);

    let first = tauri::async_runtime::block_on(first_task)
        .expect("first join")
        .expect("first outline");
    let second = tauri::async_runtime::block_on(second_task)
        .expect("second join")
        .expect("second outline");

    assert!(first.nodes.iter().any(|node| node.label == "First"));
    assert!(second.nodes.iter().any(|node| node.label == "Second"));
}

#[test]
fn read_text_file_returns_contents_off_thread() {
    let root = temp_workspace("read-text");
    let file = root.join("greeting.txt");
    fs::write(&file, "hello off thread").expect("write file");

    let contents =
        tauri::async_runtime::block_on(read_text_file(path_string(&file))).expect("read result");

    assert_eq!(contents, "hello off thread");
}

#[test]
fn read_directory_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("dir-iso-a");
    let root_b = temp_workspace("dir-iso-b");
    fs::write(root_a.join("only-in-a.php"), "<?php").expect("file in a");
    fs::write(root_b.join("only-in-b.php"), "<?php").expect("file in b");

    let entries_a = tauri::async_runtime::block_on(read_directory(path_string(&root_a)))
        .expect("read directory a");
    let entries_b = tauri::async_runtime::block_on(read_directory(path_string(&root_b)))
        .expect("read directory b");

    let names_a: Vec<&str> = entries_a.iter().map(|entry| entry.name.as_str()).collect();
    let names_b: Vec<&str> = entries_b.iter().map(|entry| entry.name.as_str()).collect();

    assert!(names_a.contains(&"only-in-a.php"));
    assert!(!names_a.contains(&"only-in-b.php"));
    assert!(names_b.contains(&"only-in-b.php"));
    assert!(!names_b.contains(&"only-in-a.php"));
    assert!(entries_a
        .iter()
        .all(|entry| matches!(entry.kind, FileEntryKind::File)));
}

#[test]
fn search_files_finds_workspace_files_off_thread() {
    let root = temp_workspace("search-files");
    fs::write(root.join("Controller.php"), "<?php").expect("controller");
    fs::write(root.join("README.md"), "docs").expect("readme");

    let results = tauri::async_runtime::block_on(search_files(
        path_string(&root),
        "Controller".to_string(),
        10,
    ))
    .expect("search result");

    assert!(
        results
            .iter()
            .any(|result| result.path.ends_with("Controller.php")),
        "expected Controller.php in results, got {results:?}"
    );
}
