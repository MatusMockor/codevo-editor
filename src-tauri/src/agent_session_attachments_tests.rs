use super::super::{
    claude_exchange, codex_exchange, ExternalAgentSessionPreview, RawClaudeLine, RawCodexLine,
    SessionExchangeDraft,
};
use super::*;
use serde_json::{json, Value};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

const ATTACHMENT_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/external-session-history-with-attachments.json");
const LEGACY_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/external-session-history-legacy-no-attachments.json");
const TWENTY_MEGABYTES: usize = 20 * 1024 * 1024;

struct CountingAllocator;

thread_local! {
    static ALLOCATED_BYTES: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ =
            ALLOCATED_BYTES.try_with(|bytes| bytes.set(bytes.get().saturating_add(layout.size())));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout)
    }
}

#[global_allocator]
static COUNTING_ALLOCATOR: CountingAllocator = CountingAllocator;

fn bytes_allocated_by<T>(work: impl FnOnce() -> T) -> (T, usize) {
    let before = ALLOCATED_BYTES.with(Cell::get);
    let value = work();
    (value, ALLOCATED_BYTES.with(Cell::get) - before)
}

fn claude_user_line(content: Value) -> String {
    json!({
        "type": "user",
        "message": {"role": "user", "content": content},
        "promptSource": "sdk",
        "cwd": "/repo",
        "timestamp": "2026-09-11T11:07:43.301Z",
        "sessionId": "3a513f41-75ae-4fab-9fe0-e39d652bea8e"
    })
    .to_string()
}

fn codex_user_line(content: Value) -> String {
    json!({
        "timestamp": "2026-09-11T11:08:30.761Z",
        "type": "response_item",
        "payload": {"type": "message", "role": "user", "content": content}
    })
    .to_string()
}

fn claude_draft(line: &str) -> SessionExchangeDraft {
    let parsed = serde_json::from_str::<RawClaudeLine>(line).expect("claude line parses");
    claude_exchange(&parsed).expect("claude line is an exchange")
}

fn codex_draft(line: &str) -> SessionExchangeDraft {
    let parsed = serde_json::from_str::<RawCodexLine>(line).expect("codex line parses");
    codex_exchange(&parsed).expect("codex line is an exchange")
}

fn image_block(media_type: &str) -> Value {
    json!({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": "iVBORw0KGgo="}})
}

fn image(mime: ExternalSessionImageMime) -> ExternalSessionAttachment {
    ExternalSessionAttachment::Image {
        mime,
        name: None,
        path: None,
    }
}

fn local_image(path: &str) -> Value {
    json!({"type": "local_image", "path": path})
}

#[test]
fn claude_user_images_carry_only_their_mime() {
    let line = claude_user_line(json!([
        image_block("image/png"),
        image_block("image/jpg"),
        image_block("image/bmp"),
        {"type": "image"},
        {"type": "image", "source": "not a map"},
        {"type": "text", "text": "Reply with the single word OK."}
    ]));

    let draft = claude_draft(&line);

    assert_eq!(draft.text, "Reply with the single word OK.");
    assert_eq!(
        draft.attachments,
        vec![
            image(ExternalSessionImageMime::Png),
            image(ExternalSessionImageMime::Jpeg)
        ]
    );
}

#[test]
fn claude_tool_result_images_are_tool_output_not_attachments() {
    let line = claude_user_line(json!([
        {
            "tool_use_id": "toolu_015Au6HGpVPDGnpRK9nmKUF5",
            "type": "tool_result",
            "content": [image_block("image/png")]
        },
        {"type": "text", "text": "Now describe it"}
    ]));

    let draft = claude_draft(&line);

    assert_eq!(draft.text, "Now describe it");
    assert!(draft.attachments.is_empty());
}

#[test]
fn non_object_content_blocks_do_not_fail_the_line() {
    let line = claude_user_line(json!([5, "x", null, [1, 2], {"type": "text", "text": "hi"}]));

    let draft = claude_draft(&line);

    assert_eq!(draft.text, "hi");
    assert!(draft.attachments.is_empty());
}

#[test]
fn codex_input_and_local_images_map_to_mime_and_path() {
    let line = codex_user_line(json!([
        {"type": "input_text", "text": "Look"},
        {"type": "input_image", "image_url": "data:image/png;base64,iVBORw0KGgo=", "detail": "high"},
        {"type": "input_image", "image_url": "https://example.test/probe.png"},
        {"type": "input_image", "image_url": "data:text/plain;base64,aGk="},
        {"type": "local_image", "path": "/var/folders/T/codex-clipboard-1.PNG"},
        {"type": "local_image", "path": "relative/probe.png"},
        {"type": "local_image", "path": "/tmp/probe.bmp"},
        {"type": "local_image"}
    ]));

    let draft = codex_draft(&line);

    assert_eq!(draft.text, "Look");
    assert_eq!(
        draft.attachments,
        vec![
            image(ExternalSessionImageMime::Png),
            ExternalSessionAttachment::Image {
                mime: ExternalSessionImageMime::Png,
                name: None,
                path: Some("/var/folders/T/codex-clipboard-1.PNG".to_string()),
            }
        ]
    );
}

#[test]
fn attached_file_lines_in_the_prompt_become_file_attachments() {
    let text = [
        "Read these",
        "[Attached image \"square.png\" is saved at: /data/agent-attachments/threads/agt-1/aa.png]",
        "[Attached file \"notes.txt\" is saved at: /data/agent-attachments/threads/agt-1/bb.txt]",
        "[Attached file \"clip.mp4\" is at: /Users/dev/Movies/clip.mp4]",
        "[Attached file \"bad/name\" is at: /Users/dev/bad]",
        "[Attached file \"relative.txt\" is at: Users/dev/relative.txt]",
        "[Attached file \"unterminated.txt\" is at: /Users/dev/unterminated.txt",
        "[Attached file \"\" is at: /Users/dev/empty]",
    ]
    .join("\n");
    let line = claude_user_line(json!([{"type": "text", "text": text}]));

    let draft = claude_draft(&line);

    assert_eq!(
        draft.attachments,
        vec![
            ExternalSessionAttachment::File {
                name: "notes.txt".to_string(),
                path: Some("/data/agent-attachments/threads/agt-1/bb.txt".to_string()),
            },
            ExternalSessionAttachment::File {
                name: "clip.mp4".to_string(),
                path: Some("/Users/dev/Movies/clip.mp4".to_string()),
            }
        ]
    );

    let codex = codex_draft(&codex_user_line(
        json!([{"type": "input_text", "text": text}]),
    ));
    assert_eq!(codex.attachments, draft.attachments);
}

#[test]
fn attachments_are_capped_at_eight_per_exchange() {
    let mut blocks: Vec<Value> = (0..12).map(|_| image_block("image/png")).collect();
    blocks.push(json!({"type": "text", "text": "Look"}));
    let claude = claude_draft(&claude_user_line(Value::Array(blocks)));
    assert_eq!(
        claude.attachments.len(),
        MAX_EXTERNAL_SESSION_EXCHANGE_ATTACHMENTS
    );

    let lines: Vec<String> = (0..12)
        .map(|index| format!("[Attached file \"f{index}.txt\" is at: /Users/dev/f{index}.txt]"))
        .collect();
    let codex = codex_draft(&codex_user_line(json!([
        {"type": "input_text", "text": lines.join("\n")},
        {"type": "input_image", "image_url": "data:image/webp;base64,AA=="}
    ])));
    assert_eq!(
        codex.attachments.len(),
        MAX_EXTERNAL_SESSION_EXCHANGE_ATTACHMENTS
    );
    assert_eq!(codex.attachments[0], image(ExternalSessionImageMime::Webp));
}

#[test]
fn a_twenty_megabyte_claude_image_payload_without_escape_sequences_is_not_copied() {
    let data = "A".repeat(TWENTY_MEGABYTES);
    let line = claude_user_line(json!([
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
        {"type": "text", "text": "Reply with the single word OK."}
    ]));
    assert!(line.len() > TWENTY_MEGABYTES);

    let (draft, allocated) = bytes_allocated_by(|| claude_draft(&line));

    assert_eq!(
        draft.attachments,
        vec![image(ExternalSessionImageMime::Png)]
    );
    assert!(
        allocated < 64 * 1024,
        "parsing the line allocated {allocated} bytes for a {} byte payload",
        data.len()
    );
}

#[test]
fn a_twenty_megabyte_codex_data_url_without_escape_sequences_is_not_copied() {
    let data = "A".repeat(TWENTY_MEGABYTES);
    let line = codex_user_line(json!([
        {"type": "input_text", "text": "Look"},
        {"type": "input_image", "image_url": format!("data:image/jpeg;base64,{data}"), "detail": "high"}
    ]));
    assert!(line.len() > TWENTY_MEGABYTES);

    let (draft, allocated) = bytes_allocated_by(|| codex_draft(&line));

    assert_eq!(
        draft.attachments,
        vec![image(ExternalSessionImageMime::Jpeg)]
    );
    assert!(
        allocated < 64 * 1024,
        "parsing the line allocated {allocated} bytes for a {} byte payload",
        data.len()
    );
}

#[test]
fn codex_non_object_content_blocks_do_not_fail_the_line() {
    let line = codex_user_line(json!([5, "x", null, [1, 2], {"type": "input_text", "text": "hi"}]));

    let draft = codex_draft(&line);

    assert_eq!(draft.text, "hi");
    assert!(draft.attachments.is_empty());
}

#[test]
fn claude_blocks_with_wrong_scalar_types_drop_the_attachment_not_the_exchange() {
    let line = claude_user_line(json!([
        {"type": 5},
        {"type": "text", "text": 5},
        {"type": "image", "source": {"type": "base64", "media_type": 5, "data": "AA=="}},
        {"type": "image", "source": {"type": "base64", "media_type": ["image/png"], "data": "AA=="}},
        {"type": "image", "source": {"type": "base64", "media_type": {"a": 1}, "data": "AA=="}},
        {"type": true, "text": "ignored"},
        {"type": "text", "text": "hi"}
    ]));

    let draft = claude_draft(&line);

    assert_eq!(draft.text, "hi");
    assert!(draft.attachments.is_empty());
}

#[test]
fn codex_blocks_with_wrong_scalar_types_drop_the_attachment_not_the_exchange() {
    let line = codex_user_line(json!([
        {"type": 5},
        {"type": "input_text", "text": 5},
        {"type": "input_image", "image_url": 5},
        {"type": "input_image", "image_url": {"url": "data:image/png;base64,AA=="}},
        {"type": "local_image", "path": 5},
        {"type": "local_image", "path": ["/tmp/probe.png"]},
        {"type": "input_text", "text": "hi"}
    ]));

    let draft = codex_draft(&line);

    assert_eq!(draft.text, "hi");
    assert!(draft.attachments.is_empty());
}

#[test]
fn codex_local_image_takes_the_users_name_from_the_attached_image_line() {
    let stored = "/data/agent-attachments/threads/agt-1/0a1b2c3d4e5f60718293a4b5c6d7e8f9.png";
    let text = format!("Look\n[Attached image \"square.png\" is saved at: {stored}]");
    let line = codex_user_line(json!([
        {"type": "input_text", "text": text},
        local_image(stored),
        local_image("/var/folders/T/codex-clipboard-1.png")
    ]));

    let draft = codex_draft(&line);

    assert_eq!(
        draft.attachments,
        vec![
            ExternalSessionAttachment::Image {
                mime: ExternalSessionImageMime::Png,
                name: Some("square.png".to_string()),
                path: Some(stored.to_string()),
            },
            ExternalSessionAttachment::Image {
                mime: ExternalSessionImageMime::Png,
                name: None,
                path: Some("/var/folders/T/codex-clipboard-1.png".to_string()),
            }
        ]
    );

    let claude = claude_draft(&claude_user_line(json!([
        image_block("image/png"),
        {"type": "text", "text": text}
    ])));
    assert_eq!(
        claude.attachments,
        vec![image(ExternalSessionImageMime::Png)]
    );
}

#[test]
fn attachment_paths_longer_than_one_kib_are_dropped() {
    let longest = format!("/{}.png", "a".repeat(MAX_SCANNED_ATTACHMENT_PATH_BYTES - 5));
    let too_long = format!("/{}.png", "a".repeat(MAX_SCANNED_ATTACHMENT_PATH_BYTES - 4));
    assert_eq!(longest.len(), MAX_SCANNED_ATTACHMENT_PATH_BYTES);
    let text = format!(
        "[Attached file \"ok.txt\" is at: {longest}]\n[Attached file \"long.txt\" is at: {too_long}]"
    );
    let line = codex_user_line(json!([
        {"type": "input_text", "text": text},
        local_image(&longest),
        local_image(&too_long)
    ]));

    let draft = codex_draft(&line);

    assert_eq!(
        draft.attachments,
        vec![
            ExternalSessionAttachment::Image {
                mime: ExternalSessionImageMime::Png,
                name: None,
                path: Some(longest.clone()),
            },
            ExternalSessionAttachment::File {
                name: "ok.txt".to_string(),
                path: Some(longest),
            }
        ]
    );
}

#[test]
fn the_shared_history_fixture_round_trips_the_typescript_wire_shape() {
    let history: ExternalAgentSessionPreview =
        serde_json::from_str(ATTACHMENT_FIXTURE).expect("shared fixture loads");

    assert_eq!(
        history.exchanges[0].attachments,
        vec![
            image(ExternalSessionImageMime::Png),
            ExternalSessionAttachment::Image {
                mime: ExternalSessionImageMime::Jpeg,
                name: None,
                path: Some("/Users/dev/Pictures/probe.jpg".to_string()),
            },
            ExternalSessionAttachment::File {
                name: "notes.txt".to_string(),
                path: Some(
                    "/data/agent-attachments/threads/agt-t1-0001/112233445566778899001122334455aa.txt"
                        .to_string()
                ),
            }
        ]
    );
    assert!(history.exchanges[1].attachments.is_empty());
    let reencoded = serde_json::to_string_pretty(&history).expect("re-encode fixture");
    assert_eq!(format!("{reencoded}\n"), ATTACHMENT_FIXTURE);
}

#[test]
fn the_legacy_history_fixture_re_serialises_byte_identically() {
    assert!(!LEGACY_FIXTURE.contains("attachments"));
    let history: ExternalAgentSessionPreview =
        serde_json::from_str(LEGACY_FIXTURE).expect("legacy fixture loads");

    assert!(history
        .exchanges
        .iter()
        .all(|exchange| exchange.attachments.is_empty()));
    let reencoded = serde_json::to_string_pretty(&history).expect("re-encode legacy");
    assert!(!reencoded.contains("attachments"));
    assert_eq!(format!("{reencoded}\n"), LEGACY_FIXTURE);
}

#[test]
fn persisted_attachments_reject_unknown_fields_and_kinds() {
    let unknown_field = json!({"kind": "image", "mime": "image/png", "bytes": 12});
    let unknown_kind = json!({"kind": "archive", "name": "x.zip"});
    let unknown_mime = json!({"kind": "image", "mime": "image/bmp"});

    for value in [unknown_field, unknown_kind, unknown_mime] {
        assert!(serde_json::from_value::<ExternalSessionAttachment>(value).is_err());
    }
}
