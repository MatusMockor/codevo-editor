use crate::debug_cdp::transport::{build_pause_inventory, CdpShared, PauseGenerationFloor};
use serde_json::{json, Value};

#[test]
fn watch_transport_connects_to_fake_socket_without_running_or_configuring_target() {
    use super::super::{
        simple_responder, CollectingSink, MockCdpServer, MOCK_REQUEST_TIMEOUT, WORKSPACE_KEY,
    };
    use crate::debug_adapter::{DebugAdapter, DebugSessionRegistry};
    use crate::debug_cdp::transport::NodeCdpAdapter;
    use std::sync::Arc;

    let server = MockCdpServer::start(simple_responder());
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let url = server.url.clone();
    registry
        .start_session(WORKSPACE_KEY, sink, move |emitter| {
            NodeCdpAdapter::connect_watch_transport_at_pause_generation_floor(
                &url,
                emitter.into(),
                MOCK_REQUEST_TIMEOUT,
                None,
                Arc::new(|| true),
                PauseGenerationFloor::try_from_epoch(41).expect("pause floor"),
                None,
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("raw watch transport");

    assert!(
        server.methods().is_empty(),
        "connect-only transport must await desired replay before any CDP method"
    );
    assert!(registry.deactivate_root(WORKSPACE_KEY));
}

fn pause_authority_fixture() -> Value {
    json!({
        "callFrames": [{
            "callFrameId": "reused-cdp-frame",
            "functionName": "run",
            "url": "file:///workspace/app.js",
            "location": {"lineNumber": 0, "columnNumber": 0},
            "scopeChain": [{
                "type": "local",
                "object": {"objectId": "reused-scope"}
            }]
        }]
    })
}

#[test]
fn successor_target_floor_prevents_old_pause_authority_aliases() {
    let params = pause_authority_fixture();
    let mut original = CdpShared::new(None);
    let original_pause =
        build_pause_inventory(&params, &mut original).expect("original pause inventory");
    let original_frame = original_pause.frames[0].frame_id;
    let original_variable_reference = original_pause.scopes[&original_frame][0].variables_reference;

    let floor = PauseGenerationFloor::try_from_epoch(original_pause.pause_generation)
        .expect("successor floor");
    let mut successor = CdpShared::new_at_pause_generation_floor(None, floor);
    let successor_pause =
        build_pause_inventory(&params, &mut successor).expect("successor pause inventory");
    let successor_frame = successor_pause.frames[0].frame_id;
    let successor_variable_reference =
        successor_pause.scopes[&successor_frame][0].variables_reference;

    // Fresh CDP state may reuse compact local IDs. Their authority remains
    // disjoint because frame and variable requests carry the exact generation.
    assert_eq!(successor_frame, original_frame);
    assert_eq!(successor_variable_reference, original_variable_reference);
    assert!(successor_pause.pause_generation > original_pause.pause_generation);
    assert_ne!(
        (
            successor_pause.pause_generation,
            successor_frame,
            successor_variable_reference
        ),
        (
            original_pause.pause_generation,
            original_frame,
            original_variable_reference
        )
    );
}

#[test]
fn default_constructor_preserves_existing_pause_generation() {
    let mut state = CdpShared::new(None);
    let pause = build_pause_inventory(&pause_authority_fixture(), &mut state)
        .expect("default pause inventory");

    assert_eq!(pause.pause_generation, 1);
}

#[test]
fn pause_generation_floor_exhaustion_fails_closed() {
    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let floor =
        PauseGenerationFloor::try_from_epoch(MAX_SAFE_INTEGER - 1).expect("last usable floor");
    let mut state = CdpShared::new_at_pause_generation_floor(None, floor);
    let final_pause = build_pause_inventory(&pause_authority_fixture(), &mut state)
        .expect("last representable pause");
    assert_eq!(final_pause.pause_generation, MAX_SAFE_INTEGER);

    state.pause = Some(final_pause);
    state.invalidate_pause();
    assert!(state.pause.is_none());
    match build_pause_inventory(&pause_authority_fixture(), &mut state) {
        Ok(_) => panic!("exhausted generation must reject the next pause"),
        Err(error) => assert_eq!(error, "The debug pause generation is exhausted."),
    }
    assert_eq!(
        PauseGenerationFloor::try_from_epoch(MAX_SAFE_INTEGER),
        Err("The debug pause generation is exhausted.".to_string())
    );
    assert_eq!(
        PauseGenerationFloor::try_from_epoch(u64::MAX),
        Err("The debug pause generation is exhausted.".to_string())
    );
}
