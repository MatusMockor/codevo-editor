use super::{AgentProviderRuntimeRegistry, ProviderTurnLease};
use crate::agent_task_spawner::agent_provider::agent_cli_version::parse_agent_cli_version;
use crate::agent_task_spawner::agent_provider::process::{
    execute_agent_provider_plan_cancellable, AgentProviderProcessIntent, AgentProviderProcessPlan,
};

use std::sync::atomic::{AtomicUsize, Ordering};

static ACTIVE_PROBES: AtomicUsize = AtomicUsize::new(0);
const MAX_ACTIVE_PROBES: usize = 2;
struct ProbePermit<'a>(&'a AtomicUsize);
impl<'a> ProbePermit<'a> {
    fn acquire(active: &'a AtomicUsize) -> Result<Self, String> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_ACTIVE_PROBES).then_some(count + 1)
            })
            .map(|_| Self(active))
            .map_err(|_| "Claude version checks are busy. Try again shortly.".into())
    }
}
impl Drop for ProbePermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl AgentProviderRuntimeRegistry {
    /// Probe the exact retained executable when discovery has no reusable version.
    pub fn observed_turn_version(
        &self,
        lease: &ProviderTurnLease,
    ) -> Result<Option<String>, String> {
        self.revalidate_turn_authority(lease)?;
        let observed = self.discovery.observed_version(
            lease.provider,
            &lease.cli_identity,
            lease.discovery_generation,
        );
        let version = match observed {
            Some(version) => Some(version),
            None => {
                let _permit = ProbePermit::acquire(&ACTIVE_PROBES)?;
                let plan = AgentProviderProcessPlan::provider_owned_with_effective_path(
                    lease.cli_identity.clone(),
                    AgentProviderProcessIntent::InstalledVersion(lease.provider),
                    &lease.effective_path,
                )?;
                self.revalidate_turn_authority(lease)?;
                let output = execute_agent_provider_plan_cancellable(&plan, || {
                    self.operations_closed()
                        || self
                            .revalidate_operation_state(
                                lease.provider,
                                lease.generation,
                                &lease.policy,
                            )
                            .is_err()
                })
                .map_err(|_| "Provider version probe failed.".to_string())?;
                std::str::from_utf8(&output.stdout)
                    .ok()
                    .and_then(parse_agent_cli_version)
                    .or_else(|| {
                        std::str::from_utf8(&output.stderr)
                            .ok()
                            .and_then(parse_agent_cli_version)
                    })
            }
        };
        self.revalidate_turn_authority(lease)?;
        Ok(version)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::agent_task_spawner::agent_provider::runtime::AgentProviderPolicy;
    use crate::agent_task_spawner::AgentCliInvocation;
    use std::{fs, os::unix::fs::PermissionsExt, sync::Arc};

    #[test]
    fn probe_permits_are_bounded_and_recovered_on_drop() {
        let active = AtomicUsize::new(0);
        let first = ProbePermit::acquire(&active).unwrap();
        let second = ProbePermit::acquire(&active).unwrap();
        assert!(ProbePermit::acquire(&active).is_err());
        drop(first);
        let replacement = ProbePermit::acquire(&active).unwrap();
        drop(second);
        drop(replacement);
        assert_eq!(active.load(Ordering::Acquire), 0);
    }

    #[test]
    fn manually_configured_script_version_is_probed_and_replacement_rejected() {
        let directory =
            std::env::temp_dir().join(format!("codevo-turn-version-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let script = directory.join("claude");
        fs::write(&script, "#!/bin/sh\nprintf '2.1.280 (Claude Code)\\n'\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let receipt = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(script.to_string_lossy().into_owned()),
                    check_for_updates: false,
                    codex_transport: Default::default(),
                    codex_app_server_args: Vec::new(),
                },
            )
            .unwrap();
        let lease = registry
            .acquire_turn_for_generation(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
            )
            .unwrap();
        assert_eq!(
            registry.observed_turn_version(&lease).unwrap().as_deref(),
            Some("2.1.280")
        );
        fs::write(&script, "#!/bin/sh\nprintf '9.9.9\\n'\n").unwrap();
        assert!(registry.observed_turn_version(&lease).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
