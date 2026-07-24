import { RefreshCw, Search } from "lucide-react";
import {
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
  SymfonyConsoleCommand,
  SymfonyRoute,
  SymfonyService,
} from "../domain/symfonyWorkspaceIntelligence";
import {
  SYMFONY_WORKSPACE_PANEL_TABS,
  type SymfonyWorkspacePanelModel,
  type SymfonyWorkspacePanelTab,
} from "../application/symfonyWorkspacePanelModel";

export type SymfonyWorkspacePanelProps = SymfonyWorkspacePanelModel;
type PanelItem = SymfonyConsoleCommand | SymfonyRoute | SymfonyService;

const TAB_LABELS: Record<SymfonyWorkspacePanelTab, string> = {
  commands: "Commands",
  routes: "Routes",
  services: "Services",
};

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
  item: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "grid",
    font: "inherit",
    gap: 12,
    gridTemplateColumns: "minmax(180px, .8fr) minmax(240px, 1.4fr) auto",
    padding: "7px 8px",
    textAlign: "left",
    width: "100%",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  message: { color: "var(--text-muted)", padding: 16 },
  muted: { color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" },
  panel: { height: "100%", overflow: "auto" },
  selected: { background: "var(--selection-background)" },
  tab: {
    background: "transparent",
    border: 0,
    borderBottom: "2px solid transparent",
    color: "inherit",
    cursor: "pointer",
    padding: "6px 10px",
  },
  tabActive: { borderBottomColor: "var(--accent, currentColor)" },
  tabs: { borderBottom: "1px solid var(--border-subtle)", display: "flex", paddingLeft: 4 },
};

export function SymfonyWorkspacePanel(props: SymfonyWorkspacePanelProps): ReactNode {
  const namespace = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const openingRef = useRef(false);
  const items = useMemo(() => activeItems(props), [props]);
  const selectedIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));
  const selected = items[selectedIndex];
  const disabled = props.busy || openingKey !== null;
  const result = activeResult(props);

  useEffect(() => setActiveIndex(0), [props.activeTab, props.query]);

  const open = (item: PanelItem, key: string): void => {
    if (openingRef.current || !hasPrimaryTarget(item)) return;
    openingRef.current = true;
    setOpeningKey(key);
    const operation = openPrimary(props, item);
    void Promise.resolve(operation)
      .finally(() => {
        openingRef.current = false;
        setOpeningKey(null);
      })
      .catch(() => undefined);
  };

  return (
    <section aria-busy={disabled} aria-label="Symfony workspace" style={styles.panel}>
      <div aria-label="Symfony intelligence sections" role="tablist" style={styles.tabs}>
        {SYMFONY_WORKSPACE_PANEL_TABS.map((tab, index) => (
          <button
            aria-controls={`${namespace}-${tab}-panel`}
            aria-selected={props.activeTab === tab}
            id={`${namespace}-${tab}-tab`}
            key={tab}
            onClick={() => props.onTabChange(tab)}
            onKeyDown={(event) => handleTabKey(event, index, props.onTabChange)}
            role="tab"
            style={{ ...styles.tab, ...(props.activeTab === tab ? styles.tabActive : {}) }}
            tabIndex={props.activeTab === tab ? 0 : -1}
            type="button"
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div style={styles.header}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={
            selected ? optionId(namespace, props.activeTab, itemKey(selected)) : undefined
          }
          aria-autocomplete="list"
          aria-controls={`${namespace}-${props.activeTab}-list`}
          aria-expanded="true"
          aria-label={`Filter Symfony ${props.activeTab}`}
          disabled={disabled}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, Math.max(items.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(Math.max(items.length - 1, 0));
            } else if (event.key === "Enter" && selected) {
              event.preventDefault();
              open(selected, itemKey(selected));
            }
          }}
          placeholder={`Filter Symfony ${props.activeTab}`}
          ref={inputRef}
          role="combobox"
          style={styles.input}
          value={props.query}
        />
        <span aria-label={`${TAB_LABELS[props.activeTab]} total`} style={styles.badge}>
          {result.status === "ok" ? result.total : 0}
        </span>
        <button
          aria-label="Refresh Symfony workspace intelligence"
          disabled={disabled}
          onClick={() => void props.onRefresh()}
          style={styles.action}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>

      <div
        aria-labelledby={`${namespace}-${props.activeTab}-tab`}
        id={`${namespace}-${props.activeTab}-panel`}
        role="tabpanel"
      >
        {props.error ? (
          <div role="alert" style={styles.message}>
            {props.error}
          </div>
        ) : null}
        {!props.error && result.status !== "ok" ? (
          <div role={result.status === "error" ? "alert" : "status"} style={styles.message}>
            {result.message}
          </div>
        ) : null}
        {!props.error && result.status === "ok" && result.truncated ? (
          <div role="status" style={styles.message}>
            Results were truncated to keep workspace inspection bounded.
          </div>
        ) : null}
        {!props.error && result.status === "ok" && items.length === 0 ? (
          <div role="status" style={styles.message}>
            {props.query
              ? "No entries match the current filter."
              : `No Symfony ${props.activeTab} found.`}
          </div>
        ) : null}
        {result.status === "ok" && items.length > 0 ? (
          <ul
            aria-label={`Symfony ${props.activeTab}`}
            id={`${namespace}-${props.activeTab}-list`}
            role="grid"
            style={styles.list}
          >
            {items.map((item, index) => {
              const key = itemKey(item);
              return (
                <li
                  aria-selected={selectedIndex === index}
                  id={optionId(namespace, props.activeTab, key)}
                  key={key}
                  role="row"
                  style={selectedIndex === index ? styles.selected : undefined}
                >
                  <div role="gridcell" style={styles.item}>
                    <button
                      disabled={disabled || !hasPrimaryTarget(item)}
                      onClick={() => open(item, key)}
                      style={{ ...styles.item, display: "contents" }}
                      type="button"
                    >
                      <strong>{itemTitle(item)}</strong>
                      <span style={styles.muted}>{itemDetail(item)}</span>
                    </button>
                    <div style={styles.actions}>{itemActions(item, disabled, open)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function activeItems(props: SymfonyWorkspacePanelProps): PanelItem[] {
  if (props.activeTab === "commands") return [...props.filteredCommands];
  if (props.activeTab === "routes") return [...props.filteredRoutes];
  return [...props.filteredServices];
}

function activeResult(props: SymfonyWorkspacePanelProps) {
  if (props.activeTab === "commands") return props.commands;
  if (props.activeTab === "routes") return props.routes;
  return props.services;
}

function itemKey(item: PanelItem): string {
  return item.key;
}

function itemTitle(item: PanelItem): string {
  if ("path" in item) return item.name || item.path;
  if ("id" in item) return item.id;
  return item.name;
}

function itemDetail(item: PanelItem): string {
  if ("path" in item)
    return `${item.methods.join(" | ")} ${item.path}${item.controller ? ` — ${item.controller}` : ""}`;
  if ("id" in item) {
    const visibility =
      item.public === null ? "visibility unknown" : item.public ? "public" : "private";
    return [item.className, item.alias ? `alias: ${item.alias}` : null, visibility]
      .filter(Boolean)
      .join(" — ");
  }
  return [item.description, ...item.aliases].filter(Boolean).join(" — ");
}

function itemActions(
  item: PanelItem,
  disabled: boolean,
  open: (item: PanelItem, key: string) => void,
): ReactNode {
  return (
    <>
      {"path" in item ? (
        <button
          aria-label={`Open controller for ${item.name || item.path}`}
          disabled={disabled || !item.controller}
          onClick={() => open(item, item.key)}
          style={styles.action}
          type="button"
        >
          Controller
        </button>
      ) : null}
      {"id" in item ? (
        <button
          aria-label={`Open service ${item.id}`}
          disabled={disabled || !item.className}
          onClick={() => open(item, item.key)}
          style={styles.action}
          type="button"
        >
          Service
        </button>
      ) : null}
    </>
  );
}

function openPrimary(props: SymfonyWorkspacePanelProps, item: PanelItem): Promise<boolean> {
  if ("path" in item) return props.onOpenRouteController(item);
  if ("id" in item) return props.onOpenService(item);
  return Promise.resolve(false);
}

function hasPrimaryTarget(item: PanelItem): boolean {
  if ("path" in item) return item.controller !== null;
  if ("id" in item) return item.className !== null;
  return false;
}

function optionId(namespace: string, tab: SymfonyWorkspacePanelTab, key: string): string {
  return `${namespace}-${tab}-${encodeURIComponent(key)}`;
}

function handleTabKey(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  select: (tab: SymfonyWorkspacePanelTab) => void,
): void {
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % SYMFONY_WORKSPACE_PANEL_TABS.length;
  else if (event.key === "ArrowLeft") {
    next = (index - 1 + SYMFONY_WORKSPACE_PANEL_TABS.length) % SYMFONY_WORKSPACE_PANEL_TABS.length;
  } else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = SYMFONY_WORKSPACE_PANEL_TABS.length - 1;
  else return;
  event.preventDefault();
  select(SYMFONY_WORKSPACE_PANEL_TABS[next]!);
  const tabs =
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs?.[next]?.focus();
}
