import { Bug, Play } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { jsTestRunScopeForExplorerNode, type JsTestRunScope } from "../domain/jsTestRunScope";
import type {
  JsTestExplorerNode,
  JsTestExplorerStatus,
  JsTestExplorerTestNode,
  JsTestExplorerWorkspaceNode,
} from "../domain/jsTestExplorerTree";
import type { FlatJsTestExplorerRow } from "./jsTestExplorerPanelProjection";

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    gap: 4,
    padding: "3px 5px",
  },
  label: {
    background: "transparent",
    border: 0,
    color: "inherit",
    font: "inherit",
    minWidth: 0,
    overflow: "hidden",
    padding: 0,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  node: { listStyle: "none", outline: "none" },
  row: {
    alignItems: "center",
    display: "flex",
    gap: 6,
    minHeight: 26,
    paddingRight: 8,
  },
  run: { marginLeft: "auto" },
  status: { display: "inline-block", flex: "0 0 14px", textAlign: "center" },
};

export interface JsTestExplorerTreeRowProps {
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly debugDisabled: boolean;
  readonly disabled: boolean;
  readonly onDebugNode: (
    node: Exclude<JsTestExplorerNode, JsTestExplorerWorkspaceNode>,
  ) => Promise<void>;
  readonly onFocus: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
  readonly onOpenTest: (test: JsTestExplorerTestNode) => void;
  readonly onRunScope: (scope: JsTestRunScope) => void;
  readonly ref: (element: HTMLLIElement | null) => void;
  readonly rootPath: string;
  readonly row: FlatJsTestExplorerRow;
  readonly style?: CSSProperties;
}

export function JsTestExplorerTreeRow({
  active,
  collapsed,
  debugDisabled,
  disabled,
  onDebugNode,
  onFocus,
  onKeyDown,
  onOpenTest,
  onRunScope,
  ref,
  rootPath,
  row,
  style,
}: JsTestExplorerTreeRowProps): ReactNode {
  const { node } = row;
  const fullName = nodeFullName(node);
  const scope =
    node.kind === "workspace"
      ? { kind: "all" as const }
      : jsTestRunScopeForExplorerNode(rootPath, node);
  const label = node.kind === "workspace" ? node.rootPath : node.label;

  return (
    <li
      aria-expanded={row.childCount > 0 ? !collapsed : undefined}
      aria-label={`${nodeKindLabel(node.kind)} ${label}`}
      aria-level={row.level}
      aria-posinset={row.indexInParent + 1}
      aria-setsize={row.siblingCount}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      ref={ref}
      role="treeitem"
      style={{ ...styles.node, ...style }}
      tabIndex={active ? 0 : -1}
    >
      <div style={{ ...styles.row, paddingLeft: (row.level - 1) * 16 + 8 }}>
        <StatusIndicator status={node.status} />
        {node.kind === "test" ? (
          <button
            aria-label={`Open test ${fullName}`}
            onClick={() => onOpenTest(node)}
            style={{ ...styles.label, cursor: "pointer" }}
            type="button"
          >
            {node.label}
          </button>
        ) : (
          <span style={styles.label} title={label}>
            {label}
          </span>
        )}
        <button
          aria-label={runButtonLabel(node, fullName, scope)}
          disabled={disabled}
          onClick={() => onRunScope(scope)}
          style={{ ...styles.action, ...styles.run }}
          type="button"
        >
          <Play aria-hidden="true" size={12} />
          Run
        </button>
        {node.kind !== "workspace" ? (
          <button
            aria-label={debugButtonLabel(node, fullName, scope)}
            disabled={debugDisabled}
            onClick={() => void onDebugNode(node)}
            style={styles.action}
            type="button"
          >
            <Bug aria-hidden="true" size={12} />
            Debug
          </button>
        ) : null}
      </div>
    </li>
  );
}

function StatusIndicator({ status }: { readonly status: JsTestExplorerStatus }) {
  return (
    <span aria-label={`Status: ${status}`} role="img" style={styles.status} title={status}>
      {statusGlyph[status]}
    </span>
  );
}

const statusGlyph: Readonly<Record<JsTestExplorerStatus, string>> = {
  failed: "×",
  idle: "○",
  passed: "✓",
  running: "◌",
  skipped: "–",
};

function nodeFullName(node: JsTestExplorerNode): string {
  if (node.kind === "suite") return node.suitePath.join(" ");
  if (node.kind === "test") return [...node.suitePath, node.label].join(" ");
  return "";
}

function runButtonLabel(node: JsTestExplorerNode, fullName: string, scope: JsTestRunScope): string {
  if (node.kind === "workspace") return `Run workspace ${node.rootPath}`;
  if (scope.kind === "file") return `Run tests in ${fileName(node.filePath)}`;
  if (node.kind === "suite") return `Run suite ${fullName}`;
  return `Run test ${fullName}`;
}

function debugButtonLabel(
  node: Exclude<JsTestExplorerNode, JsTestExplorerWorkspaceNode>,
  fullName: string,
  scope: JsTestRunScope,
): string {
  if (scope.kind === "file") return `Debug tests in ${fileName(node.filePath)}`;
  if (node.kind === "suite") return `Debug suite ${fullName}`;
  return `Debug test ${fullName}`;
}

function nodeKindLabel(kind: JsTestExplorerNode["kind"]): string {
  if (kind === "workspace") return "Workspace";
  if (kind === "file") return "File";
  if (kind === "suite") return "Suite";
  return "Test";
}

function fileName(path: string): string {
  const segments = path.split("\\").join("/").split("/");
  return segments[segments.length - 1] ?? path;
}
