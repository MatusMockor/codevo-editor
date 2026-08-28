use crate::{
    agent_task_spawner::{
        agent_provider::{
            process::AgentProviderSignInRecipe,
            runtime::{
                AgentProviderRuntimeRegistry, ProviderSignInLease,
                AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR, AGENT_PROVIDER_DISABLED_ERROR,
                AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR, AGENT_PROVIDER_STALE_ERROR,
                AGENT_PROVIDER_TURN_ACTIVE_ERROR, AGENT_PROVIDER_UPDATING_ERROR,
            },
        },
        AgentCliInvocation,
    },
    terminal::{TerminalEventSink, TerminalRuntimeStatus, TerminalSize},
    terminal_session::{
        spawn_prepared_command_with_child, SpawnedTerminal, TerminalChild, TerminalExitStatus,
        TerminalLaunchRequest, TerminalPtySpawner, TerminalSupervisor,
    },
};
use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::{
    io,
    num::{NonZeroU16, NonZeroU64},
    path::PathBuf,
    sync::{Arc, Mutex},
};

const SIGN_IN_AUTHORITY_CHANGED: &str = "Provider sign-in authority changed before launch.";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProviderSignInSize {
    cols: NonZeroU16,
    rows: NonZeroU16,
}

impl From<AgentProviderSignInSize> for TerminalSize {
    fn from(size: AgentProviderSignInSize) -> Self {
        Self {
            cols: size.cols.get(),
            rows: size.rows.get(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProviderSignInRequest {
    pub provider: AgentCliInvocation,
    pub provider_generation: NonZeroU64,
    pub size: AgentProviderSignInSize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentProviderSignInRefusalReason {
    Disabled,
    NotConfigured,
    TurnActive,
    Updating,
    AlreadySigningIn,
    StaleAuthority,
    SpawnFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentProviderSignInResult {
    Started {
        provider: AgentCliInvocation,
        provider_generation: u64,
        session_id: u64,
    },
    Refused {
        provider: AgentCliInvocation,
        provider_generation: u64,
        reason: AgentProviderSignInRefusalReason,
    },
}

pub fn start_agent_provider_sign_in(
    request: AgentProviderSignInRequest,
    registry: &Arc<AgentProviderRuntimeRegistry>,
    terminal: &TerminalSupervisor,
    sink: Arc<dyn TerminalEventSink>,
) -> AgentProviderSignInResult {
    let provider = request.provider;
    let generation = request.provider_generation.get();
    let lease = match registry.acquire_sign_in(provider, generation) {
        Ok(lease) => lease,
        Err(error) => {
            return refused(provider, generation, map_admission_error(&error));
        }
    };
    let recipe = match AgentProviderSignInRecipe::new(&lease.cli_path, provider) {
        Ok(recipe) => recipe,
        Err(_) => {
            return refused(
                provider,
                generation,
                AgentProviderSignInRefusalReason::NotConfigured,
            );
        }
    };
    let cli_path = lease.cli_path.clone();
    let spawner = AgentProviderSignInPtySpawner {
        recipe,
        registry: Arc::clone(registry),
        provider,
        generation,
        cli_path,
        lease: Mutex::new(Some(lease)),
    };
    match terminal.start_semantic_session(
        provider_sign_in_cwd(),
        request.size.into(),
        &spawner,
        sink,
    ) {
        Ok(TerminalRuntimeStatus::Running { session_id, .. }) => {
            AgentProviderSignInResult::Started {
                provider,
                provider_generation: generation,
                session_id,
            }
        }
        Ok(_) => refused(
            provider,
            generation,
            AgentProviderSignInRefusalReason::SpawnFailed,
        ),
        Err(error) if error == SIGN_IN_AUTHORITY_CHANGED => refused(
            provider,
            generation,
            AgentProviderSignInRefusalReason::StaleAuthority,
        ),
        Err(_) => refused(
            provider,
            generation,
            AgentProviderSignInRefusalReason::SpawnFailed,
        ),
    }
}

struct AgentProviderSignInPtySpawner {
    recipe: AgentProviderSignInRecipe,
    registry: Arc<AgentProviderRuntimeRegistry>,
    provider: AgentCliInvocation,
    generation: u64,
    cli_path: String,
    lease: Mutex<Option<ProviderSignInLease>>,
}

impl TerminalPtySpawner for AgentProviderSignInPtySpawner {
    fn spawn(&self, request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
        let lease = self
            .lease
            .lock()
            .map_err(|error| error.to_string())?
            .take()
            .ok_or_else(|| "Provider sign-in spawn authority was already consumed.".to_string())?;
        let mut command = CommandBuilder::new(self.recipe.program());
        command.args(self.recipe.args());
        command.env_clear();
        for (key, value) in self.recipe.env() {
            command.env(key, value);
        }
        spawn_prepared_command_with_child(
            request,
            command,
            || {
                if !self.recipe.identity_is_current()
                    || self
                        .registry
                        .revalidate_sign_in_authority(
                            self.provider,
                            self.generation,
                            &self.cli_path,
                        )
                        .is_err()
                    || !self.recipe.identity_is_current()
                {
                    return Err(SIGN_IN_AUTHORITY_CHANGED.to_string());
                }
                Ok(())
            },
            move |child| {
                Box::new(SignInTerminalChild {
                    child: Some(child),
                    lease: Some(lease),
                })
            },
        )
    }
}

struct SignInTerminalChild {
    child: Option<Box<dyn TerminalChild>>,
    lease: Option<ProviderSignInLease>,
}

impl SignInTerminalChild {
    fn child(&self) -> &dyn TerminalChild {
        self.child.as_deref().expect("sign-in terminal child")
    }

    fn child_mut(&mut self) -> &mut dyn TerminalChild {
        self.child.as_deref_mut().expect("sign-in terminal child")
    }

    fn release_after_reap(&mut self) {
        self.lease.take();
    }
}

impl TerminalChild for SignInTerminalChild {
    fn clone_killer(&self) -> Box<dyn crate::terminal_session::TerminalKiller> {
        self.child().clone_killer()
    }

    fn process_id(&self) -> Option<u32> {
        self.child().process_id()
    }

    fn try_wait(&mut self) -> io::Result<Option<TerminalExitStatus>> {
        let status = self.child_mut().try_wait()?;
        if status.is_some() {
            self.release_after_reap();
        }
        Ok(status)
    }

    fn wait(&mut self) -> io::Result<TerminalExitStatus> {
        let status = self.child_mut().wait()?;
        self.release_after_reap();
        Ok(status)
    }
}

impl Drop for SignInTerminalChild {
    fn drop(&mut self) {
        let Some(lease) = self.lease.take() else {
            return;
        };
        let Some(child) = self.child.as_deref_mut() else {
            std::mem::forget(lease);
            return;
        };
        loop {
            match child.wait() {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Ok(_) => return,
                Err(_) => {
                    // Without proof that the child was reaped, retain fail-closed provider
                    // exclusion for the rest of this process lifetime.
                    std::mem::forget(lease);
                    return;
                }
            }
        }
    }
}

#[cfg(unix)]
fn provider_sign_in_cwd() -> PathBuf {
    PathBuf::from("/")
}

#[cfg(not(unix))]
fn provider_sign_in_cwd() -> PathBuf {
    std::env::temp_dir()
}

fn refused(
    provider: AgentCliInvocation,
    provider_generation: u64,
    reason: AgentProviderSignInRefusalReason,
) -> AgentProviderSignInResult {
    AgentProviderSignInResult::Refused {
        provider,
        provider_generation,
        reason,
    }
}

fn map_admission_error(error: &str) -> AgentProviderSignInRefusalReason {
    match error {
        AGENT_PROVIDER_DISABLED_ERROR => AgentProviderSignInRefusalReason::Disabled,
        AGENT_PROVIDER_TURN_ACTIVE_ERROR => AgentProviderSignInRefusalReason::TurnActive,
        AGENT_PROVIDER_UPDATING_ERROR | AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR => {
            AgentProviderSignInRefusalReason::Updating
        }
        AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR => {
            AgentProviderSignInRefusalReason::AlreadySigningIn
        }
        AGENT_PROVIDER_STALE_ERROR => AgentProviderSignInRefusalReason::StaleAuthority,
        _ if error.contains("not configured") => AgentProviderSignInRefusalReason::NotConfigured,
        _ => AgentProviderSignInRefusalReason::StaleAuthority,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_task_spawner::agent_provider::runtime::{
            AgentProviderPolicy, AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR,
        },
        terminal::{TerminalOutputEvent, TerminalRuntimeStatus},
    };
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Condvar,
        },
        thread,
        time::Duration,
    };

    static NONCE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        directory: PathBuf,
        executable: PathBuf,
    }

    impl Fixture {
        fn new(body: &str) -> Self {
            let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
            let directory = std::env::temp_dir().join(format!(
                "codevo-provider-sign-in-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&directory).expect("fixture directory");
            let executable = directory.join("provider");
            fs::write(&executable, format!("#!/bin/sh\n{body}\n")).expect("fake provider");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
                    .expect("fake provider executable");
            }
            Self {
                directory,
                executable,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    struct ChannelSink {
        statuses: mpsc::Sender<TerminalRuntimeStatus>,
        outputs: mpsc::Sender<TerminalOutputEvent>,
    }

    impl TerminalEventSink for ChannelSink {
        fn emit_output(&self, event: TerminalOutputEvent) {
            self.outputs.send(event).expect("output receiver");
        }

        fn emit_status(&self, status: TerminalRuntimeStatus) {
            self.statuses.send(status).expect("status receiver");
        }
    }

    fn registered(
        fixture: &Fixture,
    ) -> (Arc<AgentProviderRuntimeRegistry>, u64, AgentCliInvocation) {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let provider = AgentCliInvocation::ClaudeCode;
        let receipt = registry
            .register_policy(
                provider,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(fixture.executable.to_string_lossy().into_owned()),
                    check_for_updates: false,
                },
            )
            .expect("policy");
        (registry, receipt.provider_generation, provider)
    }

    fn request(
        provider: AgentCliInvocation,
        provider_generation: u64,
    ) -> AgentProviderSignInRequest {
        AgentProviderSignInRequest {
            provider,
            provider_generation: NonZeroU64::new(provider_generation)
                .expect("registered provider generations are positive"),
            size: AgentProviderSignInSize {
                cols: NonZeroU16::new(80).expect("cols"),
                rows: NonZeroU16::new(24).expect("rows"),
            },
        }
    }

    #[cfg(unix)]
    #[test]
    fn sign_in_lease_is_retained_until_the_terminal_is_stopped_and_reaped() {
        let fixture = Fixture::new("printf 'argv:%s:%s:%s\\n' \"$#\" \"$1\" \"$2\"; read ignored");
        let (registry, generation, provider) = registered(&fixture);
        let terminal = TerminalSupervisor::new();
        let (status_tx, status_rx) = mpsc::channel();
        let (output_tx, output_rx) = mpsc::channel();
        let result = start_agent_provider_sign_in(
            request(provider, generation),
            &registry,
            &terminal,
            Arc::new(ChannelSink {
                statuses: status_tx,
                outputs: output_tx,
            }),
        );
        let AgentProviderSignInResult::Started { session_id, .. } = result else {
            panic!("sign in should start: {result:?}");
        };
        let statuses = [
            status_rx.recv().expect("starting status"),
            status_rx.recv().expect("running status"),
        ];
        assert!(statuses.iter().any(|status| matches!(
            status,
            TerminalRuntimeStatus::Running { cwd, .. } if cwd == "/"
        )));
        assert!(statuses.iter().all(|status| {
            !serde_json::to_string(status)
                .expect("terminal status wire")
                .contains(fixture.executable.to_str().expect("provider path"))
        }));
        terminal
            .acknowledge_start(session_id)
            .expect("acknowledge terminal");
        let output = output_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("fake provider argv output");
        assert!(
            output.data.contains("argv:2:auth:login"),
            "unexpected provider argv output: {:?}",
            output.data
        );
        assert_eq!(
            registry
                .acquire_turn(
                    provider,
                    generation,
                    fixture.executable.to_str().expect("path"),
                )
                .err(),
            Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string())
        );
        terminal.stop(session_id).expect("stop terminal");
        assert!(registry
            .acquire_turn(
                provider,
                generation,
                fixture.executable.to_str().expect("path"),
            )
            .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn natural_exit_releases_the_sign_in_lease_after_the_waiter_reaps() {
        let fixture = Fixture::new("exit 0");
        let (registry, generation, provider) = registered(&fixture);
        let terminal = TerminalSupervisor::new();
        let (status_tx, status_rx) = mpsc::channel();
        let (output_tx, _output_rx) = mpsc::channel();
        let result = start_agent_provider_sign_in(
            request(provider, generation),
            &registry,
            &terminal,
            Arc::new(ChannelSink {
                statuses: status_tx,
                outputs: output_tx,
            }),
        );
        let AgentProviderSignInResult::Started { session_id, .. } = result else {
            panic!("sign in should start: {result:?}");
        };
        terminal
            .acknowledge_start(session_id)
            .expect("acknowledge terminal");
        loop {
            let status = status_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("terminal settlement");
            if matches!(
                status,
                TerminalRuntimeStatus::Exited {
                    session_id: settled,
                    ..
                } if settled == session_id
            ) {
                break;
            }
        }
        assert!(registry.acquire_sign_in(provider, generation).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_stops_and_reaps_the_pty_before_waiting_for_provider_drain() {
        let fixture = Fixture::new("read ignored");
        let (registry, generation, provider) = registered(&fixture);
        let terminal = TerminalSupervisor::new();
        let (status_tx, _status_rx) = mpsc::channel();
        let (output_tx, _output_rx) = mpsc::channel();
        let result = start_agent_provider_sign_in(
            request(provider, generation),
            &registry,
            &terminal,
            Arc::new(ChannelSink {
                statuses: status_tx,
                outputs: output_tx,
            }),
        );
        assert!(matches!(result, AgentProviderSignInResult::Started { .. }));

        registry.close_operation_admission();
        terminal.stop_all();
        assert!(registry.shutdown_operations(Duration::ZERO));
    }

    struct BlockingChild {
        entered: Option<mpsc::Sender<()>>,
        gate: Arc<(Mutex<bool>, Condvar)>,
    }

    struct NoopKiller;

    impl crate::terminal_session::TerminalKiller for NoopKiller {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl TerminalChild for BlockingChild {
        fn clone_killer(&self) -> Box<dyn crate::terminal_session::TerminalKiller> {
            Box::new(NoopKiller)
        }

        fn try_wait(&mut self) -> io::Result<Option<TerminalExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> io::Result<TerminalExitStatus> {
            if let Some(entered) = self.entered.take() {
                entered.send(()).expect("wait entry receiver");
            }
            let (lock, gate) = &*self.gate;
            let released = lock.lock().expect("wait gate");
            let _released = gate
                .wait_while(released, |released| !*released)
                .expect("wait release");
            Ok(TerminalExitStatus { exit_code: Some(0) })
        }
    }

    #[test]
    fn detached_waiter_retains_sign_in_exclusion_until_definite_reap() {
        let fixture = Fixture::new("exit 0");
        let (registry, generation, provider) = registered(&fixture);
        let lease = registry
            .acquire_sign_in(provider, generation)
            .expect("sign-in lease");
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (entered_tx, entered_rx) = mpsc::channel();
        let waiter_gate = Arc::clone(&gate);
        let waiter = thread::spawn(move || {
            let mut child = SignInTerminalChild {
                child: Some(Box::new(BlockingChild {
                    entered: Some(entered_tx),
                    gate: waiter_gate,
                })),
                lease: Some(lease),
            };
            child.wait().expect("child reap");
        });
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("waiter entered child wait");
        assert_eq!(
            registry
                .acquire_turn(
                    provider,
                    generation,
                    fixture.executable.to_str().expect("path"),
                )
                .err(),
            Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string())
        );
        registry.close_operation_admission();
        assert!(!registry.shutdown_operations(Duration::ZERO));
        let (lock, release) = &*gate;
        *lock.lock().expect("wait gate") = true;
        release.notify_all();
        waiter.join().expect("waiter thread");
        assert!(registry.shutdown_operations(Duration::ZERO));
    }

    #[test]
    fn sign_in_request_and_result_wires_are_closed_and_bounded() {
        assert!(serde_json::from_str::<AgentProviderSignInRequest>(
            r#"{"provider":"claudeCode","providerGeneration":1,"size":{"cols":80,"rows":24},"argv":["login"]}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<AgentProviderSignInRequest>(
            r#"{"provider":"claudeCode","providerGeneration":1,"size":{"cols":80,"rows":24,"env":{}}}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<AgentProviderSignInRequest>(
            r#"{"provider":"claudeCode","providerGeneration":1,"size":{"cols":0,"rows":24}}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<AgentProviderSignInRequest>(
            r#"{"provider":"claudeCode","providerGeneration":0,"size":{"cols":80,"rows":24}}"#,
        )
        .is_err());
        let encoded = serde_json::to_value(AgentProviderSignInResult::Started {
            provider: AgentCliInvocation::CodexExec,
            provider_generation: 7,
            session_id: 9,
        })
        .expect("wire result");
        assert_eq!(
            encoded,
            serde_json::json!({
                "kind": "started",
                "provider": "codex",
                "providerGeneration": 7,
                "sessionId": 9,
            })
        );
    }
}
