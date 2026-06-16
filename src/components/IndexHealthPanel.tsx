import { AlertCircle, Info, Play, RotateCw, TriangleAlert } from "lucide-react";
import type {
  IndexHealthDetail,
  IndexHealthLogEntry,
  IndexProgressState,
} from "../domain/indexProgress";

interface IndexHealthPanelProps {
  isActive: boolean;
  logs: IndexHealthLogEntry[];
  progress: IndexProgressState;
  rootPath: string | null;
  onHardReindex(): void;
  onPhpReindex(): void;
  onSoftReindex(): void;
}

export function IndexHealthPanel({
  isActive,
  logs,
  onHardReindex,
  onPhpReindex,
  onSoftReindex,
  progress,
  rootPath,
}: IndexHealthPanelProps) {
  const canReindex = Boolean(rootPath) && progress.status !== "scanning";

  return (
    <div
      aria-label="Index"
      className="index-health-panel"
      hidden={!isActive}
      role="tabpanel"
    >
      <section className="index-health-summary" aria-label="Index summary">
        <Metric label="Status" value={statusLabel(progress)} />
        <Metric label="Files" value={String(progress.indexedFiles)} />
        <Metric label="Skipped" value={String(progress.skippedEntries)} />
        <Metric label="Errors" value={String(progress.erroredEntries)} />
        <Metric label="Database" value={progress.databasePath || "Not initialized"} />
      </section>

      <section className="index-health-actions" aria-label="Index actions">
        <button disabled={!canReindex} onClick={onSoftReindex} type="button">
          <RotateCw aria-hidden="true" size={14} />
          Soft
        </button>
        <button disabled={!canReindex} onClick={onPhpReindex} type="button">
          <Play aria-hidden="true" size={14} />
          PHP
        </button>
        <button disabled={!canReindex} onClick={onHardReindex} type="button">
          <AlertCircle aria-hidden="true" size={14} />
          Hard
        </button>
      </section>

      <section className="index-health-details" aria-label="Index details">
        <DetailList
          details={progress.errorDetails}
          emptyLabel="No index errors"
          title="Errors"
        />
        <DetailList
          details={progress.skippedDetails}
          emptyLabel="No skipped paths"
          title="Skipped"
        />
        <LogList logs={logs} />
      </section>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className="index-health-metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

interface DetailListProps {
  details: IndexHealthDetail[];
  emptyLabel: string;
  title: string;
}

function DetailList({ details, emptyLabel, title }: DetailListProps) {
  return (
    <div className="index-health-list">
      <h3>{title}</h3>
      {details.length === 0 ? (
        <p>{emptyLabel}</p>
      ) : (
        details.map((detail, index) => (
          <div
            className="index-health-row"
            key={`${index}:${detail.path}:${detail.reason}`}
          >
            <TriangleAlert aria-hidden="true" size={14} />
            <span>
              <strong title={detail.path}>{detail.path}</strong>
              <small title={detail.reason}>{detail.reason}</small>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

interface LogListProps {
  logs: IndexHealthLogEntry[];
}

function LogList({ logs }: LogListProps) {
  return (
    <div className="index-health-list">
      <h3>Logs</h3>
      {logs.length === 0 ? (
        <p>No index logs</p>
      ) : (
        logs.map((log) => (
          <div className={`index-health-row ${log.severity}`} key={log.id}>
            {log.severity === "error" ? (
              <AlertCircle aria-hidden="true" size={14} />
            ) : (
              <Info aria-hidden="true" size={14} />
            )}
            <span>
              <strong>{new Date(log.timestamp).toLocaleTimeString()}</strong>
              <small title={log.message}>{log.message}</small>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function statusLabel(progress: IndexProgressState): string {
  if (progress.status === "scanning") {
    return "Scanning";
  }

  if (progress.status === "completed") {
    return "Completed";
  }

  if (progress.status === "failed") {
    return "Failed";
  }

  return "Idle";
}
