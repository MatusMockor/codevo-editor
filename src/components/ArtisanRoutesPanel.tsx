import { RefreshCw, Search } from "lucide-react";
import type { ChangeEvent, CSSProperties } from "react";
import {
  artisanControllerAction,
  type ArtisanControllerAction,
  type ArtisanRoute,
} from "../domain/artisanRoutes";

interface ArtisanRoutesPanelProps {
  error: string | null;
  loading: boolean;
  onChangeQuery(query: string): void;
  onOpenController(action: ArtisanControllerAction): void;
  onRefresh(): void;
  query: string;
  routes: ArtisanRoute[];
  total: number;
  unavailable: string | null;
}

const styles: Record<string, CSSProperties> = {
  action: { background: "transparent", border: 0, color: "inherit" },
  badge: {
    border: "1px solid currentColor",
    borderRadius: 4,
    display: "inline-block",
    fontSize: 10,
    marginRight: 4,
    padding: "1px 4px",
  },
  cell: {
    borderBottom: "1px solid var(--border-subtle)",
    maxWidth: 420,
    overflow: "hidden",
    padding: "5px 8px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  header: { alignItems: "center", display: "flex", gap: 8, padding: "6px 8px" },
  input: { background: "transparent", border: 0, color: "inherit", flex: 1 },
  message: { padding: 16 },
  muted: { color: "var(--text-muted)" },
  panel: { height: "100%", overflow: "auto" },
  table: { borderCollapse: "collapse", fontSize: 12, width: "100%" },
};

export function ArtisanRoutesPanel({
  error,
  loading,
  onChangeQuery,
  onOpenController,
  onRefresh,
  query,
  routes,
  total,
  unavailable,
}: ArtisanRoutesPanelProps) {
  const filtered = query.trim().length > 0 && routes.length < total;
  const routeCount = filtered
    ? `${routes.length} of ${total} routes`
    : `${total} routes`;
  const changeQuery = (event: ChangeEvent<HTMLInputElement>) => {
    onChangeQuery(event.target.value);
  };

  return (
    <div aria-label="Artisan routes" role="tabpanel" style={styles.panel}>
      <div style={styles.header}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-label="Filter routes"
          onChange={changeQuery}
          placeholder="Filter URI, name, action, or method"
          style={styles.input}
          value={query}
        />
        <span aria-label="Route total">{routeCount}</span>
        <button
          aria-label="Refresh routes"
          disabled={loading}
          onClick={onRefresh}
          style={styles.action}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>
      {loading ? (
        <div role="status" style={styles.message}>
          Loading routes…
        </div>
      ) : null}
      {unavailable ? <div style={styles.message}>{unavailable}</div> : null}
      {error ? <div role="alert" style={styles.message}>{error}</div> : null}
      {!loading && !unavailable && !error && routes.length === 0 ? (
        <div style={styles.message}>No routes match the current filter.</div>
      ) : null}
      {routes.length > 0 ? (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.cell}>Method</th>
              <th style={styles.cell}>URI</th>
              <th style={styles.cell}>Name</th>
              <th style={styles.cell}>Action</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route, index) => {
              const target = artisanControllerAction(route.action);
              const muted = !target;

              return (
                <tr
                  aria-disabled={muted || undefined}
                  key={`${route.methods?.join("|") ?? ""}:${route.uri ?? ""}:${index}`}
                  onClick={target ? () => onOpenController(target) : undefined}
                  style={muted ? styles.muted : { cursor: "pointer" }}
                >
                  <td style={styles.cell}>
                    {route.methods?.map((method) => (
                      <span key={method} style={styles.badge}>
                        {method}
                      </span>
                    )) ?? "—"}
                  </td>
                  <td style={styles.cell} title={route.uri}>
                    {route.uri ?? "—"}
                  </td>
                  <td style={styles.cell}>{route.name ?? "—"}</td>
                  <td style={styles.cell} title={route.action}>
                    {route.action ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
