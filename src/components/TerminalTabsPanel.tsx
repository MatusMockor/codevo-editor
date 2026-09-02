import { Plus, X } from "lucide-react";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  MAX_TERMINAL_TABS,
  createTerminalTab,
  emptyTerminalTabSet,
  reduceTerminalTabSet,
  type TerminalTabSet,
} from "../domain/terminalTabSet";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type {
  AgentProviderSignInSurface,
  AgentProviderSignInTerminalIntent,
} from "../application/useAgentProviderSignIn";
import { TerminalPanel } from "./TerminalPanel";

interface TerminalRuntime {
  readonly cwd: string | null;
  readonly profileId: string | null;
  readonly sessionId: number | null;
  readonly signInIntent?: AgentProviderSignInTerminalIntent;
}

export interface TerminalTabsPanelProps {
  readonly isActive: boolean;
  readonly layoutRevision?: number;
  readonly ownerKey: string;
  readonly profileId: string | null;
  readonly profileLabel: string | null;
  readonly rootPath: string | null;
  readonly shellIntegrationEnabled: boolean;
  readonly terminalGateway: TerminalGateway;
  readonly terminalTheme: TerminalTheme;
  readonly toolbarHost?: HTMLElement | null;
  readonly providerSignIn?: AgentProviderSignInSurface;
  onActiveCwdChange?(cwd: string | null): void;
  onActiveProfileChange?(profileId: string | null): void;
  onActiveSessionReady?(sessionId: number | null): void;
  onOpenLink?(path: string, line?: number, column?: number): void;
}

const styles: Record<string, CSSProperties> = {
  shell: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
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
    onActiveSessionReadyRef.current?.(
      current?.signInIntent === undefined ? (current?.sessionId ?? null) : null,
    );
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
    if (!current || current.signInIntent !== undefined || current.profileId === props.profileId)
      return;
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

  useEffect(() => {
    if (!props.providerSignIn) return;
    for (const provider of ["claudeCode", "codex"] as const) {
      const intent = props.providerSignIn.terminalIntents[provider];
      if (intent === null) continue;
      const id = signInTabId(intent);
      if (liveTabIdsRef.current.has(id)) continue;
      if (liveTabIdsRef.current.size >= MAX_TERMINAL_TABS) {
        const evictedTabId = [...tabs.mruTabIds]
          .reverse()
          .find(
            (tabId) =>
              liveTabIdsRef.current.has(tabId) &&
              signInTabIsEvictable(runtimeRef.current.get(tabId), props.providerSignIn),
          );
        if (!evictedTabId) continue;
        liveTabIdsRef.current.delete(evictedTabId);
        updateRuntime(evictedTabId, () => undefined);
        dispatch({ ownerKey: props.ownerKey, tabId: evictedTabId, type: "close" });
      }
      const tab = createTerminalTab(
        id,
        provider === "claudeCode" ? "Claude sign-in" : "Codex sign-in",
      );
      if (!tab) continue;
      liveTabIdsRef.current.add(id);
      activeTabIdRef.current = id;
      updateRuntime(id, () => ({
        cwd: null,
        profileId: null,
        sessionId: null,
        signInIntent: intent,
      }));
      onActiveSessionReadyRef.current?.(null);
      onActiveCwdChangeRef.current?.(null);
      dispatch({ ownerKey: props.ownerKey, tab, type: "create" });
    }
  }, [props.ownerKey, props.providerSignIn, props.providerSignIn?.terminalIntents, tabs.mruTabIds]);

  const toolbar = (
    <div className="terminal-tabs-toolbar">
      <div
        aria-label="Terminal sessions"
        className="terminal-tabs-toolbar__sessions"
        role="tablist"
      >
        {tabs.tabs.map((tab, index) => {
          const selected = tab.id === tabs.activeTabId;
          return (
            <span className="terminal-tabs-toolbar__session" key={tab.id} role="presentation">
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
                className="terminal-tabs-toolbar__tab"
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {tab.title}
              </button>
              <button
                aria-label={`Close ${tab.title}`}
                disabled={
                  tabs.tabs.length === 1 ||
                  signInTabIsAwaitingSession(runtime.get(tab.id), props.providerSignIn)
                }
                className="terminal-tabs-toolbar__close"
                onClick={() => close(tab.id)}
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
        className="terminal-tabs-toolbar__new"
        disabled={tabs.tabs.length >= MAX_TERMINAL_TABS}
        onClick={create}
        type="button"
      >
        <Plus aria-hidden="true" size={14} />
      </button>
    </div>
  );

  return (
    <section aria-label="Terminal tabs" style={styles.shell}>
      {props.toolbarHost === undefined
        ? toolbar
        : props.toolbarHost
          ? createPortal(toolbar, props.toolbarHost)
          : null}
      <div style={styles.viewport}>
        {tabs.tabs.map((tab) => {
          const metadata = runtime.get(tab.id);
          const active = tab.id === tabs.activeTabId;
          return (
            <TerminalPanel
              isActive={props.isActive && active}
              key={tab.id}
              labelledBy={`${tab.id}-tab`}
              layoutRevision={props.layoutRevision}
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
                if (activeTabIdRef.current === tab.id) {
                  onActiveSessionReadyRef.current?.(
                    metadata?.signInIntent === undefined ? sessionId : null,
                  );
                }
              }}
              panelId={`${tab.id}-panel`}
              profileId={metadata?.profileId ?? null}
              rootPath={props.rootPath}
              semanticSession={
                metadata?.signInIntent && props.providerSignIn
                  ? {
                      key: signInTabId(metadata.signInIntent),
                      cancelStart: () => props.providerSignIn!.cancelStart(metadata.signInIntent!),
                      start: async (size) => {
                        const result = await props.providerSignIn!.start(
                          metadata.signInIntent!,
                          size,
                        );
                        if (result?.kind !== "started") {
                          throw new Error("Provider sign-in terminal did not start.");
                        }
                        return { kind: "starting", sessionId: result.sessionId };
                      },
                      settle: (sessionId, exitCode) =>
                        props.providerSignIn!.settle(metadata.signInIntent!, sessionId, exitCode),
                    }
                  : undefined
              }
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

function signInTabId(intent: AgentProviderSignInTerminalIntent): string {
  return `provider-sign-in-${intent.provider}-${intent.intentId}`;
}

function signInTabIsAwaitingSession(
  runtime: TerminalRuntime | undefined,
  providerSignIn: AgentProviderSignInSurface | undefined,
): boolean {
  const intent = runtime?.signInIntent;
  if (intent === undefined || runtime?.sessionId !== null) return false;
  const state = providerSignIn?.states[intent.provider];
  const currentIntent = providerSignIn?.terminalIntents[intent.provider];
  return (
    currentIntent !== null &&
    currentIntent !== undefined &&
    signInIntentsAreEqual(currentIntent, intent) &&
    (state?.kind === "starting" || state?.kind === "running") &&
    state.providerGeneration === intent.providerGeneration
  );
}

function signInTabIsEvictable(
  runtime: TerminalRuntime | undefined,
  providerSignIn: AgentProviderSignInSurface | undefined,
): boolean {
  const intent = runtime?.signInIntent;
  if (intent === undefined) return true;
  if (providerSignIn === undefined) return false;
  const currentIntent = providerSignIn.terminalIntents[intent.provider];
  return currentIntent === null || !signInIntentsAreEqual(currentIntent, intent);
}

function signInIntentsAreEqual(
  current: AgentProviderSignInTerminalIntent,
  candidate: AgentProviderSignInTerminalIntent,
): boolean {
  return (
    current.intentId === candidate.intentId &&
    current.provider === candidate.provider &&
    current.providerGeneration === candidate.providerGeneration &&
    current.revision === candidate.revision
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
