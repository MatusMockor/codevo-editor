use super::*;

#[test]
fn agent_root_lease_wire_shape_is_camel_case() {
    let workspace = TempWorkspace::create("lease-wire-shape");
    let registry = WorkspaceRegistry::new();
    let workspace_id = registry
        .register(&workspace.root)
        .expect("register workspace")
        .workspace_id;
    let request = serde_json::from_str::<AgentRootLeaseReleaseRequest>(
        "{\"rootPath\":\"/workspace/alpha\",\"leaseToken\":7}",
    )
    .expect("deserialize release request");
    let receipt = serde_json::to_string(&AgentRootLeaseReceipt {
        lease_token: 7,
        workspace_id: workspace_id.clone(),
    })
    .expect("serialize receipt");
    let released = serde_json::to_string(&AgentRootLeaseReleaseResult::from_disposition(
        request.lease_token,
        AgentRootLeaseReleaseDisposition::Released,
    ))
    .expect("serialize released result");

    assert_eq!(request.root_path, "/workspace/alpha");
    assert_eq!(request.lease_token, 7);
    assert_eq!(
        receipt,
        format!(
            "{{\"leaseToken\":7,\"workspaceId\":\"{}\"}}",
            workspace_id.as_str()
        )
    );
    assert_eq!(released, "{\"kind\":\"released\",\"leaseToken\":7}");
}

#[test]
fn agent_root_lease_release_result_echoes_the_request_token_for_every_disposition() {
    let token = MAX_AGENT_ROOT_LEASE_TOKEN;
    let cases = [
        (
            AgentRootLeaseReleaseDisposition::Released,
            "{\"kind\":\"released\",\"leaseToken\":9007199254740991}",
        ),
        (
            AgentRootLeaseReleaseDisposition::NotHeld,
            "{\"kind\":\"notHeld\",\"leaseToken\":9007199254740991}",
        ),
        (
            AgentRootLeaseReleaseDisposition::ForeignOwner,
            "{\"kind\":\"foreignOwner\",\"leaseToken\":9007199254740991}",
        ),
    ];

    for (disposition, expected) in cases {
        let result = AgentRootLeaseReleaseResult::from_disposition(token, disposition);
        let serialized = serde_json::to_string(&result).expect("serialize release result");

        assert_eq!(serialized, expected);
    }
}

#[test]
fn registered_agent_root_lease_is_idempotent_and_releases_its_workspace_admission() {
    let workspace = TempWorkspace::create("registered-agent-root-lease");
    let root = workspace
        .root
        .canonicalize()
        .expect("canonical workspace root");
    let workspace_registry = WorkspaceRegistry::new();
    let leases = AgentRootLeaseRegistry::new();

    let first = acquire_registered_workspace_lease(&root, &workspace_registry, &leases)
        .map(agent_root_lease_receipt)
        .expect("acquire registered lease");
    let second = acquire_registered_workspace_lease(&root, &workspace_registry, &leases)
        .map(agent_root_lease_receipt)
        .expect("reacquire registered lease");

    assert_eq!(first.lease_token, second.lease_token);
    assert_eq!(first.workspace_id, second.workspace_id);
    assert!(workspace_registry.descriptor(&first.workspace_id).is_ok());

    let released = release_agent_root_lease_for_registry(
        AgentRootLeaseReleaseRequest {
            root_path: root.to_string_lossy().into_owned(),
            lease_token: first.lease_token,
        },
        &leases,
        &workspace_registry,
    )
    .expect("release registered lease");

    assert_eq!(released.kind, AgentRootLeaseReleaseKind::Released);
    assert!(workspace_registry.descriptor(&first.workspace_id).is_err());
}

#[test]
fn releasing_agent_root_lease_preserves_an_existing_workspace_admission() {
    let workspace = TempWorkspace::create("shared-agent-root-lease");
    let root = workspace
        .root
        .canonicalize()
        .expect("canonical workspace root");
    let workspace_registry = WorkspaceRegistry::new();
    let editor_descriptor = workspace_registry
        .register(&root)
        .expect("register editor workspace");
    let leases = AgentRootLeaseRegistry::new();
    let receipt = acquire_registered_workspace_lease(&root, &workspace_registry, &leases)
        .map(agent_root_lease_receipt)
        .expect("acquire agent lease");

    assert_eq!(receipt.workspace_id, editor_descriptor.workspace_id);

    release_agent_root_lease_for_registry(
        AgentRootLeaseReleaseRequest {
            root_path: root.to_string_lossy().into_owned(),
            lease_token: receipt.lease_token,
        },
        &leases,
        &workspace_registry,
    )
    .expect("release agent lease");

    assert!(workspace_registry.descriptor(&receipt.workspace_id).is_ok());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn agent_release_racing_a_runtime_start_keeps_the_lease_and_its_admission() {
    let workspace = TempWorkspace::create("agent-release-runtime-start-race");
    let root = workspace
        .root
        .canonicalize()
        .expect("canonical workspace root");
    let workspace_registry = WorkspaceRegistry::new();
    let leases = AgentRootLeaseRegistry::new();
    let receipt = acquire_registered_workspace_lease(&root, &workspace_registry, &leases)
        .map(agent_root_lease_receipt)
        .expect("acquire agent lease");
    let request = || AgentRootLeaseReleaseRequest {
        root_path: root.to_string_lossy().into_owned(),
        lease_token: receipt.lease_token,
    };
    let runtime_start = workspace_registry
        .reserve_runtime_start(&receipt.workspace_id)
        .expect("runtime start in progress");

    let blocked = release_agent_root_lease_for_registry(request(), &leases, &workspace_registry);

    assert!(blocked.is_err());
    assert!(leases.registered(&root).is_some());
    assert!(workspace_registry.descriptor(&receipt.workspace_id).is_ok());

    drop(runtime_start);
    let released = release_agent_root_lease_for_registry(request(), &leases, &workspace_registry)
        .expect("release after runtime start settles");

    assert_eq!(released.kind, AgentRootLeaseReleaseKind::Released);
    assert!(leases.registered(&root).is_none());
    assert!(!leases.is_held(&root));
    assert!(workspace_registry
        .descriptor(&receipt.workspace_id)
        .is_err());
}

#[test]
fn acquiring_a_lease_that_is_being_released_fails_before_registering() {
    let workspace = TempWorkspace::create("agent-acquire-during-release");
    let root = workspace
        .root
        .canonicalize()
        .expect("canonical workspace root");
    let workspace_registry = WorkspaceRegistry::new();
    let leases = AgentRootLeaseRegistry::new();
    let receipt = acquire_registered_workspace_lease(&root, &workspace_registry, &leases)
        .map(agent_root_lease_receipt)
        .expect("acquire agent lease");
    let (disposition, _) = leases.begin_release_registered(&root, receipt.lease_token);
    assert_eq!(disposition, AgentRootLeaseReleaseDisposition::Released);

    let during_release = acquire_registered_workspace_lease(&root, &workspace_registry, &leases);

    assert_eq!(
        during_release.map(|_| ()),
        Err(agent_root_lease::AGENT_ROOT_LEASE_RELEASING_ERROR.to_string())
    );
    let released = workspace_registry
        .release_owner(
            &receipt.workspace_id,
            WorkspaceOwnerScope::Admission {
                owner: RegistrationOwner::Agent,
                admission_token: leases_registration_token(&workspace_registry, &receipt),
            },
            None,
        )
        .expect("release the only admission");
    assert!(matches!(released, WorkspaceOwnerRelease::LastOwner(_)));
}

fn leases_registration_token(registry: &WorkspaceRegistry, receipt: &AgentRootLeaseReceipt) -> u64 {
    registry
        .admission_tokens_for_test(&receipt.workspace_id)
        .into_iter()
        .next()
        .expect("single admission")
}

#[test]
fn failed_agent_release_restores_the_lease_only_while_the_registry_holds_its_token() {
    for (registry_holds, close_result, lease_restored, succeeds) in [
        (true, Err("transport failed".to_string()), true, false),
        (false, Err("transport failed".to_string()), false, false),
        (true, Ok(WorkspaceOwnerCloseResult::Releasing), true, false),
        (true, Ok(WorkspaceOwnerCloseResult::StaleOwner), false, true),
    ] {
        let workspace = TempWorkspace::create("agent-release-restore-rule");
        let root = workspace
            .root
            .canonicalize()
            .expect("canonical workspace root");
        let workspace_registry = WorkspaceRegistry::new();
        let leases = AgentRootLeaseRegistry::new();
        let receipt = acquire_registered_workspace_lease(&root, &workspace_registry, &leases)
            .map(agent_root_lease_receipt)
            .expect("acquire agent lease");
        let (result, pending) = begin_agent_root_lease_release(
            AgentRootLeaseReleaseRequest {
                root_path: root.to_string_lossy().into_owned(),
                lease_token: receipt.lease_token,
            },
            &leases,
        )
        .expect("begin release");

        let completed = tauri::async_runtime::block_on(complete_agent_root_lease_release(
            &leases,
            |_| registry_holds,
            result,
            pending.expect("registered lease"),
            |_| async move { close_result },
        ));

        assert_eq!(completed.is_ok(), succeeds);
        assert_eq!(leases.registered(&root).is_some(), lease_restored);
        assert_eq!(leases.is_held(&root), lease_restored);
    }
}
