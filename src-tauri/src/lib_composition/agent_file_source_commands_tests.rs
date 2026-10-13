use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

struct Fixture(std::path::PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-file-source-command-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn stage_request(path: &str) -> StageFileSourceRequest {
    serde_json::from_value(serde_json::json!({ "path": path })).unwrap()
}

fn release_request(source_id: &str) -> ReleaseFileSourceRequest {
    serde_json::from_value(serde_json::json!({ "sourceId": source_id })).unwrap()
}

#[test]
fn requests_are_closed_camel_case_structs() {
    assert!(serde_json::from_str::<StageFileSourceRequest>(r#"{"path":"/tmp/a.pdf"}"#).is_ok());
    for invalid in [
        r#"{}"#,
        r#"{"path":7}"#,
        r#"{"path":"/tmp/a.pdf","workspaceId":"w"}"#,
        r#"{"path":"/tmp/a.pdf","destination":"/tmp/b"}"#,
    ] {
        assert!(serde_json::from_str::<StageFileSourceRequest>(invalid).is_err());
    }
    assert!(serde_json::from_str::<ReleaseFileSourceRequest>(
        r#"{"sourceId":"7389088c-29b8-4cec-9a15-e825e1fb2f66"}"#
    )
    .is_ok());
    for invalid in [
        r#"{}"#,
        r#"{"source_id":"7389088c-29b8-4cec-9a15-e825e1fb2f66"}"#,
        r#"{"sourceId":"7389088c-29b8-4cec-9a15-e825e1fb2f66","path":"/tmp/a"}"#,
    ] {
        assert!(serde_json::from_str::<ReleaseFileSourceRequest>(invalid).is_err());
    }
}

#[test]
fn staging_answers_with_the_contract_shape_and_release_is_idempotent() {
    let fixture = Fixture::new();
    let path = fixture.0.join("report.pdf");
    std::fs::write(&path, b"report").unwrap();
    let sources = FileSources::default();
    let staged = stage(&sources, &stage_request(path.to_str().unwrap())).unwrap();
    let wire = serde_json::to_value(&staged).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({ "sourceId": staged.source_id, "name": "report.pdf", "bytes": 6 })
    );
    assert!(sources.find(&staged.source_id).is_some());
    let request = release_request(&staged.source_id);
    assert_eq!(release(&sources, &request), Ok(()));
    assert_eq!(release(&sources, &request), Ok(()));
    assert!(sources.find(&staged.source_id).is_none());
    assert_eq!(serde_json::to_value(()).unwrap(), serde_json::Value::Null);
}

#[test]
fn a_refused_path_keeps_its_contract_error_and_an_invalid_source_id_is_rejected() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    assert_eq!(
        stage(&sources, &stage_request("relative.pdf")).unwrap_err(),
        "Choose a file using an absolute local file path."
    );
    assert_eq!(
        stage(&sources, &stage_request(fixture.0.to_str().unwrap())).unwrap_err(),
        "Choose a file, not a folder."
    );
    for invalid in ["", "source", "../7389088c-29b8-4cec-9a15-e825e1fb2f66"] {
        assert_eq!(
            release(&sources, &release_request(invalid)).unwrap_err(),
            INVALID_SOURCE
        );
    }
}
