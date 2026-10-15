use super::{
    create_git_branch, delete_git_branch, fetch_git_changes, get_git_current_branch,
    list_git_branches, normalize_path, read_directory, register_picker_path_in_registry,
    register_workspace_path_in_registry, reveal_path_in_workspace, search_files, stage_git_files,
    switch_git_branch, workspace_root_for_disposal,
};
use crate::application_commands::enumerate_monospace_font_families;
use crate::git_commands::get_git_status;
use crate::settings_fonts::cached_monospace_font_families;
use crate::workspace::FileEntryKind;
use crate::workspace_registry::WorkspaceRegistry;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

include!("test_git_commands.rs");
include!("test_git_history_and_branches.rs");
include!("test_workspace_guards.rs");
include!("test_runtime_trust.rs");
