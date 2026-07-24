use super::watch_runtime::{
    discover_native_node_watch_readiness, probe_native_node_watch_readiness,
};
use super::watch_session_factory::{
    start_native_node_watch_session, NativeNodeWatchLaunchAuthority, NativeNodeWatchSessionStartup,
};
use crate::debug_adapter::{
    DebugBreakpoint, DebugEventSink, DebugExceptionPauseMode, DebugJustMyCodePolicy,
    DebugSessionRegistry, DebugStartResponse,
};
use crate::debug_breakpoint_policy::{validate_initial_breakpoints, DebugBreakpointAdapterKind};
use crate::debug_commands::DebugSessionFactoryStartup;
use crate::debug_node_launch::{
    build_strict_native_node_watch_launch_plan, NativeNodeWatchLaunchPolicy,
};
use crate::debug_session_registry::{
    retain_workspace_root, DebugSessionMode, DebugWorkspaceAuthority, RetainedDebugWorkspaceRoot,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::fs::{File, OpenOptions};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Internal policy-owned boundary used by tests and the closed public intent mapper.
pub(crate) struct NativeNodeWatchWorkspaceStartup<'a> {
    pub(crate) root_path: &'a str,
    pub(crate) policy: NativeNodeWatchLaunchPolicy,
    pub(crate) breakpoints: &'a [DebugBreakpoint],
    pub(crate) exception_pause_mode: DebugExceptionPauseMode,
    pub(crate) just_my_code: Option<DebugJustMyCodePolicy>,
    pub(crate) source_maps_enabled: bool,
    pub(crate) sink: Arc<dyn DebugEventSink>,
    pub(crate) registry: &'a Arc<DebugSessionRegistry>,
    pub(crate) workspace_registry: &'a WorkspaceRegistry,
    pub(crate) trust: &'a Mutex<WorkspaceTrustService>,
}

pub(crate) struct NativeNodeWatchIntentWorkspaceStartup<'a> {
    pub(crate) root_path: &'a str,
    pub(crate) script_path: String,
    pub(crate) preserve_output: bool,
    pub(crate) breakpoints: &'a [DebugBreakpoint],
    pub(crate) exception_pause_mode: DebugExceptionPauseMode,
    pub(crate) just_my_code: Option<DebugJustMyCodePolicy>,
    pub(crate) source_maps_enabled: bool,
    pub(crate) sink: Arc<dyn DebugEventSink>,
    pub(crate) registry: &'a Arc<DebugSessionRegistry>,
    pub(crate) workspace_registry: &'a WorkspaceRegistry,
    pub(crate) trust: &'a Mutex<WorkspaceTrustService>,
}

pub(crate) fn start_native_node_watch_intent_for_retained_workspace(
    startup: NativeNodeWatchIntentWorkspaceStartup<'_>,
) -> Result<DebugStartResponse, String> {
    let (policy, readiness) =
        discover_native_node_watch_readiness(startup.script_path.clone(), startup.preserve_output)?;
    start_native_node_watch_with_readiness(
        NativeNodeWatchWorkspaceStartup {
            root_path: startup.root_path,
            policy,
            breakpoints: startup.breakpoints,
            exception_pause_mode: startup.exception_pause_mode,
            just_my_code: startup.just_my_code,
            source_maps_enabled: startup.source_maps_enabled,
            sink: startup.sink,
            registry: startup.registry,
            workspace_registry: startup.workspace_registry,
            trust: startup.trust,
        },
        readiness.into_program(),
    )
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn start_native_node_watch_for_retained_workspace(
    startup: NativeNodeWatchWorkspaceStartup<'_>,
) -> Result<DebugStartResponse, String> {
    let readiness = probe_native_node_watch_readiness(&startup.policy)?;
    start_native_node_watch_with_readiness(startup, readiness.into_program())
}

fn start_native_node_watch_with_readiness(
    startup: NativeNodeWatchWorkspaceStartup<'_>,
    runtime: crate::debug_node_launch::NodeLaunchProgram,
) -> Result<DebugStartResponse, String> {
    let NativeNodeWatchWorkspaceStartup {
        root_path,
        policy,
        breakpoints,
        exception_pause_mode,
        just_my_code,
        source_maps_enabled,
        sink,
        registry,
        workspace_registry,
        trust,
    } = startup;

    let validated_policy = policy.clone();
    authorize_native_node_watch_start(
        NativeNodeWatchAuthorizationRequest {
            root_path,
            policy: &validated_policy,
            breakpoints,
            registry,
            workspace_registry,
            trust,
        },
        move |authorized| {
            let workspace_directory =
                authorized
                    ._retained_root
                    .try_clone_directory()
                    .map_err(|_| {
                        "Native Node watch workspace identity changed during startup.".to_string()
                    })?;
            start_native_node_watch_session(NativeNodeWatchSessionStartup {
                factory: DebugSessionFactoryStartup {
                    permit: authorized.permit,
                    sink,
                    registry,
                    breakpoint_kind: DebugBreakpointAdapterKind::Node,
                    breakpoints: &authorized.breakpoints,
                    mode: DebugSessionMode::OwnedLaunch,
                },
                root: authorized.root,
                workspace_directory,
                policy,
                exception_pause_mode,
                just_my_code,
                authority: authorized
                    .authority
                    .with_verified_runtime(runtime)
                    .with_source_maps_enabled(source_maps_enabled),
            })
        },
    )
}

struct NativeNodeWatchAuthorizationRequest<'a> {
    root_path: &'a str,
    policy: &'a NativeNodeWatchLaunchPolicy,
    breakpoints: &'a [DebugBreakpoint],
    registry: &'a Arc<DebugSessionRegistry>,
    workspace_registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
}

struct AuthorizedNativeNodeWatchStart {
    _retained_root: RetainedDebugWorkspaceRoot,
    _retained_entry: File,
    root: PathBuf,
    permit: crate::debug_adapter::DebugStartupPermit,
    authority: NativeNodeWatchLaunchAuthority,
    breakpoints: Vec<DebugBreakpoint>,
}

fn authorize_native_node_watch_start<T>(
    request: NativeNodeWatchAuthorizationRequest<'_>,
    start: impl FnOnce(AuthorizedNativeNodeWatchStart) -> Result<T, String>,
) -> Result<T, String> {
    let retained_root = retain_workspace_root(request.workspace_registry, request.root_path)?;
    let root = retained_root.live_path()?;
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } =
        &retained_root.authority
    else {
        return Err("Native Node watch requires retained workspace authority.".to_string());
    };
    if root.as_path() != std::path::Path::new(canonical_root) {
        return Err("Native Node watch workspace identity changed during startup.".to_string());
    }

    // Reject an invalid private recipe or breakpoint inventory before reserving
    // a registry start generation (which intentionally replaces the old root
    // session).
    let launch = build_strict_native_node_watch_launch_plan(&root, request.policy.clone())?;
    let entry_path = launch
        .arguments
        .last()
        .ok_or_else(|| "Native Node watch launch plan has no retained entrypoint.".to_string())?;
    ensure_exact_native_watch_entry(
        request.root_path,
        &root,
        request.policy.script_path(),
        entry_path,
    )?;
    let mut entry_options = OpenOptions::new();
    entry_options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        entry_options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let retained_entry = entry_options
        .open(entry_path)
        .map_err(|_| "Native Node watch entrypoint identity changed during startup.".to_string())?;
    if !retained_entry
        .metadata()
        .map_err(|_| "Unable to inspect native Node watch entrypoint identity.".to_string())?
        .is_file()
    {
        return Err("Native Node watch entrypoint must be a regular file.".to_string());
    }
    let breakpoints =
        validate_initial_breakpoints(&root, DebugBreakpointAdapterKind::Node, request.breakpoints)?;

    // The trust guard closes the set/revoke race through adapter publication.
    // It is dropped when `start` returns and is never captured by the watch
    // adapter or its reconnect loop. Every later trust/workspace transition
    // invalidates the registry root generation.
    let trust = request
        .trust
        .lock()
        .map_err(|_| "Unable to inspect native Node watch workspace trust.".to_string())?;
    let snapshot = trust.snapshot(canonical_root);
    if snapshot.root_path != *canonical_root || !snapshot.trusted {
        return Err("Trust this workspace to run native Node watch debugging.".to_string());
    }

    let permit = request
        .registry
        .begin_start_with_authority(canonical_root, retained_root.authority.clone())?;
    let authority_registry = Arc::clone(request.registry);
    let authority_permit = permit.clone();
    let authority = NativeNodeWatchLaunchAuthority::new(Arc::new(move || {
        authority_registry.startup_is_current(&authority_permit)
    }));

    let result = start(AuthorizedNativeNodeWatchStart {
        _retained_root: retained_root,
        _retained_entry: retained_entry,
        root,
        permit,
        authority,
        breakpoints,
    });
    drop(trust);
    result
}

fn ensure_exact_native_watch_entry(
    requested_root: &str,
    canonical_root: &std::path::Path,
    requested_script: &str,
    canonical_script: &str,
) -> Result<(), String> {
    let requested_script = std::path::Path::new(requested_script);
    let requested_relative = if requested_script.is_absolute() {
        requested_script
            .strip_prefix(std::path::Path::new(requested_root))
            .map_err(|_| {
                "Native Node watch entrypoint must use its exact workspace path.".to_string()
            })?
    } else {
        requested_script
    };
    let canonical_relative = std::path::Path::new(canonical_script)
        .strip_prefix(canonical_root)
        .map_err(|_| "Native Node watch entrypoint escaped its workspace.".to_string())?;
    if requested_relative != canonical_relative {
        return Err("Native Node watch entrypoint must use its exact workspace path.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{DebugAdapter, DebugEvent};
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(1);

    struct Fixture {
        root: PathBuf,
        script: PathBuf,
        workspace_registry: WorkspaceRegistry,
        trust: Mutex<WorkspaceTrustService>,
        registry: Arc<DebugSessionRegistry>,
    }

    impl Fixture {
        fn new(trusted: bool) -> Self {
            let parent = std::env::temp_dir().join(format!(
                "codevo-native-watch-boundary-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            let root = parent.join("workspace");
            fs::create_dir_all(&root).expect("fixture root");
            let root = root.canonicalize().expect("canonical root");
            let script = root.join("server.js");
            fs::write(&script, "setInterval(() => {}, 1000);\n").expect("fixture script");
            let workspace_registry = WorkspaceRegistry::new();
            workspace_registry
                .register(&root)
                .expect("register workspace");
            let mut trust =
                WorkspaceTrustService::load(parent.join("trust.json")).expect("trust service");
            if trusted {
                trust
                    .set(&root.to_string_lossy(), true)
                    .expect("trust workspace");
            }
            let registry = Arc::new(DebugSessionRegistry::new());
            if trusted {
                registry.activate_root(&root.to_string_lossy());
            }
            Self {
                root,
                script,
                workspace_registry,
                trust: Mutex::new(trust),
                registry,
            }
        }

        fn policy(&self) -> NativeNodeWatchLaunchPolicy {
            NativeNodeWatchLaunchPolicy::for_test(self.script.to_string_lossy().into_owned(), 22)
                .expect("policy")
        }

        fn request<'a>(
            &'a self,
            policy: &'a NativeNodeWatchLaunchPolicy,
        ) -> NativeNodeWatchAuthorizationRequest<'a> {
            NativeNodeWatchAuthorizationRequest {
                root_path: self.root.to_str().expect("UTF-8 root"),
                policy,
                breakpoints: &[],
                registry: &self.registry,
                workspace_registry: &self.workspace_registry,
                trust: &self.trust,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Some(parent) = self.root.parent() {
                let _ = fs::remove_dir_all(parent);
            }
        }
    }

    struct IdleAdapter;

    impl DebugAdapter for IdleAdapter {
        fn set_breakpoints(
            &mut self,
            _file_path: &str,
            breakpoints: &[DebugBreakpoint],
        ) -> Result<Vec<DebugBreakpoint>, String> {
            Ok(breakpoints.to_vec())
        }

        fn step(&mut self, _kind: crate::debug_adapter::StepKind) -> Result<(), String> {
            Ok(())
        }

        fn pause(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn stack_trace(&mut self) -> Result<Vec<crate::debug_adapter::DebugStackFrame>, String> {
            Ok(Vec::new())
        }

        fn scopes(
            &mut self,
            _frame_id: u64,
        ) -> Result<Vec<crate::debug_adapter::DebugScopeInfo>, String> {
            Ok(Vec::new())
        }

        fn evaluate(
            &mut self,
            _frame_id: u64,
            _expression: &str,
        ) -> Result<crate::debug_adapter::DebugVariableInfo, String> {
            Err("unused".to_string())
        }

        fn terminate(&mut self) {}
    }

    #[test]
    fn unregistered_and_untrusted_roots_fail_before_private_start_callback() {
        let untrusted = Fixture::new(false);
        let untrusted_policy = untrusted.policy();
        let calls = AtomicUsize::new(0);
        let result =
            authorize_native_node_watch_start(untrusted.request(&untrusted_policy), |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
        assert!(result
            .expect_err("untrusted")
            .contains("Trust this workspace"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let registered = Fixture::new(true);
        let registered_policy = registered.policy();
        let descriptor = registered
            .workspace_registry
            .descriptor_for_registered_path(&registered.root)
            .expect("descriptor");
        registered
            .workspace_registry
            .unregister(&descriptor.workspace_id)
            .expect("unregister");
        let result =
            authorize_native_node_watch_start(registered.request(&registered_policy), |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
        assert!(result.expect_err("unregistered").contains("not registered"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn retained_and_trusted_start_uses_registry_generation_as_ongoing_authority() {
        let fixture = Fixture::new(true);
        let policy = fixture.policy();
        let root_key = fixture.root.to_string_lossy().into_owned();
        let observed = authorize_native_node_watch_start(fixture.request(&policy), |authorized| {
            assert!(authorized.authority.is_current());
            Ok((authorized.authority, authorized.permit))
        })
        .expect("authorized");
        assert!(observed.0.is_current());

        fixture.registry.deactivate_root(&root_key);
        fixture.registry.activate_root(&root_key);
        assert!(
            !observed.0.is_current(),
            "revoke/regrant must not revive an old startup generation"
        );
    }

    #[test]
    fn trusted_live_entry_change_is_expected_and_does_not_revoke_session_authority() {
        let fixture = Fixture::new(true);
        let policy = fixture.policy();
        let authority = authorize_native_node_watch_start(fixture.request(&policy), |authorized| {
            let admitted_identity = authorized
                ._retained_entry
                .metadata()
                .expect("retained entry metadata");
            fs::write(&fixture.script, "setInterval(() => {}, 20_000);\n")
                .expect("intentional live edit");
            let edited_identity = fs::metadata(&fixture.script).expect("edited entry metadata");
            assert!(
                admitted_identity.len() != edited_identity.len()
                    || admitted_identity.modified().ok() != edited_identity.modified().ok(),
                "fixture edit must change the live entry version"
            );
            assert!(authorized.authority.is_current());
            Ok(authorized.authority)
        })
        .expect("authorized live-filesystem launch");

        assert!(
            authority.is_current(),
            "trusted live file edits are watch inputs, not authority revocations"
        );
    }

    #[test]
    fn invalid_recipe_is_rejected_before_replacing_an_existing_session() {
        let fixture = Fixture::new(true);
        let root_key = fixture.root.to_string_lossy().into_owned();
        let session_id = fixture
            .registry
            .start_session(&root_key, Arc::new(TestSink), |_emitter| {
                Ok(Box::new(IdleAdapter))
            })
            .expect("existing session");
        let invalid = NativeNodeWatchLaunchPolicy::for_test(
            fixture
                .root
                .join("server.ts")
                .to_string_lossy()
                .into_owned(),
            22,
        )
        .expect("syntactic policy");
        let request = NativeNodeWatchAuthorizationRequest {
            root_path: fixture.root.to_str().expect("UTF-8 root"),
            policy: &invalid,
            breakpoints: &[],
            registry: &fixture.registry,
            workspace_registry: &fixture.workspace_registry,
            trust: &fixture.trust,
        };

        assert!(authorize_native_node_watch_start(request, |_| Ok(()))
            .expect_err("invalid launch")
            .contains(".js, .mjs or .cjs"));
        assert_eq!(
            fixture.registry.session_id_for_root(&root_key),
            Some(session_id)
        );
    }

    struct TestSink;

    impl crate::debug_adapter::DebugEventSink for TestSink {
        fn emit(&self, _event: DebugEvent) {}
    }

    fn production_start(
        fixture: &Fixture,
        policy: NativeNodeWatchLaunchPolicy,
    ) -> Result<DebugStartResponse, String> {
        start_native_node_watch_for_retained_workspace(NativeNodeWatchWorkspaceStartup {
            root_path: fixture.root.to_str().expect("UTF-8 root"),
            policy,
            breakpoints: &[],
            exception_pause_mode: DebugExceptionPauseMode::None,
            just_my_code: None,
            source_maps_enabled: true,
            sink: Arc::new(TestSink),
            registry: &fixture.registry,
            workspace_registry: &fixture.workspace_registry,
            trust: &fixture.trust,
        })
    }

    #[cfg(target_os = "macos")]
    fn production_intent_start(fixture: &Fixture) -> Result<DebugStartResponse, String> {
        start_native_node_watch_intent_for_retained_workspace(
            NativeNodeWatchIntentWorkspaceStartup {
                root_path: fixture.root.to_str().expect("UTF-8 root"),
                script_path: fixture.script.to_string_lossy().into_owned(),
                preserve_output: false,
                breakpoints: &[],
                exception_pause_mode: DebugExceptionPauseMode::None,
                just_my_code: None,
                source_maps_enabled: true,
                sink: Arc::new(TestSink),
                registry: &fixture.registry,
                workspace_registry: &fixture.workspace_registry,
                trust: &fixture.trust,
            },
        )
    }

    #[cfg(unix)]
    #[test]
    fn production_boundary_fails_closed_after_leaf_is_replaced_by_symlink() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new(true);
        let outside_script = fixture.root.with_extension("outside-leaf.js");
        let marker = fixture.root.with_extension("foreign-leaf-marker");
        fs::write(
            &outside_script,
            format!("require('fs').writeFileSync({marker:?}, 'foreign');"),
        )
        .expect("outside script");
        fs::remove_file(&fixture.script).expect("remove admitted leaf");
        symlink(&outside_script, &fixture.script).expect("replace leaf with symlink");

        assert!(production_start(&fixture, fixture.policy()).is_err());
        assert!(!marker.exists(), "foreign leaf script must never execute");
        let _ = fs::remove_file(outside_script);
    }

    #[cfg(unix)]
    #[test]
    fn production_boundary_fails_closed_after_intermediate_is_replaced_by_symlink() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new(true);
        let outside = fixture.root.with_extension("outside-intermediate");
        let marker = fixture.root.with_extension("foreign-intermediate-marker");
        fs::create_dir_all(&outside).expect("outside directory");
        fs::write(
            outside.join("main.js"),
            format!("require('fs').writeFileSync({marker:?}, 'foreign');"),
        )
        .expect("outside script");
        symlink(&outside, fixture.root.join("linked")).expect("replace intermediate with symlink");
        let policy = NativeNodeWatchLaunchPolicy::for_test(
            fixture
                .root
                .join("linked/main.js")
                .to_string_lossy()
                .into_owned(),
            22,
        )
        .expect("syntactic policy");

        assert!(production_start(&fixture, policy).is_err());
        assert!(
            !marker.exists(),
            "foreign intermediate script must never execute"
        );
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(unix)]
    #[test]
    fn production_boundary_rejects_an_in_workspace_symlink_alias() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new(true);
        let alias = fixture.root.join("alias.js");
        symlink(&fixture.script, &alias).expect("create in-workspace alias");
        let policy =
            NativeNodeWatchLaunchPolicy::for_test(alias.to_string_lossy().into_owned(), 22)
                .expect("syntactic policy");

        assert!(
            authorize_native_node_watch_start(fixture.request(&policy), |_| Ok(()))
                .expect_err("symlink alias")
                .contains("exact workspace path")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn production_boundary_rejects_a_case_alias() {
        let fixture = Fixture::new(true);
        let case_alias = fixture.root.join("SERVER.js");
        let policy =
            NativeNodeWatchLaunchPolicy::for_test(case_alias.to_string_lossy().into_owned(), 22)
                .expect("syntactic policy");

        assert!(
            authorize_native_node_watch_start(fixture.request(&policy), |_| Ok(()))
                .expect_err("case alias")
                .contains("exact workspace path")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_public_intent_discovers_runtime_starts_watch_and_reaps_it() {
        let fixture = Fixture::new(true);

        let DebugStartResponse::Ok { session_id } =
            production_intent_start(&fixture).expect("production native Node watch")
        else {
            panic!("production boundary did not start a watch session");
        };
        assert!(
            fixture.registry.stop_by_id(session_id),
            "production watch owner must stop and reap its process group"
        );
    }

    #[test]
    fn trust_lock_is_held_through_start_callback_but_not_captured_afterward() {
        let fixture = Fixture::new(true);
        let policy = fixture.policy();
        let trust = &fixture.trust;
        authorize_native_node_watch_start(fixture.request(&policy), |_| {
            assert!(
                trust.try_lock().is_err(),
                "trust transition must not interleave with publication"
            );
            Ok(())
        })
        .expect("authorized");
        assert!(trust.try_lock().is_ok());
    }
}
