import { FilePlus, FileText, Plus, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import { gitStatusLabel, gitStatusTitle, type GitChangeStatus } from "../../../domain/git";
import { Menu } from "../../../ui/foundation/Menu";
import { MenuItem } from "../../../ui/foundation/MenuItem";
import { PanelTabs, type PanelTabBadge, type PanelTabItem } from "../../../ui/foundation/PanelTabs";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./agentRightPanelSurfaceCatalog";
import {
  selectedAgentRightPanelTabId,
  type AgentRightPanelEditorDocuments,
  type AgentRightPanelTabEntry,
  type AgentTerminalSessionCommand,
} from "./agentRightPanelTabEntries";
import "./rightPanel.css";

export interface AgentRightPanelTabStripProps {
  readonly entries: ReadonlyArray<AgentRightPanelTabEntry>;
  readonly addableSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly editorDocuments: AgentRightPanelEditorDocuments | null;
  onActivateSurface(kind: AgentSurfaceKind): void;
  onCloseSurface(kind: AgentSurfaceKind): void;
  onTerminalSessionCommand(command: AgentTerminalSessionCommand): void;
  onAddSurface(kind: AgentSurfaceKind): void;
  readonly tabPanelsRendered: boolean;
}

interface PendingTabFocus {
  readonly closedId: string;
  readonly candidateIds: ReadonlyArray<string>;
}

export function AgentRightPanelTabStrip(props: AgentRightPanelTabStripProps) {
  const addRef = useRef<HTMLButtonElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<PendingTabFocus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const byId = new Map(props.entries.map((entry) => [entry.id, entry]));
  const selectedId = selectedAgentRightPanelTabId(props.entries);

  const select = (id: string): void => {
    const entry = byId.get(id);
    if (entry === undefined) return;
    activateEntry(entry, props);
  };
  const close = (id: string): void => {
    const entry = byId.get(id);
    if (entry === undefined) return;
    pendingFocusRef.current = pendingFocusAfterClose(id, props.entries, tabsRef.current);
    closeEntry(entry, props);
  };
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    if (props.entries.some((entry) => entry.id === pending.closedId)) return;
    pendingFocusRef.current = null;
    focusNeighborTab(pending, props.entries, tabsRef.current);
  }, [props.entries]);
  useEffect(() => {
    if (selectedId === null) return;
    revealSelectedTab(tabsRef.current);
  }, [selectedId]);
  useEffect(() => {
    const strip = tabsRef.current;
    if (strip === null || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => revealSelectedTab(strip));
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);
  const pin = (id: string): void => {
    const entry = byId.get(id);
    if (entry === undefined || entry.kind !== "editorDocument") return;
    props.editorDocuments?.onPin(entry.documentId);
  };
  const add = (kind: AgentSurfaceKind): void => {
    setMenuOpen(false);
    props.onAddSurface(kind);
  };

  return (
    <div className="cv-rp-strip">
      <div className="cv-rp-strip__tabs" ref={tabsRef}>
        <PanelTabs
          label="Panel surfaces"
          onClose={close}
          onPin={pin}
          onSelect={select}
          selectedId={selectedId}
          tabs={props.entries.map((entry) => panelTab(entry, props.tabPanelsRendered))}
        />
      </div>
      {props.editorDocuments !== null && (
        <button
          aria-label="Open file"
          className="cv-icon-button cv-icon-button--xs"
          onClick={props.editorDocuments.onOpenFile}
          title="Open file ⌘P"
          type="button"
        >
          <span aria-hidden="true" className="cv-icon-button__glyph">
            <FilePlus size={14} />
          </span>
        </button>
      )}
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Add panel surface"
        className="cv-icon-button cv-icon-button--xs"
        onClick={() => setMenuOpen((open) => !open)}
        ref={addRef}
        title="Add surface"
        type="button"
      >
        <span aria-hidden="true" className="cv-icon-button__glyph">
          <Plus size={14} />
        </span>
      </button>
      <Menu
        anchorRef={addRef}
        label="Add panel surface"
        onClose={() => setMenuOpen(false)}
        open={menuOpen}
      >
        {props.addableSurfaces.map((kind) => {
          const descriptor = AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind];
          const Icon = descriptor.icon;
          return (
            <MenuItem
              icon={<Icon size={14} />}
              key={kind}
              onSelect={() => add(kind)}
              shortcut={descriptor.addMenuShortcut ?? undefined}
            >
              {descriptor.label}
            </MenuItem>
          );
        })}
      </Menu>
    </div>
  );
}

function revealSelectedTab(strip: HTMLElement | null): void {
  const tab = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (typeof tab?.scrollIntoView !== "function") return;
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function pendingFocusAfterClose(
  closedId: string,
  entries: ReadonlyArray<AgentRightPanelTabEntry>,
  tabs: HTMLElement | null,
): PendingTabFocus | null {
  if (tabs === null || !tabs.contains(document.activeElement)) return null;
  const index = entries.findIndex((entry) => entry.id === closedId);
  if (index === -1) return null;
  const candidateIds = [entries[index + 1]?.id, entries[index - 1]?.id].filter(
    (id): id is string => id !== undefined,
  );
  return { closedId, candidateIds };
}

function focusNeighborTab(
  pending: PendingTabFocus,
  entries: ReadonlyArray<AgentRightPanelTabEntry>,
  tabs: HTMLElement | null,
): void {
  if (tabs === null) return;
  const focused = document.activeElement;
  if (focused !== null && focused !== document.body && !tabs.contains(focused)) return;
  const targetId = pending.candidateIds.find((id) => entries.some((entry) => entry.id === id));
  if (targetId === undefined) return;
  const index = entries.findIndex((entry) => entry.id === targetId);
  tabs.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
}

function panelTab(entry: AgentRightPanelTabEntry, tabPanelsRendered: boolean): PanelTabItem {
  const panelId = tabPanelsRendered ? entry.panelId : undefined;
  switch (entry.kind) {
    case "surface": {
      const Icon = AGENT_RIGHT_PANEL_SURFACE_CATALOG[entry.surface].icon;
      return { id: entry.id, title: entry.label, icon: <Icon size={14} />, panelId };
    }
    case "terminalSession":
      return {
        id: entry.id,
        title: entry.label,
        icon: <SquareTerminal size={14} />,
        panelId,
        live: entry.live,
        closable: entry.closable,
      };
    case "editorDocument":
      return {
        id: entry.id,
        title: entry.label,
        icon: <FileText size={14} />,
        panelId,
        dirty: entry.dirty,
        preview: entry.preview,
        badge: entry.gitStatus === null ? undefined : gitStatusBadge(entry.gitStatus),
      };
  }
}

function activateEntry(entry: AgentRightPanelTabEntry, props: AgentRightPanelTabStripProps): void {
  switch (entry.kind) {
    case "surface":
      props.onActivateSurface(entry.surface);
      return;
    case "terminalSession":
      props.onActivateSurface("terminal");
      props.onTerminalSessionCommand({ kind: "activate", sessionId: entry.sessionId });
      return;
    case "editorDocument":
      props.editorDocuments?.onActivate(entry.documentId);
      return;
  }
}

function closeEntry(entry: AgentRightPanelTabEntry, props: AgentRightPanelTabStripProps): void {
  switch (entry.kind) {
    case "surface":
      props.onCloseSurface(entry.surface);
      return;
    case "terminalSession":
      props.onTerminalSessionCommand({ kind: "close", sessionId: entry.sessionId });
      return;
    case "editorDocument":
      props.editorDocuments?.onClose(entry.documentId);
      return;
  }
}

function gitStatusBadge(status: GitChangeStatus): PanelTabBadge {
  return {
    label: gitStatusLabel(status),
    title: gitStatusTitle(status),
    tone: gitStatusTone(status),
  };
}

function gitStatusTone(status: GitChangeStatus): PanelTabBadge["tone"] {
  switch (status) {
    case "added":
    case "renamed":
    case "untracked":
      return "ok";
    case "modified":
      return "warn";
    case "deleted":
    case "conflicted":
      return "danger";
  }
}
