use super::*;
// This Tauri composition root intentionally wires the complete command surface.
// Capability modules below use explicit imports; the runtime remains the one
// broad crate boundary until command registration is generated from typed groups.
use crate::*;
#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_metrics = startup_metrics::StartupMetrics::new();
    #[cfg(target_os = "macos")]
    super::macos_text_substitution::register_code_friendly_text_input_defaults();

    let terminal_task_admission =
        Arc::new(terminal_task_admission::TerminalTaskAdmissionRegistry::new());
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
        .manage(Arc::new(
            crate::agent_mcp_server_login_registry::AgentMcpLoginRegistry::default(),
        ))
        .register_uri_scheme_protocol("codevo-artifact-preview", crate::artifact_preview::respond);
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(application_menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            CLOSE_ACTIVE_TAB_MENU_ID => {
                let _ = app.emit(CLOSE_ACTIVE_TAB_EVENT, ());
            }
            WINDOW_ZOOM_IN_MENU_ID => {
                let _ = app.emit(WINDOW_ZOOM_IN_EVENT, ());
            }
            WINDOW_ZOOM_OUT_MENU_ID => {
                let _ = app.emit(WINDOW_ZOOM_OUT_EVENT, ());
            }
            WINDOW_ZOOM_RESET_MENU_ID => {
                let _ = app.emit(WINDOW_ZOOM_RESET_EVENT, ());
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

                if let Err(error) = shutdown_runtime_processes(app) {
                    eprintln!("Runtime process shutdown refused application quit: {error}");
                    return;
                }
                app.exit(0);
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
                if let Err(error) = shutdown_runtime_processes(window.app_handle()) {
                    eprintln!("Runtime process shutdown failed after window destruction: {error}");
                }
            }
        })
        .manage(crate::remote_runner::InventoryStreamState::default())
        .manage(crate::remote_runner::AttachmentTransferState::default())
        .manage(Arc::new(crate::agent_file_source::FileSources::default()))
        .manage(startup_metrics)
        .manage(startup_window_reveal::StartupWindowReveal::default())
        .manage(NativeCloseListenerState::default())
        .manage(WorkspaceFileChangeWatchRegistry::new())
        .manage(TerminalSupervisor::new())
        .manage(node_package_tasks::NodePackageTaskRegistry::with_admission(
            Arc::clone(&terminal_task_admission),
        ))
        .manage(terminal_task_admission)
        .manage(WorkspaceRegistry::new())
        .manage(workspace_commands::WorkspaceFileSearchLifecycle::default())
        .manage(workspace_file_commands::WorkspaceFileIndexCache::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(window_geometry::window_geometry_plugin())
        .setup(move |app| {
            window_geometry::restore_main_window_geometry(app.handle());
            startup_window_reveal::schedule_startup_reveal_fallback(app.handle());
            #[cfg(target_os = "linux")]
            webview_media_linux::enable_main_webview_microphone(app.handle());
            crate::claude_model_manifest::initialize(app.handle().clone(), app.path().app_data_dir()?);
            app.manage(crate::remote_runner::RemoteRunnerState::new(app.path().app_data_dir()?)?);
            app.manage(Arc::new(crate::agent_turn_changes::AgentTurnChangesStore::new(app.path().app_data_dir()?)));
            app.manage(Arc::new(codex_limit_reset_commands::store::LimitResetStore::new(app.path().app_data_dir()?)));
            let trust_path = app.path().app_config_dir()?.join("workspace-trust.json");
            let trust_service = WorkspaceTrustService::load(trust_path)?;
            app.manage(Mutex::new(trust_service));
            let trust_prune_app = app.handle().clone();
            let _ = std::thread::Builder::new()
                .name("workspace-trust-prune".into())
                .spawn(move || {
                    let trust = trust_prune_app.state::<Mutex<WorkspaceTrustService>>();
                    let _ = crate::trust::prune_missing_clone_roots(trust.inner());
                });
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
            let request_journal = Arc::new(
                crate::agent_runtime_requests::journal::RuntimeRequestJournal::start(
                    Arc::new(
                        agent_history_commands::agent_history_store::runtime_requests::HistoryRuntimeRequestStore::new(
                            app.path().app_data_dir()?,
                        ),
                    ),
                    crate::agent_runtime_requests::journal::new_run_id(),
                    crate::agent_runtime_requests::journal::system_clock(),
                ),
            );
            app.manage(crate::agent_runtime_requests::feed::RequestFeed::start(
                &request_journal,
                Arc::new(agent_task_commands::runtime_requests::AppHandleThreadRequestsSink(
                    app.handle().clone(),
                )),
            ));
            app.manage(Arc::new(
                crate::agent_runtime_requests::projection::RequestProjection::new(Arc::clone(&request_journal)),
            ));
            app.manage(Arc::clone(&request_journal));
            app.manage(Arc::new(
                agent_turn_log_commands::agent_turn_log::AgentTurnLogStore::new(
                    app.path().app_data_dir()?,
                ),
            ));
            app.manage(Arc::new(
                remote_agent_replay_store_commands::remote_agent_replay_store::RemoteAgentReplayStore::new(
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
                agent_cli_versions,
            ));
            let provider_executable_resolver: Arc<
                dyn agent_task_spawner::agent_provider::runtime::AgentProviderExecutableResolver,
            > = agent_cli_discovery.clone();
            let codex_hosts = Arc::new(agent_task_spawner::codex_app_server_host::CodexAppServerHostRegistry::standard());
            let claude_sessions = Arc::new(agent_task_spawner::claude_session_registry::ClaudeSessionRegistry::new(
                agent_task_supervisor::system_process_group_signals(),
                Arc::new(agent_task_commands::claude_session_composition::AppHandleClaudeSessionEvents(app.handle().clone())),
            ));
            let host_lifecycle = Arc::new(agent_task_commands::claude_session_composition::AgentProviderHostLifecycles {
                codex: agent_task_commands::codex_task_composition::CodexProviderHostLifecycle(Arc::clone(&codex_hosts)),
                claude: Arc::clone(&claude_sessions),
            });
            agent_task_commands::claude_session_composition::spawn_idle_session_retirement(
                Arc::downgrade(&claude_sessions),
                agent_task_commands::claude_session_composition::CLAUDE_SESSION_IDLE_SWEEP_INTERVAL,
            );
            app.manage(claude_sessions);
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
            app.manage(Arc::new(repository_lookup::RepositoryLookupService::new(
                Arc::clone(&agent_cli_discovery),
            )));
            app.manage(Arc::new(pull_request_commands::PullRequestService::new(
                Arc::clone(&agent_cli_discovery),
            )));
            app.manage(agent_cli_discovery);
            app.manage(agent_provider_runtime);
            app.manage(Arc::new(
                git_integration_commands::IntegrationLocks::default(),
            ));
            let agent_tasks = agent_task_supervisor::AgentTaskRegistry::new(
                agent_task_admission,
                Arc::new(agent_task_spawner::StdAgentProcessSpawner),
                Arc::new(agent_task_commands::AppHandleAgentTaskEventSink::new(
                    app.handle().clone(),
                )),
            );
            request_journal.share_sequence(agent_tasks.interaction_sequence());
            app.manage(agent_tasks);
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
            crate::claude_model_manifest::get_claude_model_manifest,
            crate::codex_model_catalog::get_codex_model_catalog,
            crate::agent_command_catalog::get_agent_command_catalog,
            crate::agent_mcp_servers::get_agent_mcp_servers,
            crate::agent_mcp_server_manage::change_agent_mcp_server,
            crate::agent_mcp_server_manage::start_agent_mcp_server_login,
            crate::agent_mcp_server_manage::get_agent_mcp_server_login,
            crate::agent_mcp_server_manage::cancel_agent_mcp_server_login,
            crate::artifact_preview::artifact_preview_create,
            crate::artifact_preview::artifact_preview_revoke,
            crate::remote_runner::remote_runner_list_servers,
            crate::remote_runner::remote_runner_collect_instructions,
            crate::remote_runner::remote_runner_subscribe_changes,
            crate::remote_runner::remote_runner_unsubscribe_changes,
            crate::remote_runner::remote_runner_connect_server,
            crate::remote_runner::remote_runner_disconnect_server,
            crate::remote_runner::remote_runner_remove_server,
            crate::remote_runner::remote_runner_get_runner,
            crate::remote_runner::remote_runner_get_account_usage,
            crate::remote_runner::remote_runner_get_command_catalog,
            crate::remote_runner::remote_runner_get_mcp_servers,
            crate::remote_runner::remote_runner_change_mcp_server,
            crate::remote_runner::remote_runner_start_mcp_server_login,
            crate::remote_runner::remote_runner_get_mcp_server_login,
            crate::remote_runner::remote_runner_submit_mcp_server_login_callback,
            crate::remote_runner::remote_runner_cancel_mcp_server_login,
            crate::remote_runner::remote_runner_sync_device_mcp_servers,
            crate::remote_runner::remote_runner_transcribe_speech,
            crate::remote_runner::remote_runner_list_projects,
            crate::remote_runner::remote_runner_clone_project,
            crate::remote_runner::remote_runner_repository_hosts,
            crate::remote_runner::remote_runner_lookup_repository,
            crate::remote_runner::remote_runner_search_repositories,
            crate::remote_runner::remote_runner_project_directories,
            crate::remote_runner::remote_runner_register_project,
            crate::remote_runner::remote_runner_get_thread_metadata,
            crate::remote_runner::remote_runner_list_thread_metadata,
            crate::remote_runner::remote_runner_patch_thread_metadata,
            crate::remote_runner::remote_runner_order_thread,
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
            crate::remote_runner::remote_runner_upload_attachment_file,
            crate::remote_runner::remote_runner_cancel_attachment_upload,
            crate::remote_runner::remote_runner_download_attachment,
            crate::remote_runner::remote_runner_get_attachment,
            crate::remote_runner::remote_runner_read_attachment,
            crate::remote_runner::resolve_remote_agent_artifact,
            crate::remote_runner::read_remote_agent_artifact,
            crate::remote_runner::get_remote_agent_thread_requests,
            crate::remote_runner::respond_remote_agent_thread_request,
            crate::remote_runner::remote_runner_surface,
            crate::remote_runner::remote_runner_list_task_files,
            crate::remote_runner::remote_runner_get_task_file_diff,
            crate::remote_runner::remote_runner_get_turn_changes,
            crate::remote_runner::remote_runner_get_turn_file_diff,
            crate::remote_runner::remote_runner_git,
            crate::remote_runner::remote_port_list,
            crate::remote_runner::remote_port_open,
            crate::remote_runner::remote_port_close,
            crate::remote_runner::remote_port_release_owner,
            crate::agent_turn_changes_commands::agent_turn_changes_get,
            crate::agent_turn_changes_commands::agent_turn_changes_diff,
            startup_metrics::log_startup_shell_painted,
            startup_window_reveal::reveal_startup_window,
            commit_git_changes,
            open_workspace_from_picker,
            node_package_scripts::workspace_discover_node_package_scripts,
            node_package_tasks::workspace_start_node_package_task,
            node_package_tasks::workspace_acknowledge_node_package_task_start,
            node_package_tasks::workspace_stop_node_package_task,
            vscode_tasks_discovery_command::workspace_discover_vscode_process_tasks,
            vscode_process_task_tauri::workspace_start_vscode_process_task,
            vscode_process_task_tauri::workspace_acknowledge_vscode_process_task_start,
            vscode_process_task_tauri::workspace_stop_vscode_process_task,
            register_workspace_path,
            rollback_workspace_registration,
            adopt_workspace_admission,
            unregister_workspace,
            project_commands::get_workspace_descriptor,
            workspace_file_preview_commands::workspace_read_file_preview,
            workspace_commands::workspace_read_directory,
            workspace_directory_commands::workspace_read_directory_bounded,
            workspace_commands::workspace_search_files,
            workspace_commands::workspace_create_text_file_with_content,
            workspace_commands::workspace_create_directory,
            detect_git_repositories,
            dispose_registered_workspace,
            dispose_workspace_root,
            get_git_commit_log,
            get_git_commit_diff,
            get_git_commit_details,
            get_git_commit_files,
            get_git_branches,
            get_git_repo_status,
            get_git_diff,
            get_git_status,
            fetch_git_changes,
            project_commands::get_workspace_trust,
            list_monospace_font_families,
            start_workspace_file_watch,
            stop_workspace_file_watch,
            terminal_commands::list_terminal_profiles,
            reveal_item_in_dir,
            push_git_changes,
            list_git_branches,
            list_git_remote_branches,
            get_git_current_branch,
            checkout_git_remote_branch,
            create_git_branch,
            delete_git_branch,
            switch_git_branch,
            quit_application,
            crate::application_commands::app_update_install_mode,
            app_update_check_commands::app_update_check,
            set_native_close_listener_ready,
            confirm_native_shutdown,
            read_directory,
            terminal_commands::resize_terminal_session,
            search_files,
            workspace_trust_commands::set_workspace_trust,
            workspace_trust_commands::grant_opened_project_trust,
            workspace_trust_commands::revoke_opened_project_trust,
            stage_git_files,
            terminal_commands::acknowledge_terminal_session_start,
            terminal_commands::start_terminal_session,
            terminal_commands::stop_all_terminal_sessions,
            terminal_commands::stop_terminal_session,
            terminal_commands::stop_terminal_sessions_for_root,
            terminal_commands::write_terminal_input,
            agent_task_commands::start_agent_task,
            agent_attachment_commands::stage_agent_attachment_bytes,
            agent_attachment_commands::stage_agent_attachment_from_path,
            agent_attachment_commands::inspect_agent_attachment_candidate,
            agent_attachment_commands::read_agent_attachment_candidate,
            agent_image_source_commands::read_agent_attachment_image_source,
            agent_file_source_commands::stage_agent_attachment_file_source,
            agent_file_source_commands::release_agent_attachment_file_source,
            agent_attachment_commands::claim_agent_attachments,
            agent_attachment_commands::release_agent_attachment,
            agent_output_artifact_commands::resolve_agent_output_artifact,
            agent_output_artifact_commands::read_agent_output_artifact,
            agent_output_artifact_commands::locate_agent_output_artifact_file,
            agent_output_artifact_commands::reveal_agent_output_artifact_file,
            agent_attachment_commands::read_agent_attachment,
            agent_inline_image_commands::read_agent_inline_image,
            agent_linked_file_commands::read_agent_linked_text_file,
            agent_attachment_commands::reveal_agent_attachment,
            agent_task_commands::acknowledge_agent_task_start,
            agent_task_commands::output_delivery::acknowledge_agent_task_output,
            agent_task_commands::steer_agent_task,
            agent_task_commands::close_agent_task_input,
            agent_task_commands::questions::answer_agent_question,
            agent_task_commands::questions::answer_agent_approval,
            agent_task_commands::runtime_requests::get_agent_thread_requests,
            agent_task_commands::stop_agent_task,
            agent_task_commands::stop_agent_tasks_for_root,
            agent_task_commands::claude_session_composition::interrupt_agent_task,
            agent_task_commands::claude_session_composition::inspect_agent_thread_session,
            agent_task_commands::claude_session_composition::end_agent_thread_session,
            agent_task_commands::claude_session_composition::stop_agent_background_task,
            agent_task_commands::claude_session_composition::list_agent_session_backgrounds,
            agent_task_commands::acquire_agent_root_lease,
            agent_task_commands::release_agent_root_lease,
            agent_history_commands::read_agent_history_threads,
            agent_history_commands::find_agent_history_import,
            agent_history_commands::load_agent_history,
            agent_history_commands::save_agent_history_thread,
            agent_history_commands::save_agent_history_turn_delta,
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
            remote_agent_replay_store_commands::remote_replay_cache_load_thread,
            remote_agent_replay_store_commands::remote_replay_cache_put_task,
            remote_agent_replay_store_commands::remote_replay_cache_remove_thread,
            remote_agent_replay_store_commands::remote_replay_cache_remove_server,
            remote_agent_replay_store_commands::remote_replay_cache_clear,
            agent_session_history_commands::list_external_agent_sessions,
            agent_session_history_commands::preview_external_agent_session,
            agent_session_history_commands::read_external_agent_session_history,
            agent_cli_discovery_commands::discover_agent_clis,
            agent_provider_commands::register_agent_provider_policy,
            agent_provider_commands::get_agent_provider_policy,
            agent_provider_commands::probe_agent_provider_health,
            agent_provider_commands::check_agent_provider_updates,
            agent_provider_commands::update_agent_provider,
            agent_provider_usage_commands::read_agent_provider_usage,
            codex_limit_reset_commands::read_codex_limit_resets,
            codex_limit_reset_commands::prepare_codex_limit_reset,
            codex_limit_reset_commands::consume_codex_limit_reset,
            agent_provider_sign_in_commands::start_agent_provider_sign_in,
            git_integration_commands::get_git_ship_status,
            git_integration_commands::push_git_branch_upstream,
            git_integration_commands::integrate_git_worktree_branch,
            git_surface_commands::get_git_surface_status,
            git_surface_commands::get_git_branch_changes,
            git_surface_commands::get_git_branch_file_diff,
            git_working_tree_commands::get_git_amend_candidate,
            git_working_tree_commands::amend_git_head,
            git_working_tree_commands::prepare_git_discard,
            git_working_tree_commands::discard_git_file,
            pull_request_commands::get_pull_request_context,
            pull_request_commands::create_pull_request,
            git_worktree_commands::list_git_worktrees,
            git_worktree_commands::add_git_worktree,
            git_worktree_commands::add_git_branch_worktree,
            git_worktree_commands::remove_git_worktree,
            git_worktree_commands::prune_git_worktrees,
            crate::local_clone::local_clone_project,
            crate::local_clone::local_get_project_clone,
            crate::local_clone::local_cancel_project_clone,
            crate::repository_identity::get_repository_identity,
            crate::remote_runner::remote_runner_repository_identity,
            repository_lookup_commands::repository_lookup_hosts,
            repository_lookup_commands::repository_lookup,
            repository_lookup_commands::repository_search,
            directory_listing_commands::list_directory_entries,
            directory_listing_commands::open_directory_in_file_manager
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("Error building tauri application: {error}"))
        .run(move |app, event| {
            if let RunEvent::ExitRequested { api, .. } = &event {
                if let Err(error) = shutdown_runtime_processes(app) {
                    eprintln!("Runtime process shutdown refused application exit: {error}");
                    api.prevent_exit();
                    return;
                }
            }
            if matches!(event, RunEvent::Exit) {
                if let Err(error) = shutdown_runtime_processes(app) {
                    eprintln!("Runtime process shutdown failed during application exit: {error}");
                }
            }
        });
}
