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
import type { NetteWorkspacePanelModel } from "../application/netteWorkspacePanelModel";
import type { NetteWorkspaceService } from "../domain/netteWorkspaceServices";

export type NetteWorkspacePanelProps = NetteWorkspacePanelModel;

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
  cell: { overflow: "hidden" },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 8,
    padding: "6px 8px",
  },
  input: { background: "transparent", border: 0, color: "inherit", flex: 1, minWidth: 100 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  message: { color: "var(--text-muted)", padding: 16 },
  muted: { color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" },
  panel: { height: "100%", overflow: "auto" },
  row: {
    alignItems: "center",
    display: "grid",
    gap: 12,
    gridTemplateColumns: "minmax(180px, .8fr) minmax(240px, 1.4fr) auto",
    padding: "7px 8px",
  },
  selected: { background: "var(--selection-background)" },
  section: {
    borderBottom: "1px solid var(--border-subtle)",
    fontWeight: 600,
    padding: "6px 10px",
  },
};

export function NetteWorkspacePanel(props: NetteWorkspacePanelProps): ReactNode {
  const namespace = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const openingRef = useRef(false);
  const selectedIndex = Math.min(activeIndex, Math.max(props.filteredServices.length - 1, 0));
  const selected = props.filteredServices[selectedIndex];
  const disabled = props.busy || openingKey !== null;

  useEffect(() => setActiveIndex(0), [props.query]);

  const open = (service: NetteWorkspaceService, target: "definition" | "class"): void => {
    if (openingRef.current || (target === "class" && !service.className)) return;
    openingRef.current = true;
    setOpeningKey(service.key);
    const operation =
      target === "definition" ? props.onOpenDefinition(service) : props.onOpenClass(service);
    void Promise.resolve(operation)
      .finally(() => {
        openingRef.current = false;
        setOpeningKey(null);
      })
      .catch(() => undefined);
  };

  return (
    <section aria-busy={disabled} aria-label="Nette workspace" style={styles.panel}>
      <div aria-label="Nette intelligence sections" style={styles.section}>
        Services
      </div>
      <div style={styles.header}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={selected ? optionId(namespace, selected.key) : undefined}
          aria-autocomplete="list"
          aria-controls={`${namespace}-services-list`}
          aria-expanded="true"
          aria-label="Filter Nette services"
          disabled={disabled}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) =>
            handleListKey(event, props.filteredServices.length, setActiveIndex, () => {
              if (selected) open(selected, "definition");
            })
          }
          placeholder="Filter Nette services"
          role="combobox"
          style={styles.input}
          value={props.query}
        />
        <span aria-label="Services total" style={styles.badge}>
          {props.services.status === "ok" ? props.services.total : 0}
        </span>
        <button
          aria-label="Refresh Nette workspace services"
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
      {!props.error && props.busy && props.services.status !== "ok" ? (
        <div role="status" style={styles.message}>
          Inspecting Nette services…
        </div>
      ) : null}
      {!props.error && !props.busy && props.services.status !== "ok" ? (
        <div role={props.services.status === "error" ? "alert" : "status"} style={styles.message}>
          {props.services.message}
        </div>
      ) : null}
      {!props.error && props.services.status === "ok" && props.services.truncated ? (
        <div role="status" style={styles.message}>
          Results were truncated to keep workspace inspection bounded.
        </div>
      ) : null}
      {!props.error && props.services.status === "ok" && props.filteredServices.length === 0 ? (
        <div role="status" style={styles.message}>
          {props.query ? "No services match the current filter." : "No Nette services found."}
        </div>
      ) : null}
      {props.services.status === "ok" && props.filteredServices.length > 0 ? (
        <ul
          aria-label="Nette services"
          id={`${namespace}-services-list`}
          role="grid"
          style={styles.list}
        >
          {props.filteredServices.map((service, index) => (
            <li
              aria-selected={selectedIndex === index}
              id={optionId(namespace, service.key)}
              key={service.key}
              role="row"
              style={{ ...styles.row, ...(selectedIndex === index ? styles.selected : {}) }}
            >
              <strong role="gridcell" style={styles.cell}>
                {service.id}
              </strong>
              <span role="gridcell" style={styles.muted}>
                {serviceDetail(service)}
              </span>
              <div role="gridcell" style={styles.actions}>
                <button
                  aria-label={`Open definition for ${service.id}`}
                  disabled={disabled}
                  onClick={() => open(service, "definition")}
                  style={styles.action}
                  type="button"
                >
                  Definition
                </button>
                <button
                  aria-label={`Open PHP class for ${service.id}`}
                  disabled={disabled || !service.className}
                  onClick={() => open(service, "class")}
                  style={styles.action}
                  type="button"
                >
                  PHP Class
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function serviceDetail(service: NetteWorkspaceService): string {
  return [
    service.className,
    service.alias ? `alias: ${service.alias}` : null,
    Array.isArray(service.autowired)
      ? `autowired: ${service.autowired.join(", ")}`
      : service.autowired
        ? "autowired"
        : "not autowired",
    `${service.source.path}:${service.source.lineNumber}`,
  ]
    .filter(Boolean)
    .join(" — ");
}

function optionId(namespace: string, key: string): string {
  return `${namespace}-services-${encodeURIComponent(key)}`;
}

function handleListKey(
  event: KeyboardEvent<HTMLInputElement>,
  itemCount: number,
  setActiveIndex: (update: (current: number) => number) => void,
  openSelected: () => void,
): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveIndex((current) => Math.min(current + 1, Math.max(itemCount - 1, 0)));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveIndex((current) => Math.max(current - 1, 0));
  } else if (event.key === "Home") {
    event.preventDefault();
    setActiveIndex(() => 0);
  } else if (event.key === "End") {
    event.preventDefault();
    setActiveIndex(() => Math.max(itemCount - 1, 0));
  } else if (event.key === "Enter") {
    event.preventDefault();
    openSelected();
  }
}
