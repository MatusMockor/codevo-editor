use super::*;
use crate::debug_adapter::DebugEventPayload;
use crate::managed_javascript_typescript::node_executable_path;
use std::fs;
use std::io::ErrorKind;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};

const REAL_NODE_EVENT_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_COLLECTION_WORKSPACE_ID: AtomicU64 = AtomicU64::new(1);

struct CollectionWorkspace(PathBuf);

impl CollectionWorkspace {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-collection-window-proof-{}-{}",
            std::process::id(),
            NEXT_COLLECTION_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create collection-window workspace");
        Self(root.canonicalize().expect("canonical collection workspace"))
    }
}

impl Drop for CollectionWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn real_node_collection_windows_render_entries_across_window_boundaries() {
    let _admission = crate::debug_node_process::real_node_test_admission::acquire();
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => drop(listener),
        Err(error) if error.kind() == ErrorKind::PermissionDenied => {
            eprintln!("skipping real collection-window proof: loopback sockets are restricted");
            return;
        }
        Err(error) => panic!("probe collection-window loopback socket: {error}"),
    }
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real collection-window proof requires the managed Node.js runtime in CI");
        }
        eprintln!("skipping real collection-window proof: no managed Node.js runtime is available");
        return;
    }

    let workspace = CollectionWorkspace::new();
    let script = workspace.0.join("collection-window.js");
    fs::write(
        &script,
        concat!(
            "function inspectCollection() {\n",
            "  const collection = new Map();\n",
            "  for (let index = 0; index < 40; index += 1) collection.set(`key-${index}`, `value-${index}`);\n",
            "  debugger;\n",
            "  return collection.size;\n",
            "}\n",
            "inspectCollection();\n",
        ),
    )
    .expect("write collection-window target");
    let script = script.canonicalize().expect("canonical collection target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CollectingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                create_node_cdp_adapter_with_exception_filter(
                    &workspace.0,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    &[],
                    false,
                    false,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("start real collection-window session");
    let frames = wait_for(
        || {
            sink.payloads()
                .into_iter()
                .find_map(|payload| match payload {
                    DebugEventPayload::Stopped { frames, .. } => Some(frames),
                    _ => None,
                })
        },
        REAL_NODE_EVENT_TIMEOUT,
        "real collection-window pause",
    );
    let frame = frames.first().expect("paused collection frame");
    let (pause_generation, local_reference) = registry
        .with_session(&root_key, |adapter| {
            let generation = adapter
                .current_pause_generation()
                .expect("collection pause generation");
            let scopes = adapter.scopes(frame.frame_id).expect("collection scopes");
            let local = scopes
                .iter()
                .find(|scope| scope.name == "Local")
                .or_else(|| scopes.first())
                .expect("local collection scope");
            (generation, local.variables_reference)
        })
        .expect("real collection session");
    let local = registry
        .with_session(&root_key, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id: frame.frame_id,
                variables_reference: local_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("real collection session")
        .expect("local collection variables");
    let collection_reference = local
        .variables
        .iter()
        .find(|variable| variable.name == "collection")
        .expect("collection local")
        .variables_reference;
    let entries = registry
        .with_session(&root_key, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id: frame.frame_id,
                variables_reference: collection_reference,
                start: 0,
                count: 40,
            })
        })
        .expect("real collection session")
        .expect("real collection entries");

    for index in [0usize, 16, 39] {
        let entry = entries.variables.get(index).expect("collection entry");
        assert_eq!(entry.name, index.to_string());
        assert_eq!(
            entry.value,
            format!("{{\"key-{index}\" => \"value-{index}\"}}")
        );
    }
    assert!(registry.stop_by_id(session_id));
}
