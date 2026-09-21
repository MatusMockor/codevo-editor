use super::*;
use crate::smart_mode::SmartModeService;
// This Tauri composition root intentionally wires the complete command surface.
// Capability modules below use explicit imports; the runtime remains the one
// broad crate boundary until command registration is generated from typed groups.
use crate::*;
#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_metrics = startup_metrics::StartupMetrics::new();
    #[cfg(all(feature = "perf-capture", target_os = "macos"))]
    perf_capture::claim_process_group().unwrap_or_else(|message| panic!("{message}"));

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
    let builder = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .manage(crate::artifact_preview::ArtifactPreviewState::default())
        .manage(crate::local_clone::LocalCloneState::default())
        .register_uri_scheme_protocol("codevo-artifact-preview", crate::artifact_preview::respond);
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

                if let Err(error) =
                    shutdown_runtime_processes(app, &js_test_batch_registry_for_menu)
                {
                    eprintln!("Runtime process shutdown refused application quit: {error}");
                    return;
                }
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
                if let Err(error) = shutdown_runtime_processes(
                    window.app_handle(),
                    &js_test_batch_registry_for_window,
                ) {
                    eprintln!("Runtime process shutdown failed after window destruction: {error}");
                }
            }
        })
        .manage(Mutex::new(SmartModeService::new()))
        .manage(crate::remote_runner::InventoryStreamState::default())
        .manage(startup_metrics)
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
        .manage(workspace_file_commands::WorkspaceFileIndexCache::new())
        .manage(
            project_commands::project_symbol_search_lifecycle::ProjectSymbolSearchLifecycle::default(),
        )
        .manage(LegacyLocalHistoryWorkspaceAuthorizer::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            app.manage(crate::remote_runner::RemoteRunnerState::new(app.path().app_data_dir()?)?);
            let trust_path = app.path().app_config_dir()?.join("workspace-trust.json");
            let trust_service = WorkspaceTrustService::load(trust_path)?;
            app.manage(Mutex::new(trust_service));
            let agent_task_admission =
                Arc::new(agent_task_admission::AgentTaskAdmissionRegistry::new());
            app.manage(Arc::clone(&agent_task_admission));
            app.manage(Arc::new(
                agent_task_commands::agent_root_lease::AgentRootLeaseRegistry::new(),
            ));
            app.manage(Arc::new(
                agent_thread_store_commands::agent_thread_store::AgentThreadStore::new(
                    app.path().app_data_dir()?,
                ),
            ));
            app.manage(Arc::new(
                agent_history_commands::agent_history_store::AgentHistoryStore::new(app.path().app_data_dir()?),
            ));
            app.manage(Arc::new(
                agent_turn_log_commands::agent_turn_log::AgentTurnLogStore::new(
                    app.path().app_data_dir()?,
                ),
            ));
            app.manage(Arc::new(agent_output_artifact_commands::store::OutputArtifactStore::new(app.path().app_data_dir()?)));
            let agent_attachment_store = Arc::new(
                agent_attachment_commands::agent_attachment_store::AgentAttachmentStore::new(
                    app.path().app_data_dir()?,
                ),
            );
            let agent_attachment_store_for_sweep = Arc::clone(&agent_attachment_store);
            app.manage(agent_attachment_store);
            tauri::async_runtime::spawn_blocking(move || {
                agent_attachment_store_for_sweep.sweep_all();
            });
            let agent_cli_versions = Arc::new(
                agent_task_spawner::agent_provider::agent_cli_version::AgentCliVersionRegistry::new(),
            );
            let agent_cli_discovery = Arc::new(agent_cli_discovery::AgentCliDiscovery::new(
                Arc::clone(&agent_cli_versions),
            ));
            let provider_executable_resolver: Arc<
                dyn agent_task_spawner::agent_provider::runtime::AgentProviderExecutableResolver,
            > = agent_cli_discovery.clone();
            let codex_hosts = Arc::new(agent_task_spawner::codex_app_server_host::CodexAppServerHostRegistry::standard());
            let host_lifecycle = Arc::new(agent_task_commands::codex_task_composition::CodexProviderHostLifecycle(Arc::clone(&codex_hosts)));
            let agent_provider_runtime = Arc::new(
                agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry::with_discovery_and_host_lifecycle(
                    provider_executable_resolver,
                    host_lifecycle,
                ),
            );
            let idle_hosts = Arc::downgrade(&codex_hosts);
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    let Some(hosts) = idle_hosts.upgrade() else { break; };
                    let _ = tauri::async_runtime::spawn_blocking(move || hosts.retire_idle()).await;
                }
            });
            app.manage(codex_hosts);
            app.manage(agent_cli_versions);
            app.manage(Arc::new(repository_lookup::RepositoryLookupService::new(
                Arc::clone(&agent_cli_discovery),
            )));
            app.manage(agent_cli_discovery);
            app.manage(agent_provider_runtime);
            app.manage(Arc::new(
                git_integration_commands::IntegrationLocks::default(),
            ));
            app.manage(agent_task_supervisor::AgentTaskRegistry::new(
                agent_task_admission,
                Arc::new(agent_task_spawner::StdAgentProcessSpawner),
                Arc::new(agent_task_commands::AppHandleAgentTaskEventSink::new(
                    app.handle().clone(),
                )),
            ));
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
            crate::artifact_preview::artifact_preview_create,
            crate::artifact_preview::workspace_html_preview::workspace_html_preview_create,
            crate::artifact_preview::artifact_preview_revoke,
            crate::remote_runner::remote_runner_list_servers,
            crate::remote_runner::remote_runner_collect_instructions,
            crate::remote_runner::remote_runner_subscribe_changes,
            crate::remote_runner::remote_runner_unsubscribe_changes,
            crate::remote_runner::remote_runner_connect_server,
            crate::remote_runner::remote_runner_disconnect_server,
            crate::remote_runner::remote_runner_remove_server,
            crate::remote_runner::remote_runner_get_runner,
            crate::remote_runner::remote_runner_list_projects,
            crate::remote_runner::remote_runner_clone_project,
            crate::remote_runner::remote_runner_get_project_clone,
            crate::remote_runner::remote_runner_cancel_project_clone,
            crate::remote_runner::remote_runner_list_tasks,
            crate::remote_runner::remote_runner_search_history,
            crate::remote_runner::remote_runner_create_task,
            crate::remote_runner::remote_runner_start_task,
            crate::remote_runner::remote_runner_get_task,
            crate::remote_runner::remote_runner_get_task_resume,
            crate::remote_runner::remote_runner_continue_task,
            crate::remote_runner::remote_runner_steer_task,
            crate::remote_runner::remote_runner_steer_pending_message,
            crate::remote_runner::remote_runner_list_pending_messages,
            crate::remote_runner::remote_runner_enqueue_message,
            crate::remote_runner::remote_runner_cancel_pending_message,
            crate::remote_runner::remote_runner_resume_pending_messages,
            crate::remote_runner::remote_runner_cancel_task,
            crate::remote_runner::remote_runner_list_events,
            crate::remote_runner::remote_runner_get_diff,
            crate::remote_runner::remote_runner_upload_attachment,
            crate::remote_runner::remote_runner_get_attachment,
            crate::remote_runner::remote_runner_read_attachment,
            crate::remote_runner::resolve_remote_agent_artifact,
            crate::remote_runner::read_remote_agent_artifact,
            crate::remote_runner::list_remote_agent_questions,
            crate::remote_runner::answer_remote_agent_question,
            crate::remote_runner::remote_runner_surface,
            crate::remote_runner::remote_runner_list_task_files,
            crate::remote_runner::remote_runner_get_task_file_diff,
            #[cfg(feature = "perf-capture")]
            perf_capture::perf_capture_activate_window,
            #[cfg(feature = "perf-capture")]
            perf_capture::perf_capture_reset_window_lease_baseline,
            #[cfg(feature = "perf-capture")]
            perf_capture::perf_capture_snapshot_window_lease,
            #[cfg(feature = "perf-capture")]
            perf_capture::perf_capture_release_window_lease,
            #[cfg(feature = "perf-capture")]
            perf_capture::perf_capture_submit,
            #[cfg(feature = "perf-capture")]
            perf_capture::perf_capture_prepare_fixture_trust,
            startup_metrics::log_startup_shell_painted,
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
            rollback_workspace_registration,
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
            debug_node_attach_list_command::debug_list_node_attach_candidates,
            debug_node_attach_start_command::debug_start_node_attach_candidate,
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
            dispose_registered_workspace,
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
            stop_workspace_file_watch,
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
            crate::application_commands::app_update_install_mode,
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
            begin_project_symbol_search,
            cancel_project_symbol_search,
            search_project_symbols,
            search_text,
            set_smart_mode,
            workspace_trust_commands::set_workspace_trust,
            workspace_trust_commands::grant_opened_project_trust,
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
            terminal_commands::write_terminal_input,
            agent_task_commands::start_agent_task,
            agent_attachment_commands::stage_agent_attachment_bytes,
            agent_attachment_commands::stage_agent_attachment_from_path,
            agent_attachment_commands::inspect_agent_attachment_candidate,
            agent_attachment_commands::read_agent_attachment_candidate,
            agent_image_source_commands::read_agent_attachment_image_source,
            agent_attachment_commands::claim_agent_attachments,
            agent_attachment_commands::release_agent_attachment,
            agent_output_artifact_commands::resolve_agent_output_artifact,
            agent_output_artifact_commands::read_agent_output_artifact,
            agent_output_artifact_commands::locate_agent_output_artifact_file,
            agent_output_artifact_commands::reveal_agent_output_artifact_file,
            agent_attachment_commands::read_agent_attachment,
            agent_attachment_commands::reveal_agent_attachment,
            agent_task_commands::acknowledge_agent_task_start,
            agent_task_commands::output_delivery::acknowledge_agent_task_output,
            agent_task_commands::steer_agent_task,
            agent_task_commands::close_agent_task_input,
            agent_task_commands::questions::list_agent_questions,
            agent_task_commands::questions::answer_agent_question,
            agent_task_commands::stop_agent_task,
            agent_task_commands::stop_agent_tasks_for_root,
            agent_task_commands::acquire_agent_root_lease,
            agent_task_commands::release_agent_root_lease,
            agent_history_commands::read_agent_history_threads,
            agent_history_commands::find_agent_history_import,
            agent_history_commands::load_agent_history,
            agent_history_commands::save_agent_history_thread,
            agent_history_commands::read_agent_history_turns,
            agent_history_commands::delete_agent_history_thread,
            agent_session_import_commands::import_agent_session_history,
            agent_session_import_commands::read_agent_imported_history,
            agent_thread_store_commands::load_agent_threads,
            agent_thread_store_commands::save_agent_thread,
            agent_thread_store_commands::delete_agent_thread,
            agent_turn_log_commands::open_agent_turn_log,
            agent_turn_log_commands::append_agent_turn_log,
            agent_turn_log_commands::read_agent_turn_log_page,
            agent_turn_log_commands::summarize_agent_turn_logs,
            agent_turn_log_commands::delete_agent_thread_log,
            agent_session_history_commands::list_external_agent_sessions,
            agent_session_history_commands::preview_external_agent_session,
            agent_session_history_commands::read_external_agent_session_history,
            agent_cli_discovery_commands::discover_agent_clis,
            agent_cli_version_commands::probe_agent_cli_version,
            agent_provider_commands::register_agent_provider_policy,
            agent_provider_commands::get_agent_provider_policy,
            agent_provider_commands::probe_agent_provider_health,
            agent_provider_commands::check_agent_provider_updates,
            agent_provider_commands::update_agent_provider,
            agent_provider_usage_commands::read_agent_provider_usage,
            agent_provider_sign_in_commands::start_agent_provider_sign_in,
            git_integration_commands::get_git_ship_status,
            git_integration_commands::push_git_branch_upstream,
            git_integration_commands::integrate_git_worktree_branch,
            git_worktree_commands::list_git_worktrees,
            git_worktree_commands::add_git_worktree,
            git_worktree_commands::remove_git_worktree,
            git_worktree_commands::prune_git_worktrees,
            crate::local_clone::local_clone_project,
            crate::local_clone::local_get_project_clone,
            crate::local_clone::local_cancel_project_clone,
            crate::repository_identity::get_repository_identity,
            crate::remote_runner::remote_runner_repository_identity,
            repository_lookup_commands::repository_lookup_hosts,
            repository_lookup_commands::repository_lookup,
            directory_listing_commands::list_directory_entries,
            directory_listing_commands::open_directory_in_file_manager
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("Error building tauri application: {error}"))
        .run(move |app, event| {
            if let RunEvent::ExitRequested { api, .. } = &event {
                if let Err(error) =
                    shutdown_runtime_processes(app, &js_test_batch_registry_for_run)
                {
                    eprintln!("Runtime process shutdown refused application exit: {error}");
                    api.prevent_exit();
                    return;
                }
            }
            if matches!(event, RunEvent::Exit) {
                if let Err(error) =
                    shutdown_runtime_processes(app, &js_test_batch_registry_for_run)
                {
                    eprintln!("Runtime process shutdown failed during application exit: {error}");
                }
            }
            #[cfg(feature = "perf-capture")]
            if matches!(event, RunEvent::Exit) {
                perf_capture::publish_shutdown_proof()
                    .unwrap_or_else(|message| panic!("{message}"));
            }
        });
}
