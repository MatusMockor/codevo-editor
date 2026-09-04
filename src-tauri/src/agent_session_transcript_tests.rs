use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

const SESSION_ID: &str = "11111111-1111-4111-8111-111111111111";
const BEFORE: &str = "2026-08-30T08:00:00.000Z";
const AFTER: &str = "2026-08-30T09:00:00.000Z";
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    base: PathBuf,
    roots: ExternalSessionHistoryRoots,
    request: ReadExternalAgentSessionHistoryRequest,
}

impl Fixture {
    fn new(provider: AgentCliInvocation) -> Self {
        let base = std::env::temp_dir().join(format!(
            "session-transcript-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(base.join("repo")).unwrap();
        let root = fs::canonicalize(base.join("repo"))
            .unwrap()
            .to_string_lossy()
            .into_owned();
        Self {
            roots: ExternalSessionHistoryRoots {
                claude_projects_directory: base.join("claude"),
                codex_sessions_directory: base.join("codex"),
            },
            base,
            request: ReadExternalAgentSessionHistoryRequest {
                provider,
                session_id: SESSION_ID.to_string(),
                project_root: root.clone(),
                repository_root: root,
                before_epoch_ms: parse_iso_utc_epoch_ms(BEFORE).unwrap(),
            },
        }
    }

    fn message(&self, role: &str, text: &str, timestamp: Option<&str>) -> Value {
        match self.request.provider {
            AgentCliInvocation::ClaudeCode => json!({
                "type": role, "sessionId": SESSION_ID, "cwd": self.request.repository_root,
                "timestamp": timestamp, "message": {"content": text},
            }),
            AgentCliInvocation::CodexExec => json!({
                "type": "response_item", "timestamp": timestamp,
                "payload": {"type": "message", "role": role, "content": [{
                    "type": if role == "user" {"input_text"} else {"output_text"}, "text": text,
                }]},
            }),
        }
    }

    fn write(&self, messages: &[Value]) -> PathBuf {
        let (path, mut lines) = match self.request.provider {
            AgentCliInvocation::ClaudeCode => (self.roots.claude_projects_directory
                .join(encode_claude_project_directory(&self.request.repository_root))
                .join(format!("{SESSION_ID}.jsonl")), Vec::new()),
            AgentCliInvocation::CodexExec => (self.roots.codex_sessions_directory
                .join("2026/08/30")
                .join(format!("rollout-2026-08-30T08-00-00-{SESSION_ID}.jsonl")), vec![json!({
                    "type": "session_meta", "timestamp": BEFORE,
                    "payload": {"id": SESSION_ID, "cwd": self.request.repository_root, "source": "cli"},
                }).to_string()]),
        };
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        lines.extend(messages.iter().map(Value::to_string));
        fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn read(&self) -> Result<ExternalAgentSessionHistory, String> {
        read_history_at(&self.request, &self.roots, self.request.before_epoch_ms)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.base).unwrap();
    }
}

#[test]
fn both_providers_return_original_chat_beyond_preview_limit_without_later_resumed_messages() {
    for provider in [
        AgentCliInvocation::ClaudeCode,
        AgentCliInvocation::CodexExec,
    ] {
        let fixture = Fixture::new(provider);
        let mut messages: Vec<Value> = (0..60)
            .map(|index| {
                fixture.message(
                    if index % 2 == 0 { "user" } else { "assistant" },
                    &format!("message {index}"),
                    Some(BEFORE),
                )
            })
            .collect();
        messages.push(fixture.message("user", "Codevo continuation", Some(AFTER)));
        messages.push(fixture.message("assistant", "Codevo response", Some(AFTER)));
        fixture.write(&messages);
        let history = fixture.read().unwrap();
        assert_eq!(history.provider, provider);
        assert_eq!(history.session_id, SESSION_ID);
        assert_eq!(history.exchanges.len(), 60);
        assert_eq!(history.exchanges[0].role, ExternalSessionExchangeRole::User);
        assert_eq!(
            history.exchanges[59].role,
            ExternalSessionExchangeRole::Assistant
        );
        assert_eq!(history.exchanges[59].text, "message 59");
        assert!(!history.exchanges_truncated);
    }
}

#[test]
fn count_limit_keeps_recent_messages_in_chronological_order() {
    let fixture = Fixture::new(AgentCliInvocation::ClaudeCode);
    fixture.write(
        &(0..300)
            .map(|index| fixture.message("user", &index.to_string(), Some(BEFORE)))
            .collect::<Vec<_>>(),
    );
    let history = fixture.read().unwrap();
    assert_eq!(history.exchanges.len(), MAX_HISTORY_EXCHANGES);
    assert_eq!(history.exchanges[0].text, "44");
    assert_eq!(history.exchanges.last().unwrap().text, "299");
    assert!(history.exchanges_truncated);
}

#[test]
fn original_session_can_move_between_nested_project_repositories() {
    let fixture = Fixture::new(AgentCliInvocation::ClaudeCode);
    let nested = Path::new(&fixture.request.repository_root).join("packages/api");
    fs::create_dir_all(&nested).unwrap();
    let mut reply = fixture.message("assistant", "nested repository answer", Some(BEFORE));
    reply["cwd"] = json!(nested.to_str().unwrap());
    fixture.write(&[
        fixture.message("user", "work on the project", Some(BEFORE)),
        reply,
    ]);
    let history = fixture.read().unwrap();
    assert_eq!(history.exchanges.len(), 2);
    assert!(!history.exchanges_truncated);
    let mut foreign = fixture.message("assistant", "foreign", Some(BEFORE));
    foreign["cwd"] = json!(fixture.base.to_str().unwrap());
    fixture.write(&[fixture.message("user", "start", Some(BEFORE)), foreign]);
    assert!(fixture.read().is_err());
}

#[test]
fn undated_messages_are_not_imported_as_old_history() {
    for provider in [
        AgentCliInvocation::ClaudeCode,
        AgentCliInvocation::CodexExec,
    ] {
        let fixture = Fixture::new(provider);
        fixture.write(&[
            fixture.message("user", "dated", Some(BEFORE)),
            fixture.message("assistant", "unknown", None),
        ]);
        let history = fixture.read().unwrap();
        assert_eq!(history.exchanges.len(), 1);
        assert!(history.exchanges_truncated);
    }
}

#[test]
fn user_html_is_chat_content_and_structural_system_records_are_excluded() {
    for provider in [
        AgentCliInvocation::ClaudeCode,
        AgentCliInvocation::CodexExec,
    ] {
        let fixture = Fixture::new(provider);
        fixture.write(&[
            fixture.message("user", "hello", Some(BEFORE)),
            fixture.message("user", "<div>fix this</div>", Some(BEFORE)),
            fixture.message(
                "user",
                "<environment_context>injected</environment_context>",
                Some(BEFORE),
            ),
        ]);
        let history = fixture.read().unwrap();
        assert_eq!(history.exchanges.len(), 2);
        assert_eq!(history.exchanges[1].text, "<div>fix this</div>");
        assert!(!history.exchanges_truncated);
    }
}

#[test]
fn post_import_foreign_cwd_does_not_invalidate_original_snapshot() {
    let fixture = Fixture::new(AgentCliInvocation::ClaudeCode);
    let mut newer = fixture.message("user", "later continuation", Some(AFTER));
    newer["cwd"] = json!(fixture.base.to_str().unwrap());
    fixture.write(&[fixture.message("user", "original", Some(BEFORE)), newer]);
    let history = fixture.read().unwrap();
    assert_eq!(history.exchanges.len(), 1);
    assert_eq!(history.exchanges[0].text, "original");
    assert!(!history.exchanges_truncated);
}

#[test]
fn bounded_file_windows_report_partial_history_and_preserve_recent_tail() {
    let fixture = Fixture::new(AgentCliInvocation::CodexExec);
    fixture.write(
        &(0..60)
            .map(|index| {
                fixture.message(
                    "user",
                    &format!("{index}:{}", "á".repeat(8_000)),
                    Some(BEFORE),
                )
            })
            .collect::<Vec<_>>(),
    );
    let history = fixture.read().unwrap();
    assert!(history.exchanges_truncated);
    assert!(history.total_preview_bytes <= HISTORY_TOTAL_BYTES as u64);
    assert_eq!(
        history.total_preview_bytes,
        history
            .exchanges
            .iter()
            .map(|exchange| exchange.text.len() as u64)
            .sum::<u64>()
    );
    assert!(history.exchanges.last().unwrap().text.starts_with("59:"));
}

#[test]
fn oversized_message_clipping_is_truthful_and_utf8_safe() {
    let fixture = Fixture::new(AgentCliInvocation::ClaudeCode);
    fixture.write(&[fixture.message("user", &"💬".repeat(5_000), Some(BEFORE))]);
    let history = fixture.read().unwrap();
    assert!(history.exchanges_truncated);
    assert_eq!(
        history.total_preview_bytes,
        MAX_EXTERNAL_SESSION_TEXT_BYTES as u64
    );
}

#[test]
fn foreign_identity_and_root_fail_closed() {
    let fixture = Fixture::new(AgentCliInvocation::ClaudeCode);
    let mut line = fixture.message("user", "secret", Some(BEFORE));
    line["sessionId"] = json!("22222222-2222-4222-8222-222222222222");
    fixture.write(&[line]);
    assert!(fixture.read().is_err());
    let fixture = Fixture::new(AgentCliInvocation::CodexExec);
    let path = fixture.write(&[fixture.message("user", "secret", Some(BEFORE))]);
    let content = fs::read_to_string(&path)
        .unwrap()
        .replace(SESSION_ID, "22222222-2222-4222-8222-222222222222");
    fs::write(path, content).unwrap();
    assert!(fixture.read().is_err());
}

#[test]
fn request_cutoff_and_fields_are_closed() {
    let request = json!({"provider":"codex","sessionId":SESSION_ID,"projectRoot":"/repo","repositoryRoot":"/repo","beforeEpochMs":1});
    for cutoff in [json!(-1), json!(1.5), json!(null)] {
        let mut invalid = request.clone();
        invalid["beforeEpochMs"] = cutoff;
        assert!(serde_json::from_value::<ReadExternalAgentSessionHistoryRequest>(invalid).is_err());
    }
    let mut extra = request.clone();
    extra["extra"] = json!(true);
    assert!(serde_json::from_value::<ReadExternalAgentSessionHistoryRequest>(extra).is_err());
    let mut unsafe_request =
        serde_json::from_value::<ReadExternalAgentSessionHistoryRequest>(request).unwrap();
    unsafe_request.before_epoch_ms = MAX_SAFE_INTEGER + 1;
    assert!(validate_request(&unsafe_request).is_err());
}

#[cfg(unix)]
#[test]
fn symlinked_history_file_is_refused() {
    let fixture = Fixture::new(AgentCliInvocation::ClaudeCode);
    let path = fixture.write(&[fixture.message("user", "secret", Some(BEFORE))]);
    let target = fixture.base.join("target.jsonl");
    fs::rename(&path, &target).unwrap();
    std::os::unix::fs::symlink(target, path).unwrap();
    assert!(fixture.read().is_err());
}
