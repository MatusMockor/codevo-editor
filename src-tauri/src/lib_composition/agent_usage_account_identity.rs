use crate::agent_task_spawner::agent_provider::process::parse_provider_probe_json;
use serde_json::Value;
use sha2::{Digest, Sha256};

const MAX_EMAIL_BYTES: usize = 320;
const MAX_ACCOUNT_BYTES: usize = 256;

fn public_text(value: Option<&Value>, limit: usize) -> Option<String> {
    let value = value?.as_str()?;
    if value.len() > limit || !value.is_ascii() || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return None;
    }
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn email(value: Option<&Value>) -> Option<String> {
    let value = public_text(value, MAX_EMAIL_BYTES)?.to_ascii_lowercase();
    let (local, domain) = value.split_once('@')?;
    (!local.is_empty() && !domain.is_empty() && !domain.contains('@') && !value.contains(' '))
        .then_some(value)
}

fn fingerprint(provider: &str, kind: &str, email: &str, account: &str) -> Option<String> {
    let payload =
        serde_json::to_vec(&["codevo-account-usage-v1", provider, kind, email, account]).ok()?;
    let digest = Sha256::digest(payload);
    Some(format!("account:v1:sha256:{digest:x}"))
}

pub(super) fn claude_identity(stdout: &[u8]) -> Option<String> {
    let value = parse_provider_probe_json(stdout)?;
    if value.get("loggedIn") != Some(&Value::Bool(true))
        || value.get("authMethod").and_then(Value::as_str) != Some("claude.ai")
    {
        return None;
    }
    let email = email(value.get("email"))?;
    let org = public_text(value.get("orgId"), MAX_ACCOUNT_BYTES)?;
    fingerprint("claudeCode", "claude-oauth", &email, &org)
}

pub(super) fn stable_identity(before: Option<String>, after: Option<String>) -> Option<String> {
    before.filter(|identity| Some(identity) == after.as_ref())
}

pub(super) fn codex_identity(stdout: &[u8]) -> Option<String> {
    let before = response(stdout, 2)?;
    let after = response(stdout, 3)?;
    let before_email = codex_email(&before)?;
    if before_email != codex_email(&after)? {
        return None;
    }
    let rates = response(stdout, 1)?;
    let account = public_text(rates.get("accountId"), MAX_ACCOUNT_BYTES)?;
    if !routing_matches(&before, &account) || !routing_matches(&after, &account) {
        return None;
    }
    fingerprint("codex", "chatgpt", &before_email, &account)
}

fn codex_email(response: &Value) -> Option<String> {
    let account = response.get("account")?;
    if account.get("type").and_then(Value::as_str) != Some("chatgpt") {
        return None;
    }
    email(account.get("email"))
}

fn routing_matches(response: &Value, account: &str) -> bool {
    match response
        .get("workspaceRouting")
        .filter(|value| !value.is_null())
    {
        None => true,
        Some(routing) => public_text(routing.get("chatgptAccountId"), MAX_ACCOUNT_BYTES)
            .is_some_and(|id| id == account),
    }
}

fn response(stdout: &[u8], id: u64) -> Option<Value> {
    let mut found = None;
    for line in stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let value = parse_provider_probe_json(line)?;
        if value.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if found.is_some() || value.get("error").is_some() {
            return None;
        }
        found = value.get("result").cloned();
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    fn codex_probe(
        before_email: &str,
        after_email: &str,
        account: Option<&str>,
        routing: Option<&str>,
    ) -> Vec<u8> {
        let auth = |email| serde_json::json!({"account":{"type":"chatgpt","email":email},"workspaceRouting":routing.map(|id| serde_json::json!({"chatgptAccountId":id}))});
        [
            serde_json::json!({"id":2,"result":auth(before_email)}),
            serde_json::json!({"id":1,"result":{"accountId":account}}),
            serde_json::json!({"id":3,"result":auth(after_email)}),
        ]
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n")
        .into_bytes()
    }
    #[test]
    fn matches_shared_runner_digest_fixtures() {
        assert_eq!(fingerprint("codex", "chatgpt", "user@example.com", "account-1").as_deref(), Some("account:v1:sha256:a7f409c1e47115f8a94e3a73d4b32301a53531a2be7ac4e7e712ad25fd65525a"));
        assert_eq!(fingerprint("claudeCode", "claude-oauth", "user@example.com", "org-1").as_deref(), Some("account:v1:sha256:9f14f610c68aac6373e7778b7bcf584800d6cbacc4a61d415e996ae6a51477da"));
    }
    #[test]
    fn canonical_account_identity_is_public_opaque_and_stable() {
        let identity = codex_identity(&codex_probe(
            " Person@Example.com ",
            "person@example.com",
            Some("account-1"),
            Some("account-1"),
        ))
        .expect("identity");
        assert_eq!(
            identity,
            fingerprint("codex", "chatgpt", "person@example.com", "account-1").expect("hash")
        );
        assert_eq!(identity.len(), "account:v1:sha256:".len() + 64);
        assert!(!identity.contains("person"));
        assert_ne!(
            Some(identity),
            codex_identity(&codex_probe(
                "person@example.com",
                "person@example.com",
                Some("account-2"),
                None
            ))
        );
    }
    #[test]
    fn refuses_unknown_switched_and_mismatched_codex_accounts() {
        for output in [
            codex_probe("a@b.c", "a@b.c", None, None),
            codex_probe("a@b.c", "c@b.c", Some("account"), None),
            codex_probe("a@b.c", "a@b.c", Some("account"), Some("other")),
        ] {
            assert!(codex_identity(&output).is_none());
        }
    }
    #[test]
    fn claude_requires_public_oauth_account_and_equal_authority() {
        let first = claude_identity(
            br#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","orgId":"org-1"}"#,
        )
        .expect("identity");
        let changed = claude_identity(
            br#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","orgId":"org-2"}"#,
        )
        .expect("identity");
        assert_eq!(
            stable_identity(Some(first.clone()), Some(first.clone())),
            Some(first.clone())
        );
        assert_eq!(stable_identity(Some(first.clone()), Some(changed)), None);
        assert_eq!(stable_identity(Some(first), None), None);
        for output in [
            br#"{"loggedIn":true,"authMethod":"api_key","email":"a@b.c","orgId":"org-1"}"#
                .as_slice(),
            br#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}"#,
            br#"{"loggedIn":false,"authMethod":"claude.ai","email":"a@b.c","orgId":"org-1"}"#,
        ] {
            assert!(claude_identity(output).is_none());
        }
    }
    #[test]
    fn rejects_control_non_ascii_oversized_and_duplicate_responses() {
        assert!(email(Some(&Value::String("a\n@b.c".into()))).is_none());
        assert!(email(Some(&Value::String("á@b.c".into()))).is_none());
        assert!(public_text(Some(&Value::String("x".repeat(257))), 256).is_none());
        let mut output = codex_probe("a@b.c", "a@b.c", Some("account"), None);
        output.extend_from_slice(b"\n{\"id\":1,\"result\":{\"accountId\":\"other\"}}");
        assert!(codex_identity(&output).is_none());
    }
}
