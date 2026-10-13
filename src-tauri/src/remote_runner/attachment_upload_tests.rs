use super::super::attachment_file_wire::{FILE_REFUSED, STORAGE_FULL, STORED_DIFFERENT};
use super::super::attachment_test_support::*;
use super::*;
use crate::agent_file_source::{CHANGED, CHUNK_BYTES, TOO_LARGE, UNREADABLE};
use std::path::Path;

#[path = "attachment_upload_stream_tests.rs"]
mod stream;

pub(super) fn run(
    runner: &Runner,
    staged: &StagedFile,
    name: &str,
    policy: TransferPolicy,
) -> Result<StoredFile, String> {
    let transfers = AttachmentTransferState::default();
    let permit = transfers
        .admit_upload("fixture", ATTACHMENT_ID)
        .expect("an idle lane admits the upload");
    upload(
        &runner.lease,
        &staged.sources,
        &permit,
        &staged.request(name),
        policy,
    )
}

fn accepting(name: &'static str, media_type: &'static str, status: u16) -> (Runner, Stored) {
    let (route, received) = storing(status, move |received| {
        let mut reply: serde_json::Value = serde_json::from_str(&stored_json(
            name,
            received.body.len(),
            &sha256(&received.body),
            media_type,
        ))
        .unwrap();
        reply["created"] = (status == 201).into();
        reply.to_string()
    });
    (Runner::serve(route), received)
}

type Stored = std::sync::mpsc::Receiver<Received>;
type Refused = (&'static str, fn(&Path), &'static str);

#[test]
fn a_file_is_streamed_with_the_contract_headers_and_its_stored_copy_is_verified() {
    let bytes = content(3 * CHUNK_BYTES + 4_321);
    for (status, created) in [(201, true), (200, false)] {
        let staged = StagedFile::holding("Správa 1+2.PDF", &bytes);
        let (runner, received) = accepting("Správa 1+2.PDF", "application/pdf", status);
        let stored = run(&runner, &staged, "Správa 1+2.PDF", swift()).unwrap();
        assert_eq!(stored.created, created);
        assert_eq!(stored.attachment.id, ATTACHMENT_ID);
        assert_eq!(stored.attachment.runner_id, RUNNER_ID);
        assert_eq!(stored.attachment.name, "Správa 1+2.PDF");
        assert_eq!(stored.attachment.bytes, bytes.len() as u64);
        assert_eq!(stored.attachment.sha256, sha256(&bytes));
        assert_eq!(stored.attachment.kind, "file");
        assert_eq!(stored.attachment.media_type, "application/pdf");
        let received = received.recv_timeout(WAIT).unwrap();
        assert!(is_upload(&received.head), "{}", received.head);
        assert_eq!(received.body, bytes);
        let head = &received.head;
        assert_eq!(header(head, "x-codevo-attachment-kind"), ["file"]);
        assert_eq!(header(head, "content-type"), ["application/pdf"]);
        assert_eq!(
            header(head, "content-length"),
            [bytes.len().to_string().as_str()]
        );
        assert_eq!(header(head, "x-file-name"), ["Spr%C3%A1va%201%2B2.PDF"]);
        assert_eq!(header(head, "authorization"), ["Bearer test-only"]);
        assert_eq!(header(head, "x-codevo-runner-id"), [RUNNER_ID]);
        assert!(header(head, "transfer-encoding").is_empty());
        let capabilities = header(head, "x-codevo-client-capabilities");
        assert_eq!(capabilities.len(), 1);
        assert!(capabilities[0]
            .split(',')
            .any(|token| token == "fileAttachments"));
        assert_eq!(runner.routed(), 1);
    }
}

#[test]
fn the_media_type_comes_from_the_staged_path_and_falls_back_to_octet_stream() {
    for (file, media_type) in [
        ("notes.TXT", "text/plain"),
        ("photo.png", "image/png"),
        ("archive.unknown", "application/octet-stream"),
        ("Makefile", "application/octet-stream"),
    ] {
        let staged = StagedFile::holding(file, b"not sniffed");
        let (runner, received) = accepting("shown.pdf", media_type, 201);
        let stored = run(&runner, &staged, "shown.pdf", swift()).unwrap();
        assert_eq!(stored.attachment.media_type, media_type);
        let received = received.recv_timeout(WAIT).unwrap();
        assert_eq!(header(&received.head, "content-type"), [media_type]);
        assert_eq!(header(&received.head, "x-file-name"), ["shown.pdf"]);
    }
}

#[test]
fn runner_statuses_map_to_the_exact_contract_strings() {
    for (status, expected) in [
        (413, TOO_LARGE),
        (429, STORAGE_FULL),
        (415, FILE_REFUSED),
        (400, FILE_REFUSED),
        (503, "Runner request failed (HTTP 503)."),
        (409, "Runner request failed (HTTP 409)."),
        (408, "Runner request failed (HTTP 408)."),
        (500, "Runner request failed (HTTP 500)."),
        (302, "Runner request failed (HTTP 302)."),
    ] {
        let staged = StagedFile::holding("report.pdf", &content(CHUNK_BYTES + 7));
        let (route, received) = storing(status, |_| "{\"error\":\"refused\"}".into());
        let runner = Runner::serve(route);
        assert_eq!(
            run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
            expected,
            "{status}"
        );
        assert!(received.recv_timeout(WAIT).unwrap().complete());
        assert!(runner.session.is_alive());
        assert_eq!(runner.routed(), 1);
    }
}

#[test]
fn a_rejected_token_closes_the_tunnel_without_replaying_the_upload() {
    let staged = StagedFile::holding("report.pdf", &content(CHUNK_BYTES + 7));
    let (route, received) = storing(401, |_| "{\"error\":\"unauthorized\"}".into());
    let runner = Runner::serve(route);
    assert_eq!(
        run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
        TUNNEL_CLOSED
    );
    assert!(received.recv_timeout(WAIT).unwrap().complete());
    assert!(!runner.session.is_alive());
    assert_eq!(runner.routed(), 1);
}

#[test]
fn a_replaced_runner_is_refused_before_any_byte_of_the_file_is_sent() {
    let staged = StagedFile::holding("report.pdf", &content(CHUNK_BYTES + 7));
    let (route, _received) = storing(201, |_| "{}".into());
    let runner = Runner::serve_as("another-runner", route);
    assert_eq!(
        run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
        "Runner identity changed. Reconnect the server before continuing."
    );
    assert_eq!(runner.routed(), 0);
}

#[test]
fn malformed_and_mismatching_responses_never_yield_an_attachment() {
    let bytes = content(CHUNK_BYTES + 7);
    let valid = stored_json(
        "report.pdf",
        bytes.len(),
        &sha256(&bytes),
        "application/pdf",
    );
    let altered = |field: &str, value: serde_json::Value| {
        let mut reply: serde_json::Value = serde_json::from_str(&valid).unwrap();
        reply["attachment"][field] = value;
        reply.to_string()
    };
    let legacy = serde_json::json!({
        "attachment": {
            "id": ATTACHMENT_ID, "runnerId": RUNNER_ID, "name": "report.pdf",
            "bytes": bytes.len(), "sha256": sha256(&bytes),
            "createdAt": "2026-10-13T00:00:00.000Z", "mediaType": "text/plain",
        },
        "created": true,
    })
    .to_string();
    for (status, reply, expected) in [
        (201, "not json".to_string(), INVALID_RESPONSE),
        (201, String::new(), INVALID_RESPONSE),
        (201, legacy, INVALID_RESPONSE),
        (201, altered("width", 4.into()), INVALID_RESPONSE),
        (201, altered("bytes", "7".into()), INVALID_RESPONSE),
        (200, valid.clone(), INVALID_RESPONSE),
        (202, valid.clone(), INVALID_RESPONSE),
        (
            201,
            altered("sha256", "0".repeat(64).into()),
            STORED_DIFFERENT,
        ),
        (201, altered("bytes", 7.into()), STORED_DIFFERENT),
        (201, altered("name", "other.pdf".into()), STORED_DIFFERENT),
        (201, altered("kind", "image".into()), STORED_DIFFERENT),
        (
            201,
            altered("mediaType", "text/plain".into()),
            STORED_DIFFERENT,
        ),
        (
            201,
            altered("runnerId", "another-runner".into()),
            STORED_DIFFERENT,
        ),
        (
            201,
            altered("id", "00000000-0000-4000-8000-000000000001".into()),
            STORED_DIFFERENT,
        ),
    ] {
        let staged = StagedFile::holding("report.pdf", &bytes);
        let body = reply.clone();
        let (route, _received) = storing(status, move |_| body.clone());
        let runner = Runner::serve(route);
        assert_eq!(
            run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
            expected,
            "{status} {reply}"
        );
    }
}

#[test]
fn an_unknown_released_or_evicted_source_is_refused_without_contacting_the_runner() {
    let staged = StagedFile::holding("report.pdf", b"payload");
    let (route, _received) = storing(201, |_| "{}".into());
    let runner = Runner::serve(route);
    let mut unknown = staged.request("report.pdf");
    unknown.source_id = "00000000-0000-4000-8000-000000000001".into();
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    assert_eq!(
        upload(&runner.lease, &staged.sources, &permit, &unknown, swift()).unwrap_err(),
        NOT_STAGED
    );
    for _ in 0..crate::agent_file_source::MAX_SOURCES {
        staged.sources.stage(staged.path.to_str().unwrap()).unwrap();
    }
    assert_eq!(
        run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
        NOT_STAGED
    );
    let fresh = StagedFile::holding("report.pdf", b"payload");
    fresh.sources.release(&fresh.source_id);
    assert_eq!(
        run(&runner, &fresh, "report.pdf", swift()).unwrap_err(),
        NOT_STAGED
    );
    assert_eq!(runner.routed(), 0);
}

fn rewritten(path: &Path, bytes: &[u8]) {
    let replacement = path.with_extension("replacement");
    std::fs::write(&replacement, bytes).unwrap();
    std::fs::rename(replacement, path).unwrap();
}

pub(super) fn touched(path: &Path) {
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(3_600);
    std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(later)
        .unwrap();
}

pub(super) fn appended(path: &Path) {
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(b"!")
        .unwrap();
}

#[test]
fn a_file_changed_between_staging_and_upload_is_refused_before_any_byte_is_sent() {
    let bytes = content(CHUNK_BYTES + 7);
    let changes: [Refused; 6] = [
        (
            "replaced",
            |path| rewritten(path, &content(CHUNK_BYTES + 7)),
            CHANGED,
        ),
        (
            "truncated",
            |path| {
                std::fs::File::options()
                    .write(true)
                    .open(path)
                    .unwrap()
                    .set_len(9)
                    .unwrap()
            },
            CHANGED,
        ),
        ("appended", appended, CHANGED),
        ("touched", touched, CHANGED),
        (
            "linked",
            |path| {
                let moved = path.with_extension("moved");
                std::fs::rename(path, &moved).unwrap();
                std::os::unix::fs::symlink(&moved, path).unwrap();
            },
            CHANGED,
        ),
        (
            "deleted",
            |path| std::fs::remove_file(path).unwrap(),
            UNREADABLE,
        ),
    ];
    for (change, apply, expected) in changes {
        let staged = StagedFile::holding("report.pdf", &bytes);
        let (route, _received) = storing(201, |_| "{}".into());
        let runner = Runner::serve(route);
        apply(&staged.path);
        assert_eq!(
            run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
            expected,
            "{change}"
        );
        assert_eq!(runner.routed(), 0, "{change}");
    }
}

#[test]
fn a_request_that_is_invalid_or_already_cancelled_never_opens_a_connection() {
    let staged = StagedFile::holding("report.pdf", b"payload");
    let (route, _received) = storing(201, |_| "{}".into());
    let runner = Runner::serve(route);
    for name in ["", "  ", "a/b.pdf", "a\\b.pdf", "line\nbreak.pdf"] {
        assert_eq!(
            run(&runner, &staged, name, swift()).unwrap_err(),
            FILE_REFUSED,
            "{name:?}"
        );
    }
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    transfers.cancel_upload("fixture", ATTACHMENT_ID);
    let request = staged.request("report.pdf");
    assert_eq!(
        upload(&runner.lease, &staged.sources, &permit, &request, swift()).unwrap_err(),
        UPLOAD_CANCELLED
    );
    runner.lease.revoke();
    assert_eq!(
        run(&runner, &staged, "report.pdf", swift()).unwrap_err(),
        LEASE_CHANGED
    );
    assert_eq!(runner.routed(), 0);
}

#[test]
fn the_legacy_base64_upload_keeps_its_wire_shape() {
    use base64::Engine;
    let bytes = b"\x89PNG\r\n\x1a\nlegacy".to_vec();
    let (route, received) = storing(201, |_| "{\"created\":true}".into());
    let runner = Runner::serve(route);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let reply = runner
        .session
        .request(
            &server(),
            "PUT",
            &format!("/v1/attachments/{ATTACHMENT_ID}"),
            Some(serde_json::json!({ "base64": encoded })),
            vec![
                ("content-type".into(), "image/png".into()),
                ("x-file-name".into(), "shot.png".into()),
            ],
        )
        .unwrap();
    assert_eq!(reply["created"], true);
    let received = received.recv_timeout(WAIT).unwrap();
    assert!(is_upload(&received.head));
    assert_eq!(received.body, bytes);
    assert!(header(&received.head, "x-codevo-attachment-kind").is_empty());
    assert_eq!(header(&received.head, "content-type"), ["image/png"]);
    assert_eq!(header(&received.head, "x-file-name"), ["shot.png"]);
    assert_eq!(
        header(&received.head, "content-length"),
        [bytes.len().to_string().as_str()]
    );
}
