import { ClipboardCopy, FileText, RotateCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canRestartRuntime,
  canStopRuntime,
  formatRuntimeCpu,
  formatRuntimeLatency,
  formatRuntimeMemory,
  formatRuntimeDebugBundle,
  runtimeLifecycleLabel,
  runtimeLifecycleTone,
  type LanguageRuntimeKind,
  type RecentLspRequest,
  type RuntimeObservability,
  type RuntimeObservabilityGateway,
} from "../domain/runtimeObservability";
import {
  latencyMetricRows,
  type LatencyMetricRow,
} from "../domain/latencyMetricsView";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const REFRESH_INTERVAL_MS = 2000;

interface RuntimeObservabilityPanelProps {
  gateway: RuntimeObservabilityGateway;
  isActive: boolean;
  rootPath: string | null;
  mode?: string;
  /**
   * Pulls a fresh snapshot of recorded operation latencies (quick open, search
   * everywhere, go-to-definition, completion, folder expand). Polled on the same
   * refresh interval as the runtime stats. Optional: when omitted the panel
   * renders no latency section.
   */
  getLatencySnapshot?(): LatencySnapshotEntry[];
}

export function RuntimeObservabilityPanel({
  gateway,
  isActive,
  rootPath,
  mode = "unknown",
  getLatencySnapshot,
}: RuntimeObservabilityPanelProps) {
  const [runtimes, setRuntimes] = useState<RuntimeObservability[]>([]);
  const [latencyRows, setLatencyRows] = useState<LatencyMetricRow[]>([]);
  const requestedRootRef = useRef<string | null>(rootPath);

  // Keep the synchronous "current active root" mirror in sync. Read inside the
  // async `.then` callbacks below to drop a stale report once the active project
  // tab changed mid-request (per-project isolation).
  useEffect(() => {
    requestedRootRef.current = rootPath;
  }, [rootPath]);

  const refresh = useCallback(() => {
    const requestedRoot = rootPath;

    if (!requestedRoot) {
      setRuntimes([]);
      return;
    }

    gateway
      .getObservability(requestedRoot)
      .then((report) => {
        // Re-check the active root after the await: drop a stale report whose
        // root no longer matches the panel's current workspace tab, so metrics
        // never leak between open projects.
        if (
          !workspaceRootKeysEqual(requestedRootRef.current ?? "", requestedRoot)
        ) {
          return;
        }

        setRuntimes(report.runtimes);
      })
      .catch(() => {
        if (
          !workspaceRootKeysEqual(requestedRootRef.current ?? "", requestedRoot)
        ) {
          return;
        }

        setRuntimes([]);
      });
  }, [gateway, rootPath]);

  useEffect(() => {
    if (!isActive || !rootPath) {
      setRuntimes([]);
      return;
    }

    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    gateway.subscribeStatus(refresh).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }

      unsubscribe = dispose;
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribe?.();
    };
  }, [gateway, isActive, refresh, rootPath]);

  // Poll the in-app latency tracker on the same cadence as the runtime stats.
  // The tracker is mutated imperatively on the hot path (no React state to
  // subscribe to), so a lightweight interval read keeps the panel current
  // without adding any cost to the measured operations themselves.
  useEffect(() => {
    if (!isActive || !getLatencySnapshot) {
      setLatencyRows([]);
      return;
    }

    const pull = () => setLatencyRows(latencyMetricRows(getLatencySnapshot()));

    pull();
    const interval = window.setInterval(pull, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [getLatencySnapshot, isActive]);

  const onRestart = useCallback(
    (kind: LanguageRuntimeKind) => {
      const requestedRoot = rootPath;

      if (!requestedRoot) {
        return;
      }

      gateway
        .restart(requestedRoot, kind)
        .then(refresh)
        .catch(() => undefined);
    },
    [gateway, refresh, rootPath],
  );

  const onStop = useCallback(
    (kind: LanguageRuntimeKind) => {
      const requestedRoot = rootPath;

      if (!requestedRoot) {
        return;
      }

      gateway
        .stop(requestedRoot, kind)
        .then(refresh)
        .catch(() => undefined);
    },
    [gateway, refresh, rootPath],
  );

  const onOpenLog = useCallback(
    (kind: LanguageRuntimeKind) => {
      const requestedRoot = rootPath;

      if (!requestedRoot) {
        return;
      }

      gateway.openLog(requestedRoot, kind).catch(() => undefined);
    },
    [gateway, rootPath],
  );

  // Format the bundle from the latest in-panel snapshot for the active root, so
  // the copied report only ever reflects the current project tab's runtimes.
  const onCopyBundle = useCallback(() => {
    const requestedRoot = rootPath;

    if (!requestedRoot) {
      return;
    }

    const bundle = formatRuntimeDebugBundle(
      { rootPath: requestedRoot, runtimes },
      mode,
    );
    gateway.copyToClipboard(bundle).catch(() => undefined);
  }, [gateway, mode, rootPath, runtimes]);

  return (
    <div
      aria-label="Runtime"
      className="runtime-observability-panel"
      hidden={!isActive}
      role="tabpanel"
    >
      {rootPath ? (
        <section
          aria-label="Language runtimes"
          className="runtime-observability-list"
        >
          {runtimes.length === 0 ? (
            <p className="runtime-observability-empty">
              No managed language runtimes for this project yet.
            </p>
          ) : (
            <>
              <div className="runtime-observability-toolbar">
                <button
                  aria-label="Copy debug bundle"
                  className="runtime-observability-copy-bundle"
                  onClick={onCopyBundle}
                  type="button"
                >
                  <ClipboardCopy aria-hidden="true" size={14} />
                  Copy debug bundle
                </button>
              </div>
              {runtimes.map((runtime) => (
                <RuntimeRow
                  key={runtime.kind}
                  onOpenLog={onOpenLog}
                  onRestart={onRestart}
                  onStop={onStop}
                  runtime={runtime}
                />
              ))}
            </>
          )}
        </section>
      ) : (
        <p className="runtime-observability-empty">
          Open a project to inspect its language runtimes.
        </p>
      )}

      {getLatencySnapshot ? (
        <section
          aria-label="Operation latency"
          className="runtime-observability-latency"
        >
          <h3 className="runtime-observability-latency-title">
            Operation latency
          </h3>
          {latencyRows.length === 0 ? (
            <p className="runtime-observability-empty">
              No operations measured yet. Use quick open, search everywhere,
              go-to-definition, completion, or expand a folder to record
              latencies.
            </p>
          ) : (
            <table className="runtime-observability-latency-table">
              <thead>
                <tr>
                  <th scope="col">Operation</th>
                  <th scope="col">Median</th>
                  <th scope="col">p95</th>
                  <th scope="col">Last</th>
                  <th scope="col">N</th>
                </tr>
              </thead>
              <tbody>
                {latencyRows.map((row) => (
                  <LatencyRow key={row.kind} row={row} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  );
}

interface LatencyRowProps {
  row: LatencyMetricRow;
}

function LatencyRow({ row }: LatencyRowProps) {
  return (
    <tr
      className="runtime-observability-latency-row"
      data-testid={`latency-row-${row.kind}`}
      data-tone={row.tone}
    >
      <th scope="row">
        <span
          aria-hidden="true"
          className={`runtime-observability-indicator ${row.tone}`}
        />
        {row.label}
      </th>
      <td>{row.medianText}</td>
      <td>{row.p95Text}</td>
      <td>{row.lastText}</td>
      <td>{row.count}</td>
    </tr>
  );
}

interface RuntimeRowProps {
  onOpenLog(kind: LanguageRuntimeKind): void;
  onRestart(kind: LanguageRuntimeKind): void;
  onStop(kind: LanguageRuntimeKind): void;
  runtime: RuntimeObservability;
}

function RuntimeRow({ onOpenLog, onRestart, onStop, runtime }: RuntimeRowProps) {
  const tone = runtimeLifecycleTone(runtime.lifecycle);

  return (
    <article className="runtime-observability-row">
      <header className="runtime-observability-row-header">
        <span
          aria-hidden="true"
          className={`runtime-observability-indicator ${tone}`}
          data-testid={`runtime-indicator-${runtime.kind}`}
          data-tone={tone}
        />
        <strong className="runtime-observability-name">{runtime.label}</strong>
        <span className="runtime-observability-state">
          {runtimeLifecycleLabel(runtime.lifecycle)}
        </span>
      </header>

      <dl className="runtime-observability-metrics">
        <Metric label="PID" value={runtime.pid ? String(runtime.pid) : "-"} />
        <Metric label="RAM" value={formatRuntimeMemory(runtime.stats?.memoryKb)} />
        <Metric label="CPU" value={formatRuntimeCpu(runtime.stats?.cpuPercent)} />
      </dl>

      {runtime.crashReason ? (
        <p className="runtime-observability-crash" title={runtime.crashReason}>
          {runtime.crashReason}
        </p>
      ) : null}

      <RecentRequestsTable requests={runtime.recentRequests ?? []} />

      <StderrTail lines={runtime.stderrTail ?? []} />

      <div className="runtime-observability-actions">
        <button
          aria-label={`Restart ${runtime.label}`}
          disabled={!canRestartRuntime(runtime.lifecycle)}
          onClick={() => onRestart(runtime.kind)}
          type="button"
        >
          <RotateCw aria-hidden="true" size={14} />
          Restart
        </button>
        <button
          aria-label={`Stop ${runtime.label}`}
          disabled={!canStopRuntime(runtime.lifecycle)}
          onClick={() => onStop(runtime.kind)}
          type="button"
        >
          <Square aria-hidden="true" size={14} />
          Stop
        </button>
        {runtime.kind === "tsserver" ? (
          <button
            aria-label={`Open ${runtime.label} log`}
            onClick={() => onOpenLog(runtime.kind)}
            type="button"
          >
            <FileText aria-hidden="true" size={14} />
            Log
          </button>
        ) : null}
      </div>
    </article>
  );
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="runtime-observability-metric">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

interface RecentRequestsTableProps {
  requests: RecentLspRequest[];
}

function RecentRequestsTable({ requests }: RecentRequestsTableProps) {
  if (requests.length === 0) {
    return null;
  }

  return (
    <section className="runtime-observability-requests">
      <h4 className="runtime-observability-section-title">Recent LSP requests</h4>
      <table className="runtime-observability-requests-table">
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Latency</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request, index) => (
            <tr
              className={
                request.success
                  ? "runtime-observability-request-ok"
                  : "runtime-observability-request-error"
              }
              key={`${request.method}-${index}`}
            >
              <td title={request.method}>{request.method}</td>
              <td>{formatRuntimeLatency(request.latencyMs)}</td>
              <td>{request.success ? "ok" : "error"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface StderrTailProps {
  lines: string[];
}

function StderrTail({ lines }: StderrTailProps) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <section className="runtime-observability-stderr">
      <h4 className="runtime-observability-section-title">Stderr</h4>
      <pre className="runtime-observability-stderr-tail">
        {lines.join("\n")}
      </pre>
    </section>
  );
}
