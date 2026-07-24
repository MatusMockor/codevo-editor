import { RefreshCw, Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  filterWorkspaceExpressRoutes,
  type WorkspaceExpressRoute,
} from "../domain/workspaceExpressRoutes";

export interface ExpressRoutesPanelProps {
  readonly error: string | null;
  readonly loading: boolean;
  readonly onOpenRoute: (route: WorkspaceExpressRoute) => Promise<unknown> | unknown;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => void;
  readonly query: string;
  readonly routes: readonly WorkspaceExpressRoute[];
  readonly truncated: boolean;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    padding: 4,
  },
  cell: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 8,
    padding: "6px 8px",
  },
  input: { background: "transparent", border: 0, color: "inherit", flex: 1, minWidth: 100 },
  list: { display: "grid", gap: 1, listStyle: "none", margin: 0, padding: 0 },
  message: { color: "var(--text-muted)", padding: 16 },
  method: { fontWeight: 700 },
  panel: { height: "100%", overflow: "auto" },
  route: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "grid",
    font: "inherit",
    gap: 12,
    gridTemplateColumns: "64px minmax(140px, 1fr) 72px minmax(150px, 0.7fr)",
    padding: "6px 8px",
    textAlign: "left",
    width: "100%",
  },
  selectedRoute: { background: "var(--selection-background)" },
};

export function ExpressRoutesPanel(props: ExpressRoutesPanelProps): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0);
  const [openingRouteId, setOpeningRouteId] = useState<string | null>(null);
  const openingRouteIdRef = useRef<string | null>(null);
  const listboxId = useId();
  const { error, loading, query, routes, truncated } = props;
  const filteredRoutes = useMemo(
    () => filterWorkspaceExpressRoutes(routes, query),
    [query, routes],
  );
  const selectedIndex = Math.min(activeIndex, Math.max(filteredRoutes.length - 1, 0));
  const selectedRoute = filteredRoutes[selectedIndex];

  const changeQuery = (nextQuery: string) => {
    setActiveIndex(0);
    props.onQueryChange(nextQuery);
  };

  const openRoute = (route: WorkspaceExpressRoute) => {
    if (openingRouteIdRef.current) return;
    openingRouteIdRef.current = route.id;
    setOpeningRouteId(route.id);
    void Promise.resolve()
      .then(() => props.onOpenRoute(route))
      .finally(() => {
        openingRouteIdRef.current = null;
        setOpeningRouteId(null);
      })
      .catch(() => undefined);
  };

  return (
    <section
      aria-busy={loading || openingRouteId !== null}
      aria-label="Express routes"
      role="tabpanel"
      style={styles.panel}
    >
      <div style={styles.header}>
        <button
          aria-label="Refresh Express routes"
          disabled={loading}
          onClick={props.onRefresh}
          style={styles.action}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={
            selectedRoute ? expressRouteOptionId(listboxId, selectedRoute.id) : undefined
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-label="Filter Express routes"
          onChange={(event) => changeQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(filteredRoutes.length - 1, 0)),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(Math.max(filteredRoutes.length - 1, 0));
            } else if (event.key === "Enter" && selectedRoute) {
              event.preventDefault();
              openRoute(selectedRoute);
            }
          }}
          placeholder="Filter method, path, receiver, file, or line"
          role="combobox"
          style={styles.input}
          value={query}
        />
        <span aria-label="Route total">{filteredRoutes.length} routes</span>
      </div>

      {loading ? (
        <div role="status" style={styles.message}>
          Loading Express routes…
        </div>
      ) : null}
      {!loading && error ? (
        <div role="alert" style={styles.message}>
          {error}
        </div>
      ) : null}
      {!loading && truncated ? (
        <div role="status" style={styles.message}>
          Results are truncated.
        </div>
      ) : null}
      {!loading && !error && routes.length === 0 ? (
        <div role="status" style={styles.message}>
          No Express routes found.
        </div>
      ) : null}
      {!loading && !error && routes.length > 0 && filteredRoutes.length === 0 ? (
        <div role="status" style={styles.message}>
          No Express routes match the current filter.
        </div>
      ) : null}

      <div aria-label="Express route results" id={listboxId} role="listbox" style={styles.list}>
        {!loading
          ? filteredRoutes.map((route, index) => {
              const selected = index === selectedIndex;
              const location = `${route.relativeFilePath}:${route.line}`;
              return (
                <button
                  aria-selected={selected}
                  disabled={openingRouteId !== null}
                  id={expressRouteOptionId(listboxId, route.id)}
                  key={route.id}
                  onClick={() => openRoute(route)}
                  onMouseMove={() => setActiveIndex(index)}
                  role="option"
                  style={selected ? { ...styles.route, ...styles.selectedRoute } : styles.route}
                  tabIndex={-1}
                  type="button"
                >
                  <span style={{ ...styles.cell, ...styles.method }}>{route.method}</span>
                  <span style={styles.cell} title={route.path}>
                    {route.path}
                  </span>
                  <span style={styles.cell}>{route.receiver}</span>
                  <span style={styles.cell} title={location}>
                    {route.packageLabel ? `${route.packageLabel} · ` : ""}
                    {location}
                  </span>
                </button>
              );
            })
          : null}
      </div>
    </section>
  );
}

function expressRouteOptionId(listboxId: string, routeId: string): string {
  return `${listboxId}-route-${routeId}`;
}
