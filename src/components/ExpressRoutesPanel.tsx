import { RefreshCw, Search } from "lucide-react";
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  filterWorkspaceExpressRoutes,
  type WorkspaceExpressRoute,
} from "../domain/workspaceExpressRoutes";
import { useWindowedRows } from "./useWindowedRows";

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
  list: { flex: 1, minHeight: 0, overflow: "auto", position: "relative" },
  message: { color: "var(--text-muted)", padding: 16 },
  method: { fontWeight: 700 },
  panel: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
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

const ROUTE_ROW_HEIGHT = 32;

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
  const selectedRoute = loading ? undefined : filteredRoutes[selectedIndex];
  const keyForIndex = useCallback(
    (index: number) => filteredRoutes[index]?.id ?? `missing-${index}`,
    [filteredRoutes],
  );
  const estimateHeight = useCallback(() => ROUTE_ROW_HEIGHT, []);
  const openingRouteIndex = openingRouteId
    ? filteredRoutes.findIndex((route) => route.id === openingRouteId)
    : -1;
  const pinnedIndices = useMemo(
    () =>
      [...new Set([selectedRoute ? selectedIndex : -1, openingRouteIndex])].filter(
        (index) => index >= 0,
      ),
    [openingRouteIndex, selectedIndex, selectedRoute],
  );
  const {
    containerRef: windowedContainerRef,
    measureRow,
    onScroll,
    rows: windowedRows,
    scrollToIndex,
    totalHeight,
  } = useWindowedRows({
    enabled: true,
    estimateHeight,
    itemCount: loading ? 0 : filteredRoutes.length,
    keyForIndex,
    pinnedIndices,
  });
  const listRef = useRef<HTMLDivElement | null>(null);
  const setListElement = useCallback(
    (element: HTMLDivElement | null) => {
      listRef.current = element;
      windowedContainerRef(element);
    },
    [windowedContainerRef],
  );

  const changeQuery = (nextQuery: string) => {
    setActiveIndex(0);
    scrollToIndex(0, "start");
    props.onQueryChange(nextQuery);
  };

  const selectIndex = (requestedIndex: number, align: "nearest" | "start" | "end" = "nearest") => {
    const nextIndex = Math.max(0, Math.min(filteredRoutes.length - 1, requestedIndex));
    setActiveIndex(nextIndex);
    scrollToIndex(nextIndex, align);
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
          placeholder="Filter method, path, receiver, file, or line"
          role="combobox"
          style={styles.input}
          value={query}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              selectIndex(selectedIndex + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              selectIndex(selectedIndex - 1);
            } else if (event.key === "Home") {
              event.preventDefault();
              selectIndex(0, "start");
            } else if (event.key === "End") {
              event.preventDefault();
              selectIndex(filteredRoutes.length - 1, "end");
            } else if (event.key === "PageDown") {
              event.preventDefault();
              const pageSize = Math.max(
                1,
                Math.floor((listRef.current?.clientHeight ?? ROUTE_ROW_HEIGHT) / ROUTE_ROW_HEIGHT),
              );
              selectIndex(selectedIndex + pageSize);
            } else if (event.key === "PageUp") {
              event.preventDefault();
              const pageSize = Math.max(
                1,
                Math.floor((listRef.current?.clientHeight ?? ROUTE_ROW_HEIGHT) / ROUTE_ROW_HEIGHT),
              );
              selectIndex(selectedIndex - pageSize);
            } else if (event.key === "Enter" && selectedRoute) {
              event.preventDefault();
              openRoute(selectedRoute);
            }
          }}
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

      <div
        aria-label="Express route results"
        id={listboxId}
        onScroll={onScroll}
        ref={setListElement}
        role="listbox"
        style={styles.list}
      >
        <div
          data-testid="express-routes-spacer"
          style={{ height: totalHeight, position: "relative" }}
        >
          {!loading
            ? windowedRows.map(({ index, offsetTop }) => {
                const route = filteredRoutes[index];
                if (!route) return null;
                const selected = index === selectedIndex;
                const location = `${route.relativeFilePath}:${route.line}`;
                return (
                  <button
                    aria-posinset={index + 1}
                    aria-selected={selected}
                    aria-setsize={filteredRoutes.length}
                    disabled={openingRouteId !== null}
                    id={expressRouteOptionId(listboxId, route.id)}
                    key={route.id}
                    onClick={() => openRoute(route)}
                    onMouseMove={() => selectIndex(index)}
                    ref={(element) => measureRow(route.id, element)}
                    role="option"
                    style={{
                      ...styles.route,
                      ...(selected ? styles.selectedRoute : {}),
                      left: 0,
                      position: "absolute",
                      right: 0,
                      top: 0,
                      transform: `translateY(${offsetTop}px)`,
                    }}
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
      </div>
    </section>
  );
}

function expressRouteOptionId(listboxId: string, routeId: string): string {
  return `${listboxId}-route-${routeId}`;
}
