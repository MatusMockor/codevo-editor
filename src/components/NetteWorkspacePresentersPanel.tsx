import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  NetteWorkspacePresenterMatch,
  NetteWorkspacePresentersPanelModel,
} from "../application/netteWorkspacePresentersPanelModel";
import type {
  NetteWorkspacePresenter,
  NetteWorkspacePresenterAction,
  NetteWorkspacePresenterSignal,
  NetteWorkspaceTemplateSource,
} from "../domain/netteWorkspacePresenters";

export type NetteWorkspacePresentersPanelProps = NetteWorkspacePresentersPanelModel;

type PresenterRow = {
  readonly key: string;
  readonly kind: "presenter";
  readonly match: NetteWorkspacePresenterMatch;
  readonly parentKey: null;
};
type ActionRow = {
  readonly action: NetteWorkspacePresenterAction;
  readonly key: string;
  readonly kind: "action";
  readonly parentKey: string;
  readonly presenter: NetteWorkspacePresenter;
};
type SignalRow = {
  readonly key: string;
  readonly kind: "signal";
  readonly parentKey: string;
  readonly presenter: NetteWorkspacePresenter;
  readonly signal: NetteWorkspacePresenterSignal;
};
type TemplateRow = {
  readonly action: NetteWorkspacePresenterAction;
  readonly key: string;
  readonly kind: "template";
  readonly parentKey: string;
  readonly presenter: NetteWorkspacePresenter;
  readonly template: NetteWorkspaceTemplateSource;
};
type TreeRow = PresenterRow | ActionRow | SignalRow | TemplateRow;

const styles: Record<string, CSSProperties> = {
  action: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    cursor: "pointer",
    padding: "3px 7px",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "flex-end" },
  badge: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "1px 6px",
  },
  disclosure: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    height: 20,
    justifyContent: "center",
    padding: 0,
    width: 20,
  },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 8,
    padding: "6px 8px",
  },
  input: { background: "transparent", border: 0, color: "inherit", flex: 1, minWidth: 100 },
  list: { listStyle: "none", margin: 0, outline: "none", padding: 0 },
  message: { color: "var(--text-muted)", padding: 16 },
  muted: { color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" },
  panel: { height: "100%", overflow: "auto" },
  row: {
    alignItems: "center",
    display: "grid",
    gap: 12,
    gridTemplateColumns: "minmax(220px, .9fr) minmax(260px, 1.4fr) auto",
    minHeight: 34,
    padding: "4px 8px",
  },
  selected: { background: "var(--selection-background)" },
  title: { alignItems: "center", display: "flex", minWidth: 0 },
};

export function NetteWorkspacePresentersPanel(
  props: NetteWorkspacePresentersPanelProps,
): ReactNode {
  const namespace = useId();
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const openingRef = useRef(false);
  const rows = useMemo(
    () => visibleRows(props.filteredPresenters, expandedKeys, Boolean(props.query.trim())),
    [expandedKeys, props.filteredPresenters, props.query],
  );
  const selectedIndex = Math.min(activeIndex, Math.max(rows.length - 1, 0));
  const selected = rows[selectedIndex];
  const disabled = props.busy || openingKey !== null;

  useEffect(() => setActiveIndex(0), [props.presenters, props.query]);

  const toggle = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const open = useCallback(
    (row: TreeRow, target: "action" | "presenter" | "render" | "signal" | "template") => {
      if (openingRef.current) return;
      const operation = openTarget(props, row, target);
      if (!operation) return;
      openingRef.current = true;
      setOpeningKey(`${row.key}:${target}`);
      void Promise.resolve(operation)
        .finally(() => {
          openingRef.current = false;
          setOpeningKey(null);
        })
        .catch(() => undefined);
    },
    [props],
  );

  const onTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || !selected) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(Math.max(rows.length - 1, 0));
      } else if (event.key === "ArrowRight" && isExpandable(selected)) {
        event.preventDefault();
        if (!isExpanded(selected, expandedKeys, props.query)) toggle(selected.key);
        else setActiveIndex((index) => Math.min(index + 1, rows.length - 1));
      } else if (event.key === "ArrowLeft") {
        const parentIndex = selected.parentKey
          ? rows.findIndex((row) => row.key === selected.parentKey)
          : -1;
        if (isExpandable(selected) && isExpanded(selected, expandedKeys, props.query)) {
          event.preventDefault();
          toggle(selected.key);
        } else if (parentIndex >= 0) {
          event.preventDefault();
          setActiveIndex(parentIndex);
        }
      } else if (event.key === " ") {
        if (!isExpandable(selected)) return;
        event.preventDefault();
        toggle(selected.key);
      } else if (event.key === "Enter") {
        event.preventDefault();
        openPrimary(selected, open);
      }
    },
    [disabled, expandedKeys, open, props.query, rows, selected, toggle],
  );

  const nestedTruncation =
    props.presenters.status === "ok" &&
    props.presenters.presenters.some(
      (presenter) =>
        presenter.actionsTruncated ||
        presenter.signalsTruncated ||
        presenter.actions.some((action) => action.templatesTruncated),
    );

  return (
    <section aria-busy={disabled} aria-label="Nette presenters" style={styles.panel}>
      <div style={styles.header}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={selected ? rowId(namespace, selected.key) : undefined}
          aria-autocomplete="list"
          aria-controls={`${namespace}-presenters-tree`}
          aria-expanded="true"
          aria-label="Filter Nette presenters"
          disabled={disabled}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={onTreeKeyDown}
          placeholder="Filter Nette presenters"
          role="combobox"
          style={styles.input}
          value={props.query}
        />
        <span aria-label="Presenters total" style={styles.badge}>
          {props.presenters.status === "ok" ? props.presenters.total : 0}
        </span>
        <button
          aria-label="Refresh Nette presenters"
          disabled={disabled}
          onClick={() => void props.onRefresh()}
          style={styles.action}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>

      {props.error ? (
        <div role="alert" style={styles.message}>
          {props.error}
        </div>
      ) : null}
      {!props.error && props.busy && props.presenters.status !== "ok" ? (
        <div role="status" style={styles.message}>
          Inspecting Nette presenters…
        </div>
      ) : null}
      {!props.error && !props.busy && props.presenters.status !== "ok" ? (
        <div role={props.presenters.status === "error" ? "alert" : "status"} style={styles.message}>
          {props.presenters.message}
        </div>
      ) : null}
      {!props.error &&
      props.presenters.status === "ok" &&
      (props.presenters.truncated || nestedTruncation) ? (
        <div role="status" style={styles.message}>
          Results were truncated to keep workspace inspection bounded.
        </div>
      ) : null}
      {!props.error && props.presenters.status === "ok" && props.filteredPresenters.length === 0 ? (
        <div role="status" style={styles.message}>
          {props.query ? "No presenters match the current filter." : "No Nette presenters found."}
        </div>
      ) : null}
      {props.presenters.status === "ok" && rows.length > 0 ? (
        <ul
          aria-activedescendant={selected ? rowId(namespace, selected.key) : undefined}
          aria-label="Nette presenters"
          aria-rowcount={rows.length}
          id={`${namespace}-presenters-tree`}
          onKeyDown={onTreeKeyDown}
          role="treegrid"
          style={styles.list}
          tabIndex={0}
        >
          {rows.map((row, index) => (
            <PresenterTreeRow
              disabled={disabled}
              expanded={isExpanded(row, expandedKeys, props.query)}
              key={row.key}
              namespace={namespace}
              onOpen={open}
              onSelect={() => setActiveIndex(index)}
              onToggle={() => toggle(row.key)}
              row={row}
              selected={selectedIndex === index}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PresenterTreeRow({
  disabled,
  expanded,
  namespace,
  onOpen,
  onSelect,
  onToggle,
  row,
  selected,
}: {
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly namespace: string;
  readonly onOpen: (
    row: TreeRow,
    target: "action" | "presenter" | "render" | "signal" | "template",
  ) => void;
  readonly onSelect: () => void;
  readonly onToggle: () => void;
  readonly row: TreeRow;
  readonly selected: boolean;
}): ReactNode {
  return (
    <li
      aria-expanded={isExpandable(row) ? expanded : undefined}
      aria-level={rowLevel(row)}
      aria-selected={selected}
      id={rowId(namespace, row.key)}
      onMouseDown={onSelect}
      role="row"
      style={{ ...styles.row, ...(selected ? styles.selected : {}) }}
    >
      <div role="gridcell" style={{ ...styles.title, paddingLeft: (rowLevel(row) - 1) * 18 }}>
        {isExpandable(row) ? (
          <button
            aria-label={`${expanded ? "Collapse" : "Expand"} ${rowTitle(row)}`}
            disabled={disabled}
            onClick={onToggle}
            style={styles.disclosure}
            type="button"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" size={14} />
            ) : (
              <ChevronRight aria-hidden="true" size={14} />
            )}
          </button>
        ) : (
          <span aria-hidden="true" style={styles.disclosure} />
        )}
        <strong>{rowTitle(row)}</strong>
      </div>
      <span role="gridcell" style={styles.muted}>
        {rowDetail(row)}
      </span>
      <div role="gridcell" style={styles.actions}>
        {rowActions(row, disabled, onOpen)}
      </div>
    </li>
  );
}

function visibleRows(
  matches: readonly NetteWorkspacePresenterMatch[],
  expandedKeys: ReadonlySet<string>,
  filtering: boolean,
): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const match of matches) {
    rows.push({ key: match.presenter.key, kind: "presenter", match, parentKey: null });
    if (!filtering && !expandedKeys.has(match.presenter.key)) continue;
    for (const action of match.actions) {
      rows.push({
        action,
        key: action.key,
        kind: "action",
        parentKey: match.presenter.key,
        presenter: match.presenter,
      });
      if (filtering || expandedKeys.has(action.key)) {
        for (const template of action.templates) {
          rows.push({
            action,
            key: `${action.key}:template:${template.path}`,
            kind: "template",
            parentKey: action.key,
            presenter: match.presenter,
            template,
          });
        }
      }
    }
    for (const signal of match.signals) {
      rows.push({
        key: signal.key,
        kind: "signal",
        parentKey: match.presenter.key,
        presenter: match.presenter,
        signal,
      });
    }
  }
  return rows;
}

function rowLevel(row: TreeRow): number {
  return row.kind === "presenter" ? 1 : row.kind === "template" ? 3 : 2;
}

function isExpandable(row: TreeRow): boolean {
  return row.kind === "presenter"
    ? row.match.actions.length + row.match.signals.length > 0
    : row.kind === "action" && row.action.templates.length > 0;
}

function isExpanded(row: TreeRow, keys: ReadonlySet<string>, query: string): boolean {
  return isExpandable(row) && (Boolean(query.trim()) || keys.has(row.key));
}

function rowTitle(row: TreeRow): string {
  if (row.kind === "presenter") return row.match.presenter.name;
  if (row.kind === "action") return row.action.name;
  if (row.kind === "signal") return `${row.signal.name}!`;
  return row.template.path.split("/").pop() ?? row.template.path;
}

function rowDetail(row: TreeRow): string {
  if (row.kind === "presenter") {
    const presenter = row.match.presenter;
    return [presenter.className, presenter.source.path].filter(Boolean).join(" — ");
  }
  if (row.kind === "action") {
    return [
      row.action.actionMethod?.methodName,
      row.action.renderMethod?.methodName,
      `${row.action.templates.length} template${row.action.templates.length === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" — ");
  }
  if (row.kind === "signal") return row.signal.method.methodName;
  return row.template.path;
}

function rowActions(
  row: TreeRow,
  disabled: boolean,
  open: PresenterTreeRowParameters["onOpen"],
): ReactNode {
  if (row.kind === "presenter") {
    return (
      <ActionButton
        disabled={disabled}
        label={`Open presenter ${row.match.presenter.name}`}
        onClick={() => open(row, "presenter")}
      >
        PHP Class
      </ActionButton>
    );
  }
  if (row.kind === "action") {
    return (
      <>
        <ActionButton
          disabled={disabled || !row.action.actionMethod}
          label={`Open action method ${row.action.name}`}
          onClick={() => open(row, "action")}
        >
          Action
        </ActionButton>
        <ActionButton
          disabled={disabled || !row.action.renderMethod}
          label={`Open render method ${row.action.name}`}
          onClick={() => open(row, "render")}
        >
          Render
        </ActionButton>
      </>
    );
  }
  if (row.kind === "signal") {
    return (
      <ActionButton
        disabled={disabled}
        label={`Open signal handler ${row.signal.name}`}
        onClick={() => open(row, "signal")}
      >
        Handler
      </ActionButton>
    );
  }
  return (
    <ActionButton
      disabled={disabled}
      label={`Open template ${row.template.path}`}
      onClick={() => open(row, "template")}
    >
      Template
    </ActionButton>
  );
}

type PresenterTreeRowParameters = Parameters<typeof PresenterTreeRow>[0];

function ActionButton({
  children,
  disabled,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={styles.action}
      type="button"
    >
      {children}
    </button>
  );
}

function openPrimary(row: TreeRow, open: PresenterTreeRowParameters["onOpen"]): void {
  if (row.kind === "presenter") open(row, "presenter");
  else if (row.kind === "signal") open(row, "signal");
  else if (row.kind === "template") open(row, "template");
  else if (row.action.renderMethod) open(row, "render");
  else if (row.action.actionMethod) open(row, "action");
  else if (row.action.templates.length > 0) {
    open(
      {
        action: row.action,
        key: `${row.action.key}:template:${row.action.templates[0]!.path}`,
        kind: "template",
        parentKey: row.action.key,
        presenter: row.presenter,
        template: row.action.templates[0]!,
      },
      "template",
    );
  }
}

function openTarget(
  props: NetteWorkspacePresentersPanelProps,
  row: TreeRow,
  target: "action" | "presenter" | "render" | "signal" | "template",
): Promise<boolean> | null {
  if (target === "presenter" && row.kind === "presenter")
    return props.onOpenPresenter(row.match.presenter);
  if (target === "action" && row.kind === "action" && row.action.actionMethod)
    return props.onOpenMethod(row.action.actionMethod);
  if (target === "render" && row.kind === "action" && row.action.renderMethod)
    return props.onOpenMethod(row.action.renderMethod);
  if (target === "signal" && row.kind === "signal") return props.onOpenMethod(row.signal.method);
  if (target === "template" && row.kind === "template") return props.onOpenTemplate(row.template);
  return null;
}

function rowId(namespace: string, key: string): string {
  return `${namespace}-presenter-${encodeURIComponent(key)}`;
}
