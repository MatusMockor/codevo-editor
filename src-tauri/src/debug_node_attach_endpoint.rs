use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_TARGET_LIST_BYTES: usize = 256 * 1_024;
const MAX_TARGET_FIELD_BYTES: usize = 4 * 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum NodeAttachEndpointFamily {
    Ipv4,
    Ipv6,
}

/// Immutable observation that one inspector target advertised the expected
/// loopback endpoint and, at validation time, named a canonical source file
/// below the selected workspace.
///
/// Source containment is only an immediate metadata/workspace filter. Paths
/// can change after validation, so this type is not a durable filesystem
/// authority or capability and consumers must never use it as one. Attach
/// authority comes from the terminal/session, process generation, and the
/// kernel-verified accepted socket.
///
/// Its fields intentionally remain private: consumers must not reconstruct or
/// partially project the observation before the attach authority is
/// implemented.
pub(super) struct NodeAttachEndpointObservation {
    target_id: Box<str>,
    source_path: PathBuf,
    web_socket_endpoint: Box<str>,
}

impl NodeAttachEndpointObservation {
    pub(super) fn same_target_endpoint(&self, other: &Self) -> bool {
        self.target_id == other.target_id && self.web_socket_endpoint == other.web_socket_endpoint
    }

    /// Moves the exact, validated WebSocket endpoint into the next opaque
    /// attach typestate. There is intentionally no borrowed/string accessor:
    /// callers cannot retain or project the URL independently of consuming
    /// the endpoint observation.
    pub(super) fn into_web_socket_endpoint(self) -> Box<str> {
        self.web_socket_endpoint
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodeAttachEndpointFailure {
    ResponseTooLarge,
    InvalidTargetList,
    UnexpectedTargetCount,
    InvalidTarget,
    InvalidTargetId,
    EndpointMismatch,
    InvalidWorkspace,
    InvalidSource,
    SourceOutsideWorkspace,
}

#[derive(Deserialize)]
struct InspectorTarget {
    id: String,
    #[serde(rename = "type")]
    target_type: String,
    url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: String,
}

pub(super) fn validate_node_attach_endpoint(
    workspace_root: &Path,
    expected_family: NodeAttachEndpointFamily,
    expected_port: u16,
    target_list: &[u8],
) -> Result<NodeAttachEndpointObservation, NodeAttachEndpointFailure> {
    if target_list.len() > MAX_TARGET_LIST_BYTES {
        return Err(NodeAttachEndpointFailure::ResponseTooLarge);
    }
    if expected_port == 0 {
        return Err(NodeAttachEndpointFailure::EndpointMismatch);
    }

    let mut targets: Vec<InspectorTarget> = serde_json::from_slice(target_list)
        .map_err(|_| NodeAttachEndpointFailure::InvalidTargetList)?;
    if targets.len() != 1 {
        return Err(NodeAttachEndpointFailure::UnexpectedTargetCount);
    }
    let target = targets
        .pop()
        .ok_or(NodeAttachEndpointFailure::UnexpectedTargetCount)?;

    validate_field(&target.id)?;
    validate_field(&target.target_type)?;
    validate_field(&target.url)?;
    validate_field(&target.web_socket_debugger_url)?;
    if target.target_type != "node" {
        return Err(NodeAttachEndpointFailure::InvalidTarget);
    }
    if !is_canonical_uuid(&target.id) {
        return Err(NodeAttachEndpointFailure::InvalidTargetId);
    }

    let expected_endpoint = match expected_family {
        NodeAttachEndpointFamily::Ipv4 => format!("ws://127.0.0.1:{expected_port}/{}", target.id),
        NodeAttachEndpointFamily::Ipv6 => format!("ws://[::1]:{expected_port}/{}", target.id),
    };
    if target.web_socket_debugger_url != expected_endpoint {
        return Err(NodeAttachEndpointFailure::EndpointMismatch);
    }

    // These path lookups intentionally provide only a point-in-time metadata
    // filter. A same-user process can replace paths after any lookup; the
    // returned observation therefore grants no right to reopen either path.
    let workspace_root = fs::canonicalize(workspace_root)
        .map_err(|_| NodeAttachEndpointFailure::InvalidWorkspace)?;
    if !workspace_root.is_dir() {
        return Err(NodeAttachEndpointFailure::InvalidWorkspace);
    }

    let source_path = parse_file_url(&target.url)?;
    let source_path =
        fs::canonicalize(source_path).map_err(|_| NodeAttachEndpointFailure::InvalidSource)?;
    if !source_path.is_file() {
        return Err(NodeAttachEndpointFailure::InvalidSource);
    }
    let relative_source = source_path
        .strip_prefix(&workspace_root)
        .map_err(|_| NodeAttachEndpointFailure::SourceOutsideWorkspace)?;
    if relative_source.as_os_str().is_empty() {
        return Err(NodeAttachEndpointFailure::SourceOutsideWorkspace);
    }

    Ok(NodeAttachEndpointObservation {
        target_id: target.id.into_boxed_str(),
        source_path,
        web_socket_endpoint: target.web_socket_debugger_url.into_boxed_str(),
    })
}

fn validate_field(value: &str) -> Result<(), NodeAttachEndpointFailure> {
    if value.is_empty()
        || value.len() > MAX_TARGET_FIELD_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(NodeAttachEndpointFailure::InvalidTarget);
    }
    Ok(())
}

fn is_canonical_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }

    value.bytes().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
        }
    })
}

fn parse_file_url(value: &str) -> Result<PathBuf, NodeAttachEndpointFailure> {
    let encoded_path = value
        .strip_prefix("file://")
        .ok_or(NodeAttachEndpointFailure::InvalidSource)?;
    if !encoded_path.starts_with('/') || encoded_path.contains(['?', '#']) {
        return Err(NodeAttachEndpointFailure::InvalidSource);
    }

    let bytes = encoded_path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(NodeAttachEndpointFailure::InvalidSource);
        }
        let high = decode_hex(bytes[index + 1]).ok_or(NodeAttachEndpointFailure::InvalidSource)?;
        let low = decode_hex(bytes[index + 2]).ok_or(NodeAttachEndpointFailure::InvalidSource)?;
        decoded.push((high << 4) | low);
        index += 3;
    }

    if decoded.iter().any(u8::is_ascii_control) {
        return Err(NodeAttachEndpointFailure::InvalidSource);
    }
    let decoded =
        String::from_utf8(decoded).map_err(|_| NodeAttachEndpointFailure::InvalidSource)?;
    let path = PathBuf::from(decoded);
    if !path.is_absolute() {
        return Err(NodeAttachEndpointFailure::InvalidSource);
    }
    Ok(path)
}

fn decode_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicU64, Ordering};

    const TARGET_ID: &str = "01234567-89ab-cdef-0123-456789abcdef";
    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        root: PathBuf,
        source: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "codevo-node-attach-endpoint-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("fixture workspace should be created");
            let source = root.join("server file.js");
            fs::write(&source, "debugger;\n").expect("fixture source should be written");
            Self { root, source }
        }

        fn target(&self, family: NodeAttachEndpointFamily, port: u16) -> Value {
            let host = match family {
                NodeAttachEndpointFamily::Ipv4 => "127.0.0.1".to_owned(),
                NodeAttachEndpointFamily::Ipv6 => "[::1]".to_owned(),
            };
            json!({
                "id": TARGET_ID,
                "type": "node",
                "title": "ignored Node metadata is allowed",
                "url": format!("file://{}", self.source.display()).replace(' ', "%20"),
                "webSocketDebuggerUrl":
                    format!("ws://{host}:{port}/{TARGET_ID}")
            })
        }

        fn encoded_target(&self, family: NodeAttachEndpointFamily, port: u16) -> Vec<u8> {
            serde_json::to_vec(&vec![self.target(family, port)]).expect("target should serialize")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn validates_real_node_ipv4_endpoint_shape_and_canonical_source_observation() {
        let fixture = Fixture::new();
        let payload = fixture.encoded_target(NodeAttachEndpointFamily::Ipv4, 9_229);

        let observation = validate_node_attach_endpoint(
            &fixture.root,
            NodeAttachEndpointFamily::Ipv4,
            9_229,
            &payload,
        )
        .expect("exact target should validate");

        assert_eq!(&*observation.target_id, TARGET_ID);
        assert_eq!(
            observation.source_path,
            fs::canonicalize(&fixture.source).expect("source should canonicalize")
        );
        assert_eq!(
            &*observation.web_socket_endpoint,
            format!("ws://127.0.0.1:9229/{TARGET_ID}")
        );
    }

    #[test]
    fn validates_exact_ipv6_endpoint() {
        let fixture = Fixture::new();
        let payload = fixture.encoded_target(NodeAttachEndpointFamily::Ipv6, 9_230);

        validate_node_attach_endpoint(
            &fixture.root,
            NodeAttachEndpointFamily::Ipv6,
            9_230,
            &payload,
        )
        .expect("exact IPv6 target should validate");
    }

    #[test]
    fn rejects_malformed_oversized_and_non_singleton_lists() {
        let fixture = Fixture::new();
        let target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);

        for payload in [
            b"not json".to_vec(),
            serde_json::to_vec(&target).expect("object should serialize"),
        ] {
            assert_eq!(
                validate_node_attach_endpoint(
                    &fixture.root,
                    NodeAttachEndpointFamily::Ipv4,
                    9_229,
                    &payload
                )
                .err(),
                Some(NodeAttachEndpointFailure::InvalidTargetList)
            );
        }
        for payload in [
            serde_json::to_vec(&Vec::<Value>::new()).expect("empty list should serialize"),
            serde_json::to_vec(&vec![target.clone(), target])
                .expect("duplicate list should serialize"),
        ] {
            assert_eq!(
                validate_node_attach_endpoint(
                    &fixture.root,
                    NodeAttachEndpointFamily::Ipv4,
                    9_229,
                    &payload
                )
                .err(),
                Some(NodeAttachEndpointFailure::UnexpectedTargetCount)
            );
        }
        assert_eq!(
            validate_node_attach_endpoint(
                &fixture.root,
                NodeAttachEndpointFamily::Ipv4,
                9_229,
                &vec![b' '; MAX_TARGET_LIST_BYTES + 1]
            )
            .err(),
            Some(NodeAttachEndpointFailure::ResponseTooLarge)
        );
    }

    #[test]
    fn rejects_noncanonical_ids_and_id_path_mismatches() {
        let fixture = Fixture::new();
        for invalid_id in [
            "01234567-89AB-CDEF-0123-456789ABCDEF",
            "0123456789ab-cdef-0123-456789abcdef",
            "01234567-89ab-cdef-0123-456789abcdeg",
            "short",
        ] {
            let mut target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
            target["id"] = json!(invalid_id);
            let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
            assert_eq!(
                validate_node_attach_endpoint(
                    &fixture.root,
                    NodeAttachEndpointFamily::Ipv4,
                    9_229,
                    &payload
                )
                .err(),
                Some(NodeAttachEndpointFailure::InvalidTargetId)
            );
        }

        let mut target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
        target["webSocketDebuggerUrl"] =
            json!("ws://127.0.0.1:9229/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
        assert_eq!(
            validate_node_attach_endpoint(
                &fixture.root,
                NodeAttachEndpointFamily::Ipv4,
                9_229,
                &payload
            )
            .err(),
            Some(NodeAttachEndpointFailure::EndpointMismatch)
        );
    }

    #[test]
    fn rejects_endpoint_host_family_port_and_shape_substitutions() {
        let fixture = Fixture::new();
        for endpoint in [
            format!("ws://localhost:9229/{TARGET_ID}"),
            format!("ws://0.0.0.0:9229/{TARGET_ID}"),
            format!("ws://[::1]:9229/{TARGET_ID}"),
            format!("ws://127.0.0.1:9230/{TARGET_ID}"),
            format!("ws://127.0.0.1:9229/devtools/page/{TARGET_ID}"),
            format!("ws://127.0.0.1:9229/{TARGET_ID}?token=x"),
        ] {
            let mut target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
            target["webSocketDebuggerUrl"] = json!(endpoint);
            let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
            assert_eq!(
                validate_node_attach_endpoint(
                    &fixture.root,
                    NodeAttachEndpointFamily::Ipv4,
                    9_229,
                    &payload
                )
                .err(),
                Some(NodeAttachEndpointFailure::EndpointMismatch)
            );
        }
        let payload = fixture.encoded_target(NodeAttachEndpointFamily::Ipv4, 9_229);
        assert_eq!(
            validate_node_attach_endpoint(
                &fixture.root,
                NodeAttachEndpointFamily::Ipv4,
                0,
                &payload
            )
            .err(),
            Some(NodeAttachEndpointFailure::EndpointMismatch)
        );
    }

    #[test]
    fn rejects_invalid_target_metadata_and_bounded_fields() {
        let fixture = Fixture::new();
        let mut wrong_type = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
        wrong_type["type"] = json!("page");
        let mut controlled = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
        controlled["type"] = json!("node\n");
        let mut oversized = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
        oversized["url"] = json!("x".repeat(MAX_TARGET_FIELD_BYTES + 1));

        for target in [wrong_type, controlled, oversized] {
            let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
            assert_eq!(
                validate_node_attach_endpoint(
                    &fixture.root,
                    NodeAttachEndpointFamily::Ipv4,
                    9_229,
                    &payload
                )
                .err(),
                Some(NodeAttachEndpointFailure::InvalidTarget)
            );
        }
    }

    #[test]
    fn requires_a_strict_absolute_file_url() {
        let fixture = Fixture::new();
        for url in [
            "https://example.test/server.js".to_owned(),
            "file://localhost/tmp/server.js".to_owned(),
            "file://relative/server.js".to_owned(),
            format!("file://{}?query=x", fixture.source.display()),
            format!("file://{}#fragment", fixture.source.display()),
            "file:///tmp/bad%2".to_owned(),
            "file:///tmp/bad%zz".to_owned(),
            "file:///tmp/bad%ff".to_owned(),
            "file:///tmp/bad%00.js".to_owned(),
            "file:///tmp/bad%0a.js".to_owned(),
        ] {
            let mut target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
            target["url"] = json!(url);
            let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
            assert_eq!(
                validate_node_attach_endpoint(
                    &fixture.root,
                    NodeAttachEndpointFamily::Ipv4,
                    9_229,
                    &payload
                )
                .err(),
                Some(NodeAttachEndpointFailure::InvalidSource)
            );
        }
    }

    #[test]
    fn rejects_missing_directory_and_outside_sources() {
        let fixture = Fixture::new();
        let outside = fixture
            .root
            .parent()
            .expect("fixture should have a parent")
            .join(format!("outside-{}.js", std::process::id()));
        fs::write(&outside, "debugger;\n").expect("outside source should be written");

        for source in [
            outside.clone(),
            fixture.root.clone(),
            fixture.root.join("missing.js"),
        ] {
            let mut target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
            target["url"] = json!(format!("file://{}", source.display()));
            let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
            assert!(validate_node_attach_endpoint(
                &fixture.root,
                NodeAttachEndpointFamily::Ipv4,
                9_229,
                &payload
            )
            .is_err());
        }

        let _ = fs::remove_file(outside);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_workspace() {
        use std::os::unix::fs::symlink;

        // This covers a stable symlink present during validation. It
        // deliberately makes no claim about path replacement after any
        // lookup; NodeAttachEndpointObservation is not a filesystem authority.
        let fixture = Fixture::new();
        let outside = fixture
            .root
            .parent()
            .expect("fixture should have a parent")
            .join(format!("outside-symlink-{}.js", std::process::id()));
        fs::write(&outside, "debugger;\n").expect("outside source should be written");
        let linked_source = fixture.root.join("linked.js");
        symlink(&outside, &linked_source).expect("source symlink should be created");

        let mut target = fixture.target(NodeAttachEndpointFamily::Ipv4, 9_229);
        target["url"] = json!(format!("file://{}", linked_source.display()));
        let payload = serde_json::to_vec(&vec![target]).expect("target should serialize");
        assert_eq!(
            validate_node_attach_endpoint(
                &fixture.root,
                NodeAttachEndpointFamily::Ipv4,
                9_229,
                &payload
            )
            .err(),
            Some(NodeAttachEndpointFailure::SourceOutsideWorkspace)
        );

        let _ = fs::remove_file(outside);
    }
}
