import { FileText, RotateCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canRestartRuntime,
  canStopRuntime,
  formatRuntimeCpu,
  formatRuntimeMemory,
  runtimeLifecycleLabel,
  runtimeLifecycleTone,
  type LanguageRuntimeKind,
  type RuntimeObservability,
  type RuntimeObservabilityGateway,
} from "../domain/runtimeObservability";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const REFRESH_INTERVAL_MS = 2000;

interface RuntimeObservabilityPanelProps {
  gateway: RuntimeObservabilityGateway;
  isActive: boolean;
  rootPath: string | null;
}

export function RuntimeObservabilityPanel({
  gateway,
  isActive,
  rootPath,
}: RuntimeObservabilityPanelProps) {
  const [runtimes, setRuntimes] = useState<RuntimeObservability[]>([]);
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
            runtimes.map((runtime) => (
              <RuntimeRow
                key={runtime.kind}
                onOpenLog={onOpenLog}
                onRestart={onRestart}
                onStop={onStop}
                runtime={runtime}
              />
            ))
          )}
        </section>
      ) : (
        <p className="runtime-observability-empty">
          Open a project to inspect its language runtimes.
        </p>
      )}
    </div>
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
