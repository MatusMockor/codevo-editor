use super::super::shell_test_support::{
    shell_host_for, within_deadline, ShellHostPids, ShellHostSpawner,
};
use super::super::{
    CodexAppServerHost, CodexAppServerHostRegistry, ThreadHandle,
    CODEX_HOST_REPLACEMENT_PENDING_ERROR,
};
use super::*;
use crate::agent_task_spawner::codex_app_server_protocol::{ThreadStartParams, TurnStartParams};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

const PARENT_PROJECT: &str = "/parent";
const NESTED_PROJECT: &str = "/parent/nested";
const OTHER_PROJECT: &str = "/other";

fn registry() -> CodexAppServerHostRegistry {
    CodexAppServerHostRegistry::new(Arc::new(ShellHostSpawner::default()))
}

fn host_serving(
    registry: &CodexAppServerHostRegistry,
    repository: &str,
    project: &str,
) -> Arc<CodexAppServerHost> {
    shell_host_for(registry, Path::new(repository), Path::new(project)).expect("shell host")
}

fn open_thread(host: &CodexAppServerHost) -> Result<ThreadHandle, String> {
    host.start_thread(ThreadStartParams {
        cwd: None,
        model: None,
        sandbox: None,
        approval_policy: None,
        developer_instructions: None,
    })
    .map_err(|failure| failure.message())
}

fn turn_on(thread: &ThreadHandle) -> TurnStartParams {
    TurnStartParams {
        thread_id: thread.thread_id().to_string(),
        input: Vec::new(),
        cwd: None,
        model: None,
        approval_policy: None,
        sandbox_policy: None,
        effort: None,
        client_user_message_id: None,
        turn_trigger: None,
    }
}

#[test]
fn revoked_trust_retires_the_idle_host_of_that_project_off_the_calling_thread_and_reaps_its_group()
{
    let (spawner, stop) = ShellHostSpawner::holding_the_first_stop();
    let registry = CodexAppServerHostRegistry::new(Arc::new(spawner));
    let shared = host_serving(&registry, NESTED_PROJECT, NESTED_PROJECT);
    assert!(Arc::ptr_eq(
        &shared,
        &host_serving(&registry, NESTED_PROJECT, PARENT_PROJECT)
    ));
    let other = host_serving(&registry, OTHER_PROJECT, OTHER_PROJECT);
    let revoked_pids = ShellHostPids::of(&shared);
    let other_pids = ShellHostPids::of(&other);

    registry.retire_for_revoked_trust(Path::new(NESTED_PROJECT));

    assert!(!shared.is_ready());
    assert!(open_thread(&shared).is_err());
    assert_eq!(registry.host_count(), 1);
    stop.await_held_stop();
    assert!(revoked_pids.alive());
    stop.release_stop();
    assert!(revoked_pids.gone_within_deadline());
    assert!(stop.released_in_time());
    assert!(other.is_ready());
    assert!(other_pids.alive());
    registry.drain_for_dispose();
    assert!(other_pids.gone_within_deadline());
}

#[test]
fn a_host_another_trusted_project_is_using_outlives_the_revocation_until_that_turn_ends() {
    let registry = registry();
    let host = host_serving(&registry, NESTED_PROJECT, NESTED_PROJECT);
    assert!(Arc::ptr_eq(
        &host,
        &host_serving(&registry, NESTED_PROJECT, PARENT_PROJECT)
    ));
    let pids = ShellHostPids::of(&host);
    let parent_thread = open_thread(&host).expect("thread of the parent project");

    registry.retire_for_revoked_trust(Path::new(NESTED_PROJECT));

    let parent_turn = host
        .start_turn(&parent_thread, turn_on(&parent_thread))
        .expect("the parent project's opened thread still starts its turn");
    assert!(host.is_ready());
    assert_eq!(host.live_turns(), 1);
    assert!(pids.alive());
    assert!(open_thread(&host).is_err());
    for project in [NESTED_PROJECT, PARENT_PROJECT] {
        assert_eq!(
            shell_host_for(&registry, Path::new(NESTED_PROJECT), Path::new(project)).err(),
            Some(CODEX_HOST_REPLACEMENT_PENDING_ERROR.to_string())
        );
    }

    drop(parent_turn);
    drop(parent_thread);

    assert!(within_deadline(|| !host.is_ready()));
    assert!(pids.gone_within_deadline());
    let fresh = host_serving(&registry, NESTED_PROJECT, NESTED_PROJECT);
    assert!(!Arc::ptr_eq(&host, &fresh));
    let fresh_pids = ShellHostPids::of(&fresh);
    registry.drain_for_dispose();
    assert!(fresh_pids.gone_within_deadline());
}

#[test]
fn a_drained_host_is_still_reaped_and_released_after_its_first_stop_panics() {
    let registry =
        CodexAppServerHostRegistry::new(Arc::new(ShellHostSpawner::panicking_on_the_first_stop()));
    let host = host_serving(&registry, NESTED_PROJECT, NESTED_PROJECT);
    assert!(Arc::ptr_eq(
        &host,
        &host_serving(&registry, NESTED_PROJECT, PARENT_PROJECT)
    ));
    let pids = ShellHostPids::of(&host);
    let parent_thread = open_thread(&host).expect("thread of the parent project");
    registry.retire_for_revoked_trust(Path::new(NESTED_PROJECT));
    assert!(pids.alive());

    drop(parent_thread);

    assert!(pids.gone_within_deadline());
    assert!(!host.is_ready());
    registry.retire_idle_before(Instant::now());
    assert_eq!(registry.host_count(), 0);
}

#[test]
fn only_the_exact_trust_root_a_host_served_retires_it() {
    let registry = registry();
    let host = host_serving(&registry, NESTED_PROJECT, PARENT_PROJECT);
    let pids = ShellHostPids::of(&host);

    for unserved in [NESTED_PROJECT, OTHER_PROJECT, "/"] {
        registry.retire_for_revoked_trust(Path::new(unserved));
    }

    assert!(host.is_ready());
    assert_eq!(registry.host_count(), 1);
    drop(open_thread(&host).expect("the host still opens threads"));

    registry.retire_for_revoked_trust(Path::new(PARENT_PROJECT));

    assert!(!host.is_ready());
    assert_eq!(registry.host_count(), 0);
    assert!(pids.gone_within_deadline());
}

#[test]
fn a_host_serves_a_bounded_number_of_projects() {
    let registry = registry();
    let mut project = PathBuf::from("/");
    let ancestors: Vec<PathBuf> = (0..=MAX_CODEX_HOST_TRUST_ROOTS)
        .map(|depth| {
            project.push(format!("level-{depth}"));
            project.clone()
        })
        .collect();
    let repository = ancestors.last().expect("deepest root").clone();
    let host = shell_host_for(&registry, &repository, &ancestors[0]).expect("first project");
    let pids = ShellHostPids::of(&host);
    for served in &ancestors[..MAX_CODEX_HOST_TRUST_ROOTS] {
        shell_host_for(&registry, &repository, served).expect("served project");
    }

    let refused = shell_host_for(&registry, &repository, &repository);

    assert_eq!(
        refused.err(),
        Some(CODEX_HOST_TRUST_ROOT_LIMIT_ERROR.to_string())
    );
    assert!(host.is_ready());
    registry.drain_for_dispose();
    assert!(pids.gone_within_deadline());
}
