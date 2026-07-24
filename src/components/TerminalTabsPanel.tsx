import { Plus, X } from "lucide-react";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  MAX_TERMINAL_TABS,
  createTerminalTab,
  emptyTerminalTabSet,
  reduceTerminalTabSet,
  type TerminalTabSet,
} from "../domain/terminalTabSet";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import { TerminalPanel } from "./TerminalPanel";

interface TerminalRuntime {
  readonly cwd: string | null;
  readonly profileId: string | null;
  readonly sessionId: number | null;
}

export interface TerminalTabsPanelProps {
  readonly isActive: boolean;
  readonly ownerKey: string;
  readonly profileId: string | null;
  readonly profileLabel: string | null;
  readonly rootPath: string | null;
  readonly shellIntegrationEnabled: boolean;
  readonly terminalGateway: TerminalGateway;
  readonly terminalTheme: TerminalTheme;
  onActiveCwdChange?(cwd: string | null): void;
  onActiveProfileChange?(profileId: string | null): void;
  onActiveSessionReady?(sessionId: number | null): void;
  onOpenLink?(path: string, line?: number, column?: number): void;
}

const styles: Record<string, CSSProperties> = {
  action: { background: "transparent", border: 0, color: "inherit", padding: 4 },
  close: { background: "transparent", border: 0, color: "inherit", padding: 2 },
  shell: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  tab: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    gap: 4,
    padding: "4px 7px",
  },
  tablist: { alignItems: "center", display: "flex", flex: "0 0 auto", overflowX: "auto" },
  viewport: { flex: "1 1 auto", minHeight: 0 },
};

export function TerminalTabsPanel(props: TerminalTabsPanelProps) {
  const [tabs, dispatch] = useReducer(reduceTerminalTabSet, props.ownerKey, initialTerminalTabs);
  const [runtime, setRuntime] = useState<ReadonlyMap<string, TerminalRuntime>>(
    () =>
      new Map([[tabs.activeTabId!, { cwd: null, profileId: props.profileId, sessionId: null }]]),
  );
  const sequenceRef = useRef(1);
  const runtimeRef = useRef(runtime);
  const activeTabIdRef = useRef(tabs.activeTabId);
  const liveTabIdsRef = useRef(new Set(tabs.tabs.map(({ id }) => id)));
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterCloseRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const onActiveCwdChangeRef = useRef(props.onActiveCwdChange);
  const onActiveProfileChangeRef = useRef(props.onActiveProfileChange);
  const onActiveSessionReadyRef = useRef(props.onActiveSessionReady);
  runtimeRef.current = runtime;
  activeTabIdRef.current = tabs.activeTabId;
  liveTabIdsRef.current = new Set(tabs.tabs.map(({ id }) => id));
  onActiveCwdChangeRef.current = props.onActiveCwdChange;
  onActiveProfileChangeRef.current = props.onActiveProfileChange;
  onActiveSessionReadyRef.current = props.onActiveSessionReady;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onActiveSessionReadyRef.current?.(null);
      onActiveCwdChangeRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    const tabId = focusAfterCloseRef.current;
    if (!tabId) return;
    focusAfterCloseRef.current = null;
    tabButtonRefs.current.get(tabId)?.focus();
  }, [tabs.tabs]);

  const publishActive = (tabId: string | null, source = runtimeRef.current) => {
    const current = tabId ? source.get(tabId) : null;
    onActiveSessionReadyRef.current?.(current?.sessionId ?? null);
    onActiveCwdChangeRef.current?.(current?.cwd ?? null);
    onActiveProfileChangeRef.current?.(current?.profileId ?? null);
  };
  const updateRuntime = (
    tabId: string,
    update: (current: TerminalRuntime | undefined) => TerminalRuntime | undefined,
  ) => {
    const next = new Map(runtimeRef.current);
    const updated = update(next.get(tabId));
    if (updated) next.set(tabId, updated);
    else next.delete(tabId);
    runtimeRef.current = next;
    setRuntime(next);
    return next;
  };
  const activate = (tabId: string) => {
    if (!liveTabIdsRef.current.has(tabId) || activeTabIdRef.current === tabId) return;
    activeTabIdRef.current = tabId;
    publishActive(tabId);
    dispatch({ ownerKey: props.ownerKey, tabId, type: "activate" });
  };
  const create = () => {
    if (tabs.tabs.length >= MAX_TERMINAL_TABS) return;
    const id = `terminal-${sequenceRef.current++}`;
    const fallbackTitle = `Terminal ${sequenceRef.current}`;
    const preferredTitle = props.profileLabel?.trim() || fallbackTitle;
    const tab = createTerminalTab(id, preferredTitle) ?? createTerminalTab(id, fallbackTitle);
    if (!tab) return;
    liveTabIdsRef.current.add(id);
    activeTabIdRef.current = id;
    updateRuntime(id, () => ({ cwd: null, profileId: props.profileId, sessionId: null }));
    onActiveSessionReadyRef.current?.(null);
    onActiveCwdChangeRef.current?.(null);
    dispatch({ ownerKey: props.ownerKey, tab, type: "create" });
  };
  const close = (tabId: string) => {
    if (tabs.tabs.length === 1 || !liveTabIdsRef.current.has(tabId)) return;
    const closingElement = tabButtonRefs.current.get(tabId)?.parentElement;
    const restoreFocus = closingElement?.contains(document.activeElement) ?? false;
    const closingWasActive = activeTabIdRef.current === tabId;
    liveTabIdsRef.current.delete(tabId);
    const fallback = closingWasActive
      ? (tabs.mruTabIds.find((id) => id !== tabId && liveTabIdsRef.current.has(id)) ?? null)
      : activeTabIdRef.current;
    activeTabIdRef.current = fallback;
    if (restoreFocus) focusAfterCloseRef.current = fallback;
    const next = updateRuntime(tabId, () => undefined);
    if (closingWasActive) publishActive(fallback, next);
    dispatch({ ownerKey: props.ownerKey, tabId, type: "close" });
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Delete") {
      event.preventDefault();
      const id = tabs.tabs[index]?.id;
      if (id) close(id);
      return;
    }
    let target = index;
    if (event.key === "ArrowRight") target = (index + 1) % tabs.tabs.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + tabs.tabs.length) % tabs.tabs.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.tabs.length - 1;
    else return;
    event.preventDefault();
    const id = tabs.tabs[target]?.id;
    if (id) {
      activate(id);
      tabButtonRefs.current.get(id)?.focus();
    }
  };

  useEffect(() => {
    const tabId = activeTabIdRef.current;
    if (!tabId || !liveTabIdsRef.current.has(tabId)) return;
    const current = runtimeRef.current.get(tabId);
    if (!current || current.profileId === props.profileId) return;
    const next = new Map(runtimeRef.current);
    next.set(tabId, {
      cwd: null,
      profileId: props.profileId,
      sessionId: null,
    });
    runtimeRef.current = next;
    setRuntime(next);
    onActiveSessionReadyRef.current?.(null);
    onActiveCwdChangeRef.current?.(null);
  }, [props.profileId]);

  return (
    <section aria-label="Terminal tabs" style={styles.shell}>
      <div style={styles.tablist}>
        <div aria-label="Terminal sessions" role="tablist" style={{ display: "flex" }}>
          {tabs.tabs.map((tab, index) => {
            const selected = tab.id === tabs.activeTabId;
            return (
              <span key={tab.id} role="presentation">
                <button
                  aria-controls={`${tab.id}-panel`}
                  aria-selected={selected}
                  id={`${tab.id}-tab`}
                  onClick={() => activate(tab.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  ref={(button) => {
                    if (button) tabButtonRefs.current.set(tab.id, button);
                    else tabButtonRefs.current.delete(tab.id);
                  }}
                  role="tab"
                  style={styles.tab}
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {tab.title}
                </button>
                <button
                  aria-label={`Close ${tab.title}`}
                  disabled={tabs.tabs.length === 1}
                  onClick={() => close(tab.id)}
                  style={styles.close}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </span>
            );
          })}
        </div>
        <button
          aria-label="New Terminal"
          disabled={tabs.tabs.length >= MAX_TERMINAL_TABS}
          onClick={create}
          style={styles.action}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
        </button>
      </div>
      <div style={styles.viewport}>
        {tabs.tabs.map((tab) => {
          const metadata = runtime.get(tab.id);
          const active = tab.id === tabs.activeTabId;
          return (
            <TerminalPanel
              isActive={props.isActive && active}
              key={tab.id}
              labelledBy={`${tab.id}-tab`}
              onCwdChange={(cwd) => {
                if (!mountedRef.current || !liveTabIdsRef.current.has(tab.id)) return;
                updateRuntime(tab.id, (previous) => (previous ? { ...previous, cwd } : undefined));
                if (activeTabIdRef.current === tab.id) onActiveCwdChangeRef.current?.(cwd);
              }}
              onOpenLink={(path, line, column) => {
                if (
                  !mountedRef.current ||
                  !liveTabIdsRef.current.has(tab.id) ||
                  activeTabIdRef.current !== tab.id
                ) {
                  return;
                }
                return props.onOpenLink?.(path, line, column);
              }}
              onSessionReady={(sessionId) => {
                if (!mountedRef.current || !liveTabIdsRef.current.has(tab.id)) return;
                updateRuntime(tab.id, (previous) =>
                  previous ? { ...previous, sessionId } : undefined,
                );
                if (activeTabIdRef.current === tab.id) onActiveSessionReadyRef.current?.(sessionId);
              }}
              panelId={`${tab.id}-panel`}
              profileId={metadata?.profileId ?? null}
              rootPath={props.rootPath}
              shellIntegrationEnabled={props.shellIntegrationEnabled}
              terminalGateway={props.terminalGateway}
              terminalTheme={props.terminalTheme}
            />
          );
        })}
      </div>
    </section>
  );
}

function initialTerminalTabs(ownerKey: string): TerminalTabSet {
  const owned = reduceTerminalTabSet(emptyTerminalTabSet(), {
    ownerKey,
    type: "replace-owner",
  });
  return reduceTerminalTabSet(owned, {
    ownerKey,
    tab: { id: "terminal-0", title: "Terminal 1" },
    type: "create",
  });
}
