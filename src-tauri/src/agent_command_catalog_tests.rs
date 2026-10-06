use super::*;
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderPolicy;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

static NONCE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    directory: PathBuf,
    workspace: PathBuf,
    registry: WorkspaceRegistry,
    trust: Mutex<WorkspaceTrustService>,
    providers: Arc<AgentProviderRuntimeRegistry>,
    cli: PathBuf,
}

impl Fixture {
    fn create(label: &str, body: &str) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codevo-command-catalog-{label}-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let workspace = directory.join("workspace");
        fs::create_dir_all(workspace.join("packages/app")).expect("workspace");
        let workspace = workspace.canonicalize().expect("canonical workspace");
        let cli = directory.join("codex");
        fs::write(&cli, format!("#!/bin/sh\n{body}\n")).expect("script");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("executable");
        let trust = WorkspaceTrustService::load(directory.join("trust.json")).expect("trust");
        Self {
            directory,
            workspace,
            registry: WorkspaceRegistry::new(),
            trust: Mutex::new(trust),
            providers: Arc::new(AgentProviderRuntimeRegistry::new()),
            cli,
        }
    }

    fn register(&self) -> ManagedWorkspaceDescriptor {
        self.registry
            .register(&self.workspace)
            .expect("register workspace")
    }

    fn grant_trust(&self) {
        self.set_trust(true);
    }

    fn enable_codex(&self) -> u64 {
        self.register_codex(1, None, true)
    }

    fn register_codex(&self, revision: u64, expected: Option<u64>, enabled: bool) -> u64 {
        self.providers
            .register_policy(
                AgentCliInvocation::CodexExec,
                revision,
                expected,
                AgentProviderPolicy {
                    enabled,
                    cli_path: Some(self.cli.to_string_lossy().into_owned()),
                    check_for_updates: false,
                    codex_transport: Default::default(),
                    codex_app_server_args: Vec::new(),
                },
            )
            .expect("register codex policy")
            .provider_generation
    }

    fn set_trust(&self, trusted: bool) {
        self.trust
            .lock()
            .unwrap()
            .set(self.workspace.to_str().expect("utf8 root"), trusted)
            .expect("update trust");
    }

    fn publish(
        &self,
        authority: &WorkspaceCatalogAuthority,
        resolved: ResolvedCatalog,
    ) -> Result<AgentCommandCatalog, String> {
        publish_catalog(
            &self.providers,
            &self.registry,
            &self.trust,
            authority,
            AgentCliInvocation::CodexExec,
            resolved,
        )
    }

    fn stale(&self, authority: &WorkspaceCatalogAuthority) -> Result<ResolvedCatalog, String> {
        stale_catalog(&self.providers, authority, AgentCliInvocation::CodexExec)
    }

    fn capture(&self, root: &Path) -> Result<WorkspaceCatalogAuthority, String> {
        WorkspaceCatalogAuthority::capture(
            &self.registry,
            &self.trust,
            root.to_str().expect("utf8 root"),
        )
    }

    fn resolve_only(&self, authority: &WorkspaceCatalogAuthority) -> Result<ResolvedCatalog, String> {
        resolve_catalog(
            &self.providers,
            &self.registry,
            &self.trust,
            authority,
            AgentCliInvocation::CodexExec,
        )
    }

    fn resolve(&self, root: &Path) -> Result<AgentCommandCatalog, String> {
        let authority = self.capture(root)?;
        let resolved = self.resolve_only(&authority)?;
        self.publish(&authority, resolved)
    }

    fn probe_count(&self) -> usize {
        fs::read_to_string(self.directory.join("probes"))
            .map(|probes| probes.lines().count())
            .unwrap_or(0)
    }

    fn wait_for_probe_count(&self, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(60);
        while self.probe_count() < expected {
            assert!(Instant::now() < deadline, "provider was not spawned");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

const SKILLS_SCRIPT: &str = r#"
echo probe >> "$(dirname "$0")/probes"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{}}\n';;
    *'"method":"skills/list"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
      while [ ! -e "$(dirname "$0")/release" ]; do sleep 0.05; done
      printf '{"id":%s,"result":{"data":[{"cwd":"%s","skills":[{"name":"pdf","scope":"system"},{"name":"repo-skill","scope":"repo"}],"errors":[]}]}}\n' "$id" "$PWD";;
  esac
done
"#;

fn released(label: &str) -> Fixture {
    let fixture = Fixture::create(label, SKILLS_SCRIPT);
    fs::write(fixture.directory.join("release"), b"").expect("release marker");
    fixture
}

#[test]
fn an_unregistered_workspace_fails_closed_without_spawning_the_provider() {
    let fixture = released("unregistered");
    fixture.grant_trust();
    fixture.enable_codex();
    assert_eq!(
        fixture.resolve(&fixture.workspace).err().as_deref(),
        Some(UNKNOWN_CATALOG_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 0);
}

#[test]
fn an_untrusted_workspace_fails_closed_without_spawning_the_provider() {
    let fixture = released("untrusted");
    fixture.register();
    fixture.enable_codex();
    assert_eq!(
        fixture.resolve(&fixture.workspace).err().as_deref(),
        Some(UNTRUSTED_CATALOG_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 0);
}

#[test]
fn a_disabled_provider_fails_closed_without_spawning_the_provider() {
    let fixture = released("disabled");
    fixture.register();
    fixture.grant_trust();
    assert_eq!(
        fixture.resolve(&fixture.workspace).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
    assert_eq!(fixture.probe_count(), 0);
}

#[test]
fn a_registered_trusted_workspace_probes_the_provider_in_its_root() {
    let fixture = released("registered");
    fixture.register();
    fixture.grant_trust();
    fixture.enable_codex();
    let catalog = fixture.resolve(&fixture.workspace).expect("catalog");
    assert_eq!(catalog.provider, AgentCliInvocation::CodexExec);
    assert_eq!(catalog.entries.len(), 2);
    assert_eq!(catalog.entries[0].name, "pdf");
    assert!(catalog.entries[0].builtin);
    assert!(!catalog.entries[1].builtin);
    assert!(!catalog.truncated);
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn a_nested_repository_resolves_through_its_registered_project_authority() {
    let fixture = released("nested");
    fixture.register();
    fixture.grant_trust();
    fixture.enable_codex();
    let nested = fixture.workspace.join("packages/app");
    let catalog = fixture.resolve(&nested).expect("nested catalog");
    assert_eq!(catalog.entries[0].name, "pdf");
    let outside = fixture.directory.canonicalize().expect("canonical directory");
    assert_eq!(
        fixture.resolve(&outside).err().as_deref(),
        Some(UNKNOWN_CATALOG_WORKSPACE_ERROR)
    );
}

#[test]
fn revoked_trust_invalidates_a_captured_authority() {
    let fixture = released("revoked-trust");
    let descriptor = fixture.register();
    fixture.grant_trust();
    fixture.enable_codex();
    fixture.resolve(&fixture.workspace).expect("first catalog");
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    assert_eq!(authority.descriptor, descriptor);
    assert_eq!(authority.repository_root, fixture.workspace);
    assert!(authority
        .revalidate(&fixture.registry, &fixture.trust)
        .is_ok());
    assert!(authority
        .revalidate_registration(&fixture.registry, &fixture.trust)
        .is_ok());
    fixture.set_trust(false);
    assert_eq!(
        authority
            .revalidate(&fixture.registry, &fixture.trust)
            .err()
            .as_deref(),
        Some(UNTRUSTED_CATALOG_WORKSPACE_ERROR)
    );
    assert_eq!(
        authority
            .revalidate_registration(&fixture.registry, &fixture.trust)
            .err()
            .as_deref(),
        Some(UNTRUSTED_CATALOG_WORKSPACE_ERROR)
    );
    assert_eq!(
        fixture.resolve(&fixture.workspace).err().as_deref(),
        Some(UNTRUSTED_CATALOG_WORKSPACE_ERROR)
    );
}

#[test]
fn a_stale_fallback_is_published_only_through_final_registration_trust_and_provider_checks() {
    let fixture = released("stale-fallback");
    let first = fixture.register();
    fixture.grant_trust();
    let generation = fixture.enable_codex();
    fixture.resolve(&fixture.workspace).expect("fill the cache");
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    let stale = fixture.stale(&authority).expect("stale catalog");
    assert_eq!(stale.generation, generation);
    assert_eq!(
        fixture
            .publish(&authority, stale.clone())
            .expect("stale publication")
            .entries[0]
            .name,
        "pdf"
    );

    fixture.set_trust(false);
    assert!(fixture.stale(&authority).is_ok());
    assert_eq!(
        fixture.publish(&authority, stale.clone()).err().as_deref(),
        Some(UNTRUSTED_CATALOG_WORKSPACE_ERROR)
    );
    fixture.set_trust(true);
    assert_eq!(
        fixture.publish(&authority, stale.clone()).err().as_deref(),
        Some(UNKNOWN_CATALOG_WORKSPACE_ERROR)
    );
    let regranted = fixture.capture(&fixture.workspace).expect("regranted authority");
    assert!(fixture.publish(&regranted, stale.clone()).is_ok());

    fixture
        .registry
        .unregister(&first.workspace_id)
        .expect("unregister first registration");
    let second = fixture.register();
    assert_ne!(second.workspace_id, first.workspace_id);
    assert!(fixture.stale(&regranted).is_ok());
    assert_eq!(
        fixture.publish(&regranted, stale.clone()).err().as_deref(),
        Some(UNKNOWN_CATALOG_WORKSPACE_ERROR)
    );
    let replacement = fixture.capture(&fixture.workspace).expect("replacement authority");
    assert_eq!(
        fixture.stale(&replacement).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_LOADING_ERROR)
    );

    let replaced = fixture.register_codex(2, Some(generation), true);
    assert_ne!(replaced, generation);
    assert_eq!(
        fixture.publish(&replacement, stale.clone()).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR)
    );
    fixture.register_codex(3, Some(replaced), false);
    assert_eq!(
        fixture.stale(&replacement).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
    assert_eq!(
        fixture.publish(&replacement, stale).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
}

#[test]
fn a_resolved_catalog_is_not_published_once_its_provider_is_replaced_or_disabled() {
    let fixture = released("provider-after-worker");
    fixture.register();
    fixture.grant_trust();
    let generation = fixture.enable_codex();
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    let resolved = fixture.resolve_only(&authority).expect("resolved catalog");
    assert_eq!(resolved.generation, generation);
    assert!(fixture.publish(&authority, resolved.clone()).is_ok());
    let replaced = fixture.register_codex(2, Some(generation), true);
    assert_eq!(
        fixture.publish(&authority, resolved.clone()).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR)
    );
    fixture.register_codex(3, Some(replaced), false);
    assert_eq!(
        fixture.publish(&authority, resolved).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
    assert_eq!(
        fixture.resolve_only(&authority).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn a_replaced_registration_is_never_served_from_the_previous_one() {
    let fixture = Fixture::create("reregistered", SKILLS_SCRIPT);
    let first = fixture.register();
    fixture.grant_trust();
    fixture.enable_codex();
    let pending = fixture.capture(&fixture.workspace).expect("authority");
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| fixture.resolve_only(&pending));
        fixture.wait_for_probe_count(1);
        fixture
            .registry
            .unregister(&first.workspace_id)
            .expect("unregister first registration");
        let second = fixture.register();
        assert_ne!(second.workspace_id, first.workspace_id);
        fs::write(fixture.directory.join("release"), b"").expect("release marker");
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some(UNKNOWN_CATALOG_WORKSPACE_ERROR)
        );
        assert_eq!(
            pending
                .revalidate_registration(&fixture.registry, &fixture.trust)
                .err()
                .as_deref(),
            Some(UNKNOWN_CATALOG_WORKSPACE_ERROR)
        );
        let generation = provider_generation(&fixture.providers, AgentCliInvocation::CodexExec)
            .expect("generation");
        assert!(service()
            .cached(&pending.owner(AgentCliInvocation::CodexExec), generation)
            .is_none());
        let replacement = fixture.capture(&fixture.workspace).expect("second authority");
        assert_eq!(replacement.descriptor, second);
        assert!(service()
            .cached(&replacement.owner(AgentCliInvocation::CodexExec), generation)
            .is_none());
        let catalog = fixture
            .resolve(&fixture.workspace)
            .expect("second registration catalog");
        assert_eq!(catalog.entries[0].name, "pdf");
        assert_eq!(fixture.probe_count(), 2);
    });
}
