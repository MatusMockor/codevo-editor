import { RefreshCw, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { NetteWorkspaceRoutesPanelModel } from "../application/netteWorkspaceRoutesPanelModel";
import type { NetteWorkspaceRoute } from "../domain/netteWorkspaceRoutes";

export type NetteWorkspaceRoutesPanelProps = NetteWorkspaceRoutesPanelModel;

const styles: Record<string, CSSProperties> = {
  action: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    cursor: "pointer",
    padding: "3px 7px",
  },
  actions: { display: "flex", gap: 5, justifyContent: "flex-end" },
  badge: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "1px 6px",
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
    gridTemplateColumns: "minmax(220px, 1fr) minmax(100px, .35fr) minmax(220px, 1fr) auto",
    minHeight: 34,
    padding: "4px 8px",
  },
  selected: { background: "var(--selection-background)" },
};

export function NetteWorkspaceRoutesPanel(props: NetteWorkspaceRoutesPanelProps): ReactNode {
  const namespace = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const openingRef = useRef(false);
  const selectedIndex = Math.min(activeIndex, Math.max(props.filteredRoutes.length - 1, 0));
  const selected = props.filteredRoutes[selectedIndex];
  const disabled = props.busy || openingKey !== null;

  useEffect(() => setActiveIndex(0), [props.query, props.routes]);

  const open = (route: NetteWorkspaceRoute, target: "definition" | "target"): void => {
    if (openingRef.current || (target === "target" && !route.target)) return;
    openingRef.current = true;
    setOpeningKey(`${route.key}:${target}`);
    const operation =
      target === "definition" ? props.onOpenDefinition(route) : props.onOpenTarget(route);
    void Promise.resolve(operation)
      .finally(() => {
        openingRef.current = false;
        setOpeningKey(null);
      })
      .catch(() => undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(props.filteredRoutes.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(props.filteredRoutes.length - 1, 0));
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      open(selected, selected.target ? "target" : "definition");
    }
  };

  return (
    <section aria-busy={disabled} aria-label="Nette routes" style={styles.panel}>
      <div style={styles.header}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={selected ? rowId(namespace, selected.key) : undefined}
          aria-autocomplete="list"
          aria-controls={`${namespace}-routes-grid`}
          aria-expanded="true"
          aria-label="Filter Nette routes"
          disabled={disabled}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="Filter Nette routes"
          role="combobox"
          style={styles.input}
          value={props.query}
        />
        <span aria-label="Routes total" style={styles.badge}>
          {props.routes.status === "ok" ? props.routes.total : 0}
        </span>
        <button
          aria-label="Refresh Nette routes"
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
      {!props.error && props.busy && props.routes.status !== "ok" ? (
        <div role="status" style={styles.message}>
          Inspecting Nette routes…
        </div>
      ) : null}
      {!props.error && !props.busy && props.routes.status !== "ok" ? (
        <div role={props.routes.status === "error" ? "alert" : "status"} style={styles.message}>
          {props.routes.message}
        </div>
      ) : null}
      {!props.error && props.routes.status === "ok" && props.routes.truncated ? (
        <div role="status" style={styles.message}>
          Results were truncated to keep workspace inspection bounded.
        </div>
      ) : null}
      {!props.error && props.routes.status === "ok" && props.filteredRoutes.length === 0 ? (
        <div role="status" style={styles.message}>
          {props.query ? "No routes match the current filter." : "No Nette routes found."}
        </div>
      ) : null}
      {props.routes.status === "ok" && props.filteredRoutes.length > 0 ? (
        <ul
          aria-activedescendant={selected ? rowId(namespace, selected.key) : undefined}
          aria-label="Nette routes"
          aria-rowcount={props.filteredRoutes.length}
          id={`${namespace}-routes-grid`}
          onKeyDown={onKeyDown}
          role="grid"
          style={styles.list}
          tabIndex={0}
        >
          {props.filteredRoutes.map((route, index) => (
            <li
              aria-selected={selectedIndex === index}
              id={rowId(namespace, route.key)}
              key={route.key}
              onMouseDown={() => setActiveIndex(index)}
              role="row"
              style={{ ...styles.row, ...(selectedIndex === index ? styles.selected : {}) }}
            >
              <strong role="gridcell">{route.mask}</strong>
              <span role="gridcell" style={styles.muted}>
                {route.methods.length > 0 ? route.methods.join(" | ") : "ANY"}
              </span>
              <span role="gridcell" style={styles.muted}>
                {route.target?.raw ?? "Dynamic target"}
              </span>
              <div role="gridcell" style={styles.actions}>
                <button
                  aria-label={`Open route definition ${route.mask}`}
                  disabled={disabled}
                  onClick={() => open(route, "definition")}
                  style={styles.action}
                  type="button"
                >
                  Definition
                </button>
                <button
                  aria-label={`Open route target ${route.mask}`}
                  disabled={disabled || !route.target}
                  onClick={() => open(route, "target")}
                  style={styles.action}
                  type="button"
                >
                  Presenter
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function rowId(namespace: string, key: string): string {
  return `${namespace}-route-${encodeURIComponent(key)}`;
}
