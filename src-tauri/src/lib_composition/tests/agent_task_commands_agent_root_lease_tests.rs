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
        Some(&workspace_registry),
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
        Some(&workspace_registry),
    )
    .expect("release agent lease");

    assert!(workspace_registry.descriptor(&receipt.workspace_id).is_ok());
}
