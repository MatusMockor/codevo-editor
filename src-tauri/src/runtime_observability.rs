//! Per-workspace runtime observability for the managed language servers.
//!
//! Surfaces, for a single active workspace root, the live runtime state of every
//! managed language runtime (phpactor + tsserver): its PID, lifecycle state,
//! sampled RAM/CPU, and the last crash reason. The data feeds the Runtime
//! Observability panel so debugging shows the real runtime state instead of
//! guesses.
//!
//! Isolation: every query is scoped to one requested root. The caller resolves
//! the active root up front and re-checks it after any await before mutating
//! shared UI state, so metrics never leak between open project tabs.

use crate::lsp_session::{LanguageServerRuntimeStatus, RecentLspRequest};
use serde::Serialize;

/// The managed language runtimes a workspace can host. Kept as a small closed
/// enum so the frontend can label and target each runtime by a stable kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageRuntimeKind {
    Phpactor,
    Tsserver,
}

impl LanguageRuntimeKind {
    /// Parse a frontend-supplied kind string for the restart/stop commands.
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "phpactor" => Some(LanguageRuntimeKind::Phpactor),
            "tsserver" => Some(LanguageRuntimeKind::Tsserver),
            _ => None,
        }
    }
}

/// Coarse lifecycle state the panel renders with a colored indicator.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeLifecycle {
    Starting,
    Running,
    Stopped,
    Crashed,
}

impl RuntimeLifecycle {
    fn from_status(status: &LanguageServerRuntimeStatus) -> Self {
        match status {
            LanguageServerRuntimeStatus::Starting { .. } => RuntimeLifecycle::Starting,
            LanguageServerRuntimeStatus::Running { .. } => RuntimeLifecycle::Running,
            LanguageServerRuntimeStatus::Stopped => RuntimeLifecycle::Stopped,
            LanguageServerRuntimeStatus::Crashed { .. } => RuntimeLifecycle::Crashed,
        }
    }
}

/// Sampled OS process statistics for a running runtime. Both fields are
/// optional: sampling is best-effort and the panel degrades gracefully when the
/// platform/probe cannot provide a value.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStats {
    /// Resident set size in kilobytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_kb: Option<u64>,
    /// CPU usage percentage as reported by the OS probe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_percent: Option<f64>,
}

impl ProcessStats {
    fn is_empty(self) -> bool {
        self.memory_kb.is_none() && self.cpu_percent.is_none()
    }
}

/// One runtime's full observability snapshot for the active workspace root.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeObservability {
    pub kind: LanguageRuntimeKind,
    pub label: String,
    pub lifecycle: RuntimeLifecycle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crash_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<ProcessStats>,
    /// Most-recent LSP requests with latencies (newest first) for the diagnostic
    /// cockpit. Always present (possibly empty) so the panel can render a stable
    /// "recent requests" section.
    pub recent_requests: Vec<RecentLspRequest>,
    /// Trailing stderr lines for inline crash/stderr context (oldest-to-newest).
    pub stderr_tail: Vec<String>,
}

/// Whole-workspace observability report: one entry per managed runtime, scoped
/// to a single active root.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeObservabilityReport {
    pub root_path: String,
    pub runtimes: Vec<RuntimeObservability>,
}

/// Read-only view of a single managed runtime, decoupling the report builder
/// from the concrete language-server registries (dependency inversion: the
/// builder depends on this abstraction, not on `PhpLanguageServerRegistry`).
pub trait RuntimeStateSource {
    fn kind(&self) -> LanguageRuntimeKind;
    fn label(&self) -> String;
    fn status(&self) -> LanguageServerRuntimeStatus;
    fn pid(&self) -> Option<u32>;
    /// Recent LSP requests (newest first) for this runtime. Defaulted to empty so
    /// existing sources/tests that do not surface telemetry keep compiling.
    fn recent_requests(&self) -> Vec<RecentLspRequest> {
        Vec::new()
    }
    /// Trailing stderr lines (oldest-to-newest) for this runtime.
    fn stderr_tail(&self) -> Vec<String> {
        Vec::new()
    }
}

/// Samples OS process statistics for a PID. Abstracted so tests can inject a
/// deterministic probe and production can sample the live process without a
/// third-party crate.
pub trait ProcessStatsProbe {
    fn sample(&self, pid: u32) -> Option<ProcessStats>;
}

/// Build the observability report for one workspace root from the managed
/// runtime sources and a process-stats probe.
pub fn build_runtime_observability_report(
    root_path: &str,
    sources: &[&dyn RuntimeStateSource],
    probe: &dyn ProcessStatsProbe,
) -> RuntimeObservabilityReport {
    let runtimes = sources
        .iter()
        .map(|source| build_runtime_observability(*source, probe))
        .collect();

    RuntimeObservabilityReport {
        root_path: root_path.to_string(),
        runtimes,
    }
}

fn build_runtime_observability(
    source: &dyn RuntimeStateSource,
    probe: &dyn ProcessStatsProbe,
) -> RuntimeObservability {
    let status = source.status();
    let lifecycle = RuntimeLifecycle::from_status(&status);
    let crash_reason = crash_reason(&status);
    let pid = source.pid();
    let stats = sample_stats_when_alive(lifecycle, pid, probe);

    RuntimeObservability {
        kind: source.kind(),
        label: source.label(),
        lifecycle,
        pid,
        crash_reason,
        stats,
        recent_requests: source.recent_requests(),
        stderr_tail: source.stderr_tail(),
    }
}

fn crash_reason(status: &LanguageServerRuntimeStatus) -> Option<String> {
    let LanguageServerRuntimeStatus::Crashed { message } = status else {
        return None;
    };

    Some(message.clone())
}

/// Only sample stats for a live process with a known PID. A stopped/crashed
/// runtime has no process to measure, and an empty probe result is dropped so
/// the panel can show "unavailable" rather than a misleading zero.
fn sample_stats_when_alive(
    lifecycle: RuntimeLifecycle,
    pid: Option<u32>,
    probe: &dyn ProcessStatsProbe,
) -> Option<ProcessStats> {
    if !matches!(
        lifecycle,
        RuntimeLifecycle::Running | RuntimeLifecycle::Starting
    ) {
        return None;
    }

    let pid = pid?;
    let stats = probe.sample(pid)?;

    if stats.is_empty() {
        return None;
    }

    Some(stats)
}

/// Production process-stats probe backed by `ps -o rss=,pcpu= -p <pid>`.
///
/// We deliberately avoid pulling in the `sysinfo` crate (not a dependency) and
/// shell out to `ps`, which is available on the macOS/Linux targets this editor
/// runs on. Sampling is best-effort: any failure (missing `ps`, dead PID, parse
/// error, non-unix host) yields `None` so the panel degrades gracefully.
pub struct PsProcessStatsProbe;

impl ProcessStatsProbe for PsProcessStatsProbe {
    fn sample(&self, pid: u32) -> Option<ProcessStats> {
        #[cfg(unix)]
        {
            let output = std::process::Command::new("ps")
                .args(["-o", "rss=,pcpu=", "-p", &pid.to_string()])
                .output()
                .ok()?;

            if !output.status.success() {
                return None;
            }

            let text = String::from_utf8_lossy(&output.stdout);
            return parse_ps_rss_pcpu(&text);
        }

        #[cfg(not(unix))]
        {
            let _ = pid;
            None
        }
    }
}

/// Parse the first data line of `ps -o rss=,pcpu=` output: two whitespace
/// separated columns, resident memory in kilobytes and CPU percentage.
fn parse_ps_rss_pcpu(text: &str) -> Option<ProcessStats> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let mut columns = line.split_whitespace();
    let memory_kb = columns.next().and_then(|value| value.parse::<u64>().ok());
    let cpu_percent = columns.next().and_then(|value| value.parse::<f64>().ok());

    let stats = ProcessStats {
        memory_kb,
        cpu_percent,
    };

    if stats.is_empty() {
        return None;
    }

    Some(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp_session::LanguageServerCapabilities;
    use std::collections::HashMap;

    struct FakeSource {
        kind: LanguageRuntimeKind,
        label: String,
        status: LanguageServerRuntimeStatus,
        pid: Option<u32>,
        recent_requests: Vec<RecentLspRequest>,
        stderr_tail: Vec<String>,
    }

    impl FakeSource {
        fn new(
            kind: LanguageRuntimeKind,
            label: &str,
            status: LanguageServerRuntimeStatus,
            pid: Option<u32>,
        ) -> Self {
            Self {
                kind,
                label: label.to_string(),
                status,
                pid,
                recent_requests: Vec::new(),
                stderr_tail: Vec::new(),
            }
        }
    }

    impl RuntimeStateSource for FakeSource {
        fn kind(&self) -> LanguageRuntimeKind {
            self.kind
        }

        fn label(&self) -> String {
            self.label.clone()
        }

        fn status(&self) -> LanguageServerRuntimeStatus {
            self.status.clone()
        }

        fn pid(&self) -> Option<u32> {
            self.pid
        }

        fn recent_requests(&self) -> Vec<RecentLspRequest> {
            self.recent_requests.clone()
        }

        fn stderr_tail(&self) -> Vec<String> {
            self.stderr_tail.clone()
        }
    }

    struct MapProbe {
        samples: HashMap<u32, ProcessStats>,
    }

    impl ProcessStatsProbe for MapProbe {
        fn sample(&self, pid: u32) -> Option<ProcessStats> {
            self.samples.get(&pid).copied()
        }
    }

    fn running_status() -> LanguageServerRuntimeStatus {
        LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities::default(),
        }
    }

    #[test]
    fn report_collects_pid_status_and_stats_per_runtime() {
        let php = FakeSource::new(
            LanguageRuntimeKind::Phpactor,
            "PHPactor",
            running_status(),
            Some(4242),
        );
        let ts = FakeSource::new(
            LanguageRuntimeKind::Tsserver,
            "TypeScript language server",
            LanguageServerRuntimeStatus::Stopped,
            None,
        );
        let mut samples = HashMap::new();
        samples.insert(
            4242,
            ProcessStats {
                memory_kb: Some(81920),
                cpu_percent: Some(3.5),
            },
        );
        let probe = MapProbe { samples };

        let report = build_runtime_observability_report(
            "/workspace-a",
            &[&php as &dyn RuntimeStateSource, &ts],
            &probe,
        );

        assert_eq!(report.root_path, "/workspace-a");
        assert_eq!(report.runtimes.len(), 2);

        let php_runtime = &report.runtimes[0];
        assert_eq!(php_runtime.kind, LanguageRuntimeKind::Phpactor);
        assert_eq!(php_runtime.lifecycle, RuntimeLifecycle::Running);
        assert_eq!(php_runtime.pid, Some(4242));
        assert_eq!(
            php_runtime.stats,
            Some(ProcessStats {
                memory_kb: Some(81920),
                cpu_percent: Some(3.5),
            })
        );
        assert_eq!(php_runtime.crash_reason, None);

        let ts_runtime = &report.runtimes[1];
        assert_eq!(ts_runtime.kind, LanguageRuntimeKind::Tsserver);
        assert_eq!(ts_runtime.lifecycle, RuntimeLifecycle::Stopped);
        assert_eq!(ts_runtime.pid, None);
        assert_eq!(ts_runtime.stats, None);
    }

    #[test]
    fn crashed_runtime_surfaces_reason_and_skips_stats() {
        let php = FakeSource::new(
            LanguageRuntimeKind::Phpactor,
            "PHPactor",
            LanguageServerRuntimeStatus::Crashed {
                message: "phpactor exited unexpectedly.".to_string(),
            },
            Some(999),
        );
        let probe = MapProbe {
            samples: HashMap::new(),
        };

        let report =
            build_runtime_observability_report("/ws", &[&php as &dyn RuntimeStateSource], &probe);

        let runtime = &report.runtimes[0];
        assert_eq!(runtime.lifecycle, RuntimeLifecycle::Crashed);
        assert_eq!(
            runtime.crash_reason.as_deref(),
            Some("phpactor exited unexpectedly.")
        );
        assert_eq!(runtime.stats, None);
    }

    #[test]
    fn running_runtime_without_probe_value_reports_no_stats() {
        let php = FakeSource::new(
            LanguageRuntimeKind::Phpactor,
            "PHPactor",
            running_status(),
            Some(7),
        );
        let probe = MapProbe {
            samples: HashMap::new(),
        };

        let report =
            build_runtime_observability_report("/ws", &[&php as &dyn RuntimeStateSource], &probe);

        assert_eq!(report.runtimes[0].pid, Some(7));
        assert_eq!(report.runtimes[0].stats, None);
    }

    #[test]
    fn report_surfaces_recent_requests_and_stderr_tail_per_runtime() {
        let mut php = FakeSource::new(
            LanguageRuntimeKind::Phpactor,
            "PHPactor",
            LanguageServerRuntimeStatus::Crashed {
                message: "phpactor exited unexpectedly.".to_string(),
            },
            Some(4242),
        );
        php.recent_requests = vec![
            RecentLspRequest {
                method: "textDocument/completion".to_string(),
                latency_ms: 42,
                success: true,
            },
            RecentLspRequest {
                method: "textDocument/hover".to_string(),
                latency_ms: 5000,
                success: false,
            },
        ];
        php.stderr_tail = vec![
            "PHP Fatal error: ...".to_string(),
            "Stack trace:".to_string(),
        ];
        let probe = MapProbe {
            samples: HashMap::new(),
        };

        let report =
            build_runtime_observability_report("/ws", &[&php as &dyn RuntimeStateSource], &probe);

        let runtime = &report.runtimes[0];
        assert_eq!(runtime.recent_requests.len(), 2);
        assert_eq!(runtime.recent_requests[0].method, "textDocument/completion");
        assert_eq!(runtime.recent_requests[0].latency_ms, 42);
        assert!(runtime.recent_requests[0].success);
        assert_eq!(runtime.recent_requests[1].latency_ms, 5000);
        assert!(!runtime.recent_requests[1].success);
        assert_eq!(
            runtime.stderr_tail,
            vec![
                "PHP Fatal error: ...".to_string(),
                "Stack trace:".to_string()
            ]
        );
    }

    #[test]
    fn parses_ps_rss_and_pcpu_columns() {
        let stats = parse_ps_rss_pcpu(" 81920  3.5\n").expect("stats");
        assert_eq!(stats.memory_kb, Some(81920));
        assert_eq!(stats.cpu_percent, Some(3.5));
    }

    #[test]
    fn parses_ps_output_with_leading_blank_and_header_free_lines() {
        let stats = parse_ps_rss_pcpu("\n  12048   0.0\n").expect("stats");
        assert_eq!(stats.memory_kb, Some(12048));
        assert_eq!(stats.cpu_percent, Some(0.0));
    }

    #[test]
    fn empty_ps_output_yields_no_stats() {
        assert_eq!(parse_ps_rss_pcpu("\n\n"), None);
    }

    #[test]
    fn kind_round_trips_through_string() {
        assert_eq!(
            LanguageRuntimeKind::from_str("phpactor"),
            Some(LanguageRuntimeKind::Phpactor)
        );
        assert_eq!(
            LanguageRuntimeKind::from_str("tsserver"),
            Some(LanguageRuntimeKind::Tsserver)
        );
        assert_eq!(LanguageRuntimeKind::from_str("unknown"), None);
    }
}
