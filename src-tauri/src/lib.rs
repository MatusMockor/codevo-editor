include!("agent_runtime_module_registration.rs");
mod application_commands;
mod application_menu;
mod artifact_preview;
mod blocking_command;
mod effective_executable_environment;
mod file_fuzzy_matcher;
pub mod file_watcher;
include!("repository_module_registration.rs");
pub mod ignore_matcher;
mod node_executable;
mod node_package_problem_matcher;
mod node_package_scripts;
mod node_package_tasks;
#[cfg_attr(test, allow(dead_code))]
mod process_task_plan;
mod process_task_resolver;
#[cfg_attr(test, allow(dead_code))]
mod process_task_runtime;
mod project_commands;
mod remote_runner;
mod retained_workspace_root;
mod runtime_task_lifecycle;
mod settings_fonts;
mod terminal;
include!("terminal_module_registration.rs");
mod trust;
#[cfg_attr(test, allow(dead_code))]
mod vscode_process_task_commands;
#[cfg_attr(test, allow(dead_code))]
mod vscode_process_task_events;
#[cfg_attr(test, allow(dead_code))]
mod vscode_process_task_registry;
mod vscode_process_task_tauri;
mod vscode_process_tasks;
mod vscode_tasks_discovery;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod vscode_tasks_discovery_command;
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
#[path = "vscode_tasks_discovery_unsupported.rs"]
mod vscode_tasks_discovery_command;
mod workspace;
mod workspace_commands;
mod workspace_directory_commands;
mod workspace_file_commands;
pub mod workspace_file_watcher;
mod workspace_registry;
mod workspace_runtime;
mod workspace_trust_commands;

#[cfg(target_os = "macos")]
use crate::application_menu::application_menu;
pub(crate) use crate::blocking_command::run_blocking_command;
use crate::runtime_task_lifecycle::shutdown_runtime_processes;
use crate::settings_fonts::cached_monospace_font_families;

use crate::application_commands::{
    confirm_native_shutdown, list_monospace_font_families, quit_application,
    set_native_close_listener_ready, NativeCloseListenerState,
};

use crate::git_commands::{
    detect_git_repositories, get_git_branches, get_git_commit_details, get_git_commit_diff,
    get_git_commit_files, get_git_commit_log, get_git_diff, get_git_repo_status, get_git_status,
};
use crate::terminal_session::TerminalSupervisor;
use crate::trust::WorkspaceTrustService;
use crate::workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use crate::workspace_registry::WorkspaceRegistry;
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
mod lib_composition;

#[cfg(test)]
pub(crate) use lib_composition::registered_runtime_root;
pub use lib_composition::run;
pub(crate) use lib_composition::{canonicalize_workspace_root, trusted_for, GitTrustState};
#[cfg(target_os = "macos")]
pub(crate) use lib_composition::{
    CLOSE_ACTIVE_TAB_MENU_ID, OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID,
};
