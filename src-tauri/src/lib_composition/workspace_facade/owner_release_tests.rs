use super::{
    release_workspace_owner_with_runtime_cleanup, WorkspaceOwnerClose, WorkspaceOwnerCloseOutcome,
};
use crate::workspace_registry::unregister::{WorkspaceAdmissionAdoption, WorkspaceOwnerScope};
use crate::workspace_registry::{RegistrationOwner, WorkspaceId, WorkspaceRegistry};
use crate::workspace_runtime::{
    LanguageServerDisposer, TerminalSessionDisposer, WorkspaceIndexLifecycleDisposer,
    WorkspaceProcessDisposer, WorkspaceRuntimeDisposal, WorkspaceWatchDisposer,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Default)]
struct CountingRuntime {
    watch_stops: AtomicUsize,
    teardowns: AtomicUsize,
}

impl WorkspaceWatchDisposer for CountingRuntime {
    fn stop_workspace_watch(&self, _root_path: &str) {
        self.watch_stops.fetch_add(1, Ordering::SeqCst);
    }
}

impl LanguageServerDisposer for CountingRuntime {
    fn stop_language_server(&self, _root_path: &str) {}
}

impl WorkspaceIndexLifecycleDisposer for CountingRuntime {
    fn cancel_workspace_index_lifecycle(&self, _root_path: &str) {}
}

impl WorkspaceProcessDisposer for CountingRuntime {
    fn stop_workspace_processes(&self, _root_path: &Path) {}
}

impl TerminalSessionDisposer for CountingRuntime {
    fn stop_terminal_sessions(&self, _root_path: &Path) -> Result<(), String> {
        Ok(())
    }
}

fn close(
    registry: &WorkspaceRegistry,
    runtime: &CountingRuntime,
    workspace_id: &WorkspaceId,
    scope: WorkspaceOwnerScope,
) -> WorkspaceOwnerCloseOutcome {
    close_at(registry, runtime, workspace_id, scope, None)
}

fn close_at(
    registry: &WorkspaceRegistry,
    runtime: &CountingRuntime,
    workspace_id: &WorkspaceId,
    scope: WorkspaceOwnerScope,
    expected_canonical_root: Option<&Path>,
) -> WorkspaceOwnerCloseOutcome {
    release_workspace_owner_with_runtime_cleanup(
        registry,
        WorkspaceOwnerClose {
            workspace_id,
            scope,
            expected_canonical_root,
        },
        WorkspaceRuntimeDisposal {
            index_lifecycle: runtime,
            javascript_typescript_language_servers: runtime,
            javascript_typescript_watch_registry: runtime,
            workspace_file_change_watch_registry: runtime,
            php_language_servers: runtime,
            eslint_processes: runtime,
            terminal_sessions: runtime,
        },
        |_| {
            runtime.teardowns.fetch_add(1, Ordering::SeqCst);
        },
        |_, _| {},
    )
    .expect("owner close")
}

fn editor(admission_token: u64) -> WorkspaceOwnerScope {
    WorkspaceOwnerScope::Admission {
        owner: RegistrationOwner::Editor,
        admission_token,
    }
}

fn agent(admission_token: u64) -> WorkspaceOwnerScope {
    WorkspaceOwnerScope::Admission {
        owner: RegistrationOwner::Agent,
        admission_token,
    }
}

fn temporary_workspace(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codevo-owner-{label}-{nonce}"));
    fs::create_dir_all(&root).expect("create workspace");
    root.canonicalize().expect("canonical workspace")
}

#[test]
fn closing_the_editor_first_keeps_the_agent_owner_and_the_last_close_tears_down_once() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("editor-first");
    let editor_tab = registry.register_with_receipt(&root).expect("editor tab");
    let agent_project = registry
        .register_owner_with_receipt(&root, RegistrationOwner::Agent)
        .expect("agent project");
    let id = editor_tab.receipt.workspace_id.clone();
    assert_eq!(agent_project.receipt.workspace_id, id);

    let editor_closed = close(
        &registry,
        &runtime,
        &id,
        editor(editor_tab.receipt.admission_token),
    );

    assert_eq!(
        editor_closed,
        WorkspaceOwnerCloseOutcome::RetainedByOtherOwners
    );
    assert!(registry.descriptor(&id).is_ok());
    assert!(registry.clone_root(&id).is_ok());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 0);
    assert_eq!(runtime.watch_stops.load(Ordering::SeqCst), 0);

    let agent_closed = close(
        &registry,
        &runtime,
        &id,
        agent(agent_project.receipt.admission_token),
    );

    assert_eq!(
        agent_closed,
        WorkspaceOwnerCloseOutcome::Released(Vec::new())
    );
    assert!(registry.descriptor(&id).is_err());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    assert_eq!(runtime.watch_stops.load(Ordering::SeqCst), 2);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn closing_the_agent_first_keeps_the_editor_owner_and_the_last_close_tears_down_once() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("agent-first");
    let editor_tab = registry.register_with_receipt(&root).expect("editor tab");
    let agent_project = registry
        .register_owner_with_receipt(&root, RegistrationOwner::Agent)
        .expect("agent project");
    let id = editor_tab.receipt.workspace_id.clone();

    let agent_closed = close(
        &registry,
        &runtime,
        &id,
        agent(agent_project.receipt.admission_token),
    );

    assert_eq!(
        agent_closed,
        WorkspaceOwnerCloseOutcome::RetainedByOtherOwners
    );
    assert!(registry.clone_root(&id).is_ok());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 0);

    let editor_closed = close(
        &registry,
        &runtime,
        &id,
        editor(editor_tab.receipt.admission_token),
    );

    assert_eq!(
        editor_closed,
        WorkspaceOwnerCloseOutcome::Released(Vec::new())
    );
    assert!(registry.descriptor(&id).is_err());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn a_concurrent_close_during_teardown_reports_releasing() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("releasing");
    let tab = registry.register_with_receipt(&root).expect("tab");
    let id = tab.receipt.workspace_id.clone();
    let release = registry
        .release_owner(&id, editor(tab.receipt.admission_token), None)
        .expect("reserve teardown");

    let concurrent = close(
        &registry,
        &runtime,
        &id,
        editor(tab.receipt.admission_token),
    );

    assert_eq!(concurrent, WorkspaceOwnerCloseOutcome::Releasing);
    assert!(matches!(
        release,
        crate::workspace_registry::unregister::WorkspaceOwnerRelease::LastOwner(_)
    ));
    drop(release);
    assert!(registry.clone_root(&id).is_ok());
    fs::remove_dir_all(root).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn symlink_alias_tab_and_canonical_tab_close_independently() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("alias-canonical");
    let alias = root.with_extension("alias");
    std::os::unix::fs::symlink(&root, &alias).expect("alias");
    let canonical_tab = registry
        .register_with_receipt(&root)
        .expect("canonical tab");
    let alias_tab = registry.register_with_receipt(&alias).expect("alias tab");
    let id = canonical_tab.receipt.workspace_id.clone();
    assert_eq!(alias_tab.receipt.workspace_id, id);

    let alias_closed = close(
        &registry,
        &runtime,
        &id,
        editor(alias_tab.receipt.admission_token),
    );

    assert_eq!(
        alias_closed,
        WorkspaceOwnerCloseOutcome::RetainedByOtherOwners
    );
    assert_eq!(
        registry
            .descriptor_for_registered_path(&root)
            .expect("canonical path still resolves")
            .workspace_id,
        id
    );
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 0);

    let canonical_closed = close(
        &registry,
        &runtime,
        &id,
        editor(canonical_tab.receipt.admission_token),
    );
    let repeated = close(
        &registry,
        &runtime,
        &id,
        editor(canonical_tab.receipt.admission_token),
    );

    assert_eq!(
        canonical_closed,
        WorkspaceOwnerCloseOutcome::Released(Vec::new())
    );
    assert_eq!(repeated, WorkspaceOwnerCloseOutcome::UnknownWorkspace);
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_file(alias).expect("cleanup alias");
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn a_b_a_stale_close_of_the_first_generation_never_tears_down_the_reopened_workspace() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root_a = temporary_workspace("aba-a");
    let root_b = temporary_workspace("aba-b");
    let first_a = registry.register_with_receipt(&root_a).expect("A1");
    let first_a_id = first_a.receipt.workspace_id.clone();
    assert_eq!(
        close(
            &registry,
            &runtime,
            &first_a_id,
            editor(first_a.receipt.admission_token)
        ),
        WorkspaceOwnerCloseOutcome::Released(Vec::new())
    );
    let b = registry.register_with_receipt(&root_b).expect("B");
    let second_a = registry.register_with_receipt(&root_a).expect("A2");
    let agent_a = registry
        .register_owner_with_receipt(&root_a, RegistrationOwner::Agent)
        .expect("agent on A2");

    let stale_first = close(
        &registry,
        &runtime,
        &first_a_id,
        editor(first_a.receipt.admission_token),
    );
    let stale_on_second = close(
        &registry,
        &runtime,
        &second_a.receipt.workspace_id,
        editor(first_a.receipt.admission_token),
    );

    assert_ne!(first_a_id, second_a.receipt.workspace_id);
    assert_eq!(stale_first, WorkspaceOwnerCloseOutcome::UnknownWorkspace);
    assert_eq!(stale_on_second, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert!(registry.clone_root(&second_a.receipt.workspace_id).is_ok());
    assert!(registry.clone_root(&b.receipt.workspace_id).is_ok());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    assert_eq!(agent_a.receipt.workspace_id, second_a.receipt.workspace_id);
    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

const OWNER_RELEASE_CONTRACT: &str =
    include_str!("../../../../contracts/workspace-owner-release-wire.json");

fn contract_statuses(command: &str) -> Vec<String> {
    let contract: serde_json::Value =
        serde_json::from_str(OWNER_RELEASE_CONTRACT).expect("owner release contract");
    contract[command]["statuses"]
        .as_array()
        .expect("contract statuses")
        .iter()
        .map(|status| status.as_str().expect("status").to_string())
        .collect()
}

fn wire_status(value: impl serde::Serialize) -> String {
    let wire = serde_json::to_value(value).expect("serialize");
    wire["status"].as_str().expect("status tag").to_string()
}

#[test]
fn owner_close_result_matches_the_shared_wire_contract() {
    use super::WorkspaceOwnerCloseResult;

    let statuses = [
        WorkspaceOwnerCloseResult::Released,
        WorkspaceOwnerCloseResult::Releasing,
        WorkspaceOwnerCloseResult::RetainedByOtherOwners,
        WorkspaceOwnerCloseResult::UnknownWorkspace,
        WorkspaceOwnerCloseResult::StaleOwner,
    ]
    .into_iter()
    .map(wire_status)
    .collect::<Vec<_>>();

    assert_eq!(statuses, contract_statuses("unregisterWorkspace"));
    assert_eq!(statuses, contract_statuses("rollbackWorkspaceRegistration"));
}

#[test]
fn dispose_registered_result_matches_the_shared_wire_contract() {
    use super::DisposeRegisteredWorkspaceResult;

    let statuses = [
        DisposeRegisteredWorkspaceResult::Closed,
        DisposeRegisteredWorkspaceResult::UnknownWorkspace,
        DisposeRegisteredWorkspaceResult::Releasing,
        DisposeRegisteredWorkspaceResult::RetainedByOtherOwners,
        DisposeRegisteredWorkspaceResult::Incomplete { errors: Vec::new() },
    ]
    .into_iter()
    .map(wire_status)
    .collect::<Vec<_>>();

    assert_eq!(statuses, contract_statuses("disposeRegisteredWorkspace"));
}

fn editor_ownership(admission_token: u64) -> WorkspaceOwnerScope {
    WorkspaceOwnerScope::EditorOwnership { admission_token }
}

fn adopt(registry: &WorkspaceRegistry, workspace_id: &WorkspaceId, new: u64, replaced: u64) {
    assert_eq!(
        registry
            .adopt_admission(workspace_id, new, replaced)
            .expect("adopt admission"),
        WorkspaceAdmissionAdoption::Adopted
    );
}

#[test]
fn editor_ownership_release_is_exact_and_refuses_a_superseded_controller() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("editor-ownership");
    let foreign_root = temporary_workspace("editor-ownership-foreign");
    let stale_tab = registry
        .register_with_receipt(&root)
        .expect("stale controller tab");
    let current_tab = registry
        .register_with_receipt(&root)
        .expect("current controller tab");
    let agent_project = registry
        .register_owner_with_receipt(&root, RegistrationOwner::Agent)
        .expect("agent project");
    let id = current_tab.receipt.workspace_id.clone();

    let foreign = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(current_tab.receipt.admission_token),
        Some(&foreign_root),
    );
    let stale = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(stale_tab.receipt.admission_token),
        Some(&root),
    );
    let agent_token = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(agent_project.receipt.admission_token),
        Some(&root),
    );
    let released = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(current_tab.receipt.admission_token),
        Some(&root),
    );

    assert_eq!(foreign, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert_eq!(stale, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert_eq!(agent_token, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert_eq!(released, WorkspaceOwnerCloseOutcome::RetainedByOtherOwners);
    assert!(registry.clone_root(&id).is_ok());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(root).expect("cleanup");
    fs::remove_dir_all(foreign_root).expect("cleanup foreign");
}

#[test]
fn reopening_the_same_tab_then_adopting_and_closing_tears_down_once() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("same-path-twice");
    let first = registry.register_with_receipt(&root).expect("first open");
    let second = registry
        .register_with_receipt(&root)
        .expect("reopen same tab");
    let id = second.receipt.workspace_id.clone();

    adopt(
        &registry,
        &id,
        second.receipt.admission_token,
        first.receipt.admission_token,
    );
    let stale = close(
        &registry,
        &runtime,
        &id,
        editor(first.receipt.admission_token),
    );
    let closed = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(second.receipt.admission_token),
        Some(&root),
    );

    assert_eq!(stale, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert_eq!(closed, WorkspaceOwnerCloseOutcome::Released(Vec::new()));
    assert!(registry.descriptor(&id).is_err());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn switching_a_b_a_with_adoption_then_closing_a_tears_down_a_exactly_once() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root_a = temporary_workspace("switch-a");
    let root_b = temporary_workspace("switch-b");
    let first_a = registry.register_with_receipt(&root_a).expect("open A");
    let b = registry
        .register_with_receipt(&root_b)
        .expect("switch to B");
    let reactivated_a = registry
        .register_with_receipt(&root_a)
        .expect("switch back to A");
    let id_a = reactivated_a.receipt.workspace_id.clone();
    adopt(
        &registry,
        &id_a,
        reactivated_a.receipt.admission_token,
        first_a.receipt.admission_token,
    );

    let closed = close(
        &registry,
        &runtime,
        &id_a,
        editor(reactivated_a.receipt.admission_token),
    );

    assert_eq!(closed, WorkspaceOwnerCloseOutcome::Released(Vec::new()));
    assert!(registry.descriptor(&id_a).is_err());
    assert!(registry.clone_root(&b.receipt.workspace_id).is_ok());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

#[test]
fn two_hundred_adopted_tab_switches_never_exhaust_the_admission_limit() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root_a = temporary_workspace("many-switches-a");
    let root_b = temporary_workspace("many-switches-b");
    let mut owned_a = registry.register_with_receipt(&root_a).expect("open A");
    let mut owned_b = registry.register_with_receipt(&root_b).expect("open B");
    for _ in 0..200 {
        let next_b = registry
            .register_with_receipt(&root_b)
            .expect("switch to B");
        adopt(
            &registry,
            &next_b.receipt.workspace_id,
            next_b.receipt.admission_token,
            owned_b.receipt.admission_token,
        );
        owned_b = next_b;
        let next_a = registry
            .register_with_receipt(&root_a)
            .expect("switch to A");
        adopt(
            &registry,
            &next_a.receipt.workspace_id,
            next_a.receipt.admission_token,
            owned_a.receipt.admission_token,
        );
        owned_a = next_a;
    }

    let closed = close(
        &registry,
        &runtime,
        &owned_a.receipt.workspace_id,
        editor(owned_a.receipt.admission_token),
    );

    assert_eq!(closed, WorkspaceOwnerCloseOutcome::Released(Vec::new()));
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

#[test]
fn overlapping_reopens_rolled_back_keep_the_owned_admission() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("overlapping-reopens");
    let owned = registry.register_with_receipt(&root).expect("T1 owned");
    let second = registry.register_with_receipt(&root).expect("T2 reopen");
    let third = registry.register_with_receipt(&root).expect("T3 reopen");
    let id = owned.receipt.workspace_id.clone();

    let rolled_back_second = close(
        &registry,
        &runtime,
        &id,
        editor(second.receipt.admission_token),
    );
    let repeated_second = close(
        &registry,
        &runtime,
        &id,
        editor(second.receipt.admission_token),
    );
    let rolled_back_third = close(
        &registry,
        &runtime,
        &id,
        editor(third.receipt.admission_token),
    );

    assert_eq!(
        rolled_back_second,
        WorkspaceOwnerCloseOutcome::RetainedByOtherOwners
    );
    assert_eq!(repeated_second, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert_eq!(
        rolled_back_third,
        WorkspaceOwnerCloseOutcome::RetainedByOtherOwners
    );
    assert!(registry.clone_root(&id).is_ok());
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 0);

    let closed = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(owned.receipt.admission_token),
        Some(&root),
    );

    assert_eq!(closed, WorkspaceOwnerCloseOutcome::Released(Vec::new()));
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn adopting_the_newest_reopen_while_an_older_reopen_is_pending_keeps_both_until_rollback() {
    let registry = WorkspaceRegistry::new();
    let runtime = CountingRuntime::default();
    let root = temporary_workspace("adopt-while-pending");
    let owned = registry.register_with_receipt(&root).expect("T1 owned");
    let pending = registry.register_with_receipt(&root).expect("T2 pending");
    let newest = registry.register_with_receipt(&root).expect("T3 newest");
    let id = owned.receipt.workspace_id.clone();

    adopt(
        &registry,
        &id,
        newest.receipt.admission_token,
        owned.receipt.admission_token,
    );
    let stale_owned = close(
        &registry,
        &runtime,
        &id,
        editor(owned.receipt.admission_token),
    );
    let rolled_back_pending = close(
        &registry,
        &runtime,
        &id,
        editor(pending.receipt.admission_token),
    );

    assert_eq!(stale_owned, WorkspaceOwnerCloseOutcome::StaleOwner);
    assert_eq!(
        rolled_back_pending,
        WorkspaceOwnerCloseOutcome::RetainedByOtherOwners
    );
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 0);

    let closed = close_at(
        &registry,
        &runtime,
        &id,
        editor_ownership(newest.receipt.admission_token),
        Some(&root),
    );

    assert_eq!(closed, WorkspaceOwnerCloseOutcome::Released(Vec::new()));
    assert_eq!(runtime.teardowns.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn adoption_refuses_an_unpublished_or_foreign_new_admission() {
    let registry = WorkspaceRegistry::new();
    let root = temporary_workspace("adopt-refusals");
    let owned = registry.register_with_receipt(&root).expect("owned");
    let agent_project = registry
        .register_owner_with_receipt(&root, RegistrationOwner::Agent)
        .expect("agent");
    let id = owned.receipt.workspace_id.clone();

    let agent_as_new = registry
        .adopt_admission(
            &id,
            agent_project.receipt.admission_token,
            owned.receipt.admission_token,
        )
        .expect("adopt agent token");
    let owned_replacing_agent = registry
        .adopt_admission(
            &id,
            owned.receipt.admission_token,
            agent_project.receipt.admission_token,
        )
        .expect("adopt replacing agent");
    let unknown = registry
        .adopt_admission(
            &serde_json::from_str::<WorkspaceId>("\"missing\"").expect("id"),
            1,
            2,
        )
        .expect("adopt unknown");

    assert_eq!(agent_as_new, WorkspaceAdmissionAdoption::StaleAdmission);
    assert_eq!(owned_replacing_agent, WorkspaceAdmissionAdoption::Adopted);
    assert!(registry
        .release_owner(&id, agent(agent_project.receipt.admission_token), None)
        .is_ok());
    assert_eq!(unknown, WorkspaceAdmissionAdoption::UnknownWorkspace);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn adoption_result_matches_the_shared_wire_contract() {
    use super::super::lifecycle_commands::WorkspaceAdmissionAdoptionResult;

    let statuses = [
        WorkspaceAdmissionAdoptionResult::Adopted,
        WorkspaceAdmissionAdoptionResult::StaleAdmission,
        WorkspaceAdmissionAdoptionResult::UnknownWorkspace,
        WorkspaceAdmissionAdoptionResult::Releasing,
    ]
    .into_iter()
    .map(wire_status)
    .collect::<Vec<_>>();

    assert_eq!(statuses, contract_statuses("adoptWorkspaceAdmission"));
}
