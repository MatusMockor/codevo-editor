use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
const ID: &str = "11111111-1111-4111-8111-111111111111";
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    base: PathBuf,
    root: String,
    roots: ExternalSessionHistoryRoots,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "session-import-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(base.join("repo")).unwrap();
        let root = fs::canonicalize(base.join("repo"))
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let roots = ExternalSessionHistoryRoots {
            claude_projects_directory: base.join("claude"),
            codex_sessions_directory: base.join("codex"),
        };
        let path = roots
            .claude_projects_directory
            .join(encode_claude_project_directory(&root))
            .join(format!("{ID}.jsonl"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        Self {
            base,
            root,
            roots,
            path,
        }
    }
    fn message(&self, text: &str) -> String {
        json!({"type":"user","sessionId":ID,"cwd":self.root,"promptSource":"typed","timestamp":"2026-08-30T08:00:00.000Z","message":{"content":text}}).to_string()+"\n"
    }
    fn page(&self, cursor: Option<SourceCursor>) -> Result<SourcePage, String> {
        read_page_at(
            AgentCliInvocation::ClaudeCode,
            ID,
            &self.root,
            u64::MAX,
            cursor,
            &self.roots,
            &self.base,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}
#[test]
fn imports_entire_middle_and_more_than_old_byte_and_exchange_limits() {
    let f = Fixture::new();
    let expected: Vec<_> = (0..700)
        .map(|i| format!("message-{i}-{}", "x".repeat(1000)))
        .collect();
    fs::write(
        &f.path,
        expected
            .iter()
            .map(|text| f.message(text))
            .collect::<String>(),
    )
    .unwrap();
    let mut cursor = None;
    let mut actual = Vec::new();
    let mut steps = 0;
    loop {
        let page = f.page(cursor).unwrap();
        assert!(!page.truncated);
        assert!(page.exchanges.len() <= 64);
        steps += 1;
        actual.extend(page.exchanges.into_iter().map(|e| e.text));
        if page.complete {
            break;
        }
        cursor = Some(page.cursor);
        assert!(steps < 100);
    }
    assert_eq!(actual, expected);
    assert!(steps > 1);
}
#[test]
fn retrying_checkpoint_is_deterministic_and_appends_do_not_extend_snapshot() {
    use std::io::Write;
    let f = Fixture::new();
    fs::write(
        &f.path,
        (0..130)
            .map(|i| f.message(&i.to_string()))
            .collect::<String>(),
    )
    .unwrap();
    let first = f.page(None).unwrap();
    let cursor = first.cursor;
    let second = f.page(Some(cursor.clone())).unwrap();
    let mut file = fs::OpenOptions::new().append(true).open(&f.path).unwrap();
    file.write_all(f.message("new append").as_bytes()).unwrap();
    let retry = f.page(Some(cursor)).unwrap();
    assert_eq!(retry.exchanges, second.exchanges);
    let last = f.page(Some(retry.cursor)).unwrap();
    assert!(last.complete);
    assert_eq!(last.exchanges.len(), 2);
}
#[test]
fn replacement_after_snapshot_does_not_change_imported_content() {
    let f = Fixture::new();
    fs::write(
        &f.path,
        (0..130)
            .map(|i| f.message(&i.to_string()))
            .collect::<String>(),
    )
    .unwrap();
    let first = f.page(None).unwrap();
    fs::rename(&f.path, f.path.with_extension("old")).unwrap();
    fs::write(&f.path, f.message("replacement")).unwrap();
    let page = f.page(Some(first.cursor)).unwrap();
    assert_eq!(page.exchanges[0].text, "64");
}
#[test]
fn oversized_record_is_reported_and_does_not_hide_later_messages() {
    let f = Fixture::new();
    fs::write(
        &f.path,
        f.message("first") + &f.message(&"x".repeat(17 * STEP_BYTES)) + &f.message("after"),
    )
    .unwrap();
    let mut cursor = None;
    let mut texts = Vec::new();
    let mut truncated = false;
    loop {
        let page = f.page(cursor).unwrap();
        truncated |= page.truncated;
        texts.extend(page.exchanges.into_iter().map(|e| e.text));
        if page.complete {
            break;
        }
        cursor = Some(page.cursor);
    }
    assert!(truncated);
    assert_eq!(texts, vec!["first", "after"]);
}
#[test]
fn attachment_only_user_message_survives() {
    let f = Fixture::new();
    let image = json!({"type":"user","cwd":f.root,"sessionId":ID,"timestamp":"2026-08-30T08:00:00.000Z","message":{"content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"eA=="}}]}});
    fs::write(&f.path, f.message("first") + &image.to_string() + "\n").unwrap();
    let page = f.page(None).unwrap();
    assert_eq!(page.exchanges.len(), 2);
    assert_eq!(page.exchanges[1].attachments.len(), 1);
}

#[test]
fn common_large_inline_image_keeps_text_and_mime_without_retaining_base64() {
    let f = Fixture::new();
    let image = json!({"type":"user","cwd":f.root,"sessionId":ID,"timestamp":"2026-08-30T08:00:00.000Z","message":{"content":[{"type":"text","text":"look at this image"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"A".repeat(2*STEP_BYTES)}}]}});
    fs::write(&f.path, image.to_string() + "\n").unwrap();
    let mut cursor = None;
    let mut messages = Vec::new();
    loop {
        let page = f.page(cursor).unwrap();
        assert!(!page.truncated);
        messages.extend(page.exchanges);
        if page.complete {
            break;
        }
        cursor = Some(page.cursor);
    }
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].text, "look at this image");
    assert_eq!(messages[0].attachments.len(), 1);
}
#[test]
fn source_change_while_copying_restarts_before_any_messages_are_committed() {
    let f = Fixture::new();
    let original = f.message("original") + &f.message(&"x".repeat(2 * STEP_BYTES));
    fs::write(&f.path, original).unwrap();
    let first = f.page(None).unwrap();
    assert!(first.exchanges.is_empty());
    fs::write(&f.path, f.message("replacement")).unwrap();
    let next = f.page(Some(first.cursor)).unwrap();
    assert!(next.complete);
    assert_eq!(next.exchanges[0].text, "replacement");
}

#[test]
fn codex_import_streams_large_image_record_and_preserves_session_messages() {
    let f = Fixture::new();
    let (year, month, day) = civil_from_days((current_epoch_ms() / EPOCH_MS_PER_DAY) as i64);
    let path = f
        .roots
        .codex_sessions_directory
        .join(format!("{year:04}/{month:02}/{day:02}"))
        .join(format!("rollout-{ID}.jsonl"));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let meta = json!({"type":"session_meta","timestamp":"2026-08-30T08:00:00.000Z","payload":{"id":ID,"cwd":f.root,"source":"cli"}});
    let message = json!({"type":"response_item","timestamp":"2026-08-30T08:00:00.000Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"codex image"},{"type":"input_image","image_url":format!("data:image/png;base64,{}","A".repeat(2*STEP_BYTES))}]}});
    fs::write(path, meta.to_string() + "\n" + &message.to_string() + "\n").unwrap();
    let mut cursor = None;
    let mut messages = Vec::new();
    loop {
        let page = read_page_at(
            AgentCliInvocation::CodexExec,
            ID,
            &f.root,
            u64::MAX,
            cursor,
            &f.roots,
            &f.base,
        )
        .unwrap();
        assert!(!page.truncated);
        messages.extend(page.exchanges);
        if page.complete {
            break;
        }
        cursor = Some(page.cursor);
    }
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].text, "codex image");
    assert_eq!(messages[0].attachments.len(), 1);
}
