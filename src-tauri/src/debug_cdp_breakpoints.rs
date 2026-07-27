use crate::{
    debug_adapter::DebugBreakpoint,
    debug_cdp::{ensure_startup_current, transport::CdpClient},
    debug_hit_condition::DebugHitCondition,
    debug_logpoint::{parse_debug_log_template, DebugLogTemplate, MAX_DEBUG_LOGPOINTS_PER_PAUSE},
};
use serde_json::json;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

struct SourceMapWorkerJob {
    emitter: crate::debug_cdp::event_sink::CdpEventEmitter,
    mutation_is_allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    request: crate::debug_source_map::SourceMapPreparation,
    settlement: crate::debug_source_map::SourceMapSettlement,
    shared: Arc<Mutex<crate::debug_cdp::transport::CdpShared>>,
}

const SOURCE_MAP_PREPARATION_QUEUE: usize = 32;
static SOURCE_MAP_WORKER: OnceLock<Option<mpsc::SyncSender<SourceMapWorkerJob>>> = OnceLock::new();

pub(crate) fn handle_script_parsed(
    params: &Value,
    context: &crate::debug_cdp::transport::SocketLoopContext,
) {
    let Some(script_id) = params.get("scriptId").and_then(Value::as_str) else {
        return;
    };
    let Some(generated_url) = params.get("url").and_then(Value::as_str) else {
        return;
    };
    let loader = {
        let Ok(shared) = context.shared.lock() else {
            return;
        };
        let Some(source_maps) = shared.source_maps.as_ref() else {
            return;
        };
        source_maps.loader()
    };
    let source_map_url = params
        .get("sourceMapURL")
        .and_then(Value::as_str)
        .filter(|url| !url.is_empty());
    let Some(source_map_url) = source_map_url else {
        if let Ok(mut shared) = context.shared.lock() {
            if let Some(source_maps) = shared.source_maps.as_mut() {
                source_maps.mark_plain_script(script_id, generated_url);
            }
        }
        return;
    };
    let request = match loader.reserve_script(script_id, generated_url, source_map_url) {
        Ok(request) => request,
        Err(error) => {
            settle_source_map_failure(context, script_id, generated_url, &error);
            return;
        }
    };
    let settlement = request.settlement();
    let pending_result = {
        let Ok(mut shared) = context.shared.lock() else {
            settlement.complete();
            return;
        };
        let Some(source_maps) = shared.source_maps.as_mut() else {
            settlement.complete();
            return;
        };
        match source_maps.mark_pending(settlement.clone()) {
            Ok(()) => Ok(()),
            Err(error) => Err(source_maps.source_map_diagnostic(&error)),
        }
    };
    if let Err(diagnostic) = pending_result {
        if let Some(text) = diagnostic {
            crate::debug_cdp::transport::emit_debug_event(
                context,
                crate::debug_adapter::DebugEventPayload::Output {
                    stream: crate::debug_adapter::DebugOutputStream::Stderr,
                    text,
                    truncated: false,
                },
            );
        }
        return;
    }
    let job = SourceMapWorkerJob {
        emitter: context.emitter.clone(),
        mutation_is_allowed: Arc::clone(&context.mutation_is_allowed),
        settlement,
        request,
        shared: Arc::clone(&context.shared),
    };
    let Some(worker) = source_map_worker() else {
        settle_source_map_worker_job(job, "Source-map preparation worker is unavailable.");
        return;
    };
    if let Err(error) = worker.try_send(job) {
        let job = match error {
            mpsc::TrySendError::Full(job) | mpsc::TrySendError::Disconnected(job) => job,
        };
        settle_source_map_worker_job(job, "Source-map preparation queue is full.");
    }
}

fn source_map_worker() -> Option<&'static mpsc::SyncSender<SourceMapWorkerJob>> {
    SOURCE_MAP_WORKER
        .get_or_init(|| {
            let (sender, receiver) =
                mpsc::sync_channel::<SourceMapWorkerJob>(SOURCE_MAP_PREPARATION_QUEUE);
            std::thread::Builder::new()
                .name("debug-source-map-worker".to_string())
                .spawn(move || {
                    while let Ok(job) = receiver.recv() {
                        let cleanup_shared = Arc::clone(&job.shared);
                        let cleanup_settlement = job.settlement.clone();
                        run_guarded_source_map_action(
                            &cleanup_shared,
                            cleanup_settlement,
                            move || process_source_map_worker_job(job),
                        );
                    }
                })
                .ok()
                .map(|_| sender)
        })
        .as_ref()
}

fn run_guarded_source_map_action(
    shared: &Arc<Mutex<crate::debug_cdp::transport::CdpShared>>,
    settlement: crate::debug_source_map::SourceMapSettlement,
    action: impl FnOnce(),
) {
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(action)).is_err() {
        settle_source_map_worker_job_without_diagnostic(shared, settlement);
    }
}

fn process_source_map_worker_job(job: SourceMapWorkerJob) {
    let Some(result) =
        prepare_source_map_request_if_allowed(job.request, job.mutation_is_allowed.as_ref())
    else {
        settle_source_map_worker_job_without_diagnostic(&job.shared, job.settlement);
        return;
    };
    if !(job.mutation_is_allowed)() {
        settle_source_map_worker_job_without_diagnostic(&job.shared, job.settlement);
        return;
    }
    let diagnostic = {
        let Ok(mut shared) = job.shared.lock() else {
            job.settlement.complete();
            return;
        };
        let Some(source_maps) = shared.source_maps.as_mut() else {
            job.settlement.complete();
            return;
        };
        if !(job.mutation_is_allowed)() {
            source_maps.settle_failed_preparation(job.settlement.clone());
            None
        } else {
            match result {
                Ok(prepared) => source_maps
                    .commit_script(prepared)
                    .err()
                    .and_then(|error| source_maps.source_map_diagnostic(&error)),
                Err(error) => {
                    source_maps.settle_failed_preparation(job.settlement.clone());
                    source_maps.source_map_diagnostic(&error)
                }
            }
        }
    };
    if let Some(text) = diagnostic.filter(|_| (job.mutation_is_allowed)()) {
        job.emitter
            .emit(crate::debug_adapter::DebugEventPayload::Output {
                stream: crate::debug_adapter::DebugOutputStream::Stderr,
                text,
                truncated: false,
            });
    }
}

fn prepare_source_map_request_if_allowed(
    request: crate::debug_source_map::SourceMapPreparation,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
) -> Option<Result<crate::debug_source_map::PreparedSourceMap, String>> {
    if !mutation_is_allowed() {
        return None;
    }
    Some(request.prepare())
}

fn settle_source_map_worker_job_without_diagnostic(
    shared: &Arc<Mutex<crate::debug_cdp::transport::CdpShared>>,
    settlement: crate::debug_source_map::SourceMapSettlement,
) {
    let mut state = match shared.lock() {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(source_maps) = state.source_maps.as_mut() {
        source_maps.settle_failed_preparation(settlement);
    } else {
        settlement.complete();
    }
    drop(state);
    shared.clear_poison();
}

fn settle_source_map_worker_job(job: SourceMapWorkerJob, error: &str) {
    let diagnostic = {
        let Ok(mut shared) = job.shared.lock() else {
            job.settlement.complete();
            return;
        };
        let Some(source_maps) = shared.source_maps.as_mut() else {
            job.settlement.complete();
            return;
        };
        source_maps.settle_failed_preparation(job.settlement);
        source_maps.source_map_diagnostic(error)
    };
    if let Some(text) = diagnostic {
        job.emitter
            .emit(crate::debug_adapter::DebugEventPayload::Output {
                stream: crate::debug_adapter::DebugOutputStream::Stderr,
                text,
                truncated: false,
            });
    }
}

fn settle_source_map_failure(
    context: &crate::debug_cdp::transport::SocketLoopContext,
    script_id: &str,
    generated_url: &str,
    error: &str,
) {
    let diagnostic = {
        let Ok(mut shared) = context.shared.lock() else {
            return;
        };
        let Some(source_maps) = shared.source_maps.as_mut() else {
            return;
        };
        source_maps.mark_failed_script(script_id, generated_url);
        source_maps.source_map_diagnostic(error)
    };
    if let Some(text) = diagnostic {
        crate::debug_cdp::transport::emit_debug_event(
            context,
            crate::debug_adapter::DebugEventPayload::Output {
                stream: crate::debug_adapter::DebugOutputStream::Stderr,
                text,
                truncated: false,
            },
        );
    }
}

pub(crate) fn handle_breakpoint_resolved(
    params: &Value,
    context: &crate::debug_cdp::transport::SocketLoopContext,
) {
    let Some(cdp_breakpoint_id) = params.get("breakpointId").and_then(Value::as_str) else {
        return;
    };
    let Some(resolved_line) = params
        .pointer("/location/lineNumber")
        .and_then(Value::as_u64)
        .and_then(|line| u32::try_from(line).ok())
    else {
        return;
    };
    let Some(resolved_column) = params
        .pointer("/location/columnNumber")
        .and_then(Value::as_u64)
        .map_or(Some(0), |column| u32::try_from(column).ok())
    else {
        return;
    };
    let prepared = {
        let Ok(mut shared) = context.shared.lock() else {
            return;
        };
        crate::debug_cdp::transport::prepare_breakpoint_resolution(
            &mut shared,
            cdp_breakpoint_id,
            crate::debug_cdp::transport::GeneratedPosition {
                line: resolved_line,
                column: resolved_column,
                script_identity: crate::debug_cdp::transport::generated_script_identity(
                    params.pointer("/location/scriptId"),
                ),
            },
        )
    };
    let Some(prepared) = prepared else {
        return;
    };
    let resolved_position = prepared.resolve();
    if !(context.mutation_is_allowed)() {
        return;
    }
    let resolved = {
        let Ok(mut shared) = context.shared.lock() else {
            return;
        };
        crate::debug_cdp::transport::complete_breakpoint_resolution(&mut shared, resolved_position)
    };
    let Some((file_path, breakpoints)) = resolved else {
        return;
    };
    if !(context.mutation_is_allowed)() {
        return;
    }
    crate::debug_cdp::transport::emit_debug_event(
        context,
        crate::debug_adapter::DebugEventPayload::BreakpointsVerified {
            file_path,
            breakpoints,
        },
    );
}

pub(crate) fn set_breakpoints_active(
    client: &CdpClient,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    active: bool,
) -> Result<(), String> {
    ensure_startup_current(mutation_is_allowed)?;
    client.request("Debugger.setBreakpointsActive", json!({ "active": active }))?;
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct LogicalBreakpointHitState {
    hit_condition: Option<DebugHitCondition>,
    hits: u64,
    logpoint: Option<DebugLogTemplate>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum BreakpointPauseDecision {
    Pause,
    AutoResume,
    Log(Vec<DebugLogTemplate>),
}

#[derive(Default)]
pub(crate) struct CdpBreakpointHitRegistry {
    by_cdp_id: HashMap<String, LogicalBreakpointHitState>,
}

impl CdpBreakpointHitRegistry {
    pub(crate) fn register(&mut self, cdp_id: String, breakpoint: &DebugBreakpoint) {
        self.by_cdp_id.insert(
            cdp_id,
            LogicalBreakpointHitState {
                hit_condition: breakpoint.hit_condition,
                hits: 0,
                logpoint: breakpoint
                    .log_message
                    .as_deref()
                    .and_then(|message| parse_debug_log_template(message).ok()),
            },
        );
    }

    pub(crate) fn remove(&mut self, cdp_id: &str) {
        self.by_cdp_id.remove(cdp_id);
    }

    /// Counts each distinct CDP id once. Unknown ids force a visible pause because silently
    /// resuming a real debugger pause is more dangerous than surfacing an extra stop.
    pub(crate) fn record_pause<'a>(
        &mut self,
        hit_cdp_ids: impl IntoIterator<Item = &'a str>,
    ) -> BreakpointPauseDecision {
        let mut seen = HashSet::new();
        let ids = hit_cdp_ids
            .into_iter()
            .filter(|id| seen.insert(*id))
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return BreakpointPauseDecision::Pause;
        }
        let mut should_pause = false;
        let mut logpoints = Vec::new();
        for id in ids {
            let Some(state) = self.by_cdp_id.get_mut(id) else {
                should_pause = true;
                continue;
            };
            state.hits = state.hits.saturating_add(1);
            let matches = state
                .hit_condition
                .is_none_or(|condition| condition.matches(state.hits));
            if !matches {
                continue;
            }
            match &state.logpoint {
                Some(logpoint) if logpoints.len() < MAX_DEBUG_LOGPOINTS_PER_PAUSE => {
                    logpoints.push(logpoint.clone());
                }
                Some(_) => should_pause = true,
                None => should_pause = true,
            }
        }
        if should_pause {
            BreakpointPauseDecision::Pause
        } else if !logpoints.is_empty() {
            BreakpointPauseDecision::Log(logpoints)
        } else {
            BreakpointPauseDecision::AutoResume
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_source_map::SourceMapRegistry;
    use crate::debug_support::file_url_from_path;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn breakpoint(id: &str, hit_condition: Option<DebugHitCondition>) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.into(),
            file_path: "/workspace/app.ts".into(),
            line_number: 1,
            column_number: None,
            condition: None,
            hit_condition,
            log_message: None,
            enabled: true,
            verified: false,
        }
    }

    #[test]
    fn ordinary_unknown_and_multiple_simultaneous_hits_are_deterministic() {
        let mut registry = CdpBreakpointHitRegistry::default();
        registry.register("ordinary".into(), &breakpoint("a", None));
        registry.register(
            "third".into(),
            &breakpoint("b", Some(DebugHitCondition::Equals { count: 3 })),
        );
        assert_eq!(
            registry.record_pause(["third", "third"]),
            BreakpointPauseDecision::AutoResume
        );
        assert_eq!(
            registry.record_pause(["third", "ordinary"]),
            BreakpointPauseDecision::Pause
        );
        assert_eq!(
            registry.record_pause(["third"]),
            BreakpointPauseDecision::Pause
        );
        assert_eq!(
            registry.record_pause(["unknown"]),
            BreakpointPauseDecision::Pause
        );
    }

    #[test]
    fn reinstall_resets_count_and_saturation_never_wraps() {
        let mut registry = CdpBreakpointHitRegistry::default();
        let breakpoint = breakpoint("a", Some(DebugHitCondition::Multiple { count: 2 }));
        registry.register("cdp".into(), &breakpoint);
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::AutoResume
        );
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::Pause
        );
        registry.register("cdp".into(), &breakpoint);
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::AutoResume
        );
        registry.by_cdp_id.get_mut("cdp").unwrap().hits = u64::MAX;
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::AutoResume
        );
        assert_eq!(registry.by_cdp_id["cdp"].hits, u64::MAX);
    }

    #[test]
    fn logpoints_reuse_hit_counts_and_ordinary_collisions_stop() {
        let mut registry = CdpBreakpointHitRegistry::default();
        let mut logging = breakpoint("log", Some(DebugHitCondition::Equals { count: 2 }));
        logging.log_message = Some("count={count}".into());
        registry.register("logging".into(), &logging);
        registry.register("ordinary".into(), &breakpoint("stop", None));

        assert_eq!(
            registry.record_pause(["logging"]),
            BreakpointPauseDecision::AutoResume
        );
        assert!(matches!(
            registry.record_pause(["logging"]),
            BreakpointPauseDecision::Log(messages) if messages.len() == 1
        ));
        assert_eq!(
            registry.record_pause(["logging", "ordinary"]),
            BreakpointPauseDecision::Pause
        );
    }

    #[test]
    fn simultaneous_logpoints_are_bounded_and_overflow_stops_conservatively() {
        let mut registry = CdpBreakpointHitRegistry::default();
        let ids = (0..=MAX_DEBUG_LOGPOINTS_PER_PAUSE)
            .map(|index| format!("cdp-{index}"))
            .collect::<Vec<_>>();
        for id in &ids {
            let mut logging = breakpoint(id, None);
            logging.log_message = Some(format!("message {id}"));
            registry.register(id.clone(), &logging);
        }

        assert_eq!(
            registry.record_pause(ids.iter().map(String::as_str)),
            BreakpointPauseDecision::Pause
        );
    }

    #[test]
    fn revoked_source_map_job_is_rejected_before_preparation() {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let root = std::env::temp_dir().join(format!(
            "codevo-cancelled-map-job-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("root");
        let root = root.canonicalize().expect("canonical root");
        let generated = root.join("dist/app.js");
        let source = root.join("src/app.ts");
        let map = root.join("dist/app.map");
        fs::create_dir_all(generated.parent().expect("dist")).expect("dist");
        fs::create_dir_all(source.parent().expect("src")).expect("src");
        fs::write(&generated, "compiled();\n").expect("generated");
        fs::write(&source, "source();\n").expect("source");
        fs::write(
            &map,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        )
        .expect("map");
        let registry = SourceMapRegistry::new(&root).expect("registry");
        let request = registry
            .loader()
            .reserve_script(
                "cancelled",
                &file_url_from_path(&generated.to_string_lossy()),
                &file_url_from_path(&map.to_string_lossy()),
            )
            .expect("reservation");
        fs::remove_file(&generated).expect("invalidate generated authority");

        assert!(
            prepare_source_map_request_if_allowed(request, &|| false).is_none(),
            "revoked jobs must not enter descriptor validation or parsing"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn worker_panic_settles_pending_receipt_and_does_not_block_following_action() {
        static NEXT: AtomicU64 = AtomicU64::new(10_000);
        let root = std::env::temp_dir().join(format!(
            "codevo-panicking-map-job-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("root");
        let root = root.canonicalize().expect("canonical root");
        let generated = root.join("dist/app.js");
        let map = root.join("dist/app.map");
        let source = root.join("src/app.ts");
        fs::create_dir_all(generated.parent().expect("dist")).expect("dist");
        fs::create_dir_all(source.parent().expect("src")).expect("src");
        fs::write(&generated, "compiled();\n").expect("generated");
        fs::write(&source, "source();\n").expect("source");
        fs::write(
            &map,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        )
        .expect("map");
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let map_url = file_url_from_path(&map.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        let first = registry
            .loader()
            .reserve_script("first", &generated_url, &map_url)
            .expect("first reservation")
            .settlement();
        registry.mark_pending(first.clone()).expect("first pending");
        let shared = Arc::new(Mutex::new(crate::debug_cdp::cdp_shared_for_test(Some(
            registry,
        ))));

        let panic_shared = Arc::clone(&shared);
        run_guarded_source_map_action(&shared, first.clone(), move || {
            let _state = panic_shared.lock().expect("panic lock");
            panic!("injected source-map worker panic")
        });

        assert!(first.wait_until(std::time::Instant::now()));
        assert!(shared
            .lock()
            .expect("shared after recovered panic")
            .source_maps
            .as_ref()
            .expect("source maps")
            .pending_settlement("first", &generated_url)
            .is_none());

        let second = {
            let mut shared_state = shared.lock().expect("shared");
            let source_maps = shared_state.source_maps.as_mut().expect("source maps");
            let settlement = source_maps
                .loader()
                .reserve_script("second", &generated_url, &map_url)
                .expect("second reservation")
                .settlement();
            source_maps
                .mark_pending(settlement.clone())
                .expect("second pending");
            settlement
        };
        let following_executed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let following_flag = Arc::clone(&following_executed);
        let following_shared = Arc::clone(&shared);
        let following_settlement = second.clone();
        run_guarded_source_map_action(&shared, second.clone(), move || {
            following_flag.store(true, std::sync::atomic::Ordering::Release);
            following_shared
                .lock()
                .expect("following shared")
                .source_maps
                .as_mut()
                .expect("source maps")
                .settle_failed_preparation(following_settlement);
        });
        assert!(following_executed.load(std::sync::atomic::Ordering::Acquire));
        assert!(second.wait_until(std::time::Instant::now()));
        let _ = fs::remove_dir_all(root);
    }
}
