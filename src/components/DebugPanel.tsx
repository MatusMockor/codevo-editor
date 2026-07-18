import {
  ArrowDownToDot,
  ArrowUpFromDot,
  Pause,
  Play,
  Square,
  StepForward,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  Breakpoint,
  DebugScope,
  DebugVariable,
  StackFrame,
  StepKind,
} from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugOutputLine } from "../application/useDebugSession";
import { workspaceRelativePath } from "../domain/pathDerivation";

export interface DebugPanelProps {
  breakpoints: Breakpoint[];
  evaluationHistory: string[];
  lastStartError: string | null;
  onLoadVariables(variablesReference: number): void;
  onEvaluate(expression: string): Promise<DebugVariable | null>;
  onNavigateToBreakpoint(breakpoint: Breakpoint): void;
  onNavigateToFrame(filePath: string, lineNumber: number): void;
  onPause(): void;
  onRemoveBreakpoint(id: string): void;
  onSelectFrame(frameId: number): void;
  onSetBreakpointCondition(id: string, condition: string | null): void;
  onSetBreakpointEnabled(id: string, enabled: boolean): void;
  onStep(kind: StepKind): void;
  onStop(): void;
  output: DebugOutputLine[];
  rootPath: string | null;
  scopes: DebugScope[];
  selectedFrameId: number | null;
  snapshot: DebuggerSessionSnapshot;
  variablesByReference: Record<number, DebugVariable[]>;
  workspaceTrusted: boolean;
}

interface DebugConsoleEvaluation {
  expression: string;
  result: DebugVariable | null;
  error: string | null;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    padding: 2,
  },
  breakpointRow: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 6,
    padding: "3px 8px",
  },
  column: {
    borderRight: "1px solid var(--border-subtle)",
    minHeight: 0,
    overflow: "auto",
  },
  columnTitle: {
    borderBottom: "1px solid var(--border-subtle)",
    display: "block",
    padding: "4px 8px",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    minHeight: 0,
  },
  conditionInput: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    flex: 1,
    fontSize: 11,
    minWidth: 0,
    padding: "1px 4px",
  },
  console: {
    borderTop: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  consoleBody: {
    flex: 1,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    overflow: "auto",
    padding: "4px 8px",
  },
  consoleInput: {
    background: "transparent",
    border: 0,
    borderTop: "1px solid var(--border-subtle)",
    boxSizing: "border-box",
    color: "inherit",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    outline: "none",
    padding: "5px 8px",
    width: "100%",
  },
  frame: {
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "block",
    overflow: "hidden",
    padding: "3px 8px",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  },
  frameActive: {
    background: "var(--background-active, rgba(127, 127, 127, 0.2))",
  },
  location: {
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    overflow: "hidden",
    padding: 0,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { color: "var(--text-muted)", padding: 8 },
  muted: { color: "var(--text-muted)" },
  outputLine: { whiteSpace: "pre-wrap" },
  panel: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) minmax(0, 35%)",
    height: "100%",
  },
  stderr: { color: "var(--status-error, #ef4444)" },
  toolbar: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 6,
    padding: "4px 8px",
  },
  variableRow: {
    overflow: "hidden",
    padding: "2px 8px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

export function DebugPanel({
  breakpoints,
  evaluationHistory,
  lastStartError,
  onLoadVariables,
  onEvaluate,
  onNavigateToBreakpoint,
  onNavigateToFrame,
  onPause,
  onRemoveBreakpoint,
  onSelectFrame,
  onSetBreakpointCondition,
  onSetBreakpointEnabled,
  onStep,
  onStop,
  output,
  rootPath,
  scopes,
  selectedFrameId,
  snapshot,
  variablesByReference,
  workspaceTrusted,
}: DebugPanelProps) {
  const state = snapshot.state;
  const stopped = state.kind === "stopped";
  const running = state.kind === "running";

  return (
    <div aria-label="Debug" role="tabpanel" style={styles.panel}>
      <div style={styles.toolbar}>
        <ToolbarButton
          disabled={!stopped}
          label="Continue"
          onClick={() => onStep("continue")}
        >
          <Play aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton disabled={!running} label="Pause" onClick={onPause}>
          <Pause aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!stopped}
          label="Step over"
          onClick={() => onStep("stepOver")}
        >
          <StepForward aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!stopped}
          label="Step into"
          onClick={() => onStep("stepInto")}
        >
          <ArrowDownToDot aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!stopped}
          label="Step out"
          onClick={() => onStep("stepOut")}
        >
          <ArrowUpFromDot aria-hidden="true" size={14} />
        </ToolbarButton>
        <ToolbarButton
          disabled={!running && !stopped && state.kind !== "starting"}
          label="Stop debugging"
          onClick={onStop}
        >
          <Square aria-hidden="true" size={14} />
        </ToolbarButton>
        <span data-testid="debug-status" style={styles.muted}>
          {debuggerStatusLabel(snapshot)}
        </span>
        {lastStartError ? (
          <span role="alert" style={styles.stderr}>
            {lastStartError}
          </span>
        ) : null}
      </div>
      <div style={styles.columns}>
        <section aria-label="Call Stack" style={styles.column}>
          <strong style={styles.columnTitle}>Call Stack</strong>
          <CallStack
            onNavigateToFrame={onNavigateToFrame}
            onSelectFrame={onSelectFrame}
            rootPath={rootPath}
            selectedFrameId={selectedFrameId}
            snapshot={snapshot}
          />
        </section>
        <section aria-label="Variables" style={styles.column}>
          <strong style={styles.columnTitle}>Variables</strong>
          <Variables
            onLoadVariables={onLoadVariables}
            scopes={scopes}
            stopped={stopped}
            variablesByReference={variablesByReference}
          />
        </section>
        <section
          aria-label="Breakpoints"
          style={{ ...styles.column, borderRight: 0 }}
        >
          <strong style={styles.columnTitle}>Breakpoints</strong>
          <Breakpoints
            breakpoints={breakpoints}
            onNavigateToBreakpoint={onNavigateToBreakpoint}
            onRemoveBreakpoint={onRemoveBreakpoint}
            onSetBreakpointCondition={onSetBreakpointCondition}
            onSetBreakpointEnabled={onSetBreakpointEnabled}
            rootPath={rootPath}
          />
        </section>
      </div>
      <section aria-label="Debug console" style={styles.console}>
        <strong style={styles.columnTitle}>Console</strong>
        <DebugConsole
          enabled={stopped && workspaceTrusted}
          history={evaluationHistory}
          onEvaluate={onEvaluate}
          output={output}
          rootPath={rootPath}
          sessionId={state.kind === "inactive" ? null : state.sessionId}
        />
      </section>
    </div>
  );
}

function ToolbarButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={styles.action}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function debuggerStatusLabel(snapshot: DebuggerSessionSnapshot): string {
  const state = snapshot.state;

  if (state.kind === "starting") {
    return "Starting";
  }

  if (state.kind === "running") {
    return "Running";
  }

  if (state.kind === "stopped") {
    return `Paused (${state.reason})`;
  }

  if (state.kind === "terminated") {
    if (state.exitCode === null) {
      return "Terminated";
    }

    return `Terminated (exit code ${state.exitCode})`;
  }

  return "Inactive";
}

function displayPath(rootPath: string | null, filePath: string): string {
  if (!rootPath) {
    return filePath;
  }

  return workspaceRelativePath(rootPath, filePath) ?? filePath;
}

function CallStack({
  onNavigateToFrame,
  onSelectFrame,
  rootPath,
  selectedFrameId,
  snapshot,
}: {
  onNavigateToFrame(filePath: string, lineNumber: number): void;
  onSelectFrame(frameId: number): void;
  rootPath: string | null;
  selectedFrameId: number | null;
  snapshot: DebuggerSessionSnapshot;
}) {
  const state = snapshot.state;

  if (state.kind !== "stopped") {
    return <div style={styles.message}>Not paused</div>;
  }

  const highlightedFrameId = selectedFrameId ?? state.topFrame?.frameId ?? null;

  return (
    <div>
      {state.frames.map((frame) => (
        <button
          aria-current={
            frame.frameId === highlightedFrameId ? "true" : undefined
          }
          data-testid="debug-frame"
          key={frame.frameId}
          onClick={() => activateFrame(frame, onSelectFrame, onNavigateToFrame)}
          style={
            frame.frameId === highlightedFrameId
              ? { ...styles.frame, ...styles.frameActive }
              : styles.frame
          }
          type="button"
        >
          {frame.name}{" "}
          <span style={styles.muted}>
            {frame.filePath
              ? `${displayPath(rootPath, frame.filePath)}:${frame.lineNumber}`
              : `line ${frame.lineNumber}`}
          </span>
        </button>
      ))}
    </div>
  );
}

function activateFrame(
  frame: StackFrame,
  onSelectFrame: (frameId: number) => void,
  onNavigateToFrame: (filePath: string, lineNumber: number) => void,
) {
  onSelectFrame(frame.frameId);

  if (frame.filePath === null) {
    return;
  }

  onNavigateToFrame(frame.filePath, frame.lineNumber);
}

function Variables({
  onLoadVariables,
  scopes,
  stopped,
  variablesByReference,
}: {
  onLoadVariables(variablesReference: number): void;
  scopes: DebugScope[];
  stopped: boolean;
  variablesByReference: Record<number, DebugVariable[]>;
}) {
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(
    new Set(),
  );

  if (!stopped) {
    return <div style={styles.message}>Not paused</div>;
  }

  if (scopes.length === 0) {
    return (
      <div style={styles.message}>Select a frame to inspect variables</div>
    );
  }

  const toggleReference = (variablesReference: number) => {
    setExpandedReferences((current) => {
      const next = new Set(current);

      if (next.has(variablesReference)) {
        next.delete(variablesReference);
        return next;
      }

      next.add(variablesReference);
      return next;
    });

    if (expandedReferences.has(variablesReference)) {
      return;
    }

    if (variablesByReference[variablesReference]) {
      return;
    }

    onLoadVariables(variablesReference);
  };

  return (
    <div>
      {scopes.map((scope) => (
        <div key={scope.variablesReference}>
          <button
            aria-expanded={expandedReferences.has(scope.variablesReference)}
            data-testid="debug-scope"
            onClick={() => toggleReference(scope.variablesReference)}
            style={styles.frame}
            type="button"
          >
            {expandedReferences.has(scope.variablesReference) ? "▾ " : "▸ "}
            {scope.name}
          </button>
          {expandedReferences.has(scope.variablesReference) ? (
            <VariableList
              ancestors={new Set([scope.variablesReference])}
              depth={1}
              expandedReferences={expandedReferences}
              onToggleReference={toggleReference}
              variables={variablesByReference[scope.variablesReference] ?? []}
              variablesByReference={variablesByReference}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

const MAX_VARIABLE_DEPTH = 10;

function VariableList({
  ancestors,
  depth,
  expandedReferences,
  onToggleReference,
  variables,
  variablesByReference,
}: {
  ancestors: ReadonlySet<number>;
  depth: number;
  expandedReferences: Set<number>;
  onToggleReference(variablesReference: number): void;
  variables: DebugVariable[];
  variablesByReference: Record<number, DebugVariable[]>;
}) {
  return (
    <div>
      {variables.map((variable) => {
        const expandable =
          variable.variablesReference > 0 &&
          !ancestors.has(variable.variablesReference) &&
          depth < MAX_VARIABLE_DEPTH;

        return (
          <div key={`${variable.name}:${variable.variablesReference}`}>
            <div
              data-testid="debug-variable"
              style={{ ...styles.variableRow, paddingLeft: 8 + depth * 12 }}
            >
              {expandable ? (
                <button
                  aria-expanded={expandedReferences.has(
                    variable.variablesReference,
                  )}
                  aria-label={`Expand ${variable.name}`}
                  onClick={() => onToggleReference(variable.variablesReference)}
                  style={styles.action}
                  type="button"
                >
                  {expandedReferences.has(variable.variablesReference)
                    ? "▾"
                    : "▸"}
                </button>
              ) : null}
              {variable.name}
              <span style={styles.muted}>
                {" = "}
                {variable.value}
                {variable.type ? ` (${variable.type})` : ""}
              </span>
            </div>
            {expandable &&
            expandedReferences.has(variable.variablesReference) ? (
              <VariableList
                ancestors={new Set([...ancestors, variable.variablesReference])}
                depth={depth + 1}
                expandedReferences={expandedReferences}
                onToggleReference={onToggleReference}
                variables={
                  variablesByReference[variable.variablesReference] ?? []
                }
                variablesByReference={variablesByReference}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Breakpoints({
  breakpoints,
  onNavigateToBreakpoint,
  onRemoveBreakpoint,
  onSetBreakpointCondition,
  onSetBreakpointEnabled,
  rootPath,
}: {
  breakpoints: Breakpoint[];
  onNavigateToBreakpoint(breakpoint: Breakpoint): void;
  onRemoveBreakpoint(id: string): void;
  onSetBreakpointCondition(id: string, condition: string | null): void;
  onSetBreakpointEnabled(id: string, enabled: boolean): void;
  rootPath: string | null;
}) {
  if (breakpoints.length === 0) {
    return <div style={styles.message}>No breakpoints</div>;
  }

  return (
    <div>
      {breakpoints.map((breakpoint) => (
        <div
          data-testid="debug-breakpoint"
          key={breakpoint.id}
          style={styles.breakpointRow}
        >
          <input
            aria-label={`Enable breakpoint ${breakpoint.filePath}:${breakpoint.lineNumber}`}
            checked={breakpoint.enabled}
            onChange={(event) =>
              onSetBreakpointEnabled(breakpoint.id, event.target.checked)
            }
            type="checkbox"
          />
          <button
            data-testid="debug-breakpoint-location"
            onClick={() => onNavigateToBreakpoint(breakpoint)}
            style={styles.location}
            title={`${breakpoint.filePath}:${breakpoint.lineNumber}`}
            type="button"
          >
            {displayPath(rootPath, breakpoint.filePath)}:{breakpoint.lineNumber}
            {breakpoint.verified === false ? (
              <span style={styles.muted}> (unverified)</span>
            ) : null}
          </button>
          <BreakpointConditionInput
            breakpoint={breakpoint}
            key={`${breakpoint.id}:${breakpoint.condition ?? ""}`}
            onSetBreakpointCondition={onSetBreakpointCondition}
          />
          <button
            aria-label="Remove breakpoint"
            onClick={() => onRemoveBreakpoint(breakpoint.id)}
            style={styles.action}
            type="button"
          >
            <X aria-hidden="true" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function BreakpointConditionInput({
  breakpoint,
  onSetBreakpointCondition,
}: {
  breakpoint: Breakpoint;
  onSetBreakpointCondition(id: string, condition: string | null): void;
}) {
  const [value, setValue] = useState(breakpoint.condition ?? "");

  const commit = () => {
    const trimmed = value.trim();
    const condition = trimmed === "" ? null : trimmed;

    if (condition === (breakpoint.condition ?? null)) {
      return;
    }

    onSetBreakpointCondition(breakpoint.id, condition);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    commit();
  };

  return (
    <input
      aria-label="Condition"
      onBlur={commit}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Condition"
      style={styles.conditionInput}
      value={value}
    />
  );
}

const SCROLL_BOTTOM_TOLERANCE = 4;

function DebugConsole({
  enabled,
  history,
  onEvaluate,
  output,
  rootPath,
  sessionId,
}: {
  enabled: boolean;
  history: string[];
  onEvaluate(expression: string): Promise<DebugVariable | null>;
  output: DebugOutputLine[];
  rootPath: string | null;
  sessionId: number | null;
}) {
  const sessionKey = `${rootPath ?? ""}\0${sessionId ?? "inactive"}`;
  const evaluationsRef = useRef(new Map<string, DebugConsoleEvaluation[]>());
  const [expression, setExpression] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [, setRevision] = useState(0);
  const evaluations = evaluationsRef.current.get(sessionKey) ?? [];

  useEffect(() => {
    setExpression("");
    setHistoryIndex(null);
  }, [sessionKey]);

  const submit = async () => {
    const candidate = expression.trim();

    if (!enabled || candidate === "") {
      return;
    }

    const submittedKey = sessionKey;
    setExpression("");
    setHistoryIndex(null);

    let evaluation: DebugConsoleEvaluation;

    try {
      const result = await onEvaluate(candidate);

      if (!result) {
        return;
      }

      evaluation = { error: null, expression: candidate, result };
    } catch (error) {
      evaluation = {
        error: error instanceof Error ? error.message : String(error),
        expression: candidate,
        result: null,
      };
    }

    const current = evaluationsRef.current.get(submittedKey) ?? [];
    evaluationsRef.current.set(
      submittedKey,
      [...current, evaluation].slice(-500),
    );
    setRevision((value) => value + 1);
  };

  const navigateHistory = (direction: -1 | 1) => {
    if (history.length === 0) {
      return;
    }

    if (direction === -1 && (historyIndex === null || historyIndex === 0)) {
      setHistoryIndex(null);
      setExpression("");
      return;
    }

    const nextIndex = Math.max(
      0,
      Math.min(history.length - 1, (historyIndex ?? -1) + direction),
    );
    setHistoryIndex(nextIndex);
    setExpression(history[nextIndex] ?? "");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setExpression("");
      setHistoryIndex(null);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateHistory(1);
      return;
    }

    if (event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    navigateHistory(-1);
  };

  return (
    <>
      <ConsoleOutput evaluations={evaluations} output={output} />
      <input
        aria-label="Debug expression"
        disabled={!enabled}
        onChange={(event) => setExpression(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={enabled ? "Evaluate expression" : "Pause to evaluate"}
        style={styles.consoleInput}
        value={expression}
      />
    </>
  );
}

function ConsoleOutput({
  evaluations,
  output,
}: {
  evaluations: DebugConsoleEvaluation[];
  output: DebugOutputLine[];
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const body = bodyRef.current;

    if (!body) {
      return;
    }

    if (!stickToBottomRef.current) {
      return;
    }

    body.scrollTop = body.scrollHeight;
  }, [evaluations, output]);

  const handleScroll = () => {
    const body = bodyRef.current;

    if (!body) {
      return;
    }

    stickToBottomRef.current =
      body.scrollTop + body.clientHeight >=
      body.scrollHeight - SCROLL_BOTTOM_TOLERANCE;
  };

  if (output.length === 0 && evaluations.length === 0) {
    return (
      <div
        data-testid="debug-console-body"
        onScroll={handleScroll}
        ref={bodyRef}
        style={styles.consoleBody}
      >
        <span data-testid="debug-output-empty" style={styles.muted}>
          No output
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="debug-console-body"
      onScroll={handleScroll}
      ref={bodyRef}
      style={styles.consoleBody}
    >
      {output.map((line, index) => (
        <div
          data-stream={line.stream}
          data-testid="debug-output-line"
          key={index}
          style={
            line.stream === "stderr"
              ? { ...styles.outputLine, ...styles.stderr }
              : styles.outputLine
          }
        >
          {line.text}
        </div>
      ))}
      {evaluations.map((evaluation, index) => (
        <div
          data-testid="debug-evaluation"
          key={`${evaluation.expression}:${index}`}
        >
          <div style={styles.outputLine}>{`> ${evaluation.expression}`}</div>
          <div style={evaluation.error ? styles.stderr : styles.outputLine}>
            {evaluation.error ?? formatEvaluationResult(evaluation.result)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatEvaluationResult(result: DebugVariable | null): string {
  if (!result) {
    return "No result";
  }

  return result.type ? `${result.value} (${result.type})` : result.value;
}
