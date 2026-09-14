use super::*;
use serde_json::json;

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
            codex_transport: Default::default(),
            codex_app_server_args: Vec::new(),
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
            "checkForUpdates":false,
            "codexTransport":"appServer",
            "codexAppServerArgs":[]
        })
    );
}

#[test]
fn codex_policy_wire_defaults_are_backward_compatible_and_transport_is_closed() {
    let base =
        json!({"provider":"codex", "settingsRevision":1, "enabled":true, "checkForUpdates":true});
    let parsed: RegisterAgentProviderPolicyRequest = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(
        parsed.codex_transport,
        crate::agent_task_spawner::agent_provider::runtime::CodexTransport::AppServer
    );
    assert!(parsed.codex_app_server_args.is_empty());
    for (key, value) in [
        ("codexTransport", json!("remote")),
        ("codexTransport", json!(null)),
        ("codexAppServerArgs", json!(null)),
        ("codexAppServerArgs", json!("--help")),
    ] {
        let mut invalid = base.clone();
        invalid[key] = value;
        assert!(serde_json::from_value::<RegisterAgentProviderPolicyRequest>(invalid).is_err());
    }
    let mut explicit = base;
    explicit["codexTransport"] = json!("exec");
    explicit["codexAppServerArgs"] = json!(["--analytics-default-enabled"]);
    let parsed: RegisterAgentProviderPolicyRequest = serde_json::from_value(explicit).unwrap();
    assert_eq!(
        parsed.codex_transport,
        crate::agent_task_spawner::agent_provider::runtime::CodexTransport::Exec
    );
    assert_eq!(
        parsed.codex_app_server_args,
        ["--analytics-default-enabled"]
    );
}
