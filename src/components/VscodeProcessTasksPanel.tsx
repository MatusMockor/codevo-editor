import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import {
  MAX_VSCODE_PROCESS_TASK_RENDERED_STREAM_CODE_UNITS,
  vscodeProcessTaskIdentity,
  vscodeProcessTaskOutputStreamTail,
  type VscodeProcessTaskOutput,
} from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksState } from "../application/useVscodeProcessTasks";
import type { VscodeProcessTasksConfigurationAction } from "../application/configureVscodeProcessTasks";
import { vscodeProcessTaskDependencySummary } from "./vscodeProcessTaskDependencySummary";

export type VscodeProcessTasksPanelProps = VscodeProcessTasksState & {
  readonly className?: string;
  readonly configurationAction: VscodeProcessTasksConfigurationAction | null;
  readonly configuring: boolean;
  configure(): Promise<boolean>;
};

const styles: Record<string, CSSProperties> = {
  actions: { alignItems: "center", display: "flex", gap: 8 },
  diagnostic: { marginBlock: 4 },
  diagnostics: { margin: 0, paddingInlineStart: 20 },
  empty: { color: "var(--color-text-muted)", margin: 0, padding: 12 },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--color-border)",
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 10px",
  },
  output: {
    background: "var(--color-surface)",
    margin: 0,
    maxHeight: 180,
    overflow: "auto",
    padding: 8,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  outputGrid: { display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" },
  panel: { display: "flex", flexDirection: "column", minHeight: 0 },
  section: { borderBottom: "1px solid var(--color-border)", padding: 10 },
  task: {
    alignItems: "center",
    borderBottom: "1px solid var(--color-border)",
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    padding: "8px 10px",
  },
  taskList: { listStyle: "none", margin: 0, padding: 0 },
  taskMetadata: { display: "grid", gap: 3, minWidth: 0 },
  taskDependency: {
    color: "var(--color-text-muted)",
    overflowWrap: "anywhere",
  },
  truncation: { color: "var(--color-warning)", margin: "8px 0 0" },
};

export function VscodeProcessTasksPanel({
  activeLabel,
  className,
  configurationAction,
  configure,
  configuring,
  currentStep,
  diagnostics,
  discover,
  discovering,
  error,
  output,
  occupied,
  running,
  start,
  status,
  stop,
  stopping,
  tasks,
  truncated,
  unavailable,
}: VscodeProcessTasksPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const configurationRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const stopRef = useRef<HTMLButtonElement | null>(null);
  const busy = configuring || discovering || occupied || running || stopping;
  const statusText = taskStatusText({
    activeLabel,
    configurationAction,
    configuring,
    currentStep,
    discovering,
    error,
    running,
    status,
    stopping,
    unavailable,
  });

  useEffect(() => {
    const panel = panelRef.current;
    const activeElement = document.activeElement;
    if (!panel || !activeElement || !panel.contains(activeElement)) return;
    if (
      activeElement instanceof HTMLButtonElement &&
      activeElement.disabled &&
      activeElement.getAttribute("aria-label")?.startsWith("Run configured task ")
    ) {
      stopRef.current?.focus();
      return;
    }
    if (configuring && activeElement === configurationRef.current) {
      statusRef.current?.focus();
      return;
    }
    if (stopping && activeElement === stopRef.current) {
      statusRef.current?.focus();
      return;
    }
    if (!busy && activeElement === statusRef.current) {
      const runButton = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.getAttribute("aria-label") === `Run configured task ${activeLabel ?? ""}`,
      );
      (
        runButton ??
        configurationRef.current ??
        panel.querySelector<HTMLButtonElement>('button[aria-label="Refresh configured tasks"]')
      )?.focus();
    }
  }, [activeLabel, busy, configuring, stopping]);

  return (
    <section
      aria-busy={busy}
      aria-label="VS Code configured process tasks"
      className={className}
      ref={panelRef}
      style={styles.panel}
    >
      <header style={styles.header}>
        <strong>Configured Tasks</strong>
        <div style={styles.actions}>
          {configurationAction && (
            <button
              aria-label={
                configurationAction === "create" ? "Create tasks.json" : "Open tasks.json"
              }
              disabled={busy || unavailable !== null}
              onClick={() => void configure()}
              ref={configurationRef}
              type="button"
            >
              {configuring
                ? configurationAction === "create"
                  ? "Creating…"
                  : "Opening…"
                : configurationAction === "create"
                  ? "Create"
                  : "Open"}
            </button>
          )}
          {(occupied || running || stopping) && (
            <button
              aria-label={stopping ? "Stopping configured task" : "Stop configured task"}
              disabled={stopping}
              onClick={() => void stop()}
              ref={stopRef}
              type="button"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <button
            aria-label="Refresh configured tasks"
            disabled={busy || unavailable !== null}
            onClick={() => void discover()}
            type="button"
          >
            {discovering ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <p aria-live="polite" ref={statusRef} role="status" style={styles.section} tabIndex={-1}>
        {statusText}
      </p>

      {(error || diagnostics.length > 0 || truncated) && (
        <section aria-label="Task diagnostics" style={styles.section}>
          <strong>Diagnostics</strong>
          <ul style={styles.diagnostics}>
            {error && <li style={styles.diagnostic}>{error}</li>}
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.severity}:${index}`} style={styles.diagnostic}>
                {diagnostic.severity === "error" ? "Error" : "Warning"}: {diagnostic.message}
              </li>
            ))}
            {truncated && (
              <li style={styles.diagnostic}>
                Additional configured tasks or diagnostics were not returned.
              </li>
            )}
          </ul>
        </section>
      )}

      {tasks.length === 0 ? (
        !discovering && <p style={styles.empty}>No configured process tasks found.</p>
      ) : (
        <ul aria-label="Configured process tasks" style={styles.taskList}>
          {tasks.map((task) => {
            const dependencySummary = vscodeProcessTaskDependencySummary(task.dependsOn);
            const identity = vscodeProcessTaskIdentity(task);
            return (
              <li key={`${task.package}\u0000${task.label}`} style={styles.task}>
                <div style={styles.taskMetadata}>
                  <strong>{task.label}</strong>
                  {task.detail && <span>{task.detail}</span>}
                  {dependencySummary && (
                    <small style={styles.taskDependency}>{dependencySummary}</small>
                  )}
                  {task.problemMatcher && (
                    <small>Problem matcher: {problemMatcherLabel(task.problemMatcher)}</small>
                  )}
                  <small>
                    {task.group === "none" ? "No group" : task.group} · {task.source}
                  </small>
                </div>
                {task.executable && (
                  <button
                    aria-label={`Run configured task ${task.label}`}
                    disabled={identity === null || busy || unavailable !== null}
                    onClick={() => {
                      if (identity) void start(identity);
                    }}
                    type="button"
                  >
                    Run
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(activeLabel ||
        output.stdout.codeUnits > 0 ||
        output.stderr.codeUnits > 0 ||
        status !== null) && (
        <section aria-label="Active configured task" style={styles.section}>
          <strong>{activeLabel ?? "Configured task"}</strong>
          <div style={styles.outputGrid}>
            <OutputStream label="stdout" output={output} />
            <OutputStream label="stderr" output={output} />
          </div>
          {output.truncated && (
            <p style={styles.truncation}>Additional task output was truncated.</p>
          )}
        </section>
      )}
    </section>
  );
}

function problemMatcherLabel(matcher: "eslint" | "typescript"): string {
  return matcher === "typescript" ? "$tsc" : "$eslint-stylish";
}

const OutputStream = memo(function OutputStream({
  label,
  output,
}: {
  readonly label: "stdout" | "stderr";
  readonly output: VscodeProcessTaskOutput;
}) {
  const elementRef = useRef<HTMLPreElement | null>(null);
  const identityRef = useRef<object | null>(null);
  const renderedTextRef = useRef("");
  const stream = output[label];
  const projection = useMemo(
    () =>
      vscodeProcessTaskOutputStreamTail(stream, MAX_VSCODE_PROCESS_TASK_RENDERED_STREAM_CODE_UNITS),
    [stream],
  );
  const text = projection.text;
  const identity = output.identity ?? output;

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const existingChild = element.firstChild;
    let textNode: Text;
    if (existingChild instanceof Text) {
      textNode = existingChild;
    } else {
      textNode = document.createTextNode("");
      element.replaceChildren(textNode);
    }
    const previousText = renderedTextRef.current;
    const reset = identityRef.current !== identity || !text.startsWith(previousText);
    if (reset) {
      textNode.data = text || "No output.";
    } else if (text.length > previousText.length) {
      if (previousText.length === 0) textNode.data = "";
      textNode.appendData(text.slice(previousText.length));
    } else if (text.length === 0 && textNode.data === "") {
      textNode.data = "No output.";
    }
    identityRef.current = identity;
    renderedTextRef.current = text;
  }, [identity, text]);

  return (
    <section aria-label={`${label} stream`}>
      <small>{label}</small>
      {projection.omitted && (
        <small>Earlier {label} output is hidden to keep the task panel responsive.</small>
      )}
      <pre aria-label={`${label} output`} ref={elementRef} style={styles.output} />
    </section>
  );
});

function taskStatusText({
  activeLabel,
  configurationAction,
  configuring,
  currentStep,
  discovering,
  error,
  running,
  status,
  stopping,
  unavailable,
}: {
  readonly activeLabel: string | null;
  readonly configurationAction: VscodeProcessTasksConfigurationAction | null;
  readonly configuring: boolean;
  readonly currentStep: VscodeProcessTasksState["currentStep"];
  readonly discovering: boolean;
  readonly error: string | null;
  readonly running: boolean;
  readonly status: VscodeProcessTasksState["status"];
  readonly stopping: boolean;
  readonly unavailable: string | null;
}): string {
  if (unavailable) return unavailable;
  if (error) return error;
  if (configuring) {
    return configurationAction === "create"
      ? "Creating .vscode/tasks.json…"
      : "Opening .vscode/tasks.json…";
  }
  if (stopping) return `Stopping ${activeLabel ?? "configured task"}…`;
  if (running && currentStep) {
    return `Step ${currentStep.index} of ${currentStep.total}: ${currentStep.label}`;
  }
  if (running && status === "running") return `${activeLabel ?? "Configured task"} is running.`;
  if (running) return `Starting ${activeLabel ?? "configured task"}…`;
  if (status === "exited") return `${activeLabel ?? "Configured task"} finished.`;
  if (status === "failed") return `${activeLabel ?? "Configured task"} failed.`;
  if (status === "stopped") return `${activeLabel ?? "Configured task"} stopped.`;
  if (discovering) return "Refreshing configured tasks…";
  return "Configured tasks are ready.";
}
