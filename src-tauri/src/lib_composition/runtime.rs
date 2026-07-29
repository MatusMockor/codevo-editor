use super::*;
// This Tauri composition root intentionally wires the complete command surface.
// Capability modules below use explicit imports; the runtime remains the one
// broad crate boundary until command registration is generated from typed groups.
use crate::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminal_task_admission =
        Arc::new(terminal_task_admission::TerminalTaskAdmissionRegistry::new());
    let js_test_batch_registry = Arc::new(JsTestBatchRegistry::new());
    #[cfg(target_os = "macos")]
    let js_test_batch_registry_for_menu = Arc::clone(&js_test_batch_registry);
    let js_test_batch_registry_for_window = Arc::clone(&js_test_batch_registry);
    let js_test_batch_registry_for_run = Arc::clone(&js_test_batch_registry);
    #[cfg(not(test))]
    let vscode_process_task_registry = Arc::new(
        vscode_process_task_registry::VscodeProcessTaskRegistry::with_admission(Arc::clone(
            &terminal_task_admission,
        )),
    );
    #[cfg(not(test))]
    let vscode_process_task_registry_for_setup = Arc::clone(&vscode_process_task_registry);
    let builder = tauri::Builder::default().enable_macos_default_menu(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(application_menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            CLOSE_ACTIVE_TAB_MENU_ID => {
                let _ = app.emit(CLOSE_ACTIVE_TAB_EVENT, ());
            }
            FONT_ZOOM_IN_MENU_ID => {
                let _ = app.emit(FONT_ZOOM_IN_EVENT, ());
            }
            FONT_ZOOM_OUT_MENU_ID => {
                let _ = app.emit(FONT_ZOOM_OUT_EVENT, ());
            }
            FONT_ZOOM_RESET_MENU_ID => {
                let _ = app.emit(FONT_ZOOM_RESET_EVENT, ());
            }
            OPEN_APPEARANCE_SETTINGS_MENU_ID => {
                let _ = app.emit(OPEN_APPEARANCE_SETTINGS_EVENT, ());
            }
            QUIT_APPLICATION_MENU_ID => {
                let listener_ready = app
                    .try_state::<NativeCloseListenerState>()
                    .is_some_and(|state| state.ready.load(Ordering::Acquire));
                if listener_ready && app.emit(NATIVE_CLOSE_REQUEST_EVENT, "quit").is_ok() {
                    return;
                }

                shutdown_runtime_processes(app, &js_test_batch_registry_for_menu);
                app.exit(0);
            }
            TOGGLE_FONT_LIGATURES_MENU_ID => {
                let _ = app.emit(TOGGLE_FONT_LIGATURES_EVENT, ());
            }
            _ => {}
        });

    builder
        .on_window_event(move |window, event| {
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                let listener_ready = window
                    .app_handle()
                    .try_state::<NativeCloseListenerState>()
                    .is_some_and(|state| state.ready.load(Ordering::Acquire));
                if listener_ready {
                    api.prevent_close();
                    if window.emit(NATIVE_CLOSE_REQUEST_EVENT, "close").is_err() {
                        let _ = window.destroy();
                    }
                }
                return;
            }

            if matches!(event, WindowEvent::Destroyed) {
                shutdown_runtime_processes(window.app_handle(), &js_test_batch_registry_for_window);
            }
        })
        .manage(Mutex::new(SmartModeService::new()))
        .manage(NativeCloseListenerState::default())
        .manage(PhpLanguageServerRegistry::new())
        .manage(JavaScriptTypeScriptLanguageServerRegistry::new())
        .manage(DocumentChangeAdmissionRegistry::default())
        .manage(JavaScriptTypeScriptWorkspaceWatchRegistry::new())
        .manage(WorkspaceFileChangeWatchRegistry::new())
        .manage(WorkspaceIndexLifecycle::new())
        .manage(Arc::new(DebugSessionRegistry::new()))
        .manage(Arc::new(
            debug_cdp::NodeAttachCandidatePublicationRegistry::new(),
        ))
        .manage(Arc::new(eslint::EslintProcessRegistry::default()))
        .manage(TerminalSupervisor::new())
        .manage(node_package_tasks::NodePackageTaskRegistry::with_admission(
            Arc::clone(&terminal_task_admission),
        ))
        .manage(node_run_tasks::NodeRunTaskRegistry::new(Arc::clone(
            &terminal_task_admission,
        )))
        .manage(js_test_tasks::JsTestTaskRegistry::new())
        .manage(Arc::clone(&js_test_batch_registry))
        .manage(Arc::new(js_test_watch::JsTestWatchRegistry::new()))
        .manage(terminal_task_admission)
        .manage(WorkspaceRegistry::new())
        .manage(workspace_commands::WorkspaceFileSearchLifecycle::default())
        .manage(LegacyLocalHistoryWorkspaceAuthorizer::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let trust_path = app.path().app_config_dir()?.join("workspace-trust.json");
            let trust_service = WorkspaceTrustService::load(trust_path)?;
            app.manage(Mutex::new(trust_service));
            #[cfg(not(test))]
            app.manage(
                vscode_process_task_commands::VscodeProcessTaskCommandService::new(
                    Arc::clone(&vscode_process_task_registry_for_setup),
                    Arc::new(vscode_process_task_commands::AppProcessTaskRuntime(
                        app.handle().clone(),
                    )),
                    Arc::new(vscode_process_task_events::AppVscodeProcessTaskEventSink(
                        app.handle().clone(),
                    )),
                ),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            amend_git_commit,
            reword_git_commit,
            clear_workspace_index,
            apply_workspace_edit,
            commit_git_changes,
            managed_install_commands::install_managed_phpactor,
            managed_install_commands::install_managed_typescript_language_server,
            open_workspace_from_picker,
            package_commands::preview_workspace_package_operation,
            node_package_scripts::workspace_discover_node_package_scripts,
            node_package_tasks::workspace_start_node_package_task,
            node_package_tasks::workspace_acknowledge_node_package_task_start,
            node_package_tasks::workspace_stop_node_package_task,
            js_test_watch::workspace_start_js_test_watch,
            js_test_watch::workspace_acknowledge_js_test_watch_start,
            js_test_watch::workspace_stop_js_test_watch,
            node_run_tasks::workspace_start_node_run_task,
            node_run_tasks::workspace_acknowledge_node_run_task_start,
            node_run_tasks::workspace_stop_node_run_task,
            vscode_tasks_discovery_command::workspace_discover_vscode_process_tasks,
            vscode_process_task_tauri::workspace_start_vscode_process_task,
            vscode_process_task_tauri::workspace_acknowledge_vscode_process_task_start,
            vscode_process_task_tauri::workspace_stop_vscode_process_task,
            register_workspace_path,
            unregister_workspace,
            project_commands::get_workspace_descriptor,
            workspace_commands::workspace_read_text_file,
            workspace_commands::workspace_read_image_file,
            workspace_commands::workspace_read_directory,
            workspace_directory_commands::workspace_read_directory_bounded,
            workspace_commands::workspace_search_files,
            workspace_source_discovery::workspace_enumerate_js_source_files,
            workspace_source_discovery::workspace_enumerate_package_json_files,
            workspace_source_discovery::workspace_read_source_text_bounded,
            symfony_commands::list_symfony_console_commands,
            symfony_commands::list_symfony_routes,
            symfony_commands::list_symfony_services,
            workspace_test_discovery::workspace_enumerate_js_test_files,
            workspace_test_discovery::workspace_read_text_file_bounded,
            workspace_commands::workspace_search_text,
            workspace_commands::workspace_replace_in_path,
            workspace_apply_workspace_edit,
            workspace_apply_workspace_edit_transaction,
            workspace_commands::workspace_save_text_file,
            workspace_commands::workspace_create_text_file,
            workspace_commands::workspace_create_text_file_with_content,
            workspace_commands::workspace_create_directory,
            workspace_commands::workspace_delete_path,
            workspace_commands::workspace_rename_path,
            debug_evaluate,
            debug_list_node_attach_candidates,
            debug_start_node_attach_candidate,
            debug_completions,
            debug_disconnect,
            debug_pause,
            debug_restart_frame,
            debug_run_to_location,
            debug_scopes,
            debug_set_breakpoints,
            debug_set_breakpoints_active,
            debug_set_function_breakpoints,
            debug_set_exception_pause,
            debug_set_variable,
            debug_set_expression,
            debug_stack_trace,
            debug_node_env_file::debug_start,
            debug_node_watch_start_command::debug_start_native_node_watch,
            debug_node_watch_start_command::debug_confirm_native_node_watch,
            debug_start_compound,
            debug_step,
            debug_stop,
            debug_variables,
            detect_git_repositories,
            project_commands::detect_php_tools,
            project_commands::detect_workspace,
            dispose_workspace_root,
            get_php_file_outline,
            get_git_blame,
            get_git_commit_graph_page,
            get_git_commit_log,
            get_git_commit_diff,
            get_git_commit_details,
            revert_git_commit,
            cherry_pick_git_commit,
            get_git_commit_files,
            get_git_branches,
            get_git_repo_status,
            get_git_diff,
            get_git_file_commit_diff,
            get_git_file_history,
            get_git_file_hunks,
            get_git_status,
            fetch_git_changes,
            record_local_history_snapshot,
            get_local_history_versions,
            get_local_history_version_content,
            get_javascript_typescript_language_server_status,
            get_php_language_server_status,
            runtime_commands::get_runtime_observability,
            restart_language_runtime,
            stop_language_runtime,
            get_php_tree,
            project_commands::get_smart_mode_state,
            project_commands::get_workspace_trust,
            initialize_workspace_index,
            list_monospace_font_families,
            start_workspace_file_watch,
            terminal_commands::list_terminal_profiles,
            runtime_commands::open_language_runtime_log,
            reveal_item_in_dir,
            parse_php_file_outline,
            parse_php_syntax,
            plan_javascript_typescript_language_server,
            plan_php_language_server,
            push_git_changes,
            package_commands::run_workspace_package_operation,
            pull_git_changes,
            save_git_stash,
            get_git_stash_list,
            get_git_stash_diff,
            stash_apply_git,
            stash_pop_git,
            stash_drop_git,
            list_git_branches,
            list_git_remote_branches,
            get_git_current_branch,
            checkout_git_remote_branch,
            create_git_branch,
            delete_git_branch,
            rename_git_branch,
            switch_git_branch,
            quit_application,
            set_native_close_listener_ready,
            confirm_native_shutdown,
            read_directory,
            read_text_file,
            remove_workspace_index_file,
            terminal_commands::resize_terminal_session,
            revert_git_files,
            quality_commands::run_eslint_analysis,
            quality_commands::run_eslint_document_analysis,
            quality_commands::run_phpstan_analysis,
            quality_commands::run_pint_format,
            quality_commands::run_prettier_format,
            quality_commands::run_artisan_route_list,
            js_test_commands::run_js_tests_json,
            js_test_commands::run_js_tests_scoped_json,
            js_test_commands::run_js_test_batch_json,
            js_test_commands::stop_js_test_batch,
            js_test_tasks::commands::run_js_test_task_json,
            js_test_tasks::commands::stop_js_test_task,
            js_test_coverage_commands::run_js_test_coverage_json,
            quality_commands::run_php_tests_junit,
            quality_commands::run_php_test_coverage_clover,
            search_files,
            search_project_symbols,
            search_text,
            set_smart_mode,
            workspace_trust_commands::set_workspace_trust,
            stage_git_files,
            stage_git_hunk,
            unstage_git_hunk,
            revert_git_hunk,
            start_initial_metadata_scan,
            start_javascript_typescript_language_server,
            start_workspace_reindex,
            start_php_language_server,
            terminal_commands::acknowledge_terminal_session_start,
            terminal_commands::start_terminal_session,
            stop_all_javascript_typescript_language_servers,
            stop_all_php_language_servers,
            terminal_commands::stop_all_terminal_sessions,
            stop_javascript_typescript_language_server,
            stop_php_language_server,
            terminal_commands::stop_terminal_session,
            terminal_commands::stop_terminal_sessions_for_root,
            unstage_git_files,
            javascript_typescript_document_did_change,
            javascript_typescript_document_did_change_bounded,
            javascript_typescript_document_did_close,
            javascript_typescript_document_did_close_bounded,
            javascript_typescript_document_did_open,
            javascript_typescript_document_did_open_bounded,
            javascript_typescript_document_did_save,
            javascript_typescript_language_server_execute_command,
            javascript_typescript_language_server_execute_command_locations,
            javascript_typescript_workspace_did_change_configuration,
            javascript_typescript_workspace_did_change_watched_files,
            javascript_typescript_workspace_did_create_files,
            javascript_typescript_workspace_did_delete_files,
            javascript_typescript_workspace_did_rename_files,
            javascript_typescript_workspace_will_create_files,
            javascript_typescript_workspace_will_delete_files,
            javascript_typescript_workspace_will_rename_files,
            lsp_request_commands::cancel_lsp_request,
            lsp_request_commands::javascript_typescript_text_document_code_action_resolve,
            lsp_request_commands::javascript_typescript_text_document_code_actions,
            javascript_typescript_text_document_code_lens_resolve,
            javascript_typescript_text_document_code_lenses,
            javascript_typescript_text_document_completion,
            javascript_typescript_text_document_completion_resolve,
            lsp_request_commands::javascript_typescript_text_document_declaration,
            lsp_request_commands::javascript_typescript_text_document_definition,
            lsp_request_commands::javascript_typescript_text_document_document_highlights,
            javascript_typescript_text_document_document_link_resolve,
            javascript_typescript_text_document_document_links,
            javascript_typescript_text_document_document_symbols,
            javascript_typescript_text_document_folding_ranges,
            javascript_typescript_text_document_formatting,
            javascript_typescript_text_document_hover,
            javascript_typescript_text_document_incoming_calls,
            lsp_request_commands::javascript_typescript_text_document_implementation,
            javascript_typescript_text_document_inlay_hint_resolve,
            javascript_typescript_text_document_inlay_hints,
            lsp_request_commands::javascript_typescript_text_document_linked_editing_ranges,
            javascript_typescript_text_document_on_type_formatting,
            javascript_typescript_text_document_outgoing_calls,
            javascript_typescript_text_document_prepare_call_hierarchy,
            javascript_typescript_text_document_prepare_rename,
            javascript_typescript_text_document_prepare_type_hierarchy,
            javascript_typescript_text_document_range_formatting,
            javascript_typescript_text_document_range_semantic_tokens,
            lsp_request_commands::javascript_typescript_text_document_references,
            javascript_typescript_text_document_rename,
            javascript_typescript_text_document_selection_ranges,
            lsp_request_commands::javascript_typescript_text_document_semantic_tokens,
            javascript_typescript_text_document_signature_help,
            lsp_request_commands::javascript_typescript_text_document_source_definition,
            javascript_typescript_text_document_type_hierarchy_subtypes,
            javascript_typescript_text_document_type_hierarchy_supertypes,
            lsp_request_commands::javascript_typescript_text_document_type_definition,
            lsp_request_commands::javascript_typescript_workspace_symbols,
            language_server_execute_command,
            language_server_execute_command_locations,
            text_document_code_action_resolve,
            text_document_code_actions,
            text_document_code_lens_resolve,
            text_document_code_lenses,
            text_document_completion,
            text_document_completion_resolve,
            text_document_declaration,
            text_document_definition,
            text_document_document_highlights,
            text_document_document_link_resolve,
            text_document_document_links,
            text_document_document_symbols,
            text_document_folding_ranges,
            text_document_did_change,
            text_document_did_close,
            text_document_did_open,
            text_document_did_save,
            text_document_formatting,
            text_document_hover,
            text_document_incoming_calls,
            text_document_implementation,
            text_document_inlay_hint_resolve,
            text_document_inlay_hints,
            text_document_linked_editing_ranges,
            text_document_on_type_formatting,
            text_document_outgoing_calls,
            text_document_prepare_call_hierarchy,
            text_document_prepare_rename,
            text_document_prepare_type_hierarchy,
            text_document_range_formatting,
            text_document_range_semantic_tokens,
            text_document_references,
            text_document_rename,
            text_document_selection_ranges,
            text_document_semantic_tokens,
            text_document_signature_help,
            text_document_type_hierarchy_subtypes,
            text_document_type_hierarchy_supertypes,
            text_document_type_definition,
            text_document_will_create_files,
            text_document_will_delete_files,
            text_document_will_rename_files,
            workspace_did_create_files,
            workspace_did_change_configuration,
            workspace_did_change_watched_files,
            workspace_did_delete_files,
            workspace_did_rename_files,
            upsert_workspace_index_file,
            workspace_symbols,
            terminal_commands::write_terminal_input
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("Error building tauri application: {error}"))
        .run(move |app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                shutdown_runtime_processes(app, &js_test_batch_registry_for_run);
            }
        });
}
