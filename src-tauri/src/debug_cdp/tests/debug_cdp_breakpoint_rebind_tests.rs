use super::super::{BreakpointResolutionTarget, CdpShared};
use super::*;
use crate::debug_adapter::{
    DebugBreakpoint, DebugEvent, DebugEventPayload, DebugEventSink, DebugExceptionPauseMode,
    DebugLaunchTarget, DebugSessionRegistry, DebugStackFrame, DebugStopReason,
};
use crate::debug_source_map::SourceMapRegistry;
use crate::managed_javascript_typescript::node_executable_path;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::net::{Ipv4Addr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

static NEXT_REBIND_TEST: AtomicU64 = AtomicU64::new(1);
const REAL_IMPORTED_SOURCE: &str =
    "export function hit() {\n  console.log('IMPORTED_BREAKPOINT_HIT');\n}\n";
const REAL_IMPORTED_OUTPUT: &str = concat!(
    "\"use strict\";\n",
    "Object.defineProperty(exports, \"__esModule\", { value: true });\n",
    "exports.hit = hit;\n",
    "function hit() {\n",
    "    console.log('IMPORTED_BREAKPOINT_HIT');\n",
    "}\n",
    "//# sourceMappingURL=foo.js.map\n"
);
const REAL_IMPORTED_SOURCE_MAP: &str = r#"{"version":3,"file":"foo.js","sourceRoot":"","sources":["../src/foo.ts"],"names":[],"mappings":";;AAAA,kBAEC;AAFD,SAAgB,GAAG;IACjB,OAAO,CAAC,GAAG,CAAC,yBAAyB,CAAC,CAAC;AACzC,CAAC"}"#;

#[derive(Default)]
struct CollectingSink {
    events: Mutex<Vec<DebugEvent>>,
}

impl CollectingSink {
    fn payloads(&self) -> Vec<DebugEventPayload> {
        self.events
            .lock()
            .expect("events")
            .iter()
            .map(|event| event.payload.clone())
            .collect()
    }
}

impl DebugEventSink for CollectingSink {
    fn emit(&self, event: DebugEvent) {
        self.events.lock().expect("events").push(event);
    }
}

struct RebindFixture {
    original: PathBuf,
    receipt: crate::debug_source_map::SourceMapReceipt,
    root: PathBuf,
    shared: Arc<Mutex<CdpShared>>,
}

impl RebindFixture {
    fn new(verified: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-breakpoint-rebind-{}-{}",
            std::process::id(),
            NEXT_REBIND_TEST.fetch_add(1, Ordering::Relaxed)
        ));
        let source_dir = root.join("src");
        let output_dir = root.join("dist");
        fs::create_dir_all(&source_dir).expect("create source directory");
        fs::create_dir_all(&output_dir).expect("create output directory");
        let original = source_dir.join("foo.ts");
        let generated = output_dir.join("foo.js");
        let source_map = output_dir.join("foo.js.map");
        fs::write(&original, "export function hit() {}\n").expect("write original");
        fs::write(
            &generated,
            "exports.hit = function hit() {};\n//# sourceMappingURL=foo.js.map\n",
        )
        .expect("write generated");
        fs::write(
            &source_map,
            r#"{"version":3,"file":"foo.js","sourceRoot":"","sources":["../src/foo.ts"],"names":[],"mappings":"AAAA"}"#,
        )
        .expect("write source map");
        let root = root.canonicalize().expect("canonical root");
        let original = original.canonicalize().expect("canonical original");
        let generated = generated.canonicalize().expect("canonical generated");
        let generated_url = crate::debug_support::file_url_from_path(&generated.to_string_lossy());
        let mut maps = SourceMapRegistry::new(&root).expect("source maps");
        let loader = maps.loader();
        let request = loader
            .reserve_script("script-foo", &generated_url, "foo.js.map")
            .expect("reserve source map");
        maps.mark_pending(request.settlement())
            .expect("mark source map pending");
        let prepared = request.prepare().expect("prepare source map");
        let receipt = maps
            .commit_script_with_receipt(prepared)
            .expect("commit source map");
        let file_path = original.to_string_lossy().into_owned();
        let breakpoint = test_breakpoint(&file_path, verified);
        let mut shared = CdpShared::new(Some(maps));
        shared
            .breakpoints_by_file
            .insert(file_path.clone(), vec![breakpoint.clone()]);
        if !verified {
            shared
                .cdp_ids_by_file
                .insert(file_path.clone(), vec!["old-cdp".to_string()]);
            shared.resolution_index.insert(
                "old-cdp".to_string(),
                BreakpointResolutionTarget {
                    breakpoint_id: breakpoint.id,
                    column_number: None,
                    file_path,
                    generated_url: crate::debug_support::file_url_from_path(
                        &original.to_string_lossy(),
                    ),
                    source_path: original.to_string_lossy().into_owned(),
                },
            );
        }
        Self {
            original,
            receipt,
            root,
            shared: Arc::new(Mutex::new(shared)),
        }
    }

    fn enqueue(&self) -> bool {
        enqueue(&self.shared, self.receipt.clone(), "script-foo".to_string())
    }
}

impl Drop for RebindFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn pause_projection_recovers_empty_frame_url_from_exact_script_identity() {
    let fixture = RebindFixture::new(false);
    let params = json!({
        "callFrames": [{
            "callFrameId": "frame-mapped",
            "functionName": "mappedScript",
            "url": "",
            "location": {"scriptId": "script-foo", "lineNumber": 0, "columnNumber": 0},
            "scopeChain": []
        }]
    });
    let inventory =
        super::super::build_pause_inventory(&params, &mut fixture.shared.lock().expect("shared"))
            .expect("recovered mapped pause");

    assert_eq!(
        inventory.frames[0].file_path.as_deref(),
        Some(fixture.original.to_string_lossy().as_ref())
    );
}

#[test]
fn pause_projection_recovers_plain_file_url_from_exact_script_identity() {
    let fixture = RebindFixture::new(false);
    let generated = fixture.root.join("dist/foo.js");
    let generated_url = crate::debug_support::file_url_from_path(&generated.to_string_lossy());
    let params = json!({
        "callFrames": [{
            "callFrameId": "frame-plain",
            "functionName": "plainScript",
            "url": "",
            "location": {"scriptId": "plain", "lineNumber": 0, "columnNumber": 0},
            "scopeChain": []
        }]
    });
    let mut shared = fixture.shared.lock().expect("shared");
    shared
        .source_maps
        .as_mut()
        .expect("source maps")
        .mark_plain_script("plain", &generated_url);
    let inventory =
        super::super::build_pause_inventory(&params, &mut shared).expect("recovered plain pause");

    assert_eq!(
        inventory.frames[0].file_path.as_deref(),
        Some(generated.to_string_lossy().as_ref())
    );
}

struct FakeRebindCdp {
    calls: Mutex<Vec<(String, Value)>>,
    invalidate_on_set: bool,
    is_current: Arc<AtomicBool>,
}

impl BreakpointRebindCdp for FakeRebindCdp {
    fn request(
        &self,
        method: &str,
        params: Value,
        reserve: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Value, BreakpointRebindRequestFailure> {
        if !reserve() {
            return Err(BreakpointRebindRequestFailure::Rejected(
                "stale authority".to_string(),
            ));
        }
        self.calls
            .lock()
            .expect("calls")
            .push((method.to_string(), params));
        if self.invalidate_on_set && method == "Debugger.setBreakpointByUrl" {
            self.is_current.store(false, Ordering::Release);
        }
        if method == "Debugger.removeBreakpoint" {
            return Ok(json!({}));
        }
        Ok(json!({
            "breakpointId": "new-cdp",
            "locations": [{
                "scriptId": "script-foo",
                "lineNumber": 0,
                "columnNumber": 0
            }]
        }))
    }
}

#[derive(Default)]
struct EngineTrackingCdp {
    active_ids: Mutex<HashSet<String>>,
    calls: Mutex<Vec<(String, Value)>>,
    rejected_removals: Mutex<HashSet<String>>,
}

impl BreakpointRebindCdp for EngineTrackingCdp {
    fn request(
        &self,
        method: &str,
        params: Value,
        reserve: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Value, BreakpointRebindRequestFailure> {
        if !reserve() {
            return Err(BreakpointRebindRequestFailure::Rejected(
                "stale authority".to_string(),
            ));
        }
        self.calls
            .lock()
            .expect("calls")
            .push((method.to_string(), params.clone()));
        if method == "Debugger.removeBreakpoint" {
            let Some(breakpoint_id) = params.get("breakpointId").and_then(Value::as_str) else {
                return Err(BreakpointRebindRequestFailure::Rejected(
                    "missing breakpoint id".to_string(),
                ));
            };
            if self
                .rejected_removals
                .lock()
                .expect("rejected removals")
                .contains(breakpoint_id)
            {
                return Err(BreakpointRebindRequestFailure::Rejected(
                    "cannot remove breakpoint".to_string(),
                ));
            }
            self.active_ids
                .lock()
                .expect("active ids")
                .remove(breakpoint_id);
            return Ok(json!({}));
        }
        self.active_ids
            .lock()
            .expect("active ids")
            .insert("rebind-cdp".to_string());
        Ok(json!({
            "breakpointId": "rebind-cdp",
            "locations": [{
                "scriptId": "script-foo",
                "lineNumber": 0,
                "columnNumber": 0
            }]
        }))
    }
}

fn test_breakpoint(file_path: &str, verified: bool) -> DebugBreakpoint {
    DebugBreakpoint {
        id: "bp-foo".to_string(),
        file_path: file_path.to_string(),
        line_number: 1,
        column_number: None,
        condition: None,
        hit_condition: None,
        log_message: None,
        enabled: true,
        verified,
    }
}

#[test]
fn unexplained_old_breakpoint_removal_rejection_preserves_the_old_registration() {
    let fixture = RebindFixture::new(false);
    let cdp = Arc::new(EngineTrackingCdp {
        active_ids: Mutex::new(HashSet::from(["old-cdp".to_string()])),
        calls: Mutex::new(Vec::new()),
        rejected_removals: Mutex::new(HashSet::from(["old-cdp".to_string()])),
    });
    let events = Arc::new(Mutex::new(Vec::new()));
    let emit_events = Arc::clone(&events);
    let emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync> =
        Arc::new(move |payload| emit_events.lock().expect("events").push(payload));
    assert!(register_transport(
        &fixture.shared,
        Arc::clone(&cdp) as Arc<dyn BreakpointRebindCdp>,
        emit,
        Arc::new(|| true),
        Arc::new(|| {}),
    ));
    assert!(fixture.enqueue());
    schedule(&fixture.shared);
    wait_until(|| cdp.calls.lock().expect("calls").len() == 3);
    let file_path = fixture.original.to_string_lossy().into_owned();
    let state = fixture.shared.lock().expect("shared");

    assert_eq!(
        cdp.active_ids.lock().expect("active ids").clone(),
        HashSet::from(["old-cdp".to_string()])
    );
    assert_eq!(
        state.cdp_ids_by_file.get(&file_path),
        Some(&vec!["old-cdp".to_string()])
    );
    assert!(state.resolution_index.contains_key("old-cdp"));
    assert!(!state.resolution_index.contains_key("rebind-cdp"));
    assert!(events.lock().expect("events").is_empty());
}

#[test]
fn set_breakpoints_in_flight_generation_prevents_rebind_orphan_on_final_overwrite() {
    let fixture = RebindFixture::new(false);
    let cdp = Arc::new(EngineTrackingCdp::default());
    let events = Arc::new(Mutex::new(Vec::new()));
    let emit_events = Arc::clone(&events);
    let emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync> =
        Arc::new(move |payload| emit_events.lock().expect("events").push(payload));
    let failed_closed = Arc::new(AtomicBool::new(false));
    let fail_closed = {
        let failed_closed = Arc::clone(&failed_closed);
        Arc::new(move || failed_closed.store(true, Ordering::Release))
            as Arc<dyn Fn() + Send + Sync>
    };
    assert!(register_transport(
        &fixture.shared,
        Arc::clone(&cdp) as Arc<dyn BreakpointRebindCdp>,
        emit,
        Arc::new(|| true),
        fail_closed,
    ));
    let in_flight_generation = {
        let mut state = fixture.shared.lock().expect("shared");
        let generation =
            begin_registration_mutation(&fixture.shared).expect("begin breakpoint mutation");
        let file_path = fixture.original.to_string_lossy().into_owned();
        let ids = state.cdp_ids_by_file.remove(&file_path).unwrap_or_default();
        for id in ids {
            state.resolution_index.remove(&id);
            state.pending_resolutions.remove(&id);
            state.breakpoint_hits.remove(&id);
        }
        generation
    };
    assert!(!in_flight_generation.is_multiple_of(2));
    assert!(fixture.enqueue());
    schedule(&fixture.shared);
    wait_until(|| counters_for_test(&fixture.shared).is_some_and(|counters| counters.0 == 1));
    cdp.active_ids
        .lock()
        .expect("active ids")
        .insert("set-breakpoints-cdp".to_string());
    let file_path = fixture.original.to_string_lossy().into_owned();
    {
        let mut state = fixture.shared.lock().expect("shared");
        state
            .cdp_ids_by_file
            .insert(file_path.clone(), vec!["set-breakpoints-cdp".to_string()]);
        finish_registration_mutation(&fixture.shared, in_flight_generation)
            .expect("finish breakpoint mutation");
    }
    let local_ids = fixture
        .shared
        .lock()
        .expect("shared")
        .cdp_ids_by_file
        .get(&file_path)
        .cloned()
        .expect("local breakpoint ids")
        .into_iter()
        .collect::<HashSet<_>>();
    let engine_ids = cdp.active_ids.lock().expect("active ids").clone();

    assert_eq!(counters_for_test(&fixture.shared).expect("counters").2, 2);
    assert_eq!(engine_ids, local_ids);
    assert!(events.lock().expect("events").is_empty());
    assert!(!failed_closed.load(Ordering::Acquire));
}

struct RebindRun {
    cdp: Arc<FakeRebindCdp>,
    events: Arc<Mutex<Vec<DebugEventPayload>>>,
    failed_closed: Arc<AtomicBool>,
}

fn run_fixture(fixture: &RebindFixture, invalidate_on_set: bool) -> RebindRun {
    let is_current = Arc::new(AtomicBool::new(true));
    let failed_closed = Arc::new(AtomicBool::new(false));
    let cdp = Arc::new(FakeRebindCdp {
        calls: Mutex::new(Vec::new()),
        invalidate_on_set,
        is_current: Arc::clone(&is_current),
    });
    let events = Arc::new(Mutex::new(Vec::new()));
    let emit_events = Arc::clone(&events);
    let emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync> =
        Arc::new(move |payload| emit_events.lock().expect("events").push(payload));
    let authority = {
        let is_current = Arc::clone(&is_current);
        Arc::new(move || is_current.load(Ordering::Acquire)) as Arc<dyn Fn() -> bool + Send + Sync>
    };
    let fail_closed = {
        let failed_closed = Arc::clone(&failed_closed);
        Arc::new(move || failed_closed.store(true, Ordering::Release))
            as Arc<dyn Fn() + Send + Sync>
    };
    assert!(register_transport(
        &fixture.shared,
        Arc::clone(&cdp) as Arc<dyn BreakpointRebindCdp>,
        emit,
        authority,
        fail_closed,
    ));
    assert!(fixture.enqueue());
    schedule(&fixture.shared);
    RebindRun {
        cdp,
        events,
        failed_closed,
    }
}

fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    panic!("timed out waiting for breakpoint rebind");
}

fn wait_for<T>(predicate: impl Fn() -> Option<T>, description: &str) -> T {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(value) = predicate() {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {description}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn wait_for_stopped(sink: &CollectingSink) -> (DebugStopReason, Vec<DebugStackFrame>) {
    wait_for(
        || {
            sink.payloads()
                .into_iter()
                .find_map(|payload| match payload {
                    DebugEventPayload::Stopped { reason, frames, .. } => Some((reason, frames)),
                    _ => None,
                })
        },
        "stopped event",
    )
}

fn diagnostic_frames(frames: &[DebugStackFrame]) -> String {
    frames
        .iter()
        .take(5)
        .map(|frame| {
            format!(
                "file={:?}, function={:?}, line={}, column={}",
                frame.file_path, frame.name, frame.line_number, frame.column
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

#[test]
fn imported_type_script_breakpoint_binds_and_hits_without_retoggling() {
    let fixture = RebindFixture::new(false);
    let run = run_fixture(&fixture, false);
    wait_until(|| !run.events.lock().expect("events").is_empty());
    assert!(
        !run.events.lock().expect("events").is_empty(),
        "calls: {:?}, breakpoints: {:?}",
        run.cdp.calls.lock().expect("calls"),
        fixture.shared.lock().expect("shared").breakpoints_by_file
    );
    assert!(!run.failed_closed.load(Ordering::Acquire));
    let calls = run.cdp.calls.lock().expect("calls");
    assert_eq!(
        calls.first().map(|(method, _)| method.as_str()),
        Some("Debugger.setBreakpointByUrl")
    );
    assert_eq!(
        calls.get(1).map(|(method, _)| method.as_str()),
        Some("Debugger.removeBreakpoint")
    );
    assert_eq!(
        calls
            .iter()
            .filter(|(method, _)| method == "Debugger.setBreakpointByUrl")
            .count(),
        1
    );
    assert_eq!(
        calls
            .iter()
            .find(|(method, _)| method == "Debugger.setBreakpointByUrl")
            .and_then(|(_, params)| params.get("url"))
            .and_then(Value::as_str),
        Some(crate::debug_support::file_url_from_path(
            &fixture.root.join("dist/foo.js").to_string_lossy()
        ))
        .as_deref()
    );
    assert_eq!(
        calls
            .iter()
            .find(|(method, _)| method == "Debugger.setBreakpointByUrl")
            .and_then(|(_, params)| params.get("columnNumber"))
            .and_then(Value::as_u64),
        Some(0)
    );
    assert!(run.events.lock().expect("events").iter().any(|event| {
        matches!(
            event,
            DebugEventPayload::BreakpointsVerified { breakpoints, .. }
                if breakpoints.iter().any(|breakpoint| breakpoint.verified)
        )
    }));
}

#[test]
fn unrelated_unmapped_breakpoints_do_not_consume_the_attempt_limit() {
    let fixture = RebindFixture::new(false);
    {
        let mut state = fixture.shared.lock().expect("shared");
        state.resolution_index.clear();
        state.cdp_ids_by_file.clear();
        let file_path = fixture.original.to_string_lossy().into_owned();
        let mut breakpoints = (0..MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SCRIPT)
            .map(|index| {
                let mut breakpoint = test_breakpoint(&file_path, false);
                breakpoint.id = format!("unmapped-{index}");
                breakpoint.line_number = 2;
                breakpoint
            })
            .collect::<Vec<_>>();
        breakpoints.push(test_breakpoint(&file_path, false));
        state.breakpoints_by_file.insert(file_path, breakpoints);
    }
    let run = run_fixture(&fixture, false);
    wait_until(|| !run.events.lock().expect("events").is_empty());
    assert_eq!(
        run.cdp
            .calls
            .lock()
            .expect("calls")
            .iter()
            .filter(|(method, _)| method == "Debugger.setBreakpointByUrl")
            .count(),
        1
    );
}

#[test]
fn imported_fixture_maps_statement_and_leading_indentation_to_hit_body() {
    let root = std::env::temp_dir().join(format!(
        "codevo-breakpoint-map-proof-{}-{}",
        std::process::id(),
        NEXT_REBIND_TEST.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(root.join("src")).expect("create map proof source directory");
    fs::create_dir_all(root.join("dist")).expect("create map proof output directory");
    let source = root.join("src/foo.ts");
    let generated = root.join("dist/foo.js");
    let source_map = root.join("dist/foo.js.map");
    fs::write(&source, REAL_IMPORTED_SOURCE).expect("write map proof source");
    fs::write(&generated, REAL_IMPORTED_OUTPUT).expect("write map proof output");
    fs::write(&source_map, REAL_IMPORTED_SOURCE_MAP).expect("write map proof source map");
    let root = root.canonicalize().expect("canonical map proof root");
    let source = source.canonicalize().expect("canonical map proof source");
    let generated = generated
        .canonicalize()
        .expect("canonical map proof output");
    let source_map = source_map
        .canonicalize()
        .expect("canonical map proof source map");
    let generated_url = crate::debug_support::file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("map proof registry");
    let prepared = registry
        .loader()
        .prepare_script(
            "script-foo",
            &generated_url,
            &crate::debug_support::file_url_from_path(&source_map.to_string_lossy()),
        )
        .expect("prepare map proof");
    registry.commit_script(prepared).expect("commit map proof");

    let generated_statement = registry
        .map_original_position(&source, 2, 3)
        .expect("reverse-map imported statement");
    let projected_statement = registry
        .map_generated_for_script("script-foo", &generated_url, 4, 4)
        .expect("forward-map imported statement");
    let projected_indentation = registry
        .map_generated_for_script("script-foo", &generated_url, 4, 0)
        .expect("forward-map imported statement indentation");

    assert!(registry
        .map_generated_for_script("script-foo", &generated_url, 0, 0)
        .is_none());
    assert_eq!(generated_statement.line_number, 5);
    assert_eq!(generated_statement.column, 5);
    assert_eq!(projected_statement.file_path, source.to_string_lossy());
    assert_eq!(projected_statement.line_number, 2);
    assert_eq!(projected_statement.column, 3);
    assert_eq!(projected_indentation, projected_statement);
    fs::remove_dir_all(root).expect("remove map proof fixture");
}

#[test]
fn real_node_imported_type_script_breakpoint_binds_and_hits_without_retoggling() {
    match TcpListener::bind((Ipv4Addr::LOCALHOST, 0)) {
        Ok(listener) => drop(listener),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            eprintln!("skipping real imported TypeScript breakpoint proof: loopback inspector bind is restricted");
            return;
        }
        Err(error) => panic!("probe real imported breakpoint loopback bind: {error}"),
    }
    let _admission = crate::debug_node_process::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real imported TypeScript breakpoint proof requires managed Node.js in CI");
        }
        eprintln!("skipping real imported TypeScript breakpoint proof: no managed Node.js");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "codevo-real-breakpoint-rebind-{}-{}",
        std::process::id(),
        NEXT_REBIND_TEST.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(root.join("src")).expect("create real source directory");
    fs::create_dir_all(root.join("dist")).expect("create real output directory");
    fs::write(
        root.join("tsconfig.json"),
        r#"{"compilerOptions":{"rootDir":"src","outDir":"dist","sourceMap":true}}"#,
    )
    .expect("write tsconfig");
    fs::write(
        root.join("src/entry.ts"),
        concat!(
            "const fs = require('fs');\n",
            "const path = require('path');\n",
            "const foo = require('./foo');\n",
            "const sentinel = path.join(__dirname, '../breakpoint-bound');\n",
            "const deadline = Date.now() + 15000;\n",
            "function hitWhenBound() {\n",
            "  if (fs.existsSync(sentinel)) {\n",
            "    foo.hit();\n",
            "    return;\n",
            "  }\n",
            "  if (Date.now() >= deadline) {\n",
            "    process.exitCode = 1;\n",
            "    return;\n",
            "  }\n",
            "  setTimeout(hitWhenBound, 10);\n",
            "}\n",
            "hitWhenBound();\n",
            "setTimeout(() => {}, 16000);\n"
        ),
    )
    .expect("write entry source");
    fs::write(root.join("src/foo.ts"), REAL_IMPORTED_SOURCE).expect("write imported source");
    fs::write(
        root.join("dist/entry.js"),
        concat!(
            "const fs = require('fs');\n",
            "const path = require('path');\n",
            "const foo = require('./foo');\n",
            "const sentinel = path.join(__dirname, '../breakpoint-bound');\n",
            "const deadline = Date.now() + 15000;\n",
            "function hitWhenBound() {\n",
            "    if (fs.existsSync(sentinel)) {\n",
            "        foo.hit();\n",
            "        return;\n",
            "    }\n",
            "    if (Date.now() >= deadline) {\n",
            "        process.exitCode = 1;\n",
            "        return;\n",
            "    }\n",
            "    setTimeout(hitWhenBound, 10);\n",
            "}\n",
            "hitWhenBound();\n",
            "setTimeout(() => { }, 16000);\n",
            "//# sourceMappingURL=entry.js.map\n"
        ),
    )
    .expect("write entry output");
    fs::write(
        root.join("dist/entry.js.map"),
        r#"{"version":3,"file":"entry.js","sourceRoot":"","sources":["../src/entry.ts"],"names":[],"mappings":"AAAA,MAAM,EAAE,GAAG,OAAO,CAAC,IAAI,CAAC,CAAC;AACzB,MAAM,IAAI,GAAG,OAAO,CAAC,MAAM,CAAC,CAAC;AAC7B,MAAM,GAAG,GAAG,OAAO,CAAC,OAAO,CAAC,CAAC;AAC7B,MAAM,QAAQ,GAAG,IAAI,CAAC,IAAI,CAAC,SAAS,EAAE,qBAAqB,CAAC,CAAC;AAC7D,MAAM,QAAQ,GAAG,IAAI,CAAC,GAAG,EAAE,GAAG,KAAK,CAAC;AACpC,SAAS,YAAY;IACnB,IAAI,EAAE,CAAC,UAAU,CAAC,QAAQ,CAAC,EAAE,CAAC;QAC5B,GAAG,CAAC,GAAG,EAAE,CAAC;QACV,OAAO;IACT,CAAC;IACD,IAAI,IAAI,CAAC,GAAG,EAAE,IAAI,QAAQ,EAAE,CAAC;QAC3B,OAAO,CAAC,QAAQ,GAAG,CAAC,CAAC;QACrB,OAAO;IACT,CAAC;IACD,UAAU,CAAC,YAAY,EAAE,EAAE,CAAC,CAAC;AAC/B,CAAC;AACD,YAAY,EAAE,CAAC;AACf,UAAU,CAAC,GAAG,EAAE,GAAE,CAAC,EAAE,KAAK,CAAC,CAAC"}"#,
    )
    .expect("write entry source map");
    fs::write(root.join("dist/foo.js"), REAL_IMPORTED_OUTPUT).expect("write imported output");
    fs::write(root.join("dist/foo.js.map"), REAL_IMPORTED_SOURCE_MAP)
        .expect("write imported source map");
    let root = root.canonicalize().expect("canonical real root");
    let entry = root
        .join("src/entry.ts")
        .canonicalize()
        .expect("canonical entry");
    let imported = root
        .join("src/foo.ts")
        .canonicalize()
        .expect("canonical imported source");
    let root_key = root.to_string_lossy().into_owned();
    let imported_key = imported.to_string_lossy().into_owned();
    let sink = Arc::new(CollectingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: entry.to_string_lossy().into_owned(),
    };
    let mut imported_breakpoint = test_breakpoint(&imported_key, false);
    imported_breakpoint.line_number = 2;
    imported_breakpoint.column_number = Some(3);
    let initial = vec![imported_breakpoint];
    let session_id = match registry.start_session(
        &root_key,
        Arc::clone(&sink) as Arc<dyn DebugEventSink>,
        |emitter| {
            crate::debug_cdp::create_node_cdp_adapter_with_exception_filter(
                &root,
                &launch,
                &initial,
                DebugExceptionPauseMode::None,
                &[],
                true,
                false,
                emitter,
                Box::new(|_| {}),
                Arc::new(|| true),
            )
        },
    ) {
        Ok(session_id) => session_id,
        Err(error) => panic!("start real imported breakpoint session: {error}"),
    };
    wait_for(
        || {
            sink.payloads()
                .into_iter()
                .find_map(|payload| match payload {
                    DebugEventPayload::BreakpointsVerified {
                        file_path,
                        breakpoints,
                    } if file_path == imported_key
                        && breakpoints.iter().any(|breakpoint| breakpoint.verified) =>
                    {
                        Some(())
                    }
                    _ => None,
                })
        },
        "imported breakpoint verification",
    );
    fs::write(root.join("breakpoint-bound"), b"ready").expect("release imported breakpoint call");
    let (_, frames) = wait_for_stopped(&sink);
    assert!(
        frames.first().is_some_and(|frame| {
            frame.file_path.as_deref() == Some(imported_key.as_str()) && frame.name == "hit"
        }),
        "expected top frame file={imported_key:?}, function=\"hit\"; observed top frames: [{}]",
        diagnostic_frames(&frames)
    );
    assert!(registry.stop_by_id(session_id));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn uncovered_breakpoint_stays_unverified() {
    let fixture = RebindFixture::new(false);
    let uncovered = fixture.root.join("src/uncovered.ts");
    fs::write(&uncovered, "export const uncovered = true;\n").expect("write uncovered");
    let uncovered = uncovered.canonicalize().expect("canonical uncovered");
    {
        let mut state = fixture.shared.lock().expect("shared");
        state.breakpoints_by_file.clear();
        state.resolution_index.clear();
        state.cdp_ids_by_file.clear();
        let path = uncovered.to_string_lossy().into_owned();
        state
            .breakpoints_by_file
            .insert(path.clone(), vec![test_breakpoint(&path, false)]);
    }
    let run = run_fixture(&fixture, false);
    wait_until(|| counters_for_test(&fixture.shared).is_some_and(|counters| counters.0 == 1));
    assert!(run.cdp.calls.lock().expect("calls").is_empty());
    assert!(run.events.lock().expect("events").is_empty());
    assert!(
        !fixture
            .shared
            .lock()
            .expect("shared")
            .breakpoints_by_file
            .values()
            .flatten()
            .next()
            .expect("breakpoint")
            .verified
    );
}

#[test]
fn script_parsed_storm_coalesces_to_one_bounded_sweep() {
    let fixture = RebindFixture::new(false);
    let run = run_fixture(&fixture, false);
    for _ in 0..32 {
        assert!(!fixture.enqueue());
        schedule(&fixture.shared);
    }
    wait_until(|| !run.events.lock().expect("events").is_empty());
    let counters = counters_for_test(&fixture.shared).expect("counters");
    assert_eq!(counters.0, 1);
    assert_eq!(counters.1, 1);
    assert_eq!(
        run.cdp
            .calls
            .lock()
            .expect("calls")
            .iter()
            .filter(|(method, _)| method == "Debugger.setBreakpointByUrl")
            .count(),
        1
    );
}

#[test]
fn rebind_after_session_replacement_fails_closed() {
    let fixture = RebindFixture::new(false);
    let run = run_fixture(&fixture, true);
    wait_until(|| run.failed_closed.load(Ordering::Acquire));
    assert!(run.events.lock().expect("events").is_empty());
    assert!(
        !fixture
            .shared
            .lock()
            .expect("shared")
            .breakpoints_by_file
            .values()
            .flatten()
            .next()
            .expect("breakpoint")
            .verified
    );
}

#[test]
fn already_verified_breakpoint_is_not_resent() {
    let fixture = RebindFixture::new(true);
    let run = run_fixture(&fixture, false);
    wait_until(|| counters_for_test(&fixture.shared).is_some_and(|counters| counters.0 == 1));
    assert!(run.cdp.calls.lock().expect("calls").is_empty());
}

#[test]
fn entry_script_startup_breakpoint_path_is_unchanged() {
    let fixture = RebindFixture::new(true);
    let _ = run_fixture(&fixture, false);
    let initial = fixture
        .shared
        .lock()
        .expect("shared")
        .breakpoints_by_file
        .get(&fixture.original.to_string_lossy().into_owned())
        .cloned()
        .expect("startup breakpoints");
    assert_eq!(initial.len(), 1);
    assert!(initial[0].verified);
    assert_eq!(counters_for_test(&fixture.shared).expect("counters").2, 0);
}
