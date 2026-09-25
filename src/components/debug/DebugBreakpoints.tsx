import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useCallback, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useBreakpointGroupCollapseState } from "../../application/useBreakpointGroupCollapseState";
import { useBreakpointRowFocus } from "../../application/useBreakpointRowFocus";
import type { Breakpoint, BreakpointHitCondition } from "../../domain/debug";
import {
  breakpointHitConditionError,
  formatBreakpointHitCondition,
  parseBreakpointHitCondition,
} from "../../domain/debugBreakpointHitCondition";
import {
  breakpointLogMessageError,
  isBreakpointLogMessage,
} from "../../domain/debugBreakpointLogMessage";
import {
  createBreakpointGroupRows,
  groupBreakpointsByFile,
} from "../../domain/debugBreakpointGroups";
import { isBreakpointPathSupported } from "../../domain/debugBreakpointPolicy";
import { useWindowedRows } from "../useWindowedRows";
import { breakpointLocationLabel } from "./debugLocationLabels";
import {
  BREAKPOINT_GROUP_ROW_HEIGHT,
  BREAKPOINT_ROW_HEIGHT,
  DEBUG_LIST_VIEWPORT_HEIGHT,
  DEBUG_LIST_VIRTUALIZATION_THRESHOLD,
} from "./debugListLayout";

export function DebugBreakpoints({
  breakpoints,
  onNavigateToBreakpoint,
  onRemoveBreakpoint,
  onSetBreakpointCondition,
  onSetBreakpointHitCondition,
  onSetBreakpointLogMessage,
  onSetBreakpointEnabled,
  supportsHitConditions,
  supportsLogpoints,
  rootPath,
}: {
  breakpoints: Breakpoint[];
  onNavigateToBreakpoint(breakpoint: Breakpoint): void;
  onRemoveBreakpoint(id: string): void;
  onSetBreakpointCondition(id: string, condition: string | null): void;
  onSetBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): void;
  onSetBreakpointLogMessage(id: string, logMessage: string | null): void;
  onSetBreakpointEnabled(id: string, enabled: boolean): void;
  supportsHitConditions: boolean;
  supportsLogpoints: boolean;
  rootPath: string | null;
}) {
  const groups = useMemo(
    () => groupBreakpointsByFile(breakpoints, rootPath),
    [breakpoints, rootPath],
  );
  const activeFilePaths = useMemo(() => groups.map(({ filePath }) => filePath), [groups]);
  const { collapsedFilePaths, toggle } = useBreakpointGroupCollapseState(rootPath, activeFilePaths);
  const rows = useMemo(
    () => createBreakpointGroupRows(groups, collapsedFilePaths),
    [collapsedFilePaths, groups],
  );
  const breakpointPositionById = useMemo(() => {
    const positions = new Map<string, number>();
    let position = 0;
    for (const row of rows) {
      if (row.kind === "group") {
        continue;
      }
      positions.set(row.breakpoint.id, position);
      position += 1;
    }
    return positions;
  }, [rows]);
  const rowFocus = useBreakpointRowFocus({
    collapsedFilePaths,
    rows,
    toggleGroupCollapse: toggle,
  });
  const estimateRowHeight = useCallback(
    (index: number) =>
      rows[index]?.kind === "group" ? BREAKPOINT_GROUP_ROW_HEIGHT : BREAKPOINT_ROW_HEIGHT,
    [rows],
  );
  const keyForRowIndex = useCallback((index: number) => rows[index]?.key ?? String(index), [rows]);
  const windowedRows = useWindowedRows({
    enabled: rows.length > DEBUG_LIST_VIRTUALIZATION_THRESHOLD,
    estimateHeight: estimateRowHeight,
    fallbackViewportHeight: DEBUG_LIST_VIEWPORT_HEIGHT,
    itemCount: rows.length,
    keyForIndex: keyForRowIndex,
    pinnedIndices: rowFocus.pinnedRowIndices,
    preserveScrollAnchor: true,
  });

  if (breakpoints.length === 0) {
    return <div className="cv-debug__message">No breakpoints</div>;
  }

  return (
    <div
      aria-label="Source breakpoints"
      onBlurCapture={rowFocus.handleBlur}
      onFocusCapture={rowFocus.handleFocus}
      onScroll={windowedRows.onScroll}
      ref={windowedRows.containerRef}
      role="list"
      className="cv-debug__windowed-list"
    >
      <div className="cv-debug__windowed-body" style={{ height: windowedRows.totalHeight }}>
        {windowedRows.rows.map(({ index, offsetTop }) => {
          const row = rows[index];
          if (!row) return null;
          if (row.kind === "group") {
            const collapsed = collapsedFilePaths.has(row.group.filePath);
            const breakpointNoun = row.group.count === 1 ? "breakpoint" : "breakpoints";
            const pathLabel =
              row.group.relativePath === null
                ? row.group.fileName
                : `${row.group.fileName}, ${row.group.relativePath}`;
            return (
              <div
                key={row.key}
                ref={(element) => windowedRows.measureRow(row.key, element)}
                role="listitem"
                className="cv-debug__windowed-row"
                style={{ top: offsetTop }}
              >
                <button
                  aria-expanded={!collapsed}
                  aria-label={`${pathLabel}, ${row.group.count} ${breakpointNoun}`}
                  data-breakpoint-group=""
                  data-breakpoint-row-key={row.key}
                  onClick={() => rowFocus.toggleGroup(row.group.filePath)}
                  onKeyDown={(event) =>
                    rowFocus.handleNavigationKey(event, row, windowedRows.scrollToIndex)
                  }
                  ref={(element) => rowFocus.registerRowFocusElement(row.key, element)}
                  className="cv-debug__breakpoint-group-header"
                  tabIndex={row.key === rowFocus.effectiveRovingRowKey ? 0 : -1}
                  type="button"
                >
                  {collapsed ? (
                    <ChevronRight aria-hidden="true" size={12} />
                  ) : (
                    <ChevronDown aria-hidden="true" size={12} />
                  )}
                  <strong>{row.group.fileName}</strong>
                  {row.group.relativePath === null ? null : (
                    <span className="cv-debug__muted">— {row.group.relativePath}</span>
                  )}
                  <span className="cv-debug__muted">({row.group.count})</span>
                </button>
              </div>
            );
          }
          const breakpoint = row.breakpoint;
          return (
            <div
              aria-posinset={(breakpointPositionById.get(breakpoint.id) ?? 0) + 1}
              aria-setsize={breakpointPositionById.size}
              data-breakpoint-id={breakpoint.id}
              data-breakpoint-row-key={row.key}
              data-testid="debug-breakpoint"
              key={row.key}
              ref={(element) => windowedRows.measureRow(row.key, element)}
              role="listitem"
              className="cv-debug__windowed-row cv-debug__breakpoint-row"
              style={{ top: offsetTop }}
            >
              <input
                aria-label={`Enable breakpoint ${breakpointLocationLabel(breakpoint)}`}
                checked={breakpoint.enabled}
                onChange={(event) => onSetBreakpointEnabled(breakpoint.id, event.target.checked)}
                type="checkbox"
              />
              <button
                data-breakpoint-row-key={row.key}
                data-testid="debug-breakpoint-location"
                onClick={() => onNavigateToBreakpoint(breakpoint)}
                onKeyDown={(event) =>
                  rowFocus.handleNavigationKey(event, row, windowedRows.scrollToIndex)
                }
                ref={(element) => rowFocus.registerRowFocusElement(row.key, element)}
                className="cv-debug__location"
                tabIndex={row.key === rowFocus.effectiveRovingRowKey ? 0 : -1}
                title={breakpointLocationLabel(breakpoint)}
                type="button"
              >
                {breakpointLocationLabel(breakpoint, rootPath)}
                {breakpoint.verified === false ? (
                  <span className="cv-debug__muted"> (unverified)</span>
                ) : null}
              </button>
              <BreakpointConditionInput
                breakpoint={breakpoint}
                key={`condition:${breakpoint.id}:${breakpoint.condition ?? ""}`}
                onSetBreakpointCondition={onSetBreakpointCondition}
              />
              {supportsHitConditions &&
              rootPath &&
              isBreakpointPathSupported(rootPath, "node", breakpoint.filePath) ? (
                <BreakpointHitConditionInput
                  breakpoint={breakpoint}
                  key={`hit:${breakpoint.id}:${formatBreakpointHitCondition(breakpoint.hitCondition)}`}
                  onSetBreakpointHitCondition={onSetBreakpointHitCondition}
                />
              ) : null}
              {supportsLogpoints &&
              rootPath &&
              isBreakpointPathSupported(rootPath, "node", breakpoint.filePath) ? (
                <BreakpointLogMessageInput
                  breakpoint={breakpoint}
                  key={`log:${breakpoint.id}:${breakpoint.logMessage ?? ""}`}
                  onSetBreakpointLogMessage={onSetBreakpointLogMessage}
                />
              ) : null}
              <button
                aria-label="Remove breakpoint"
                onClick={() => onRemoveBreakpoint(breakpoint.id)}
                className="cv-debug__action"
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BreakpointLogMessageInput({
  breakpoint,
  onSetBreakpointLogMessage,
}: {
  breakpoint: Breakpoint;
  onSetBreakpointLogMessage(id: string, logMessage: string | null): void;
}) {
  const [value, setValue] = useState(breakpoint.logMessage ?? "");
  const error = breakpointLogMessageError(value);
  const errorId = `${useId()}-logpoint-error`;

  const commit = () => {
    if (error) return;
    const logMessage = isBreakpointLogMessage(value) ? value : null;
    if (logMessage === (breakpoint.logMessage ?? null)) return;
    onSetBreakpointLogMessage(breakpoint.id, logMessage);
  };

  return (
    <>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-label={`Log message for ${breakpointLocationLabel(breakpoint)}`}
        onBlur={commit}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        placeholder="Log Message"
        className="cv-debug__condition-input"
        title={error ?? "Use text and expressions in {braces}"}
        value={value}
      />
      {error ? (
        <span id={errorId} role="alert" className="cv-debug__muted">
          {error}
        </span>
      ) : null}
    </>
  );
}

function BreakpointHitConditionInput({
  breakpoint,
  onSetBreakpointHitCondition,
}: {
  breakpoint: Breakpoint;
  onSetBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): void;
}) {
  const [value, setValue] = useState(formatBreakpointHitCondition(breakpoint.hitCondition));
  const error = breakpointHitConditionError(value);
  const errorId = `${useId()}-hit-count-error`;

  const commit = () => {
    if (error) return;
    const hitCondition = parseBreakpointHitCondition(value);
    if (
      formatBreakpointHitCondition(hitCondition) ===
      formatBreakpointHitCondition(breakpoint.hitCondition)
    )
      return;
    onSetBreakpointHitCondition(breakpoint.id, hitCondition);
  };

  return (
    <>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-label="Hit Count"
        onBlur={commit}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        placeholder="Hit Count"
        className="cv-debug__condition-input"
        title={error ?? "Use N, >=N, or %N"}
        value={value}
      />
      {error ? (
        <span id={errorId} role="alert" className="cv-debug__muted">
          {error}
        </span>
      ) : null}
    </>
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
      className="cv-debug__condition-input"
      value={value}
    />
  );
}
