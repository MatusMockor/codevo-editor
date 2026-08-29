use super::*;
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderExecutableResolver, ResolvedProviderExecutable,
};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Condvar,
    },
    time::Duration,
};

static NONCE: AtomicU64 = AtomicU64::new(0);
const ADVERSARIAL_INSTALLER_OUTPUT: &str = "password=hunter2 AWS_SECRET_ACCESS_KEY=aws-secret cookie=session-secret pid=4242 argv=--token-secret HOME=/Users/private /arbitrary/private/path";

fn assert_safe_progress_event(event: &AgentProviderUpdateProgressEvent) {
    assert!(event.redacted);
    if event.truncated {
        assert_eq!(event.data, "Additional installer activity withheld.");
        return;
    }
    let count = event
        .data
        .strip_prefix(match event.stream {
            AgentProviderUpdateProgressStream::Stdout => "Installer stdout activity: ",
            AgentProviderUpdateProgressStream::Stderr => "Installer stderr activity: ",
        })
        .and_then(|value| value.strip_suffix(" bytes."))
        .and_then(|value| value.parse::<usize>().ok())
        .expect("fixed safe activity grammar");
    assert!((1..=4_096).contains(&count));
    for secret in ADVERSARIAL_INSTALLER_OUTPUT.split_whitespace() {
        assert!(!event.data.contains(secret), "unsafe progress: {event:?}");
    }
}

struct RecordingProgressSink {
    events: Mutex<Vec<AgentProviderUpdateProgressEvent>>,
    changed: Condvar,
    fail_emission: bool,
}

impl RecordingProgressSink {
    fn new(fail_emission: bool) -> Self {
        Self {
            events: Mutex::new(Vec::new()),
            changed: Condvar::new(),
            fail_emission,
        }
    }

    fn events(&self) -> Vec<AgentProviderUpdateProgressEvent> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn wait_for_event_count(&self, minimum: usize) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut events = self
            .events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        loop {
            if events.len() >= minimum {
                return true;
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline.saturating_duration_since(now);
            let (next, timeout) = self
                .changed
                .wait_timeout(events, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            events = next;
            if timeout.timed_out() {
                return events.len() >= minimum;
            }
        }
    }
}

impl AgentProviderUpdateProgressSink for RecordingProgressSink {
    fn emit(&self, event: AgentProviderUpdateProgressEvent) -> Result<(), ()> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
        self.changed.notify_all();
        if self.fail_emission {
            Err(())
        } else {
            Ok(())
        }
    }
}

struct IsolatedFixture {
    root: PathBuf,
}

impl IsolatedFixture {
    fn new(label: &str) -> Self {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "codevo-provider-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("fixture root");
        Self { root }
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    fn executable(&self, relative: &str, body: &str) -> PathBuf {
        let path = self.path(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("executable parent");
        }
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("executable fixture");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .expect("executable permissions");
        }
        path
    }
}

impl Drop for IsolatedFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct FixedPackageManagerLocator {
    npm: Option<ExecutableIdentity>,
    brew: Option<ExecutableIdentity>,
    calls: AtomicUsize,
}

impl FixedPackageManagerLocator {
    fn empty() -> Self {
        Self {
            npm: None,
            brew: None,
            calls: AtomicUsize::new(0),
        }
    }

    fn npm(path: &Path) -> Self {
        Self {
            npm: Some(executable_identity(path.to_str().expect("npm path")).expect("npm")),
            brew: None,
            calls: AtomicUsize::new(0),
        }
    }

    fn brew(path: &Path) -> Self {
        Self {
            npm: None,
            brew: Some(executable_identity(path.to_str().expect("brew path")).expect("brew")),
            calls: AtomicUsize::new(0),
        }
    }
}

impl AgentProviderPackageManagerLocator for FixedPackageManagerLocator {
    fn resolve(&self, name: &str) -> Option<ExecutableIdentity> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match name {
            "npm" => self.npm.clone(),
            "brew" => self.brew.clone(),
            _ => None,
        }
    }
}

struct RefreshSwitchingResolver {
    initial: ResolvedProviderExecutable,
    updated: ResolvedProviderExecutable,
    refreshes: AtomicUsize,
}

impl RefreshSwitchingResolver {
    fn new(initial: &Path, updated: &Path, effective_path: &str) -> Self {
        let initial_identity =
            executable_identity(initial.to_str().expect("initial path")).expect("initial identity");
        let updated_identity =
            executable_identity(updated.to_str().expect("updated path")).expect("updated identity");
        Self {
            initial: ResolvedProviderExecutable {
                cli_path: initial_identity
                    .canonical_path
                    .to_string_lossy()
                    .into_owned(),
                cli_identity: initial_identity,
                effective_path: effective_path.to_string(),
                path_fingerprint: "effective-path-1".to_string(),
                discovery_generation: 1,
            },
            updated: ResolvedProviderExecutable {
                cli_path: updated_identity
                    .canonical_path
                    .to_string_lossy()
                    .into_owned(),
                cli_identity: updated_identity,
                effective_path: effective_path.to_string(),
                path_fingerprint: "effective-path-1".to_string(),
                discovery_generation: 2,
            },
            refreshes: AtomicUsize::new(0),
        }
    }
}

impl AgentProviderExecutableResolver for RefreshSwitchingResolver {
    fn resolve_provider(
        &self,
        _provider: AgentCliInvocation,
        _manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        let refreshes = match refresh {
            true => self.refreshes.fetch_add(1, Ordering::SeqCst) + 1,
            false => self.refreshes.load(Ordering::SeqCst),
        };
        if refreshes >= 2 {
            return Ok(self.updated.clone());
        }
        Ok(self.initial.clone())
    }
}

struct MissingAfterUpdateResolver {
    initial: ResolvedProviderExecutable,
    refreshes: AtomicUsize,
}

impl MissingAfterUpdateResolver {
    fn new(initial: &Path, effective_path: &str) -> Self {
        let identity =
            executable_identity(initial.to_str().expect("initial path")).expect("initial identity");
        Self {
            initial: ResolvedProviderExecutable {
                cli_path: identity.canonical_path.to_string_lossy().into_owned(),
                cli_identity: identity,
                effective_path: effective_path.to_string(),
                path_fingerprint: "effective-path-1".to_string(),
                discovery_generation: 1,
            },
            refreshes: AtomicUsize::new(0),
        }
    }
}

impl AgentProviderExecutableResolver for MissingAfterUpdateResolver {
    fn resolve_provider(
        &self,
        _provider: AgentCliInvocation,
        _manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        let refreshes = match refresh {
            true => self.refreshes.fetch_add(1, Ordering::SeqCst) + 1,
            false => self.refreshes.load(Ordering::SeqCst),
        };
        if refreshes >= 2 {
            return Err("Provider executable unavailable.".to_string());
        }
        Ok(self.initial.clone())
    }
}

struct NpmFixture {
    _fixture: IsolatedFixture,
    provider_path: PathBuf,
    manager_path: PathBuf,
    install_marker: PathBuf,
}

fn npm_fixture(update_behavior: &str) -> NpmFixture {
    let fixture = IsolatedFixture::new("npm-flow");
    let version_path = fixture.path("registry/installed-version");
    fs::create_dir_all(version_path.parent().expect("version parent")).expect("version directory");
    fs::write(&version_path, "0.150.1\n").expect("installed version");
    let install_marker = fixture.path("registry/install-called");
    let provider_path = fixture.executable(
            "global/@openai/codex/bin/codex.js",
            &format!(
                "if [ \"$1\" = \"--version\" ]; then printf 'codex '; /bin/cat '{}'; exit 0; fi\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 9",
                version_path.display()
            ),
        );
    let manager_path = fixture.executable(
            "bin/npm",
            &format!(
                "if [ \"$1\" = \"root\" ] && [ \"$2\" = \"--global\" ] && [ \"$#\" -eq 2 ]; then printf '%s\\n' '{}'; exit 0; fi\nif [ \"$1\" = \"ls\" ] && [ \"$2\" = \"-g\" ] && [ \"$3\" = \"--json\" ] && [ \"$4\" = \"@anthropic-ai/claude-code\" ] && [ \"$5\" = \"@openai/codex\" ] && [ \"$6\" = \"--depth\" ] && [ \"$7\" = \"0\" ] && [ \"$#\" -eq 7 ]; then version=$(/bin/cat '{}'); printf '{{\"name\":\"fake-global\",\"dependencies\":{{\"@openai/codex\":{{\"version\":\"%s\"}}}}}}\\n' \"$version\"; exit 0; fi\nif [ \"$1\" = \"view\" ] && [ \"$2\" = \"@openai/codex\" ] && [ \"$3\" = \"version\" ] && [ \"$4\" = \"--json\" ] && [ \"$#\" -eq 4 ]; then printf '\"0.151.0\"\\n'; exit 0; fi\nif [ \"$1\" = \"install\" ] && [ \"$2\" = \"--global\" ] && [ \"$3\" = \"@openai/codex@0.151.0\" ] && [ \"$#\" -eq 3 ]; then printf called > '{}'; {update_behavior}; fi\nexit 91",
                fixture.path("global").display(),
                version_path.display(),
                install_marker.display(),
            ),
        );
    NpmFixture {
        _fixture: fixture,
        provider_path,
        manager_path,
        install_marker,
    }
}

fn registered_registry(
    provider_path: &Path,
    check_for_updates: bool,
) -> (
    Arc<AgentProviderRuntimeRegistry>,
    AgentProviderPolicyReceipt,
) {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let receipt = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(provider_path.to_string_lossy().into_owned()),
                check_for_updates,
            },
        )
        .expect("provider policy");
    (registry, receipt)
}

fn health_with_locator(
    registry: &Arc<AgentProviderRuntimeRegistry>,
    receipt: AgentProviderPolicyReceipt,
    locator: &dyn AgentProviderPackageManagerLocator,
) -> AgentProviderHealthProbeResult {
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    probe_health_with_locator(registry, lease, &AtomicBool::new(false), locator)
        .expect("health probe")
}

fn update_request(receipt: AgentProviderPolicyReceipt) -> AgentProviderUpdateRequest {
    AgentProviderUpdateRequest {
        provider: AgentCliInvocation::CodexExec,
        provider_generation: receipt.provider_generation,
        operation_id: "operation-local-fake".to_string(),
    }
}

fn provider_executable(body: &str) -> std::path::PathBuf {
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!(
        "codevo-provider-health-{}-{nonce}",
        std::process::id()
    ));
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("provider fixture");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable fixture");
    }
    path
}

#[test]
fn policy_and_operation_requests_reject_unknown_fields() {
    let cancellation = ProviderRequestCancellation::new();
    let cancelled = cancellation.flag();
    drop(cancellation);
    assert!(cancelled.load(AtomicOrdering::Acquire));

    let accepted = serde_json::from_value::<RegisterAgentProviderPolicyRequest>(json!({
        "provider": "codex",
        "settingsRevision": 1,
        "expectedProviderGeneration": null,
        "enabled": true,
        "cliPath": "/usr/local/bin/codex",
        "checkForUpdates": false
    }));
    assert!(accepted.is_ok());
    let extra = serde_json::from_value::<RegisterAgentProviderPolicyRequest>(json!({
        "provider": "codex",
        "settingsRevision": 1,
        "expectedProviderGeneration": null,
        "enabled": true,
        "cliPath": "/usr/local/bin/codex",
        "checkForUpdates": false,
        "version": "latest"
    }));
    assert!(extra.is_err());
    let update = serde_json::from_value::<AgentProviderUpdateRequest>(json!({
        "provider": "codex",
        "providerGeneration": 2,
        "operationId": "operation-1",
        "installer": "npm"
    }));
    assert!(update.is_err());
    let query = serde_json::from_value::<GetAgentProviderPolicyRequest>(json!({
        "provider": "codex",
        "extra": true
    }));
    assert!(query.is_err());
}

#[test]
fn policy_snapshots_use_the_closed_tagged_wire_shape() {
    assert_eq!(
        serde_json::to_value(AgentProviderPolicySnapshot::Unregistered).expect("unregistered"),
        json!({"kind":"unregistered"})
    );
    assert_eq!(
        serde_json::to_value(AgentProviderPolicySnapshot::Registered {
            receipt: RegisterAgentProviderPolicyReceipt {
                provider: AgentCliInvocation::CodexExec,
                settings_revision: 4,
                provider_generation: 9,
            },
            enabled: true,
            cli_path: Some("/usr/local/bin/codex".to_string()),
            check_for_updates: false,
        })
        .expect("registered"),
        json!({
            "kind":"registered",
            "receipt": {
                "provider":"codex",
                "settingsRevision":4,
                "providerGeneration":9
            },
            "enabled":true,
            "cliPath":"/usr/local/bin/codex",
            "checkForUpdates":false
        })
    );
}

#[test]
fn health_probe_uses_the_closed_version_and_auth_plans() {
    let executable = provider_executable(
            "if [ \"$1\" = \"--version\" ]; then echo 'claude 2.1.247'; exit 0; fi\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ] && [ \"$3\" = \"--json\" ]; then echo '{\"loggedIn\":true,\"subscriptionType\":\"Pro\"}'; exit 0; fi\nexit 9",
        );
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let receipt = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(executable.to_string_lossy().into_owned()),
                check_for_updates: false,
            },
        )
        .expect("policy");
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::ClaudeCode, receipt.provider_generation)
        .expect("health lease");
    let result = probe_health(&registry, lease, &AtomicBool::new(false)).expect("health");
    assert_eq!(result.installed_version.as_deref(), Some("2.1.247"));
    assert_eq!(
        result.auth,
        AgentProviderAuthState::SignedIn {
            label: Some("Pro".to_string())
        }
    );
    assert_eq!(
        result.update,
        AgentProviderUpdateAvailability::ChecksDisabled
    );
    fs::remove_file(executable).expect("cleanup");
}

#[test]
fn claude_capabilities_select_text_unavailable_and_cache_unknown_fallback() {
    let text = provider_executable(
            "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ] && [ -z \"$3\" ]; then echo 'Logged in using Claude'; exit 0; fi\nexit 9",
        );
    let text_registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let text_receipt = text_registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(text.to_string_lossy().into_owned()),
                check_for_updates: false,
            },
        )
        .expect("text policy");
    let text_lease = text_registry
        .acquire_health_for_generation(
            AgentCliInvocation::ClaudeCode,
            text_receipt.provider_generation,
        )
        .expect("text lease");
    let text_identity = executable_identity(text.to_str().expect("text path")).expect("identity");
    assert_eq!(
        probe_auth(
            &text_registry,
            &text_lease,
            &text_identity,
            Some("2.1.83"),
            &AtomicBool::new(false),
        ),
        AgentProviderAuthState::SignedIn {
            label: Some("Claude".to_string())
        }
    );
    drop(text_lease);
    fs::remove_file(text).expect("text cleanup");

    let marker = std::env::temp_dir().join(format!(
        "codevo-provider-auth-marker-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let unavailable = provider_executable(&format!(
        "if [ \"$1\" = \"auth\" ]; then echo hit > '{}'; fi\nexit 9",
        marker.display()
    ));
    let unavailable_registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let unavailable_receipt = unavailable_registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(unavailable.to_string_lossy().into_owned()),
                check_for_updates: false,
            },
        )
        .expect("unavailable policy");
    let unavailable_lease = unavailable_registry
        .acquire_health_for_generation(
            AgentCliInvocation::ClaudeCode,
            unavailable_receipt.provider_generation,
        )
        .expect("unavailable lease");
    let unavailable_identity =
        executable_identity(unavailable.to_str().expect("path")).expect("unavailable identity");
    assert_eq!(
        probe_auth(
            &unavailable_registry,
            &unavailable_lease,
            &unavailable_identity,
            Some("0.2.0"),
            &AtomicBool::new(false),
        ),
        AgentProviderAuthState::Unknown
    );
    assert!(!marker.exists());
    drop(unavailable_lease);
    fs::remove_file(unavailable).expect("unavailable cleanup");

    let fallback_marker = std::env::temp_dir().join(format!(
        "codevo-provider-auth-fallback-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let fallback = provider_executable(&format!(
            "if [ \"$3\" = \"--json\" ]; then echo json >> '{}'; echo \"error: unknown option '--json'\" >&2; exit 1; fi\nif [ \"$1\" = \"auth\" ]; then echo 'Logged in using Claude'; exit 0; fi\nexit 9",
            fallback_marker.display()
        ));
    let fallback_registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let fallback_receipt = fallback_registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(fallback.to_string_lossy().into_owned()),
                check_for_updates: false,
            },
        )
        .expect("fallback policy");
    let fallback_identity =
        executable_identity(fallback.to_str().expect("path")).expect("fallback identity");
    for _ in 0..2 {
        let lease = fallback_registry
            .acquire_health_for_generation(
                AgentCliInvocation::ClaudeCode,
                fallback_receipt.provider_generation,
            )
            .expect("fallback lease");
        assert!(matches!(
            probe_auth(
                &fallback_registry,
                &lease,
                &fallback_identity,
                Some("9.9.9"),
                &AtomicBool::new(false),
            ),
            AgentProviderAuthState::SignedIn { .. }
        ));
        drop(lease);
    }
    assert_eq!(
        fs::read_to_string(&fallback_marker).expect("fallback marker"),
        "json\n"
    );
    fs::remove_file(fallback).expect("fallback cleanup");
    fs::remove_file(fallback_marker).expect("marker cleanup");

    let retry_marker = std::env::temp_dir().join(format!(
        "codevo-provider-auth-retry-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let retry = provider_executable(&format!(
            "if [ \"$3\" = \"--json\" ] && [ ! -f '{}' ]; then touch '{}'; echo transient >&2; exit 1; fi\nif [ \"$3\" = \"--json\" ]; then echo \"error: unknown option '--json'\" >&2; exit 1; fi\nif [ \"$1\" = \"auth\" ]; then echo 'Logged in using Claude'; exit 0; fi\nexit 9",
            retry_marker.display(),
            retry_marker.display()
        ));
    let retry_registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let retry_receipt = retry_registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(retry.to_string_lossy().into_owned()),
                check_for_updates: false,
            },
        )
        .expect("retry policy");
    let retry_identity =
        executable_identity(retry.to_str().expect("path")).expect("retry identity");
    let first_retry_lease = retry_registry
        .acquire_health_for_generation(
            AgentCliInvocation::ClaudeCode,
            retry_receipt.provider_generation,
        )
        .expect("first retry lease");
    assert_eq!(
        probe_auth(
            &retry_registry,
            &first_retry_lease,
            &retry_identity,
            Some("9.9.9"),
            &AtomicBool::new(false),
        ),
        AgentProviderAuthState::Unknown
    );
    assert_eq!(
        retry_registry.claude_auth_capability(&first_retry_lease, &retry_identity),
        None
    );
    drop(first_retry_lease);
    let second_retry_lease = retry_registry
        .acquire_health_for_generation(
            AgentCliInvocation::ClaudeCode,
            retry_receipt.provider_generation,
        )
        .expect("second retry lease");
    assert!(matches!(
        probe_auth(
            &retry_registry,
            &second_retry_lease,
            &retry_identity,
            Some("9.9.9"),
            &AtomicBool::new(false),
        ),
        AgentProviderAuthState::SignedIn { .. }
    ));
    drop(second_retry_lease);
    fs::remove_file(retry).expect("retry cleanup");
    fs::remove_file(retry_marker).expect("retry marker cleanup");
}

#[test]
fn claude_fallback_requires_an_exact_unsupported_option_error() {
    assert!(unsupported_json_option(
        b"",
        b"error: unknown option '--json'"
    ));
    assert!(!unsupported_json_option(b"", b"network failed --json"));
    assert_eq!(
        bounded_absolute_path(b"/opt/homebrew/Caskroom/codex\n"),
        Some(std::path::PathBuf::from("/opt/homebrew/Caskroom/codex"))
    );
    assert_eq!(
        bounded_absolute_path(b"/opt/homebrew/Caskroom/codex\n\n"),
        None
    );
    assert_eq!(
        probe_failure_reason(&AgentProviderProcessFailure::Exited {
            stdout: Vec::new(),
            stderr: b"Error: unknown option: --cask".to_vec(),
        }),
        AgentProviderUpdateUnavailableReason::UnsupportedProbe
    );
    assert_eq!(
        probe_failure_reason(&AgentProviderProcessFailure::TimedOut {
            stdout: Vec::new(),
            stderr: Vec::new(),
        }),
        AgentProviderUpdateUnavailableReason::ProbeFailed
    );
}

#[test]
fn managed_installer_ownership_requires_the_exact_provider_artifact() {
    let npm_root = Path::new("/managed/node_modules/@openai/codex");
    assert!(npm_cli_artifact_matches(
        npm_root,
        Path::new("/managed/node_modules/@openai/codex/bin/codex.js"),
        AgentCliInvocation::CodexExec,
    ));
    for rejected in [
        "/managed/node_modules/@openai/codex/bin/other",
        "/managed/node_modules/@openai/codex/vendor/codex",
        "/managed/node_modules/@openai/codex/bin/codex.js/child",
        "/managed/node_modules/@openai/other/bin/codex.js",
    ] {
        assert!(!npm_cli_artifact_matches(
            npm_root,
            Path::new(rejected),
            AgentCliInvocation::CodexExec,
        ));
    }

    let brew_root = Path::new("/opt/homebrew/Caskroom/codex");
    assert!(brew_cli_artifact_matches(
        brew_root,
        Path::new("/opt/homebrew/Caskroom/codex/0.150.1/bin/codex"),
        AgentCliInvocation::CodexExec,
        "0.150.1",
    ));
    for rejected in [
        "/opt/homebrew/Caskroom/codex/0.150.1/other",
        "/opt/homebrew/Caskroom/codex/0.150.1/codex",
        "/opt/homebrew/Caskroom/codex/0.149.0/bin/codex",
        "/opt/homebrew/Caskroom/other/0.150.1/bin/codex",
    ] {
        assert!(!brew_cli_artifact_matches(
            brew_root,
            Path::new(rejected),
            AgentCliInvocation::CodexExec,
            "0.150.1",
        ));
    }
    assert!(npm_cli_artifact_matches(
        Path::new("/managed/node_modules/@anthropic-ai/claude-code"),
        Path::new("/managed/node_modules/@anthropic-ai/claude-code/cli.js"),
        AgentCliInvocation::ClaudeCode,
    ));
    assert!(brew_cli_artifact_matches(
        Path::new("/opt/homebrew/Caskroom/claude-code"),
        Path::new("/opt/homebrew/Caskroom/claude-code/2.1.231/claude"),
        AgentCliInvocation::ClaudeCode,
        "2.1.231",
    ));
}

#[test]
fn local_fake_update_check_is_opt_in_gated() {
    let npm = npm_fixture("printf '0.151.0\\n' > 'unused'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, false);

    let health = health_with_locator(&registry, receipt, &locator);

    assert_eq!(
        health.update,
        AgentProviderUpdateAvailability::ChecksDisabled
    );
    assert_eq!(locator.calls.load(Ordering::SeqCst), 0);
    assert!(!npm.install_marker.exists());
}

#[test]
fn local_fake_npm_detects_available_update_and_reprobes_after_install() {
    let npm = npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let version_path = npm._fixture.path("registry/installed-version");
    let script = fs::read_to_string(&npm.manager_path)
        .expect("npm script")
        .replace("$VERSION_PATH", &version_path.to_string_lossy());
    fs::write(&npm.manager_path, script).expect("patched npm script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm.manager_path, fs::Permissions::from_mode(0o755))
            .expect("npm permissions");
    }
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available {
            ref installed_version,
            ref available_version,
            ref installer,
        } if installed_version == "0.150.1"
            && available_version == "0.151.0"
            && installer == &crate::agent_task_spawner::agent_provider::AgentProviderInstaller::Npm {
                package_name: "@openai/codex".to_string(),
            }
    ));

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("npm update");
    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.151.0".to_string(),
        }
    );
    assert!(npm.install_marker.exists());
}

#[test]
fn successful_update_refreshes_to_replaced_executable_before_immediate_turn() {
    let npm =
        npm_fixture("printf '0.151.0\n' > '$VERSION_PATH'; /bin/rm -f '$OLD_PROVIDER'; exit 0");
    let version_path = npm._fixture.path("registry/installed-version");
    let updated_provider = npm._fixture.executable(
        "updated/codex",
        &format!(
            "if [ \"$1\" = \"--version\" ]; then printf 'codex '; /bin/cat '{}'; exit 0; fi\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 9",
            version_path.display()
        ),
    );
    let script = fs::read_to_string(&npm.manager_path)
        .expect("npm script")
        .replace("$VERSION_PATH", &version_path.to_string_lossy())
        .replace("$OLD_PROVIDER", &npm.provider_path.to_string_lossy());
    fs::write(&npm.manager_path, script).expect("patched npm script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm.manager_path, fs::Permissions::from_mode(0o755))
            .expect("npm permissions");
    }
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(RefreshSwitchingResolver::new(
        &npm.provider_path,
        &updated_provider,
        &effective_path,
    ));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
    let receipt = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: None,
                check_for_updates: true,
            },
        )
        .expect("automatic policy");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("updated result");
    assert!(matches!(
        result,
        AgentProviderUpdateResult::Succeeded {
            ref installed_version,
            ..
        } if installed_version == "0.151.0"
    ));
    assert!(!npm.provider_path.exists());
    let turn = registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("turn after update");
    assert_eq!(
        turn.cli_path,
        fs::canonicalize(updated_provider)
            .expect("updated provider")
            .to_string_lossy()
    );
    assert!(registry.revalidate_turn_authority(&turn).is_ok());
}

#[cfg(unix)]
#[test]
fn local_fake_brew_detects_available_update_and_reprobes_after_upgrade() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};

    let fixture = IsolatedFixture::new("brew-flow");
    let caskroom = fixture.path("Caskroom/codex");
    let old_provider = fixture.executable(
            "Caskroom/codex/0.150.1/bin/codex",
            "if [ \"$1\" = \"--version\" ]; then printf 'codex 0.150.1\\n'; exit 0; fi\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 9",
        );
    let new_provider = fixture.executable(
            "Caskroom/codex/0.151.0/bin/codex",
            "if [ \"$1\" = \"--version\" ]; then printf 'codex 0.151.0\\n'; exit 0; fi\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 9",
        );
    let configured = fixture.path("bin/codex");
    fs::create_dir_all(configured.parent().expect("configured parent"))
        .expect("configured directory");
    symlink(&old_provider, &configured).expect("configured provider symlink");
    let marker = fixture.path("upgrade-called");
    let release = fixture.path("release-upgrade");
    let brew = fixture.executable(
            "bin/brew",
            &format!(
                "if [ \"$1\" = \"--caskroom\" ] && [ \"$2\" = \"codex\" ] && [ \"$#\" -eq 2 ]; then printf '%s\\n' '{}'; exit 0; fi\nif [ \"$1\" = \"outdated\" ] && [ \"$2\" = \"--json=v2\" ] && [ \"$3\" = \"--cask\" ] && [ \"$4\" = \"codex\" ] && [ \"$#\" -eq 4 ]; then printf '{{\"formulae\":[],\"casks\":[{{\"name\":\"codex\",\"installed_versions\":[\"0.150.1\"],\"current_version\":\"0.151.0\",\"pinned\":false,\"pinned_version\":null}}]}}\\n'; exit 0; fi\nif [ \"$1\" = \"upgrade\" ] && [ \"$2\" = \"--cask\" ] && [ \"$3\" = \"codex\" ] && [ \"$#\" -eq 3 ]; then printf '\\r%s' '{ADVERSARIAL_INSTALLER_OUTPUT}'; while [ ! -f '{}' ]; do /bin/sleep 0.01; done; printf called > '{}'; /bin/ln -sfn '{}' '{}'; exit 0; fi\nexit 91",
                caskroom.display(),
                release.display(),
                marker.display(),
                new_provider.display(),
                configured.display(),
            ),
        );
    fs::set_permissions(&brew, fs::Permissions::from_mode(0o755)).expect("brew permissions");
    let locator = FixedPackageManagerLocator::brew(&brew);
    let (registry, receipt) = registered_registry(&configured, true);

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available {
            ref installed_version,
            ref available_version,
            ref installer,
        } if installed_version == "0.150.1"
            && available_version == "0.151.0"
            && installer == &crate::agent_task_spawner::agent_provider::AgentProviderInstaller::Homebrew {
                cask: "codex".to_string(),
            }
    ));
    let recording = Arc::new(RecordingProgressSink::new(false));
    let worker_registry = Arc::clone(&registry);
    let worker_sink: Arc<dyn AgentProviderUpdateProgressSink> = recording.clone();
    let request = update_request(receipt);
    let worker = std::thread::spawn(move || {
        run_agent_provider_update_with_progress_sink(
            &worker_registry,
            &request,
            &AtomicBool::new(false),
            worker_sink,
        )
    });
    assert!(recording.wait_for_event_count(1));
    assert!(!worker.is_finished(), "brew update settled before release");
    recording
        .events()
        .iter()
        .for_each(assert_safe_progress_event);
    fs::write(&release, b"release").expect("release brew upgrade");
    let result = worker.join().expect("brew worker").expect("brew update");
    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.151.0".to_string(),
        }
    );
    assert!(marker.exists());
    recording
        .events()
        .iter()
        .for_each(assert_safe_progress_event);
}

#[test]
fn local_fake_update_refuses_a_running_turn_before_install() {
    let npm = npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let turn = registry
        .acquire_turn(
            AgentCliInvocation::CodexExec,
            receipt.provider_generation,
            npm.provider_path.to_str().expect("provider path"),
        )
        .expect("turn lease");

    let error =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect_err("turn must block update");
    assert_eq!(
        error,
        crate::agent_task_spawner::agent_provider::runtime::AGENT_PROVIDER_TURN_ACTIVE_ERROR
    );
    assert!(!npm.install_marker.exists());
    drop(turn);
}

#[cfg(unix)]
#[test]
fn local_fake_cli_swap_at_installer_spawn_boundary_refuses_without_installing() {
    use std::os::unix::fs::PermissionsExt;

    let npm = npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let provider_path = npm.provider_path.clone();
    let retained_path = npm.provider_path.with_extension("retained");

    let result = run_agent_provider_update_with_spawn_barrier(
        &registry,
        &update_request(receipt),
        &AtomicBool::new(false),
        move || {
            fs::rename(&provider_path, &retained_path).expect("retain admitted provider");
            fs::write(&provider_path, "#!/bin/sh\nprintf 'codex 9.9.9\\n'\n")
                .expect("replacement provider");
            fs::set_permissions(&provider_path, fs::Permissions::from_mode(0o755))
                .expect("replacement permissions");
        },
    )
    .expect("closed admission result");

    assert!(matches!(
        result,
        AgentProviderUpdateResult::Failed {
            reason: AgentProviderUpdateFailureReason::AdmissionRefused,
            ..
        }
    ));
    assert!(!npm.install_marker.exists());
}

#[test]
fn local_fake_failing_installer_withholds_all_arbitrary_output() {
    let behavior = format!("printf '%s' '{ADVERSARIAL_INSTALLER_OUTPUT}' >&2; exit 17");
    let npm = npm_fixture(&behavior);
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));

    let recording = Arc::new(RecordingProgressSink::new(false));
    let progress_sink: Arc<dyn AgentProviderUpdateProgressSink> = recording.clone();
    let result = run_agent_provider_update_with_progress_sink(
        &registry,
        &update_request(receipt),
        &AtomicBool::new(false),
        progress_sink,
    )
    .expect("closed update failure");
    let AgentProviderUpdateResult::Failed {
        reason,
        output_tail,
        output_truncated,
    } = result
    else {
        panic!("expected failed update");
    };
    assert_eq!(reason, AgentProviderUpdateFailureReason::Exited);
    assert!(
        output_tail.len()
            <= crate::agent_task_spawner::agent_provider::MAX_AGENT_PROVIDER_UPDATE_TAIL_BYTES
    );
    assert_eq!(
        output_tail,
        format!(
            "Installer output withheld (stdout: 0 bytes, stderr: {} bytes).",
            ADVERSARIAL_INSTALLER_OUTPUT.len()
        )
    );
    for secret in ADVERSARIAL_INSTALLER_OUTPUT.split_whitespace() {
        assert!(
            !output_tail.contains(secret),
            "unsafe result: {output_tail}"
        );
    }
    recording
        .events()
        .iter()
        .for_each(assert_safe_progress_event);
    assert!(!output_truncated);
}

#[test]
fn local_fake_oversized_installer_is_killed_reaped_and_releases_authority() {
    let npm = npm_fixture(
            "/usr/bin/yes a | /usr/bin/head -c 600000; /usr/bin/yes b | /usr/bin/head -c 430000 >&2; printf '\\001token=secret-value\\nutf8-é🙂\\n' >&2; /usr/bin/yes c | /usr/bin/head -c 50000 >&2; exit 0",
        );
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("closed oversized result");
    let AgentProviderUpdateResult::Failed {
        reason,
        output_tail,
        output_truncated,
    } = result
    else {
        panic!("expected oversized update failure");
    };
    assert_eq!(
        reason,
        AgentProviderUpdateFailureReason::OutputLimitExceeded
    );
    assert!(output_truncated);
    assert!(
        output_tail.len()
            <= crate::agent_task_spawner::agent_provider::MAX_AGENT_PROVIDER_UPDATE_TAIL_BYTES
    );
    assert!(output_tail.starts_with("Installer output withheld (stdout: "));
    assert!(output_tail.ends_with(" bytes)."));
    assert!(!output_tail.contains("secret-value"), "{output_tail}");
    assert!(!output_tail.contains("utf8-é🙂"), "{output_tail}");
    assert!(npm.install_marker.exists());

    let turn = registry
        .acquire_turn(
            AgentCliInvocation::CodexExec,
            receipt.provider_generation,
            npm.provider_path.to_str().expect("provider path"),
        )
        .expect("update process reaped and lease released before settlement");
    drop(turn);
}

#[test]
fn local_fake_unknown_installer_is_truthfully_unavailable() {
    let fixture = IsolatedFixture::new("unknown-installer");
    let provider = fixture.executable(
            "codex",
            "if [ \"$1\" = \"--version\" ]; then printf 'codex 0.150.1\\n'; exit 0; fi\nif [ \"$1\" = \"login\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 9",
        );
    let locator = FixedPackageManagerLocator::empty();
    let (registry, receipt) = registered_registry(&provider, true);

    let health = health_with_locator(&registry, receipt, &locator);

    assert_eq!(
        health.update,
        AgentProviderUpdateAvailability::Unavailable {
            reason: AgentProviderUpdateUnavailableReason::UnknownInstaller,
        }
    );
    assert_eq!(locator.calls.load(Ordering::SeqCst), 2);
}

#[test]
fn local_fake_zero_exit_without_version_change_is_not_success() {
    let npm = npm_fixture("exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("closed mismatch result");
    let AgentProviderUpdateResult::Failed {
        reason,
        output_tail,
        output_truncated,
    } = result
    else {
        panic!("expected failed update");
    };
    assert_eq!(reason, AgentProviderUpdateFailureReason::Uncertain);
    assert_eq!(
        output_tail,
        "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes)."
    );
    assert!(!output_truncated);
    assert!(npm.install_marker.exists());
}

#[test]
fn successful_installer_with_missing_executable_returns_closed_uncertain_result() {
    let npm = npm_fixture("printf '0.151.0\n' > '$VERSION_PATH'; exit 0");
    let version_path = npm._fixture.path("registry/installed-version");
    let manager = fs::read_to_string(&npm.manager_path)
        .expect("npm script")
        .replace("$VERSION_PATH", &version_path.to_string_lossy());
    fs::write(&npm.manager_path, manager).expect("patched npm script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm.manager_path, fs::Permissions::from_mode(0o755))
            .expect("npm permissions");
    }
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(MissingAfterUpdateResolver::new(
        &npm.provider_path,
        &effective_path,
    ));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
    let receipt = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: None,
                check_for_updates: true,
            },
        )
        .expect("automatic policy");
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("closed post-install result");

    assert!(
        matches!(
            &result,
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::Uncertain,
                ..
            }
        ),
        "got {result:?}"
    );
    assert!(npm.install_marker.exists());
}

#[test]
fn update_progress_wire_is_strict_and_authority_scoped() {
    assert_eq!(
        AGENT_PROVIDER_UPDATE_PROGRESS_EVENT,
        "agent-provider-update://progress"
    );
    assert_eq!(
        serde_json::to_value(AgentProviderUpdateProgressEvent {
            provider: AgentCliInvocation::CodexExec,
            provider_generation: 7,
            operation_id: "operation-1".to_string(),
            sequence: 3,
            stream: AgentProviderUpdateProgressStream::Stderr,
            data: "Installer stderr activity: 17 bytes.".to_string(),
            truncated: false,
            redacted: true,
        })
        .expect("progress event"),
        json!({
            "provider": "codex",
            "providerGeneration": 7,
            "operationId": "operation-1",
            "sequence": 3,
            "stream": "stderr",
            "data": "Installer stderr activity: 17 bytes.",
            "truncated": false,
            "redacted": true,
        })
    );
}

#[test]
fn progress_stream_is_bounded_monotonic_and_never_projects_arbitrary_bytes() {
    let recording = Arc::new(RecordingProgressSink::new(false));
    let sink = ProviderUpdateProcessOutputSink::new(
        AgentCliInvocation::CodexExec,
        9,
        "operation-progress".to_string(),
        recording.clone(),
    );
    sink.emit(
        AgentProviderProcessOutputStream::Stdout,
        ADVERSARIAL_INSTALLER_OUTPUT.as_bytes(),
    )
    .expect("first output");
    sink.emit(AgentProviderProcessOutputStream::Stdout, b"\rno-newline")
        .expect("second output");
    for _ in 0..MAX_AGENT_PROVIDER_PROGRESS_EVENTS {
        sink.emit(AgentProviderProcessOutputStream::Stderr, b"x\n")
            .expect("bounded output");
    }
    sink.finish(AgentProviderProcessOutputStream::Stdout)
        .expect("stdout finish");
    sink.finish(AgentProviderProcessOutputStream::Stderr)
        .expect("stderr finish");

    let events = recording.events();
    assert_eq!(events.len(), MAX_AGENT_PROVIDER_PROGRESS_EVENTS as usize);
    assert!(events
        .windows(2)
        .all(|events| events[1].sequence == events[0].sequence + 1));
    assert!(events
        .iter()
        .all(|event| event.data.len() <= MAX_AGENT_PROVIDER_PROGRESS_DATA_BYTES));
    assert!(
        events.iter().map(|event| event.data.len()).sum::<usize>()
            <= MAX_AGENT_PROVIDER_PROGRESS_TOTAL_DATA_BYTES
    );
    events.iter().for_each(assert_safe_progress_event);
    assert_eq!(events.last().map(|event| event.sequence), Some(4_096));
    assert!(events.last().is_some_and(|event| event.truncated));
}

#[test]
fn local_fake_npm_streams_progress_before_completion_and_still_reprobes() {
    let fixture = IsolatedFixture::new("stream-release");
    let release = fixture.path("release");
    let behavior = format!(
            "printf '%s' '{ADVERSARIAL_INSTALLER_OUTPUT}'; while [ ! -f '{}' ]; do /bin/sleep 0.01; done; printf '0.151.0\\n' > '$VERSION_PATH'; exit 0",
            release.display()
        );
    let npm = npm_fixture(&behavior);
    let version_path = npm._fixture.path("registry/installed-version");
    let script = fs::read_to_string(&npm.manager_path)
        .expect("npm script")
        .replace("$VERSION_PATH", &version_path.to_string_lossy());
    fs::write(&npm.manager_path, script).expect("patched npm script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm.manager_path, fs::Permissions::from_mode(0o755))
            .expect("npm permissions");
    }
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let recording = Arc::new(RecordingProgressSink::new(false));
    let worker_registry = Arc::clone(&registry);
    let worker_sink: Arc<dyn AgentProviderUpdateProgressSink> = recording.clone();
    let request = update_request(receipt);
    let worker = std::thread::spawn(move || {
        run_agent_provider_update_with_progress_sink(
            &worker_registry,
            &request,
            &AtomicBool::new(false),
            worker_sink,
        )
    });

    assert!(recording.wait_for_event_count(1));
    assert!(!worker.is_finished(), "update settled before release");
    recording
        .events()
        .iter()
        .for_each(assert_safe_progress_event);
    fs::write(&release, b"release").expect("release installer");
    let result = worker
        .join()
        .expect("update worker")
        .expect("update result");
    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.151.0".to_string(),
        }
    );
    let events = recording.events();
    events.iter().for_each(assert_safe_progress_event);
    assert!(events.iter().all(|event| {
        event.provider == AgentCliInvocation::CodexExec
            && event.provider_generation == receipt.provider_generation
            && event.operation_id == "operation-local-fake"
    }));
    assert!(events
        .windows(2)
        .all(|events| events[1].sequence == events[0].sequence + 1));
}

#[test]
fn progress_sink_failure_does_not_change_successful_final_result() {
    let npm = npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let version_path = npm._fixture.path("registry/installed-version");
    let script = fs::read_to_string(&npm.manager_path)
        .expect("npm script")
        .replace("$VERSION_PATH", &version_path.to_string_lossy());
    fs::write(&npm.manager_path, script).expect("patched npm script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm.manager_path, fs::Permissions::from_mode(0o755))
            .expect("npm permissions");
    }
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);
    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let failing_sink: Arc<dyn AgentProviderUpdateProgressSink> =
        Arc::new(RecordingProgressSink::new(true));

    let result = run_agent_provider_update_with_progress_sink(
        &registry,
        &update_request(receipt),
        &AtomicBool::new(false),
        failing_sink,
    )
    .expect("sink failure is non-authoritative");
    assert!(matches!(
        result,
        AgentProviderUpdateResult::Succeeded { .. }
    ));
}
