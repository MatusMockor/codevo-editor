use crate::agent_task_spawner::agent_provider::process::{
    AgentProviderProcessIntent, AgentProviderProcessPlan, ExecutableIdentity,
};
use crate::agent_task_spawner::agent_provider::{
    self_update_command, AgentProviderInstaller, AgentProviderSelfUpdateCommand,
};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolvedAgentProviderInstaller {
    Npm {
        program: ExecutableIdentity,
        package_name: String,
    },
    Homebrew {
        program: ExecutableIdentity,
        cask: String,
    },
    SelfUpdate {
        program: ExecutableIdentity,
        command: AgentProviderSelfUpdateCommand,
    },
}

impl ResolvedAgentProviderInstaller {
    pub fn display(&self) -> AgentProviderInstaller {
        match self {
            Self::Npm { package_name, .. } => AgentProviderInstaller::Npm {
                package_name: package_name.clone(),
            },
            Self::Homebrew { cask, .. } => AgentProviderInstaller::Homebrew { cask: cask.clone() },
            Self::SelfUpdate { command, .. } => {
                AgentProviderInstaller::SelfUpdate { command: *command }
            }
        }
    }

    pub fn owns_provider_executable(&self, cli_identity: &ExecutableIdentity) -> bool {
        let Self::SelfUpdate { program, .. } = self else {
            return true;
        };
        program == cli_identity
    }

    pub fn update_plan(
        &self,
        provider: AgentCliInvocation,
        version: &str,
        effective_path: &str,
    ) -> Result<AgentProviderProcessPlan, String> {
        match self {
            Self::Npm { program, .. } => {
                AgentProviderProcessPlan::package_manager_with_effective_path(
                    program.clone(),
                    AgentProviderProcessIntent::NpmUpdate {
                        provider,
                        version: version.to_string(),
                    },
                    effective_path,
                )
            }
            Self::Homebrew { program, .. } => {
                AgentProviderProcessPlan::package_manager_with_effective_path(
                    program.clone(),
                    AgentProviderProcessIntent::BrewUpdate(provider),
                    effective_path,
                )
            }
            Self::SelfUpdate { program, command } => {
                if *command != self_update_command(provider) {
                    return Err("Provider self-update command is invalid.".to_string());
                }
                AgentProviderProcessPlan::provider_owned_with_effective_path(
                    program.clone(),
                    AgentProviderProcessIntent::SelfUpdate(provider),
                    effective_path,
                )
            }
        }
    }
}

const CLAUDE_NATIVE_INSTALL_PREFIXES: [&str; 2] = [".local/share/claude/versions", ".claude/local"];
const CODEX_NATIVE_INSTALL_PREFIXES: [&str; 1] = [".codex/packages"];
const MAX_PROVIDER_HOME_PATH_BYTES: usize = 4096;

pub fn bounded_home_path(home: Option<String>) -> Option<PathBuf> {
    let home = home?;
    if home.is_empty() || home.len() > MAX_PROVIDER_HOME_PATH_BYTES {
        return None;
    }
    let home = PathBuf::from(home);
    if !home.is_absolute() || home.components().any(is_traversal_component) {
        return None;
    }
    Some(home)
}

pub fn native_cli_artifact_matches(
    home: &Path,
    cli_path: &Path,
    provider: AgentCliInvocation,
) -> bool {
    let Some(home) = bounded_home_root(home) else {
        return false;
    };
    if !cli_path.is_absolute() || cli_path.components().any(is_traversal_component) {
        return false;
    }
    let prefixes: &[&str] = match provider {
        AgentCliInvocation::ClaudeCode => &CLAUDE_NATIVE_INSTALL_PREFIXES,
        AgentCliInvocation::CodexExec => &CODEX_NATIVE_INSTALL_PREFIXES,
    };
    if !prefixes
        .iter()
        .any(|prefix| cli_path.starts_with(home.join(prefix)))
    {
        return false;
    }
    fs::symlink_metadata(cli_path).is_ok_and(|metadata| metadata.is_file())
}

fn bounded_home_root(home: &Path) -> Option<PathBuf> {
    if !home.is_absolute() || home.components().any(is_traversal_component) {
        return None;
    }
    if home.as_os_str().len() > MAX_PROVIDER_HOME_PATH_BYTES {
        return None;
    }
    let home = fs::canonicalize(home).ok()?;
    fs::symlink_metadata(&home)
        .ok()
        .filter(|metadata| metadata.is_dir())?;
    Some(home)
}

fn is_traversal_component(component: Component<'_>) -> bool {
    matches!(component, Component::ParentDir | Component::CurDir)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentProviderUpdateCandidate {
    pub cli_path: String,
    pub cli_identity: ExecutableIdentity,
    pub effective_path: String,
    pub path_fingerprint: String,
    pub discovery_generation: u64,
    pub installed_version: String,
    pub available_version: String,
    pub installer: ResolvedAgentProviderInstaller,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NONCE: AtomicU64 = AtomicU64::new(0);

    struct HomeFixture {
        root: PathBuf,
    }

    impl HomeFixture {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "codevo-installer-{label}-{}-{}",
                std::process::id(),
                NONCE.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir_all(root.join("home")).expect("fixture home");
            Self { root }
        }

        fn home(&self) -> PathBuf {
            self.root.join("home")
        }

        fn file(&self, relative: &str) -> PathBuf {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
            fs::write(&path, "provider").expect("fixture file");
            fs::canonicalize(&path).expect("canonical fixture file")
        }
    }

    impl Drop for HomeFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn native_ownership_proof_accepts_only_supported_installer_prefixes() {
        let fixture = HomeFixture::new("prefixes");
        let home = fixture.home();
        let claude_versions = fixture.file("home/.local/share/claude/versions/2.1.261/claude");
        let claude_local = fixture.file("home/.claude/local/claude");
        let codex_packages = fixture.file("home/.codex/packages/standalone/current/bin/codex");
        let shim = fixture.file("home/.local/bin/claude");

        for (provider, cli) in [
            (AgentCliInvocation::ClaudeCode, &claude_versions),
            (AgentCliInvocation::ClaudeCode, &claude_local),
            (AgentCliInvocation::CodexExec, &codex_packages),
        ] {
            assert!(
                native_cli_artifact_matches(&home, cli, provider),
                "expected native ownership for {}",
                cli.display()
            );
        }
        for (provider, cli) in [
            (AgentCliInvocation::CodexExec, &claude_versions),
            (AgentCliInvocation::CodexExec, &claude_local),
            (AgentCliInvocation::ClaudeCode, &codex_packages),
            (AgentCliInvocation::ClaudeCode, &shim),
        ] {
            assert!(
                !native_cli_artifact_matches(&home, cli, provider),
                "unexpected native ownership for {}",
                cli.display()
            );
        }
        assert!(!native_cli_artifact_matches(
            &home,
            &fs::canonicalize(home.join(".claude/local")).expect("canonical directory"),
            AgentCliInvocation::ClaudeCode,
        ));
        assert!(!native_cli_artifact_matches(
            Path::new("relative/home"),
            &claude_local,
            AgentCliInvocation::ClaudeCode,
        ));
        assert!(!native_cli_artifact_matches(
            &home.join("../home"),
            &claude_local,
            AgentCliInvocation::ClaudeCode,
        ));
        assert!(!native_cli_artifact_matches(
            Path::new(&"/".repeat(MAX_PROVIDER_HOME_PATH_BYTES + 1)),
            &claude_local,
            AgentCliInvocation::ClaudeCode,
        ));
    }

    #[cfg(unix)]
    #[test]
    fn native_ownership_proof_rejects_a_symlink_escaping_home() {
        let fixture = HomeFixture::new("escape");
        let home = fixture.home();
        fs::create_dir_all(home.join(".claude/local")).expect("home prefix");
        let outside = fixture.file("outside/claude");
        let escaping = home.join(".claude/local/claude");
        std::os::unix::fs::symlink(&outside, &escaping).expect("escaping symlink");

        assert!(!native_cli_artifact_matches(
            &home,
            &fs::canonicalize(&escaping).expect("canonical escape"),
            AgentCliInvocation::ClaudeCode,
        ));
        assert!(!native_cli_artifact_matches(
            &home,
            &escaping,
            AgentCliInvocation::ClaudeCode,
        ));
    }

    #[test]
    fn unusable_home_values_never_yield_a_native_home_root() {
        assert_eq!(bounded_home_path(None), None);
        assert_eq!(bounded_home_path(Some(String::new())), None);
        assert_eq!(
            bounded_home_path(Some("x".repeat(MAX_PROVIDER_HOME_PATH_BYTES + 1))),
            None
        );
        assert_eq!(bounded_home_path(Some("relative/home".to_string())), None);
        assert_eq!(bounded_home_path(Some("/home/../root".to_string())), None);
        assert_eq!(
            bounded_home_path(Some("/home/person".to_string())),
            Some(PathBuf::from("/home/person"))
        );
    }
}
