import { ChevronDown, ChevronRight, Play, RefreshCw, Square } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import type { NodePackageTaskState } from "../application/nodePackageTaskLifecycle";
import {
  presentNodePackageScriptsPanel,
  type NodePackageScriptPanelGroup,
  type NodePackageScriptPanelRow,
} from "./NodePackageScriptsPanelModel";

export interface NodePackageScriptsPanelProps {
  readonly available: boolean;
  readonly error: string | null;
  readonly loading: boolean;
  readonly pending: boolean;
  readonly scripts: readonly NodePackageScript[];
  readonly task: NodePackageTaskState | null;
  readonly total: number;
  readonly truncated: boolean;
  onOpen(script: NodePackageScript): void;
  onRefresh(): void;
  onRun(script: NodePackageScript): void;
  onStop(): void;
}

interface VisibleTreeItem {
  readonly groupId: string;
  readonly id: string;
  readonly kind: "group" | "script";
  readonly row?: NodePackageScriptPanelRow;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    gap: 4,
    padding: "3px 6px",
  },
  group: { listStyle: "none" },
  groupChildren: { listStyle: "none", margin: 0, padding: 0 },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { color: "var(--text-muted)", padding: 16 },
  panel: { height: "100%", overflow: "auto" },
  row: {
    alignItems: "center",
    display: "flex",
    gap: 6,
    minHeight: 28,
    outline: "none",
    padding: "0 8px",
  },
  scriptRow: { paddingLeft: 30 },
  selected: { background: "var(--selection-background)" },
  status: {
    color: "var(--text-muted)",
    fontSize: 11,
    marginLeft: "auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toolbar: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 8,
    padding: "6px 8px",
  },
  tree: { fontSize: 12, listStyle: "none", margin: 0, padding: "4px 0" },
};

export const NODE_PACKAGE_GROUP_DOM_PAGE_SIZE = 100;
export const NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE = 200;

export function NodePackageScriptsPanel({
  available,
  error,
  loading,
  onOpen,
  onRefresh,
  onRun,
  onStop,
  pending,
  scripts,
  task,
  total,
  truncated,
}: NodePackageScriptsPanelProps) {
  const model = useMemo(
    () => presentNodePackageScriptsPanel({ available, pending, scripts, task, total }),
    [available, pending, scripts, task, total],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [groupPage, setGroupPage] = useState(0);
  const [scriptPage, setScriptPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);
  const groupPageCount = Math.max(
    1,
    Math.ceil(model.groups.length / NODE_PACKAGE_GROUP_DOM_PAGE_SIZE),
  );
  const effectiveGroupPage = Math.min(groupPage, groupPageCount - 1);
  const renderedGroups = useMemo(
    () =>
      model.groups.slice(
        effectiveGroupPage * NODE_PACKAGE_GROUP_DOM_PAGE_SIZE,
        (effectiveGroupPage + 1) * NODE_PACKAGE_GROUP_DOM_PAGE_SIZE,
      ),
    [effectiveGroupPage, model.groups],
  );
  const expandedGroup = model.groups.find((group) => expanded.has(group.id)) ?? null;
  const scriptPageCount = Math.max(
    1,
    Math.ceil((expandedGroup?.rows.length ?? 0) / NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE),
  );
  const effectiveScriptPage = Math.min(scriptPage, scriptPageCount - 1);
  const visible = useMemo(
    () => visibleTreeItems(renderedGroups, expanded, effectiveScriptPage),
    [effectiveScriptPage, expanded, renderedGroups],
  );
  const effectiveSelectedId = visible.some((item) => item.id === selectedId)
    ? selectedId
    : (visible[0]?.id ?? null);

  useEffect(() => {
    if (effectiveSelectedId !== selectedId) setSelectedId(effectiveSelectedId);
  }, [effectiveSelectedId, selectedId]);

  useEffect(() => {
    if (groupPage !== effectiveGroupPage) setGroupPage(effectiveGroupPage);
    if (scriptPage !== effectiveScriptPage) setScriptPage(effectiveScriptPage);
  }, [effectiveGroupPage, effectiveScriptPage, groupPage, scriptPage]);

  useEffect(() => {
    for (const [groupIndex, group] of model.groups.entries()) {
      const rowIndex = group.rows.findIndex((row) => row.active);
      if (rowIndex < 0) continue;
      setGroupPage(Math.floor(groupIndex / NODE_PACKAGE_GROUP_DOM_PAGE_SIZE));
      setScriptPage(Math.floor(rowIndex / NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE));
      setExpanded((current) =>
        current.size === 1 && current.has(group.id) ? current : new Set([group.id]),
      );
      setSelectedId(group.rows[rowIndex]?.id ?? group.id);
      return;
    }
  }, [model.groups, task?.runId]);

  const toggleGroup = (groupId: string, force?: boolean) => {
    setScriptPage(0);
    setExpanded((current) => {
      const next = new Set(current);
      const shouldExpand = force ?? !next.has(groupId);
      if (shouldExpand) {
        next.clear();
        next.add(groupId);
      } else next.delete(groupId);
      return next;
    });
  };

  const run = (row: NodePackageScriptPanelRow) => {
    if (row.canRun) onRun(row.script);
  };

  const open = (row: NodePackageScriptPanelRow) => {
    onOpen(row.script);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (visible.length === 0) return;
    const index = Math.max(
      0,
      visible.findIndex((item) => item.id === effectiveSelectedId),
    );
    const selected = visible[index] ?? visible[0];
    if (!selected) return;
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") nextIndex = Math.min(index + 1, visible.length - 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(index - 1, 0);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = visible.length - 1;
    else if (event.key === "ArrowRight" && selected.kind === "group") {
      if (!expanded.has(selected.groupId)) toggleGroup(selected.groupId, true);
      else nextIndex = Math.min(index + 1, visible.length - 1);
    } else if (event.key === "ArrowLeft") {
      if (selected.kind === "script") {
        nextIndex = visible.findIndex((item) => item.id === selected.groupId);
      } else if (expanded.has(selected.groupId)) {
        toggleGroup(selected.groupId, false);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      if (selected.kind === "group") toggleGroup(selected.groupId);
      else if (selected.row) open(selected.row);
    } else {
      return;
    }

    event.preventDefault();
    if (nextIndex !== null && nextIndex >= 0) setSelectedId(visible[nextIndex]?.id ?? null);
  };

  return (
    <section
      aria-busy={loading || pending}
      aria-label="Node package scripts"
      role="tabpanel"
      style={styles.panel}
    >
      <div aria-label="Node package script actions" role="toolbar" style={styles.toolbar}>
        <button
          aria-label="Refresh Node package scripts"
          disabled={loading}
          onClick={onRefresh}
          style={styles.action}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
          Refresh
        </button>
        <span aria-live="polite" style={styles.status}>
          {model.shown} script{model.shown === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div role="status" style={styles.message}>
          Loading package scripts…
        </div>
      ) : null}
      {!loading && error ? (
        <div role="alert" style={styles.message}>
          {error}
        </div>
      ) : null}
      {!loading && !available ? (
        <div role="status" style={styles.message}>
          Package script execution is unavailable.
        </div>
      ) : null}
      {!loading && truncated ? (
        <div role="status" style={styles.message}>
          Showing {model.shown} of {model.total} package scripts. Refresh after narrowing the
          workspace.
        </div>
      ) : null}
      {!loading && model.groups.length === 0 && !error ? (
        <div role="status" style={styles.message}>
          No package scripts found.
        </div>
      ) : null}
      {model.activeTask ? (
        <div aria-live="polite" style={styles.toolbar}>
          <span style={styles.label}>{model.activeTask.label}</span>
          <span style={styles.status}>{model.activeTask.status}</span>
          <button
            aria-label="Stop active package script"
            onClick={onStop}
            style={styles.action}
            type="button"
          >
            <Square aria-hidden="true" size={12} />
            Stop
          </button>
        </div>
      ) : null}
      {!loading && model.groups.length > 0 ? (
        <ul
          aria-activedescendant={effectiveSelectedId ?? undefined}
          aria-label="Node package scripts"
          onKeyDown={handleKeyDown}
          ref={treeRef}
          role="tree"
          style={styles.tree}
          tabIndex={0}
        >
          {renderedGroups.map((group) => {
            const isExpanded = expanded.has(group.id);
            const selected = effectiveSelectedId === group.id;
            return (
              <li
                aria-expanded={isExpanded}
                aria-level={1}
                aria-selected={selected}
                id={group.id}
                key={group.id}
                role="treeitem"
                style={styles.group}
              >
                <div
                  onClick={() => {
                    setSelectedId(group.id);
                    toggleGroup(group.id);
                    treeRef.current?.focus();
                  }}
                  style={{ ...styles.row, ...(selected ? styles.selected : {}) }}
                >
                  {isExpanded ? (
                    <ChevronDown aria-hidden="true" size={14} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={14} />
                  )}
                  <span style={styles.label} title={group.description}>
                    {group.label}
                  </span>
                  <span style={styles.status}>{group.rows.length}</span>
                </div>
                {isExpanded ? (
                  <ul role="group" style={styles.groupChildren}>
                    {group.rows
                      .slice(
                        effectiveScriptPage * NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE,
                        (effectiveScriptPage + 1) * NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE,
                      )
                      .map((row) => (
                        <ScriptTreeItem
                          key={row.id}
                          onOpen={open}
                          onRun={run}
                          onSelect={() => {
                            setSelectedId(row.id);
                            treeRef.current?.focus();
                          }}
                          onStop={onStop}
                          row={row}
                          selected={effectiveSelectedId === row.id}
                        />
                      ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!loading && model.groups.length > NODE_PACKAGE_GROUP_DOM_PAGE_SIZE ? (
        <Pagination
          label="package groups"
          onNext={() => {
            setExpanded(new Set());
            setGroupPage((page) => Math.min(page + 1, groupPageCount - 1));
          }}
          onPrevious={() => {
            setExpanded(new Set());
            setGroupPage((page) => Math.max(0, page - 1));
          }}
          page={effectiveGroupPage}
          pageCount={groupPageCount}
        />
      ) : null}
      {renderedGroups.map((group) =>
        expanded.has(group.id) && group.rows.length > NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE ? (
          <Pagination
            key={`${group.id}:pagination`}
            label={`scripts in ${group.label}`}
            onNext={() =>
              setScriptPage((page) =>
                Math.min(
                  page + 1,
                  Math.ceil(group.rows.length / NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE) - 1,
                ),
              )
            }
            onPrevious={() => setScriptPage((page) => Math.max(0, page - 1))}
            page={effectiveScriptPage}
            pageCount={Math.ceil(group.rows.length / NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE)}
          />
        ) : null,
      )}
    </section>
  );
}

function Pagination({
  label,
  onNext,
  onPrevious,
  page,
  pageCount,
}: {
  readonly label: string;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly page: number;
  readonly pageCount: number;
}) {
  return (
    <nav aria-label={`Pages of ${label}`} style={styles.toolbar}>
      <button disabled={page === 0} onClick={onPrevious} style={styles.action} type="button">
        Previous
      </button>
      <span aria-live="polite">
        Page {page + 1} of {pageCount}
      </span>
      <button disabled={page + 1 >= pageCount} onClick={onNext} style={styles.action} type="button">
        Next
      </button>
    </nav>
  );
}

function ScriptTreeItem({
  onOpen,
  onRun,
  onSelect,
  onStop,
  row,
  selected,
}: {
  readonly onOpen: (row: NodePackageScriptPanelRow) => void;
  readonly onRun: (row: NodePackageScriptPanelRow) => void;
  readonly onSelect: () => void;
  readonly onStop: () => void;
  readonly row: NodePackageScriptPanelRow;
  readonly selected: boolean;
}) {
  return (
    <li
      aria-current={row.active ? "true" : undefined}
      aria-level={2}
      aria-selected={selected}
      id={row.id}
      onClick={() => {
        onSelect();
        onOpen(row);
      }}
      role="treeitem"
      style={{ ...styles.row, ...styles.scriptRow, ...(selected ? styles.selected : {}) }}
    >
      <span style={styles.label}>{row.script.scriptName}</span>
      <span style={styles.status}>{row.status ?? row.manager}</span>
      {row.active &&
      row.status &&
      row.status !== "Stopped" &&
      !row.status.startsWith("Exited") &&
      !row.status.startsWith("Failed") ? (
        <button
          aria-label={`Stop ${row.script.scriptName}`}
          disabled={!row.canStop}
          onClick={(event) => {
            event.stopPropagation();
            if (row.canStop) onStop();
          }}
          style={styles.action}
          type="button"
        >
          <Square aria-hidden="true" size={12} />
          Stop
        </button>
      ) : (
        <button
          aria-label={`Run ${row.script.scriptName}`}
          disabled={!row.canRun}
          onClick={(event) => {
            event.stopPropagation();
            onRun(row);
          }}
          style={styles.action}
          type="button"
        >
          <Play aria-hidden="true" size={12} />
          Run
        </button>
      )}
    </li>
  );
}

function visibleTreeItems(
  groups: readonly NodePackageScriptPanelGroup[],
  expanded: ReadonlySet<string>,
  scriptPage: number,
): VisibleTreeItem[] {
  const visible: VisibleTreeItem[] = [];
  for (const group of groups) {
    visible.push({ groupId: group.id, id: group.id, kind: "group" });
    if (!expanded.has(group.id)) continue;
    for (const row of group.rows.slice(
      scriptPage * NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE,
      (scriptPage + 1) * NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE,
    )) {
      visible.push({ groupId: group.id, id: row.id, kind: "script", row });
    }
  }
  return visible;
}
