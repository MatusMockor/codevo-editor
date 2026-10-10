// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadSearchSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type {
  AgentHistoryCatalogRow,
  AgentHistoryCatalogSurface,
} from "../../application/useAgentHistoryCatalog";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentThread, AgentTurnStatus } from "../../domain/agentThread";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThreadSearchResult } from "../../domain/agentThreadSearch";
import type { AgentThreadBulkCommand } from "../../domain/agentThreadBulkAction";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import {
  AGENT_THREAD_BULK_CONFIRM_DELAY_MS,
  agentThreadBulkOwnerKey,
  agentThreadBulkPlan,
} from "../../domain/agentThreadBulkAction";
import { agentThreadBulkCandidates } from "./useAgentThreadMenuCommands";
import { __resetKeymapPlatformCacheForTests } from "../../domain/keymap";
import { createAgentTurnLogFactsStore } from "../../application/agentTurnLogStatusStore";
import { AgentClockProvider } from "./agentClock";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { readStyleSheet } from "../cssContractTestSupport";
import { readAgentModeStyles } from "./agentModeCssTestSupport";
import type { AgentProjectGroup } from "./agentModePresentation";
import { AgentThreadsSidebar, type AgentThreadsSidebarProps } from "./AgentThreadsSidebar";
import { useAgentRailProjectDisclosure } from "./useAgentRailProjectDisclosure";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS, agentRailScopeEntries } from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";
const NOW = 1_700_000_600_000;
const AGENT_MODE_CSS = readAgentModeStyles();
const SIDEBAR_CSS = readStyleSheet("components/agentMode/agentSidebar.css").source;
const ROOT_OWNER = agentThreadBulkOwnerKey({ rootKey: ROOT, ownerId: `agent-root:${ROOT}` });

type SidebarHarnessProps = Omit<AgentThreadsSidebarProps, "projectDisclosure"> &
  Partial<Pick<AgentThreadsSidebarProps, "projectDisclosure">>;

function SidebarHarness({ projectDisclosure, ...props }: SidebarHarnessProps) {
  const disclosure = useAgentRailProjectDisclosure(null);
  return <AgentThreadsSidebar {...props} projectDisclosure={projectDisclosure ?? disclosure} />;
}

describe("AgentThreadsSidebar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    __resetKeymapPlatformCacheForTests();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    restoreNavigator();
    __resetKeymapPlatformCacheForTests();
  });

  it("moves a dragged thread within its project across active and pinned sections", () => {
    const command = vi.fn();
    const views = threeThreads();
    const pinned = { ...views[2]!, thread: { ...views[2]!.thread, pinned: true } };
    render({
      groups: [group(ROOT, "app", [views[0]!, views[1]!, pinned])],
      onThreadMenuCommand: command,
    });
    const drag = (type: string, id: string) => {
      const row = host.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!;
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 0 });
      Object.defineProperty(event, "dataTransfer", {
        value: { setData: vi.fn(), effectAllowed: "", dropEffect: "" },
      });
      act(() => row.dispatchEvent(event));
    };
    drag("dragstart", "agt-2");
    drag("drop", "agt-1");
    expect(command).toHaveBeenCalledWith("agt-2", {
      kind: "moveBefore",
      targetThreadId: "agt-1",
      destination: "active",
    });
    command.mockClear();
    drag("dragstart", "agt-2");
    drag("drop", "agt-3");
    expect(command).toHaveBeenCalledWith("agt-2", {
      kind: "moveBefore",
      targetThreadId: "agt-3",
      destination: "pinned",
    });
    command.mockClear();
    drag("drop", "agt-1");
    expect(command).not.toHaveBeenCalled();
  });

  it("offers empty destination zones and rejects foreign projects, snoozed targets and stale drag owners", () => {
    const command = vi.fn();
    const views = threeThreads();
    const foreign = {
      ...views[1]!,
      thread: {
        ...views[1]!.thread,
        owner: { ...views[1]!.thread.owner, ownerId: "another-owner" },
      },
    };
    const sleeping = { ...views[2]!, thread: { ...views[2]!.thread, snoozedUntil: NOW + 1000 } };
    const draw = (first = views[0]!) =>
      render({
        groups: [group(ROOT, "app", [first, foreign, sleeping])],
        onThreadMenuCommand: command,
      });
    draw();
    click('.cv-sb-shelf[data-shelf="snoozed"]');
    const dispatch = (type: string, selector: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 0 });
      Object.defineProperty(event, "dataTransfer", {
        value: { setData: vi.fn(), effectAllowed: "", dropEffect: "" },
      });
      act(() => host.querySelector(selector)!.dispatchEvent(event));
    };
    const start = () => {
      dispatch("dragstart", '[data-thread-id="agt-1"]');
    };
    start();
    expect(host.querySelector('[data-thread-drop-section="pinned"]')).not.toBeNull();
    dispatch("drop", '[data-thread-drop-section="pinned"]');
    expect(command).toHaveBeenCalledWith("agt-1", {
      kind: "moveAfter",
      targetThreadId: "agt-1",
      destination: "pinned",
    });
    command.mockClear();
    for (const id of ["agt-2", "agt-3"]) {
      start();
      dispatch("drop", `[data-thread-id="${id}"]`);
      expect(command).not.toHaveBeenCalled();
    }
    start();
    draw({
      ...views[0]!,
      thread: { ...views[0]!.thread, owner: { ...views[0]!.thread.owner, ownerId: "replaced" } },
    });
    dispatch("drop", '[data-thread-drop-section="settled"]');
    expect(command).not.toHaveBeenCalled();
  });

  it("keeps Settled collapsed behind a counted shelf and excludes its rows from keyboard navigation", () => {
    const [first, second] = threeThreads();
    const settledView = { ...second!, thread: { ...second!.thread, settledAt: NOW - 1_000 } };
    render({ groups: [group(ROOT, "app", [first!, settledView])] });
    const shelf = settledShelf();
    expect(shelf?.textContent).toContain("Settled (1)");
    expect(shelf?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[data-thread-id="agt-2"]')).toBeNull();
    act(() => row("agt-1").focus());
    key(row("agt-1"), "End");
    expect(document.activeElement).toBe(row("agt-1"));
    act(() => shelf?.click());
    expect(settledShelf()?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-thread-id="agt-2"]')).not.toBeNull();
    key(row("agt-1"), "End");
    expect(document.activeElement).toBe(row("agt-2"));
  });

  it("collapses Snoozed behind a counted shelf", () => {
    const [first, second] = threeThreads();
    const sleeping = { ...second!, thread: { ...second!.thread, snoozedUntil: NOW + 60_000 } };
    render({ groups: [group(ROOT, "app", [first!, sleeping])] });
    const shelf = [...host.querySelectorAll<HTMLButtonElement>("button.cv-sb-shelf")].find(
      (button) => button.textContent?.startsWith("Snoozed"),
    );
    expect(shelf?.textContent).toContain("Snoozed (1)");
    expect(host.querySelector('[data-thread-id="agt-2"]')).toBeNull();
    act(() => shelf?.click());
    expect(host.querySelector('[data-thread-id="agt-2"]')).not.toBeNull();
  });

  it("hides the Pins and Active drop markers until a drag starts", () => {
    render({ groups: [group(ROOT, "app", threeThreads())] });
    const list = host.querySelector(".agent-list");
    expect(list?.getAttribute("data-dragging")).toBeNull();
    const event = new MouseEvent("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: vi.fn(), effectAllowed: "", dropEffect: "" },
    });
    act(() => row("agt-1").dispatchEvent(event));
    expect(host.querySelector(".agent-list")?.getAttribute("data-dragging")).toBe("true");
    act(() => {
      row("agt-1").dispatchEvent(new MouseEvent("dragend", { bubbles: true }));
    });
    expect(host.querySelector(".agent-list")?.getAttribute("data-dragging")).toBeNull();
  });

  it("shows search hits with the project monogram and relative time", () => {
    const search = searchSurface("parser", {
      query: "parser",
      truncated: false,
      documentsTruncated: false,
      matches: [
        {
          threadId: "agt-1",
          source: "title",
          turnId: null,
          eventIndex: null,
          snippet: "Fix the parser",
          ranges: [{ start: 8, end: 14 }],
          segmentStart: 8,
          segmentEnd: 14,
          score: 1,
        },
      ],
    });
    render({ search });
    const option = host.querySelector(".cv-sb-results .cv-sr");
    expect(option?.querySelector(".cv-favicon")?.textContent).toBe("A");
    expect(option?.querySelector(".cv-sr__title mark")?.textContent).toBe("parser");
    expect(option?.querySelector(".cv-sr__when")?.textContent).toBe("2m");
  });

  it("titles a rail search hit on an archived thread without rendering it as a rail row", () => {
    const search = searchSurface("parser", {
      query: "parser",
      truncated: false,
      documentsTruncated: false,
      matches: [
        {
          threadId: "arc-1",
          source: "assistant",
          turnId: "turn-1",
          eventIndex: null,
          snippet: "the parser change",
          ranges: [{ start: 4, end: 10 }],
          segmentStart: 4,
          segmentEnd: 10,
          score: 1,
        },
      ],
    });
    render({
      groups: [group(ROOT, "app", [settled("arc-1", "Old parser work", { archived: true })])],
      search,
    });

    const option = host.querySelector(".cv-sb-results .cv-sr");
    expect(option?.textContent).toContain("Old parser work");
    expect(option?.textContent).not.toContain("arc-1");
    expect(host.querySelector('[data-thread-id="arc-1"]')).toBeNull();
  });

  it("moves snoozed rows back to active at their deadline without a data refresh", () => {
    const original = settled("sleep", "Sleeping");
    const sleeping = { ...original, thread: { ...original.thread, snoozedUntil: NOW + 1000 } };
    render({ groups: [group(ROOT, "app", [sleeping])] });
    expect(host.textContent).toContain("Snoozed (1)");
    act(() => vi.advanceTimersByTime(1000));
    expect(host.textContent).not.toContain("Snoozed (1)");
    expect(host.querySelector('[data-thread-id="sleep"]')).not.toBeNull();
  });

  it("renders the chrome, search row and scope row without headings or filters", () => {
    render();

    expect(host.querySelector('[aria-label="Collapse sidebar"]')).not.toBeNull();
    expect(
      host.querySelector('input[role="combobox"][aria-label="Search threads"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="New thread"]')).not.toBeNull();
    expect(host.querySelector('[aria-label^="Filter threads by project"]')).toBeNull();
    expect(host.querySelector('[aria-label="Add project"]')).not.toBeNull();
    expect(host.querySelector(".agent-rail__title")).toBeNull();
    expect(host.querySelector(".agent-rail__filters")).toBeNull();
    expect(host.textContent).not.toContain("running");
  });

  it("asks the turn log for the facts of the visible rows, bounded to eight threads", () => {
    const store = createAgentTurnLogFactsStore(() => 0);
    const asked: Array<{ threadId: string; turnIds: ReadonlyArray<string> }> = [];
    const turnLog = {
      ...store,
      ensureThreadFacts: (threadId: string, turnIds: ReadonlyArray<string>) => {
        asked.push({ threadId, turnIds });
        return Promise.resolve();
      },
    };
    const views = Array.from({ length: 6 }, (_unused, index) =>
      settled(`agt-${index}`, `Thread ${index}`, { updatedAtEpochMs: NOW - index * 60_000 }),
    );
    const others = Array.from({ length: 6 }, (_unused, index) =>
      settled(`api-${index}`, `Api ${index}`, {
        repositoryRoot: OTHER,
        updatedAtEpochMs: NOW - index * 60_000,
      }),
    );

    render({ groups: [group(ROOT, "app", views), group(OTHER, "api", others)], turnLog });

    expect(asked).toHaveLength(8);
    expect(asked.map((entry) => entry.threadId)).toEqual([
      ...views.map((view) => view.thread.threadId),
      "api-0",
      "api-1",
    ]);
    expect(asked[0]?.turnIds).toEqual(["agt-0-t1"]);
  });

  it("hands the rail chrome row to the window as a drag region", () => {
    render();

    const chrome = host.querySelector(".cv-topbar--sidebar");
    expect(chrome?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(
      chrome
        ?.querySelector('[aria-label="Collapse sidebar"]')
        ?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
  });

  it("puts the collapse control in the sidebar top bar with its chord", () => {
    render();

    const collapse = host.querySelector<HTMLButtonElement>(
      '.cv-topbar--sidebar button[aria-label="Collapse sidebar"]',
    );
    expect(collapse?.title).toBe("Collapse sidebar (⌘B)");
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
  });

  it("places provider status after the independently scrolling thread list", () => {
    render();

    const scroll = host.querySelector(".agent-rail__scroll");
    expect(scroll?.nextElementSibling).toBe(host.querySelector(".agent-provider-footer"));
  });

  it("pins the rail frame", () => {
    expect(cssRule("\n.agent-rail {")).toContain("background: var(--cv-side)");
    expect(cssRule("\n.agent-rail {")).toContain("padding: 0 6px 8px");
    expect(cssRule("\n.agent-rail {")).toContain("box-shadow: var(--cv-edge-end-divider)");
    expect(AGENT_MODE_CSS).not.toContain(".agent-rail__chrome");
    expect(cssRule("\n.agent-rail__scroll {")).toContain("padding: 6px 4px 4px");
    expect(cssRule(".agent-iconbutton {")).toContain("width: 32px");
    expect(cssRule(".agent-iconbutton {")).toContain("border-radius: var(--cv-r-control)");
  });

  it("styles the thread search palette as a raised 12px sheet with primary marks", () => {
    const palette = cssRule("\n.agent-thread-palette {");
    expect(palette).toContain("border-radius: var(--cv-r-group)");
    expect(palette).toContain("background: var(--cv-raised)");
    expect(palette).toContain("box-shadow: var(--cv-shadow-pop)");
    expect(cssRule(".agent-thread-palette .palette-search {")).toContain("border-bottom: 0");
    expect(cssRule(".agent-thread-palette .palette-search input {")).toContain("height: 46px");
    expect(cssRule(".agent-search-row {")).toContain("min-height: 32px");
    expect(cssRule(".agent-search-row--active {")).toContain("background: var(--cv-row-hover)");
    expect(cssRule(".agent-search-row--active {")).not.toContain("box-shadow");
    const mark = cssRule(".agent-search-row__title mark,\n.agent-search-row__snippet mark {");
    expect(mark).toContain("color: var(--cv-accent)");
    expect(mark).toContain("background: transparent");
  });

  it("keeps the footer icon-only, scaled from 44px and without a top rule", () => {
    expect(cssRule("\n.agent-provider-footer {")).toContain(
      "min-height: calc(44px * var(--cv-type-scale))",
    );
    expect(cssRule("\n.agent-provider-footer {")).not.toContain("border");
    expect(cssRule(".agent-provider-footer__navigation .agent-iconbutton {")).toContain(
      "width: 28px",
    );
    expect(cssRule(".agent-provider-footer__providers:empty {")).toContain("display: none");
    expect(AGENT_MODE_CSS).not.toContain("@container (max-width: 280px)");
    expect(AGENT_MODE_CSS).not.toContain(".agent-provider-footer__label");
    expect(AGENT_MODE_CSS).not.toContain(".agent-provider-footer__glyph");
    expect(AGENT_MODE_CSS).not.toContain(".agent-provider-footer__action");
    expect(AGENT_MODE_CSS).not.toContain(".agent-provider-footer__provider {");
  });

  it("pins the update check flush right and centred, never pushed inward by the activity", () => {
    const footer = cssRule("\n.agent-provider-footer {");
    expect(footer).toContain("align-items: center");
    expect(footer).toContain("padding: 8px 2px 0");
    const navigation = cssRule(".agent-provider-footer__navigation {");
    expect(navigation).toContain("flex: 0 1 auto");
    expect(navigation).not.toContain("flex: 1 1 auto");
    const refresh = cssRule(".agent-provider-footer__refresh {");
    expect(refresh).toContain("flex: none");
    expect(refresh).toContain("margin-left: auto");
    expect(refresh).toContain("width: 28px");
    expect(refresh).toContain("height: 28px");
    expect(refresh).not.toContain("margin-right");
    const status = cssRule(".agent-provider-footer__app-status {");
    expect(status).toContain("flex: 1 1 100%");
    expect(status).toContain("order: -1");
    const idle = cssRule(".agent-provider-footer__app-status:empty {");
    expect(idle).toContain("position: absolute");
    expect(idle).toContain("width: 1px");
    expect(idle).toContain("height: 1px");
    expect(idle).toContain("overflow: hidden");
    expect(idle).toContain("clip-path: inset(50%)");
    expect(idle).not.toContain("display: none");
    expect(idle).not.toContain("visibility: hidden");
  });

  it("stacks the provider recovery actions as full-width soft-tinted pills", () => {
    expect(cssRule(".agent-provider-footer__providers {")).toContain("flex-direction: column");
    expect(cssRule(".agent-provider-footer__providers {")).toContain("align-items: stretch");
    const pill = cssRule("\n.agent-provider-footer__pill {");
    expect(pill).toContain("width: 100%");
    expect(pill).toContain("min-height: calc(30px * var(--cv-type-scale))");
    expect(pill).toContain("border: none");
    expect(pill).toContain("border-radius: var(--cv-r-control)");
    expect(pill).toContain("font-size: calc(var(--cv-t-md) * var(--cv-type-scale))");
    expect(pill).toContain("font-weight: 500");
    expect(pill).toContain("--provider-pill-tint: var(--cv-accent)");
    expect(pill).toContain("--provider-pill-ink: var(--cv-accent)");
    expect(pill).toContain("--provider-pill-fill: var(--cv-accent-soft)");
    expect(pill).toContain("background: var(--provider-pill-fill)");
    expect(pill).toContain("color: var(--provider-pill-ink)");
    expect(pill).not.toContain("hairline");
    expect(pill).not.toContain("color: var(--provider-pill-tint)");
    const success = cssRule(".agent-provider-footer__pill--success {");
    expect(success).toContain("--provider-pill-tint: var(--cv-ok)");
    expect(success).toContain("--provider-pill-ink: var(--cv-ok)");
    expect(success).toContain("--provider-pill-fill: var(--cv-ok-soft)");
    const danger = cssRule(".agent-provider-footer__pill--danger {");
    expect(danger).toContain("--provider-pill-tint: var(--cv-danger)");
    expect(danger).toContain("--provider-pill-ink: var(--cv-danger)");
    expect(danger).toContain("--provider-pill-fill: var(--cv-danger-soft)");
    expect(AGENT_MODE_CSS).not.toContain(".agent-provider-footer__pill--primary");
    const disabled = cssRule("button.agent-provider-footer__pill:disabled {");
    expect(disabled).not.toContain("opacity");
    expect(disabled).not.toContain("color:");
    expect(disabled).toContain("--provider-pill-fill");
    expect(cssRule(".agent-provider-footer__pill-glyph {")).toContain("width: 14px");
    expect(cssRule(".agent-provider-footer__pill-label {")).toContain("min-width: 48px");
    expect(cssRule(".agent-provider-footer__pill-label {")).toContain("text-overflow: ellipsis");
  });

  it("lifts the search note to full muted under the light palette scheme", () => {
    const light = AGENT_MODE_CSS.slice(AGENT_MODE_CSS.indexOf(".agent-thread-palette"));
    const scope = light.slice(light.indexOf(':root[data-cv-scheme="light"]'));
    expect(light).toContain(':root[data-cv-scheme="light"]');
    expect(scope).toContain(
      ':root[data-cv-scheme="light"] .agent-search-results__note {\n  color: var(--cv-fg-muted);\n}',
    );
    expect(light).not.toContain("data-theme");
    expect(light).not.toContain("@media (prefers-color-scheme: light)");
    expect(AGENT_MODE_CSS).toContain(
      ".agent-iconbutton:focus-visible {\n  box-shadow: var(--cv-ring-focus);\n}",
    );
  });

  it("routes source control and opens Settings > Usage without a rail popover", () => {
    const onOpenSourceControl = vi.fn();
    const onOpenUsage = vi.fn();
    render({ onOpenSourceControl, onOpenUsage });

    click('button[aria-label="Open Source Control"]');
    click('button[aria-label="Open Usage"]');

    expect(onOpenSourceControl).toHaveBeenCalledTimes(1);
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".agent-usage-layer")).toBeNull();
  });

  it("hides the usage button when Settings > Usage is not wired", () => {
    render();

    expect(host.querySelector('button[aria-label="Open Usage"]')).toBeNull();
  });

  it("moves focus to Expand when the rail collapses with focus inside it", async () => {
    render({
      onCollapseSidebar: () =>
        root.render(
          <button aria-label="Expand sidebar" type="button">
            Expand
          </button>,
        ),
    });
    const collapse = host.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]');
    expect(collapse).not.toBeNull();

    await act(async () => {
      collapse?.focus();
      collapse?.click();
      await Promise.resolve();
    });
    await Promise.resolve();

    expect(document.activeElement).toBe(host.querySelector('button[aria-label="Expand sidebar"]'));
  });

  it("lists a project's threads as one recency-sorted card list under its owner", () => {
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-old", "Old", { updatedAtEpochMs: NOW - 3 * 3_600_000 }),
          running("agt-new", "New", { updatedAtEpochMs: NOW - 60_000 }),
        ]),
        group(OTHER, "api", [settled("agt-mid", "Mid", { updatedAtEpochMs: NOW - 8 * 60_000 })]),
      ],
    });

    expect(rowIds()).toEqual(["agt-new", "agt-mid", "agt-old"]);
    expect(projectRowIds("app")).toEqual(["agt-new", "agt-mid", "agt-old"]);
    expect(projectRowIds("api")).toEqual([]);
    expect(host.querySelector("section")).toBeNull();
    expect(host.querySelector(".agent-band")).toBeNull();
    expect(host.textContent).not.toContain("NEEDS ATTENTION");
    expect(host.textContent).not.toContain("+ New thread");
  });

  it("renders project rows as title, time and branch, leaving the project to the group", () => {
    render({
      groups: [group(ROOT, "app", [settled("agt-1", "Fix the parser", { branch: "main" })])],
    });

    const card = row("agt-1");
    expect(card.classList.contains("is-grouped")).toBe(true);
    expect(card.querySelector(".cv-favicon")).toBeNull();
    expect(card.querySelector(".cv-card-row__project")).toBeNull();
    expect(card.querySelector(".cv-card-row__head .cv-card-row__title")?.textContent).toBe(
      "Fix the parser",
    );
    expect(card.querySelector(".cv-card-row__head .cv-card-row__when")?.textContent).toBe("2m");
    expect(card.querySelector(".cv-card-row__branch")?.textContent).toBe("main");
    expect(card.querySelector(".cv-card-row__context")).toBeNull();
  });

  it("renders pinned cards with the monogram, project, title, branch and time", () => {
    render({
      groups: [
        group(ROOT, "app", [settled("agt-1", "Fix the parser", { branch: "main", pinned: true })]),
      ],
    });

    const card = row("agt-1");
    expect(card.classList.contains("is-grouped")).toBe(false);
    expect(card.querySelector(".cv-favicon")?.textContent).toBe("A");
    expect(card.querySelector(".cv-card-row__project")?.textContent).toBe("app");
    expect(card.querySelector(".cv-card-row__title")?.textContent).toBe("Fix the parser");
    expect(card.querySelector(".cv-card-row__branch")?.textContent).toBe("main");
    expect(card.querySelector(".cv-card-row__when")?.textContent).toBe("2m");
    expect(projectRowIds("app")).toEqual([]);
    expect([...host.querySelectorAll(".cv-sb-heading")].map((node) => node.textContent)).toEqual([
      "Pinned",
      "Projects",
    ]);
  });

  it("names the server of a remote row from the connected servers", () => {
    const base = settled("agt-remote", "Remote one");
    const remote: AgentThreadView = {
      ...base,
      execution: {
        kind: "remote",
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        conversationId: "conversation",
        latestTaskId: "task",
        resume: null,
        reachability: REMOTE_RUNNER_REACHABLE,
      },
    };
    const servers = [
      { id: "linux", name: "build-box", host: "linux", username: "u", port: 22, connected: true },
    ];
    const context = (selectedServerId: string | null): RemoteRunnerContextValue => ({
      gateway: {} as RemoteRunnerGateway,
      servers,
      status: "ready",
      error: null,
      refresh: async () => undefined,
      connect: async () => null,
      disconnect: async () => undefined,
      remove: async () => undefined,
      selectedServerId,
      selectServer: () => undefined,
    });
    const groups = [group(ROOT, "app", [remote])];
    const renderWith = (selectedServerId: string | null) =>
      act(() =>
        root.render(
          <RemoteRunnerContext.Provider value={context(selectedServerId)}>
            <AgentClockProvider nowTickMs={1000}>
              <SidebarHarness {...sidebarProps({ groups })} />
            </AgentClockProvider>
          </RemoteRunnerContext.Provider>,
        ),
      );

    const line3 = (): HTMLElement | null => row("agt-remote").querySelector(".cv-card-row__l3");
    renderWith(null);
    expect(row("agt-remote").querySelector(".cv-card-row__context")).toBeNull();
    expect(line3()?.getAttribute("title")).toBe("build-box · Worktree");
    renderWith("linux");
    expect(row("agt-remote").querySelector(".cv-card-row__context")).toBeNull();
    expect(line3()?.getAttribute("title")).toBe("build-box · Worktree");
    expect(line3()?.querySelector(".agent-visually-hidden")?.textContent).toBe(
      "build-box · Worktree",
    );
    const visible = row("agt-remote").cloneNode(true) as HTMLElement;
    visible.querySelectorAll(".agent-visually-hidden").forEach((hidden) => hidden.remove());
    expect(visible.textContent).not.toContain("build-box");
    expect(row("agt-remote").querySelector(".cv-card-row__glyph")).toBeNull();
    const badge = line3()?.querySelector(".cv-card-row__runtime");
    expect(badge?.getAttribute("aria-label")).toBe("Claude Code, on build-box");
    expect(badge?.querySelector(".cv-card-row__runtime-place svg.lucide-server")).not.toBeNull();
  });

  it("names the repository on project rows only for multi-repository projects", () => {
    render({
      groups: [{ ...group(ROOT, "app", [settled("agt-1", "One")]), singleRepo: false }],
    });

    expect(row("agt-1").querySelector(".cv-card-row__context")?.textContent).toBe("app");
    expect(row("agt-1").querySelector(".cv-card-row__branch")).toBeNull();
  });

  it("labels every row of a nested-checkout project, including the scoped repository", () => {
    const nested = `${ROOT}/packages/api`;
    const base = group(ROOT, "app", [settled("agt-1", "One")]);
    const nestedThread = scopedTo(ROOT, settled("agt-2", "Two", { repositoryRoot: nested }));
    render({
      groups: [
        {
          ...base,
          singleRepo: false,
          repos: [
            ...base.repos,
            {
              repositoryRoot: nested,
              label: "packages/api",
              repositoryResolved: true,
              threads: [nestedThread],
              archived: [],
              orphans: [],
              liveCount: 0,
            },
          ],
        },
      ],
    });

    expect(row("agt-1").querySelector(".cv-card-row__context")?.textContent).toBe("app");
    expect(row("agt-2").querySelector(".cv-card-row__context")?.textContent).toBe("packages/api");
  });

  it("replaces the time with Working plus a live duration while a turn runs", () => {
    render({ groups: [group(ROOT, "app", [running("agt-1", "Busy")])] });

    const status = row("agt-1").querySelector('.cv-card-row__status[data-tone="work"]');
    expect(status?.textContent).toContain("Working");
    expect(status?.querySelector(".cv-card-row__tick")?.textContent).toBe("10m");
    expect(row("agt-1").classList.contains("is-live")).toBe(true);
    expect(row("agt-1").classList.contains("is-fade")).toBe(true);
  });

  it("labels failed, stopped and unread done threads and keeps read ones quiet", () => {
    render({
      groups: [
        group(ROOT, "app", [
          failed("agt-f", "Broken"),
          settled("agt-s", "Stopped", { status: { kind: "stopped" } }),
          settled("agt-d", "Fresh", { viewedAtEpochMs: null, endedAtEpochMs: NOW }),
          settled("agt-r", "Read"),
        ]),
      ],
    });

    expect(row("agt-f").querySelector('.cv-card-row__status[data-tone="fail"]')?.textContent).toBe(
      "Failed",
    );
    expect(row("agt-s").querySelector('.cv-card-row__status[data-tone="quiet"]')?.textContent).toBe(
      "Stopped",
    );
    expect(row("agt-d").querySelector('.cv-card-row__status[data-tone="ok"]')?.textContent).toBe(
      "Done",
    );
    expect(row("agt-d").classList.contains("is-unread")).toBe(true);
    expect(row("agt-d").classList.contains("is-unread-done")).toBe(true);
    expect(
      row("agt-d").querySelector(".cv-card-row__status .cv-card-row__done-dot"),
    ).not.toBeNull();
    expect(row("agt-d").querySelector(".cv-card-row__status svg")).toBeNull();
    expect(row("agt-r").querySelector(".cv-card-row__status")).toBeNull();
    expect(row("agt-r").querySelector(".cv-card-row__when")).not.toBeNull();
    expect(row("agt-r").classList.contains("is-unread-done")).toBe(false);
    expect(row("agt-r").classList.contains("is-recede")).toBe(true);
    expect(row("agt-f").classList.contains("is-recede")).toBe(false);
    expect(row("agt-f").classList.contains("is-unread-done")).toBe(false);
    expect(row("agt-f").classList.contains("is-fade")).toBe(false);
  });

  it("keeps the open working card at full strength", () => {
    render({
      groups: [group(ROOT, "app", [running("agt-1", "Busy")])],
      selectedThreadId: "agt-1",
    });

    expect(row("agt-1").classList.contains("is-current")).toBe(true);
    expect(row("agt-1").classList.contains("is-fade")).toBe(false);
  });

  it("marks the selected card as on and never receded", () => {
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Read")])], selectedThreadId: "agt-1" });

    expect(row("agt-1").classList.contains("is-current")).toBe(true);
    expect(row("agt-1").classList.contains("is-recede")).toBe(false);
    expect(row("agt-1").getAttribute("aria-current")).toBe("true");
  });

  it("puts pinned cards before the Active drop heading and unpins with the P key", () => {
    const onTogglePin = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "Newest", { updatedAtEpochMs: NOW - 1000 }),
          settled("agt-p", "Pinned", { pinned: true, updatedAtEpochMs: NOW - 9000 }),
        ]),
      ],
      onTogglePin,
    });

    expect(rowIds()).toEqual(["agt-p", "agt-1"]);
    expect(host.querySelector('[data-thread-drop-section="active"]')?.textContent).toBe("Active");
    expect(row("agt-1").querySelector(".cv-card-row__pin")).toBeNull();
    expect(row("agt-p").querySelector('.cv-card-row__pin[aria-label="Pinned"]')).not.toBeNull();

    act(() => row("agt-p").focus());
    key(row("agt-p"), "p");

    expect(onTogglePin).toHaveBeenCalledWith("agt-p");
  });

  it("offers the hover Settle action on cards and hides it while working", () => {
    const onThreadMenuCommand = vi.fn();
    render({
      groups: [group(ROOT, "app", [running("agt-r", "Busy"), settled("agt-s", "Done")])],
      onThreadMenuCommand,
    });

    expect(row("agt-r").closest("li")?.querySelector('[aria-label="Settle thread"]')).toBeNull();
    const settle = row("agt-s")
      .closest("li")
      ?.querySelector<HTMLButtonElement>('[aria-label="Settle thread"]');
    expect(settle).not.toBeNull();
    act(() => settle?.click());

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-s", { kind: "settle" });
  });

  it("keeps archived threads out of the rail; they live in Settings > Archive", () => {
    const archived = Array.from({ length: 25 }, (_, index) =>
      settled(`arc-${index}`, `Archived ${index}`, {
        archived: true,
        updatedAtEpochMs: NOW - 86_400_000 * 4 - index,
      }),
    );
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Live"), ...archived])] });

    expect(host.querySelector('.cv-sb-shelf[data-shelf="archived"]')).toBeNull();
    expect(host.querySelector('[data-thread-id^="arc-"]')).toBeNull();
    expect(host.querySelector(".agent-row--more")).toBeNull();
    expect(row("agt-1")).not.toBeNull();
    act(() => row("agt-1").focus());
    key(row("agt-1"), "End");
    expect(document.activeElement).toBe(row("agt-1"));
  });

  it("lists a saved conversation only while the rail does not already show it", () => {
    const groups = [
      group(ROOT, "app", [settled("agt-1", "App thread")]),
      group(OTHER, "api", [
        settled("api-1", "Api thread", { repositoryRoot: OTHER }),
        settled("api-arc", "Api archived", { repositoryRoot: OTHER, archived: true }),
      ]),
    ];
    const catalog = savedCatalog(OTHER, [
      savedRow("api-1", "Api thread"),
      savedRow("api-arc", "Api archived", true),
      savedRow("api-saved", "Api saved"),
    ]);

    render({ groups, catalog, projectFocus: "all" });
    expect(rowIds()).toEqual(["agt-1", "api-1"]);
    expect(savedTitles()).toEqual(["Api archived", "Api saved"]);

    const focused = { projectRootKey: OTHER, repositoryRoot: OTHER };
    render({ groups, catalog, projectFocus: "active", scope: focused });
    expect(rowIds()).toEqual(["api-1"]);
    expect(savedTitles()).toEqual(["Api archived", "Api saved"]);
    expect(host.querySelector(".agent-history-catalog select")).toBeNull();
    expect(host.querySelector(".agent-history-catalog h3")?.textContent).toBe("api");
    expect(catalog.choose).not.toHaveBeenCalled();
  });

  it("never lists another project's live threads as saved while the rail is focused", () => {
    const groups = [
      group(ROOT, "app", [settled("agt-1", "App thread")]),
      group(OTHER, "api", [
        settled("api-1", "Api one", { repositoryRoot: OTHER }),
        settled("api-2", "Api two", { repositoryRoot: OTHER }),
      ]),
    ];
    const catalog = savedCatalog(OTHER, [
      savedRow("api-1", "Api one"),
      savedRow("api-2", "Api two"),
      savedRow("api-saved", "Api saved"),
    ]);

    render({ groups, catalog, projectFocus: "active" });
    expect(rowIds()).toEqual(["agt-1"]);
    expect(savedTitles()).toEqual([]);
    expect(host.querySelector(".agent-history-catalog__header")).toBeNull();
    expect(catalog.choose).toHaveBeenCalledExactlyOnceWith(ROOT);

    render({ groups, catalog, projectFocus: "active" });
    expect(savedTitles()).toEqual([]);
    expect(catalog.choose).toHaveBeenCalledOnce();

    render({ groups, catalog, projectFocus: "all" });
    expect(rowIds()).toEqual(["agt-1", "api-1", "api-2"]);
    expect(savedTitles()).toEqual(["Api saved"]);
  });

  it("opens saved conversations on the focused project, not the first one", () => {
    const groups = [group(ROOT, "app", []), group(OTHER, "api", [])];
    const closed = { ...savedCatalog(ROOT, []), page: null };
    const scope = { projectRootKey: OTHER, repositoryRoot: OTHER };

    render({ groups, catalog: closed, projectFocus: "active", scope });
    click('[data-shelf="saved-conversations"]');
    expect(closed.choose).toHaveBeenCalledExactlyOnceWith(OTHER);

    render({ groups, catalog: closed, projectFocus: "all", scope });
    click('[data-shelf="saved-conversations"]');
    expect(closed.choose).toHaveBeenLastCalledWith(OTHER);

    const remote = { projectRootKey: "remote:srv:/srv/api", repositoryRoot: "/srv/api" };
    const withRemote = [...groups, group(remote.projectRootKey, "remote api", [])];
    render({ groups: withRemote, catalog: closed, projectFocus: "active", scope: remote });
    expect(host.querySelector(".agent-history-catalog")).toBeNull();
    render({ groups: withRemote, catalog: closed, projectFocus: "all", scope: remote });
    click('[data-shelf="saved-conversations"]');
    expect(closed.choose).toHaveBeenLastCalledWith(ROOT);
  });

  it("counts collapsed Settled and Snoozed rail rows as already open", () => {
    const [live, done, later] = threeThreads();
    const sleeping = { ...later!, thread: { ...later!.thread, snoozedUntil: NOW + 60_000 } };
    const groups = [
      group(ROOT, "app", [
        live!,
        { ...done!, thread: { ...done!.thread, settledAt: NOW - 1_000 } },
        sleeping,
      ]),
    ];
    const catalog = savedCatalog(ROOT, [
      savedRow("agt-1", "One"),
      savedRow("agt-2", "Two"),
      savedRow("agt-3", "Three"),
    ]);

    render({ groups, catalog });
    expect(rowIds()).toEqual(["agt-1"]);
    expect(settledShelf()?.textContent).toContain("Settled (1)");
    expect(host.querySelector('.cv-sb-shelf[data-shelf="snoozed"]')?.textContent).toContain(
      "Snoozed (1)",
    );
    expect(savedTitles()).toEqual([]);
    expect(host.querySelector(".agent-history-catalog__empty")?.textContent).toBe(
      "All saved conversations are already open.",
    );
  });

  it("lists a saved conversation whose id the rail shows under another project root", () => {
    const groups = [group(ROOT, "app", [settled("agt-1", "App thread")]), group(OTHER, "api", [])];

    render({ groups, catalog: savedCatalog(OTHER, [savedRow("agt-1", "Api saved")]) });
    expect(rowIds()).toEqual(["agt-1"]);
    expect(savedTitles()).toEqual(["Api saved"]);

    render({ groups, catalog: savedCatalog(ROOT, [savedRow("agt-1", "App thread")]) });
    expect(savedTitles()).toEqual([]);

    render({ groups, catalog: { ...savedCatalog(ROOT, []), page: null } });
    expect(savedTitles()).toEqual([]);
    expect(host.querySelector(".agent-history-catalog__empty")).toBeNull();
  });

  it("shows the empty state when a project holds only archived threads", () => {
    render({
      groups: [
        group(ROOT, "app", [
          settled("arc-1", "Old", { archived: true, updatedAtEpochMs: NOW - 86_400_000 }),
        ]),
      ],
    });

    expect(host.querySelector('[data-thread-id="arc-1"]')).toBeNull();
    expect(host.querySelector(".cv-sb-project__empty")?.textContent).toBe("No threads yet");
  });

  it("opens the thread context menu in the mockup order and dispatches commands", () => {
    const onThreadMenuCommand = vi.fn();
    render({
      groups: [group(ROOT, "app", [running("agt-1", "Busy", { branch: "feat/x" })])],
      onThreadMenuCommand,
    });

    openRowMenu("agt-1");

    const menu = document.querySelector('[role="menu"][aria-label="Thread actions"]');
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];
    expect(items.map((item) => item.textContent)).toEqual([
      "New thread on feat/x",
      "Pin thread",
      "Settle thread",
      "Snooze",
      "Stop agent",
      "Rename thread",
      "Mark unread",
      "Move to",
      "Copy",
      "Archive thread",
      "Delete",
    ]);
    const item = (label: string) =>
      items.find((candidate) => candidate.textContent === label) as HTMLButtonElement;
    expect(item("Archive thread").getAttribute("aria-disabled")).toBe("true");
    expect(item("Delete").getAttribute("aria-disabled")).toBe("true");
    expect(item("Delete").getAttribute("title")).toBe(
      "Stop the agent before deleting this thread.",
    );
    expect(item("Mark unread").getAttribute("title")).toBe("Available after a run finishes.");

    act(() => item("Delete").click());
    expect(onThreadMenuCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() => item("Stop agent").click());

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "stop" });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("confirms Delete in a dialog and cancels without deleting", () => {
    const onThreadMenuCommand = vi.fn();
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Old name")])], onThreadMenuCommand });

    openRowMenu("agt-1");
    act(() => deleteItem().click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Delete thread?");
    expect(dialog?.textContent).toContain("Old name");
    act(() => dialogButton("Cancel").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onThreadMenuCommand).not.toHaveBeenCalled();

    openRowMenu("agt-1");
    act(() => deleteItem().click());
    expect(dialogButton("Delete thread").className).toContain("cv-button--danger");
    act(() => dialogButton("Delete thread").click());
    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "delete" });
  });

  it("keeps list navigation keys inside the Delete dialog instead of moving to rows behind it", () => {
    const onSelectThread = vi.fn();
    const onThreadMenuCommand = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "One", { updatedAtEpochMs: NOW - 1000 }),
          settled("agt-2", "Two", { updatedAtEpochMs: NOW - 2000 }),
        ]),
      ],
      onSelectThread,
      onThreadMenuCommand,
    });

    openRowMenu("agt-1");
    act(() => deleteItem().click());
    const cancel = dialogButton("Cancel");
    act(() => cancel.focus());
    for (const name of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      key(document.activeElement as HTMLElement, name);
      expect(document.activeElement).toBe(cancel);
    }
    key(document.activeElement as HTMLElement, "Enter");
    key(document.activeElement as HTMLElement, " ");
    key(document.activeElement as HTMLElement, "p");
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(markedIds()).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("keeps list navigation keys inside the custom Snooze dialog", () => {
    const onSelectThread = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "One", { updatedAtEpochMs: NOW - 1000 }),
          settled("agt-2", "Two", { updatedAtEpochMs: NOW - 2000 }),
        ]),
      ],
      onSelectThread,
    });

    openRowMenu("agt-1");
    const snooze = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith("Snooze"),
    );
    expect(snooze).toBeDefined();
    act(() => snooze?.click());
    const custom = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Choose date"),
    );
    expect(custom).toBeDefined();
    act(() => custom?.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const focusable = dialog?.querySelector<HTMLElement>("button");
    act(() => focusable?.focus());
    const before = document.activeElement;
    for (const name of ["ArrowDown", "End"]) {
      key(document.activeElement as HTMLElement, name);
      expect(document.activeElement).toBe(before);
    }
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("dresses the context menu as a foundation menu with icons and a danger Delete", () => {
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Old name", { branch: "feat/x" })])] });

    openRowMenu("agt-1");

    const menu = document.querySelector('[role="menu"]');
    const items = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

    expect(menu?.classList.contains("cv-menu")).toBe(true);
    expect(menu?.querySelectorAll(".cv-menu__separator").length).toBe(3);
    expect(items.every((item) => item.querySelector(".cv-menu__icon > svg.lucide") !== null)).toBe(
      true,
    );
    expect(items[1]?.querySelector(".lucide-pin")).not.toBeNull();
    const last = items[items.length - 1];
    expect(last?.classList.contains("cv-menu__item--danger")).toBe(true);
    expect(last?.querySelector(".lucide-trash2, .lucide-trash-2")).not.toBeNull();
  });

  it("swaps the pin icon once the thread is pinned", () => {
    render({
      groups: [group(ROOT, "app", [settled("agt-1", "Pinned", { branch: null, pinned: true })])],
    });

    openRowMenu("agt-1");

    const pin = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Unpin thread",
    );

    expect(pin?.querySelector(".lucide-pin-off")).not.toBeNull();
  });

  it("renames inline from the context menu and commits on Enter", () => {
    const onThreadMenuCommand = vi.fn();
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Old name")])], onThreadMenuCommand });

    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const rename = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Rename thread",
    );
    act(() => {
      (rename as HTMLButtonElement).click();
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]');
    expect(input?.value).toBe("Old name");
    act(() => {
      nativeInputValue(input as HTMLInputElement, "New name");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", {
      kind: "rename",
      title: "New name",
    });
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
  });

  it("moves focus with the arrow keys, selects with Enter and pins with p", () => {
    const onSelectThread = vi.fn();
    const onTogglePin = vi.fn();
    const groups = [
      group(ROOT, "app", [
        settled("agt-1", "One", { updatedAtEpochMs: NOW - 1000 }),
        settled("agt-2", "Two", { updatedAtEpochMs: NOW - 2000 }),
      ]),
    ];
    render({ groups, onSelectThread, onTogglePin });

    expect(row("agt-1").tabIndex).toBe(0);
    expect(row("agt-2").tabIndex).toBe(-1);

    act(() => row("agt-1").focus());
    key(row("agt-1"), "ArrowDown");

    expect(document.activeElement).toBe(row("agt-2"));
    expect(row("agt-2").tabIndex).toBe(0);

    key(row("agt-2"), "Enter");
    expect(onSelectThread).toHaveBeenCalledWith("agt-2");

    key(row("agt-2"), "p");
    expect(onTogglePin).toHaveBeenCalledWith("agt-2");

    render({ groups, onSelectThread, onTogglePin, selectedThreadId: "agt-2" });
    expect(markedIds()).toEqual(["agt-2"]);

    key(row("agt-2"), "Escape");
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Search threads"]'));
  });

  it("shows jump badges after holding the command key", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One"), settled("agt-2", "Two")])] });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    });
    expect(host.querySelector(".cv-card-row__jump")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect([...host.querySelectorAll(".cv-card-row__jump")].map((el) => el.textContent)).toEqual([
      "⌘1",
      "⌘2",
    ]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    });
    expect(host.querySelector(".cv-card-row__jump")).toBeNull();
  });

  it("numbers jumps and arrows across pins then projects, skipping collapsed projects", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const groups = [
      group(ROOT, "app", [
        settled("agt-1", "One", { updatedAtEpochMs: NOW - 1000 }),
        settled("agt-2", "Two", { pinned: true }),
      ]),
      group(OTHER, "api", [settled("api-1", "Api", { repositoryRoot: OTHER })]),
    ];
    render({ groups });
    const badges = () => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
        vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
      });
      const labels = Object.fromEntries(
        [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map((element) => [
          element.dataset.threadId,
          element.querySelector(".cv-card-row__jump")?.textContent ?? null,
        ]),
      );
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
      });
      return labels;
    };

    expect(rowIds()).toEqual(["agt-2", "agt-1", "api-1"]);
    expect(badges()).toEqual({ "agt-2": "⌘1", "agt-1": "⌘2", "api-1": "⌘3" });

    act(() => projectToggle("app").click());
    expect(badges()).toEqual({ "agt-2": "⌘1", "api-1": "⌘2" });

    act(() => row("agt-2").focus());
    key(row("agt-2"), "ArrowDown");
    expect(document.activeElement).toBe(row("api-1"));
  });

  it("uses Control and the Ctrl glyph off macOS and clears hints when the tab hides", () => {
    withUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One"), settled("agt-2", "Two")])] });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect(host.querySelector(".cv-card-row__jump")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect([...host.querySelectorAll(".cv-card-row__jump")].map((el) => el.textContent)).toEqual([
      "Ctrl1",
      "Ctrl2",
    ]);

    withVisibility("hidden", () => {
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    });
    expect(host.querySelector(".cv-card-row__jump")).toBeNull();
  });

  it("lets Enter on the settled shelf expand it instead of selecting the focused thread", () => {
    const onSelectThread = vi.fn();
    const onTogglePin = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "Live"),
          settled("arc-1", "Old", { settledAt: NOW - 86_400_000 }),
        ]),
      ],
      onSelectThread,
      onTogglePin,
    });

    const shelf = host.querySelector<HTMLButtonElement>('.cv-sb-shelf[data-shelf="settled"]');
    expect(shelf).not.toBeNull();
    act(() => shelf?.focus());
    key(shelf as HTMLElement, "Enter");
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();

    click('.cv-sb-shelf[data-shelf="settled"]');
    expect(shelf?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-thread-id="arc-1"]')).not.toBeNull();

    key(shelf as HTMLElement, "p");
    expect(onTogglePin).not.toHaveBeenCalled();
    const settle = row("agt-1")
      .closest("li")
      ?.querySelector<HTMLElement>('[aria-label="Settle thread"]');
    expect(settle).not.toBeNull();
    key(settle as HTMLElement, "Enter");
    expect(onSelectThread).not.toHaveBeenCalled();

    key(row("agt-1"), "Enter");
    expect(onSelectThread).toHaveBeenCalledWith("agt-1");
  });

  it("returns focus to the row that opened the context menu once it closes", () => {
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One")])] });

    act(() => row("agt-1").focus());
    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.contains(document.activeElement)).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(row("agt-1"));

    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const copyMenu = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Copy",
    );
    act(() => copyMenu?.click());
    const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Copy thread ID",
    );
    expect(copy).toBeDefined();
    act(() => copy?.click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(row("agt-1"));
  });

  it("surfaces the document truncation bound from the search result", () => {
    render({
      search: searchSurface("parser", {
        query: "parser",
        truncated: false,
        documentsTruncated: true,
        matches: [],
      }),
    });

    expect([...host.querySelectorAll(".cv-sb-hint")].map((node) => node.textContent)).toEqual([
      "No threads found",
      "Some saved history could not be searched",
    ]);
  });

  it("nests every project's threads under a collapsible project header", () => {
    const appThread = settled("agt-1", "One");
    const apiThread = settled("agt-api", "Api", { repositoryRoot: OTHER });
    const groups = [group(ROOT, "app", [appThread]), group(OTHER, "api", [apiThread])];
    render({ groups });

    expect(projectNames()).toEqual(["app", "api"]);
    expect(projectRowIds("app")).toEqual(["agt-1"]);
    expect(projectRowIds("api")).toEqual(["agt-api"]);
    expect(host.querySelector('button[aria-label^="Filter threads by project"]')).toBeNull();
    expect(host.querySelector(".cv-sb-show")).toBeNull();

    act(() => projectToggle("app").click());
    expect(projectToggle("app").getAttribute("aria-expanded")).toBe("false");
    expect(projectRowIds("app")).toEqual([]);
    expect(rowIds()).toEqual(["agt-api"]);

    act(() => projectToggle("app").click());
    expect(projectToggle("app").getAttribute("aria-expanded")).toBe("true");
    expect(projectRowIds("app")).toEqual(["agt-1"]);
  });

  it("keeps the selected thread visible inside a collapsed project", () => {
    const groups = [group(ROOT, "app", threeThreads())];
    render({ groups, selectedThreadId: "agt-2" });

    act(() => projectToggle("app").click());

    expect(projectRowIds("app")).toEqual(["agt-2"]);
  });

  it("previews six threads per project behind Show more and Show less", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      settled(`agt-${index}`, `Thread ${index}`, { updatedAtEpochMs: NOW - index * 1000 }),
    );
    render({ groups: [group(ROOT, "app", many)] });

    expect(projectRowIds("app")).toHaveLength(6);
    click('button[aria-label="Show 2 more threads in app"]');
    expect(projectRowIds("app")).toHaveLength(8);
    click('button[aria-label="Show fewer threads in app"]');
    expect(projectRowIds("app")).toHaveLength(6);
  });

  it("starts a thread in the hovered project and fails closed for one that cannot be used", () => {
    const onNewThreadInProject = vi.fn();
    const onNewThread = vi.fn();
    const groups = [
      group(ROOT, "app", [settled("agt-1", "One")]),
      group(OTHER, "api", [], { trust: "untrusted" }),
    ];
    render({ groups, onNewThread, onNewThreadInProject });

    click('button[aria-label="Create new thread in app"]');
    expect(onNewThreadInProject).toHaveBeenCalledWith(ROOT);
    expect(onNewThread).not.toHaveBeenCalled();
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Create new thread in api"]')
        ?.disabled,
    ).toBe(true);
    expect(projectToggle("app").getAttribute("aria-expanded")).toBe("true");
  });

  it("routes Trust and Release through the project actions menu and shows the project state", () => {
    const onProjectCommand = vi.fn();
    const groups = [
      group(ROOT, "app", [settled("agt-1", "One")], { origin: "closed-tab-live-tasks" }),
      group(OTHER, "api", [settled("agt-2", "Two", { repositoryRoot: OTHER })], {
        trust: "untrusted",
      }),
    ];
    render({ groups, onProjectCommand });
    expect(projectState("api")).toBe("Not trusted");
    expect(projectState("app")).toBe("Tab closed");

    click('button[aria-label="Project actions for api"]');
    const trust = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Trust project…",
    );
    act(() => trust?.click());
    expect(onProjectCommand).toHaveBeenCalledWith(
      { projectRootKey: OTHER, repositoryRoot: OTHER, rootPath: OTHER },
      "trust",
    );

    const appToggle = projectToggle("app");
    act(() => {
      appToggle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const release = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Release project",
    );
    act(() => release?.click());
    expect(onProjectCommand).toHaveBeenLastCalledWith(
      { projectRootKey: ROOT, repositoryRoot: ROOT, rootPath: ROOT },
      "release",
    );
    expect(projectToggle("app").getAttribute("aria-expanded")).toBe("true");
  });

  it("signals live work in a collapsed project", () => {
    const groups = [group(ROOT, "app", [running("agt-1", "Busy")])];
    render({ groups });
    expect(host.querySelector(".cv-sb-project__signal")).toBeNull();

    act(() => projectToggle("app").click());

    expect(host.querySelector(".cv-sb-project__signal")?.getAttribute("aria-label")).toBe(
      "1 thread working",
    );
  });

  it("says No threads yet inside an empty project and No active threads when all are pinned", () => {
    render({
      groups: [
        group(ROOT, "app", [settled("agt-1", "Pinned", { pinned: true })]),
        group(OTHER, "api", []),
      ],
    });
    expect(
      [...host.querySelectorAll(".cv-sb-project__empty")].map((node) => node.textContent),
    ).toEqual(["No active threads", "No threads yet"]);
    expect(
      host.querySelector('[role="group"][aria-labelledby] [data-thread-id="agt-1"]'),
    ).not.toBeNull();
  });

  it("keeps Search, the project switcher, Add project and New thread in one row", () => {
    render({ newThreadTitle: "New thread in app (⇧⌘N) · ⌘N: choose project" });

    const row = host.querySelector(".cv-sb-search");
    expect(
      [...(row?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])].map((node) =>
        node.getAttribute("aria-label"),
      ),
    ).toEqual(["Search threads", "Switch project: app", "Add project", "New thread"]);
    const switcher = row?.querySelector<HTMLButtonElement>(".cv-sb-switch");
    expect(switcher?.textContent).toBe("AP");
    expect(switcher?.title).toBe("app");
    expect(host.querySelector(".cv-sb-ws")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="New thread"]')?.title).toBe(
      "New thread in app (⇧⌘N) · ⌘N: choose project",
    );
  });

  it("does not re-render the thread list when only the New thread title changes", () => {
    const pendingInteractions = new CountingMap<string, AgentPendingInteraction>();
    const props = sidebarProps({ pendingInteractions, newThreadTitle: "New thread (⇧⌘N)" });
    const renderWith = (next: SidebarHarnessProps): void =>
      act(() => {
        root.render(
          <AgentClockProvider nowTickMs={1000}>
            <SidebarHarness {...next} />
          </AgentClockProvider>,
        );
      });
    renderWith(props);
    const listReads = pendingInteractions.reads;
    expect(listReads).toBeGreaterThan(0);

    renderWith({ ...props, newThreadTitle: "New thread in app (⇧⌘N)" });

    expect(host.querySelector<HTMLButtonElement>('[aria-label="New thread"]')?.title).toBe(
      "New thread in app (⇧⌘N)",
    );
    expect(pendingInteractions.reads).toBe(listReads);
  });

  it("requests a new thread with the shift state and fails closed without a project", () => {
    const onNewThread = vi.fn();
    const groups = [group(ROOT, "app", [], { trust: "untrusted" }), group(OTHER, "api", [])];
    render({ groups, onNewThread, scope: { projectRootKey: OTHER, repositoryRoot: OTHER } });

    const button = host.querySelector<HTMLButtonElement>('[aria-label="New thread"]');
    expect(button?.title).toBe("New thread in api (⇧⌘N) · ⌘N: choose project");
    click('[aria-label="New thread"]');
    expect(onNewThread).toHaveBeenLastCalledWith(false);
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(onNewThread).toHaveBeenLastCalledWith(true);

    render({ groups: [group(OTHER, "api", [])], onNewThread });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="New thread"]')?.title).toBe(
      "New thread (⇧⌘N)",
    );

    render({ groups, onNewThread });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="New thread"]')?.disabled).toBe(true);
  });

  it("renders the empty states and the overflow note", () => {
    render({ groups: [] });
    expect(host.querySelector(".cv-sb-empty")?.textContent).toBe("No projects yet");

    render({ groups: [group(ROOT, "app", [])], overflowRootPaths: ["/workspace/nine"] });
    expect(host.querySelector(".cv-sb-empty")).toBeNull();
    expect(host.querySelector(".cv-sb-project__empty")?.textContent).toBe("No threads yet");
    expect(host.querySelector(".cv-sb-note")?.textContent).toBe(
      "1 more project is not shown (limit 64)",
    );
  });

  it("forwards typing to the search surface and clears on Escape", () => {
    const search = searchSurface("");
    render({ search });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Search threads"]');
    act(() => {
      nativeInputValue(input as HTMLInputElement, "par");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(search.setQuery).toHaveBeenCalledWith("par");

    render({ search: searchSurface("par") });
    key(host.querySelector('[aria-label="Search threads"]') as HTMLElement, "Escape");
    expect(host.querySelector('[aria-label="Clear thread search"]')).not.toBeNull();
  });

  it("replaces the list with the search listbox and selects a hit with Enter", () => {
    const onSelectThread = vi.fn();
    const search = searchSurface("parser", {
      query: "parser",
      truncated: false,
      documentsTruncated: false,
      matches: [
        {
          threadId: "agt-2",
          source: "user",
          turnId: "agt-2-t1",
          eventIndex: null,
          snippet: "Fix the parser",
          ranges: [{ start: 8, end: 14 }],
          segmentStart: 8,
          segmentEnd: 14,
          score: 400,
        },
        {
          threadId: "agt-1",
          source: "title",
          turnId: null,
          eventIndex: null,
          snippet: "parser",
          ranges: [{ start: 0, end: 6 }],
          segmentStart: 0,
          segmentEnd: 6,
          score: 0,
        },
      ],
    });
    render({
      groups: [group(ROOT, "app", [settled("agt-1", "parser"), settled("agt-2", "Two")])],
      onSelectThread,
      search,
    });

    expect(host.querySelector(".agent-list")).toBeNull();
    const listbox = host.querySelector("#agent-rail-search-results");
    expect(listbox?.getAttribute("role")).toBe("listbox");
    const input = host.querySelector('[aria-label="Search threads"]') as HTMLElement;
    expect(input.getAttribute("aria-activedescendant")).toBe("agent-rail-search-result-0");

    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe("agent-rail-search-result-1");

    key(input, "Enter");
    expect(onSelectThread).toHaveBeenCalledWith("agt-1", undefined);
    expect(search.clear).toHaveBeenCalled();
  });

  it("toggles rows with the platform modifier click without opening a thread", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const onSelectThread = vi.fn();
    render({ groups: [group(ROOT, "app", threeThreads())], onSelectThread });

    clickRow("agt-1", { metaKey: true });
    clickRow("agt-3", { metaKey: true });

    expect(onSelectThread).not.toHaveBeenCalled();
    expect(markedIds()).toEqual(["agt-1", "agt-3"]);
    expect(row("agt-2").getAttribute("aria-selected")).toBe("false");
    expect(row("agt-1").classList.contains("is-marked")).toBe(true);
    expect(selectionBar()?.textContent).toContain("2 threads selected");

    clickRow("agt-3", { metaKey: true });
    expect(markedIds()).toEqual(["agt-1"]);
    expect(selectionBar()).toBeNull();
  });

  it("offers only Archive and Delete for a multi-selection", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render({ groups: [group(ROOT, "app", threeThreads())] });

    clickRow("agt-1", { metaKey: true });
    clickRow("agt-2", { metaKey: true });

    const labels = [...(selectionBar()?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(["Archive", "Delete", ""]);
    expect(selectionBar()?.textContent).not.toContain("Unarchive");
  });

  it("uses control instead of command as the toggle modifier off mac", () => {
    withUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    const onSelectThread = vi.fn();
    render({ groups: [group(ROOT, "app", threeThreads())], onSelectThread });

    clickRow("agt-1", { ctrlKey: true });
    expect(markedIds()).toEqual(["agt-1"]);
    expect(onSelectThread).not.toHaveBeenCalled();

    clickRow("agt-2", { metaKey: true });
    expect(markedIds()).toEqual(["agt-2"]);
    expect(onSelectThread).toHaveBeenCalledWith("agt-2");
  });

  it("extends a shift-click range across the pinned and active sections", () => {
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-p", "Pinned", { pinned: true, updatedAtEpochMs: NOW - 500 }),
          ...threeThreads(),
        ]),
      ],
    });

    clickRow("agt-p");
    clickRow("agt-2", { shiftKey: true });

    expect(markedIds()).toEqual(["agt-p", "agt-1", "agt-2"]);
  });

  it("keeps a shift range away from archived threads the rail never renders", () => {
    render({
      groups: [
        group(ROOT, "app", [
          ...threeThreads(),
          settled("agt-old", "Archived", { archived: true, updatedAtEpochMs: NOW - 9000 }),
        ]),
      ],
    });

    expect(host.querySelector('[data-thread-id="agt-old"]')).toBeNull();
    clickRow("agt-1");
    clickRow("agt-3", { shiftKey: true });
    expect(markedIds()).toEqual(["agt-1", "agt-2", "agt-3"]);
    keyWith(row("agt-3"), "ArrowDown", { shiftKey: true });
    expect(markedIds()).toEqual(["agt-1", "agt-2", "agt-3"]);
  });

  it("clears the selection on Escape before handing focus back to the search box", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render({ groups: [group(ROOT, "app", threeThreads())] });

    clickRow("agt-1");
    clickRow("agt-2", { metaKey: true });
    expect(markedIds()).toEqual(["agt-1", "agt-2"]);

    act(() => row("agt-2").focus());
    key(row("agt-2"), "Escape");
    expect(markedIds()).toEqual([]);
    expect(document.activeElement).toBe(row("agt-2"));

    key(row("agt-2"), "Escape");
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Search threads"]'));
  });

  it("toggles with Space and extends with Shift and the arrow keys", () => {
    const onSelectThread = vi.fn();
    render({ groups: [group(ROOT, "app", threeThreads())], onSelectThread });

    act(() => row("agt-1").focus());
    keyWith(row("agt-1"), " ");
    expect(markedIds()).toEqual(["agt-1"]);
    expect(onSelectThread).not.toHaveBeenCalled();

    keyWith(row("agt-1"), "ArrowDown", { shiftKey: true });
    expect(markedIds()).toEqual(["agt-1", "agt-2"]);

    keyWith(row("agt-2"), "ArrowDown", { shiftKey: true });
    expect(markedIds()).toEqual(["agt-1", "agt-2", "agt-3"]);

    keyWith(row("agt-3"), " ");
    expect(markedIds()).toEqual(["agt-1", "agt-2"]);
  });

  it("arms the bulk delete once and then reports the exact selection to the workspace", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const onThreadBulkCommand = vi.fn();
    render({ groups: [group(ROOT, "app", threeThreads())], onThreadBulkCommand });

    clickRow("agt-1");
    clickRow("agt-2", { metaKey: true });

    const remove = barButton("Delete");
    act(() => remove.click());
    expect(onThreadBulkCommand).not.toHaveBeenCalled();
    expect(barButton("Confirm delete of 2 threads")).toBeInstanceOf(HTMLButtonElement);

    act(() => barButton("Confirm delete of 2 threads").click());
    expect(onThreadBulkCommand).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(AGENT_THREAD_BULK_CONFIRM_DELAY_MS));
    act(() => barButton("Confirm delete of 2 threads").click());
    expect(onThreadBulkCommand).toHaveBeenCalledWith({
      kind: "apply",
      request: {
        action: "delete",
        threadIds: ["agt-1", "agt-2"],
        ownerKeys: new Map([
          ["agt-1", ROOT_OWNER],
          ["agt-2", ROOT_OWNER],
        ]),
        missingIds: [],
      },
    });
    expect(markedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it("skips threads whose owner was replaced between selection and commit (A to B to A)", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const onThreadBulkCommand = vi.fn();
    const views = threeThreads();
    render({ groups: [group(ROOT, "app", views)], onThreadBulkCommand });

    clickRow("agt-1");
    clickRow("agt-2", { metaKey: true });

    const reopened = views.map((view) =>
      view.thread.threadId === "agt-1"
        ? {
            ...view,
            thread: {
              ...view.thread,
              owner: { ...view.thread.owner, ownerId: `agent-root:${ROOT}:reopened` },
            },
          }
        : view,
    );
    render({ groups: [group(ROOT, "app", reopened)], onThreadBulkCommand });
    act(() => barButton("Archive").click());

    expect(onThreadBulkCommand).toHaveBeenCalledTimes(1);
    const command = onThreadBulkCommand.mock.calls[0]?.[0] as AgentThreadBulkCommand;
    expect(command.kind).toBe("apply");
    if (command.kind !== "apply") return;
    const plan = agentThreadBulkPlan(command.request, agentThreadBulkCandidates(reopened));
    expect(plan.applyIds).toEqual(["agt-2"]);
    expect(plan.skipped).toEqual([{ threadId: "agt-1", reason: "foreignOwner" }]);
  });

  it("archives the whole selection in one command without arming", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const onThreadBulkCommand = vi.fn();
    render({ groups: [group(ROOT, "app", threeThreads())], onThreadBulkCommand });

    clickRow("agt-1");
    clickRow("agt-3", { metaKey: true });
    act(() => barButton("Archive").click());

    expect(onThreadBulkCommand).toHaveBeenCalledWith({
      kind: "apply",
      request: {
        action: "archive",
        threadIds: ["agt-1", "agt-3"],
        ownerKeys: new Map([
          ["agt-1", ROOT_OWNER],
          ["agt-3", ROOT_OWNER],
        ]),
        missingIds: [],
      },
    });
    expect(selectionBar()).toBeNull();
  });

  it("disarms a primed delete once the selection is no longer the one that was armed", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const onThreadBulkCommand = vi.fn();
    render({ groups: [group(ROOT, "app", threeThreads())], onThreadBulkCommand });

    clickRow("agt-1");
    clickRow("agt-2", { metaKey: true });
    act(() => barButton("Delete").click());
    expect(barButton("Confirm delete of 2 threads")).toBeInstanceOf(HTMLButtonElement);

    clickRow("agt-3", { metaKey: true });
    clickRow("agt-1", { metaKey: true });
    expect(markedIds()).toEqual(["agt-2", "agt-3"]);
    expect(barButton("Delete").dataset.armed).toBeUndefined();

    act(() => vi.advanceTimersByTime(AGENT_THREAD_BULK_CONFIRM_DELAY_MS));
    act(() => barButton("Delete").click());
    expect(onThreadBulkCommand).not.toHaveBeenCalled();
    expect(barButton("Confirm delete of 2 threads")).toBeInstanceOf(HTMLButtonElement);
  });

  it("clears the selection when Escape is pressed inside the selection bar", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render({ groups: [group(ROOT, "app", threeThreads())] });

    clickRow("agt-1");
    clickRow("agt-2", { metaKey: true });
    act(() => barButton("Archive").focus());

    keyWith(barButton("Archive"), "Escape");
    expect(markedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it("re-anchors on a plain arrow so a later Shift arrow cannot reach back", () => {
    render({
      groups: [
        group(ROOT, "app", [
          ...threeThreads(),
          settled("agt-4", "Four", { updatedAtEpochMs: NOW - 4000 }),
          settled("agt-5", "Five", { updatedAtEpochMs: NOW - 5000 }),
        ]),
      ],
    });

    clickRow("agt-1");
    act(() => row("agt-1").focus());
    keyWith(row("agt-1"), "ArrowDown");
    keyWith(row("agt-2"), "ArrowDown");
    keyWith(row("agt-3"), "ArrowDown");
    expect(markedIds()).toEqual(["agt-4"]);

    keyWith(row("agt-4"), "ArrowDown", { shiftKey: true });
    expect(markedIds()).toEqual(["agt-4", "agt-5"]);
  });

  it("leaves the selection alone when an arrow starts from the settled shelf", () => {
    render({
      groups: [
        group(ROOT, "app", [
          ...threeThreads(),
          settled("agt-old", "Settled", { settledAt: NOW - 9000 }),
        ]),
      ],
    });

    clickRow("agt-2");
    clickRow("agt-3", { shiftKey: true });
    expect(markedIds()).toEqual(["agt-2", "agt-3"]);

    const shelf = host.querySelector<HTMLElement>('.cv-sb-shelf[data-shelf="settled"]');
    expect(shelf).not.toBeNull();
    act(() => shelf?.focus());
    keyWith(shelf as HTMLElement, "ArrowDown", { shiftKey: true });

    expect(markedIds()).toEqual(["agt-2", "agt-3"]);
  });

  it("drops rows of a collapsed project from the selection", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const groups = [
      group(ROOT, "app", threeThreads()),
      group(OTHER, "api", [settled("agt-x", "X", { repositoryRoot: OTHER })]),
    ];
    render({ groups });

    clickRow("agt-1");
    clickRow("agt-2", { metaKey: true });
    expect(markedIds()).toEqual(["agt-1", "agt-2"]);

    act(() => projectToggle("app").click());
    expect(markedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it("announces the thread list as a multi-selectable listbox of options", () => {
    render({ groups: [group(ROOT, "app", threeThreads())] });

    const list = host.querySelector<HTMLElement>('[aria-label="Thread list"]');
    expect(list?.getAttribute("role")).toBe("listbox");
    expect(list?.getAttribute("aria-multiselectable")).toBe("true");
    expect(row("agt-1").getAttribute("role")).toBe("option");
    expect(row("agt-1").getAttribute("aria-selected")).toBe("false");
  });

  it("tints every marked row, the open one included, without borders or outlines", () => {
    const marked = cssRule(".cv-card-row.is-current,\n.cv-card-row.is-marked {", SIDEBAR_CSS);
    expect(marked).toContain("background: var(--cv-row-active)");
    expect(marked).not.toContain("border");
    expect(marked).not.toContain("outline");
    expect(marked).not.toContain("opacity");
    expect(cssRule(".agent-selection-bar {")).toContain("border-radius: var(--cv-r-card)");
  });

  it("tints the open thread too, so a range anchored on it cannot hide what will be deleted", () => {
    render({
      groups: [group(ROOT, "app", threeThreads())],
      selectedThreadId: "agt-1",
    });

    clickRow("agt-1");
    clickRow("agt-3", { shiftKey: true });

    expect(markedIds()).toEqual(["agt-1", "agt-2", "agt-3"]);
    expect(row("agt-1").classList.contains("is-current")).toBe(true);
    expect(row("agt-1").classList.contains("is-marked")).toBe(true);
    expect(selectionBar()?.textContent).toContain("3 threads selected");
  });

  it("does not rerender untouched rows when one thread of two hundred updates", () => {
    const counters = new Map<string, { count: number }>();
    const views = Array.from({ length: 200 }, (_, index) => {
      const counter = { count: 0 };
      counters.set(`agt-${index}`, counter);
      return settled(`agt-${index}`, `Thread ${index}`, {
        countRenders: counter,
        updatedAtEpochMs: NOW - index * 1000,
      });
    });
    render({ groups: [group(ROOT, "app", views)] });
    click('button[aria-label="Show 194 more threads in app"]');

    expect(host.querySelectorAll("[data-thread-id]")).toHaveLength(200);
    const before = counters.get("agt-5")?.count ?? 0;
    expect(before).toBeGreaterThan(0);

    for (let update = 1; update <= 20; update += 1) {
      const target = settled("agt-0", `Thread 0 v${update}`, {
        countRenders: counters.get("agt-0") ?? { count: 0 },
        updatedAtEpochMs: NOW + update,
      });
      render({ groups: [group(ROOT, "app", [target, ...views.slice(1)])] });
    }

    expect(counters.get("agt-5")?.count).toBe(before);
    expect(counters.get("agt-0")?.count).toBeGreaterThan(before);
  });

  it("shows a pending clone row above the list and reports cancel and dismiss", () => {
    const onCancelPendingClone = vi.fn();
    const onDismissPendingClone = vi.fn();
    render({
      pendingClone: { id: "clone-storefront", name: "storefront", status: "running", error: null },
      onCancelPendingClone,
      onDismissPendingClone,
    });

    const clone = host.querySelector('[aria-label="Repository clone"]');
    expect(clone?.textContent).toContain("storefront");
    expect(clone?.textContent).toContain("Cloning on the server");
    expect(clone?.nextElementSibling).toBe(host.querySelector(".agent-rail__scroll"));

    act(() => clone?.querySelector<HTMLButtonElement>("button")?.click());
    expect(onCancelPendingClone).toHaveBeenCalledTimes(1);

    render({
      pendingClone: {
        id: "clone-storefront",
        name: "storefront",
        status: "failed",
        error: "Clone rejected",
      },
      onCancelPendingClone,
      onDismissPendingClone,
    });
    expect(host.textContent).toContain("Clone rejected");
    act(() =>
      host
        .querySelector('[aria-label="Repository clone"]')
        ?.querySelector<HTMLButtonElement>("button")
        ?.click(),
    );
    expect(onDismissPendingClone).toHaveBeenCalledTimes(1);
  });

  it("keeps the rail free of a clone row without a pending clone", () => {
    render();

    expect(host.querySelector('[aria-label="Repository clone"]')).toBeNull();
  });

  function render(overrides: Partial<AgentThreadsSidebarProps> = {}): void {
    const props = sidebarProps(overrides);
    act(() => {
      root.render(
        <AgentClockProvider nowTickMs={1000}>
          <SidebarHarness {...props} />
        </AgentClockProvider>,
      );
    });
  }

  function sidebarProps(overrides: Partial<AgentThreadsSidebarProps> = {}): SidebarHarnessProps {
    const groups = overrides.groups ?? [group(ROOT, "app", [settled("agt-1", "Fix the parser")])];
    return {
      addProjectAvailable: true,
      groups,
      search: searchSurface(""),
      scope: { projectRootKey: ROOT, repositoryRoot: ROOT },
      scopeEntries: agentRailScopeEntries(groups),
      overflowRootPaths: [],
      selectedThreadId: null,
      providerManagement: providerManagement(),
      providerEnabled: { claudeCode: true, codex: true },
      onOpenProviderSettings: vi.fn(),
      onOpenSourceControl: vi.fn(),
      onSelectThread: vi.fn(),
      onTogglePin: vi.fn(),
      onThreadMenuCommand: vi.fn(),
      onNewThread: vi.fn(),
      onAddProject: vi.fn(),
      onProjectCommand: vi.fn(),
      onNewThreadInProject: vi.fn(),
      onSwitchProject: vi.fn(),
      onFocusProject: vi.fn(),
      onShowAllProjects: vi.fn(),
      projectFocus: "all",
      collapseShortcut: "Cmd+B",
      ...overrides,
    };
  }

  function row(threadId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function deleteItem(): HTMLButtonElement {
    const element = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Delete",
    );
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element as HTMLButtonElement;
  }

  function dialogButton(label: string): HTMLButtonElement {
    const element = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === label);
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element as HTMLButtonElement;
  }

  function savedTitles(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>("[data-saved-conversation-row]")].map(
      (element) => element.getAttribute("title") ?? "",
    );
  }

  function settledShelf(): HTMLButtonElement | undefined {
    return [...host.querySelectorAll<HTMLButtonElement>("button.cv-sb-shelf")].find((button) =>
      button.textContent?.startsWith("Settled"),
    );
  }

  function openRowMenu(threadId: string): void {
    act(() => {
      row(threadId).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    });
  }

  function projectGroup(label: string): HTMLElement {
    const groupElement = [...host.querySelectorAll<HTMLElement>(".cv-sb-project")].find(
      (candidate) => candidate.querySelector(".cv-sb-project__name")?.textContent === label,
    );
    expect(groupElement).toBeDefined();
    return groupElement as HTMLElement;
  }

  function projectNames(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".cv-sb-project__name")].map((node) => node.textContent ?? "");
  }

  function projectToggle(label: string): HTMLButtonElement {
    const toggle = projectGroup(label).querySelector<HTMLButtonElement>(".cv-sb-project__toggle");
    expect(toggle).not.toBeNull();
    return toggle as HTMLButtonElement;
  }

  function projectRowIds(label: string): ReadonlyArray<string> {
    return [...projectGroup(label).querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function projectState(label: string): string | null {
    return projectGroup(label).querySelector(".cv-sb-project__state")?.textContent ?? null;
  }

  function rowIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function clickRow(threadId: string, modifiers: MouseEventInit = {}): void {
    const element = row(threadId);
    act(() => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }),
      );
    });
  }

  function markedIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>('[data-thread-id][aria-selected="true"]')].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function selectionBar(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[aria-label="Thread selection actions"]');
  }

  function barButton(label: string): HTMLButtonElement {
    const buttons = [...(selectionBar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const element = buttons.find((button) => button.textContent?.includes(label) === true);
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element as HTMLButtonElement;
  }

  function keyWith(element: HTMLElement, keyName: string, init: KeyboardEventInit = {}): void {
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init }),
      );
    });
  }

  function cssRule(selector: string, source: string = AGENT_MODE_CSS): string {
    const start = source.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    const bodyStart = source.indexOf("{", start);
    const end = source.indexOf("}", bodyStart);
    return source.slice(bodyStart + 1, end);
  }

  function key(element: HTMLElement, keyName: string): void {
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }),
      );
    });
  }
});

function providerManagement(): AgentProviderManagementSurface {
  const preferences = defaultAgentProviderPreferences();
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "disabled" },
    }),
    authority: (provider) => ({
      settingsRevision: 1,
      provider,
      preference: preferences[provider],
      cliPath: `/bin/${provider}`,
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    refreshAll: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}

let savedUserAgent: PropertyDescriptor | undefined;

function withUserAgent(userAgent: string): void {
  savedUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
}

function restoreNavigator(): void {
  if (savedUserAgent === undefined) {
    Reflect.deleteProperty(navigator, "userAgent");
    return;
  }
  Object.defineProperty(navigator, "userAgent", savedUserAgent);
  savedUserAgent = undefined;
}

function withVisibility(state: DocumentVisibilityState, run: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  try {
    run();
  } finally {
    if (saved === undefined) Reflect.deleteProperty(document, "visibilityState");
    if (saved !== undefined) Object.defineProperty(document, "visibilityState", saved);
  }
}

class CountingMap<Key, Value> extends Map<Key, Value> {
  reads = 0;

  override get(key: Key): Value | undefined {
    this.reads += 1;
    return super.get(key);
  }
}

function searchSurface(query: string, result: AgentThreadSearchResult | null = null) {
  const surface: AgentThreadSearchSurface = {
    query,
    active: query.trim().length >= 2,
    result,
    pending: false,
    setQuery: vi.fn(),
    clear: vi.fn(),
  };
  return surface;
}

function savedRow(threadId: string, title: string, archived = false): AgentHistoryCatalogRow {
  return {
    threadId,
    title,
    archived,
    running: false,
    provider: "claudeCode",
    worktree: true,
    updatedAtEpochMs: NOW - 2 * 60_000,
  };
}

function savedCatalog(
  rootKey: string,
  rows: ReadonlyArray<AgentHistoryCatalogRow>,
): AgentHistoryCatalogSurface {
  return {
    projects: [
      { rootKey: ROOT, label: "app" },
      { rootKey: OTHER, label: "api" },
    ],
    page: {
      rootKey,
      threads: [],
      beforeThreadId: null,
      hasEarlier: false,
      atNewest: true,
      loading: false,
      deletingThreadId: null,
      error: null,
      notice: null,
    },
    rows,
    choose: vi.fn().mockResolvedValue(undefined),
    older: vi.fn().mockResolvedValue(undefined),
    latest: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    open: vi.fn().mockResolvedValue(true),
    rename: vi.fn().mockResolvedValue(true),
    setArchived: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
  };
}

function scopedTo(projectRootKey: string, view: AgentThreadView): AgentThreadView {
  return {
    ...view,
    thread: { ...view.thread, owner: { ...view.thread.owner, rootKey: projectRootKey } },
  };
}

function threeThreads(): ReadonlyArray<AgentThreadView> {
  return [
    settled("agt-1", "One", { updatedAtEpochMs: NOW - 1000 }),
    settled("agt-2", "Two", { updatedAtEpochMs: NOW - 2000 }),
    settled("agt-3", "Three", { updatedAtEpochMs: NOW - 3000 }),
  ];
}

function group(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentThreadView>,
  overrides: Partial<Pick<AgentProjectGroup, "origin" | "rootPath" | "trust">> = {},
): AgentProjectGroup {
  return {
    projectRootKey: repositoryRoot,
    kind: "project",
    label,
    rootPath: repositoryRoot,
    trust: "trusted",
    origin: "active-tab",
    singleRepo: true,
    repos: [
      {
        repositoryRoot,
        label,
        repositoryResolved: true,
        threads: threads.filter((view) => !view.thread.archived),
        archived: threads.filter((view) => view.thread.archived),
        orphans: [],
        liveCount: threads.filter((view) => view.lifecycle === "running").length,
      },
    ],
    liveCount: threads.filter((view) => view.lifecycle === "running").length,
    ...overrides,
  };
}

interface ThreadViewOptions {
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly settledAt?: number | null;
  readonly updatedAtEpochMs?: number;
  readonly endedAtEpochMs?: number | null;
  readonly viewedAtEpochMs?: number | null;
  readonly branch?: string | null;
  readonly provider?: "claudeCode" | "codex";
  readonly repositoryRoot?: string;
  readonly countRenders?: { count: number };
}

function threadView(threadId: string, title: string, options: ThreadViewOptions): AgentThreadView {
  const {
    archived = false,
    branch = null,
    countRenders,
    endedAtEpochMs = null,
    pinned = false,
    provider = "claudeCode",
    repositoryRoot = ROOT,
    settledAt = null,
    status = { kind: "running" },
    updatedAtEpochMs = NOW - 2 * 60_000,
    viewedAtEpochMs = null,
  } = options;
  const running = status.kind === "pending" || status.kind === "running";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: repositoryRoot, ownerId: `agent-root:${repositoryRoot}`, repositoryRoot },
    target: { isolation: "worktree", worktreePath: `${repositoryRoot}/.worktrees/${threadId}` },
    provider: { kind: provider, sessionId: null },
    title,
    pinned,
    archived,
    settledAt,
    createdAtEpochMs: NOW - 10 * 60_000,
    updatedAtEpochMs,
    turns: [
      {
        turnId: `${threadId}-t1`,
        prompt: title,
        status,
        startedAtEpochMs: NOW - 10 * 60_000,
        endedAtEpochMs,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs,
    externalOrigin: null,
    integration: null,
  };
  if (countRenders !== undefined) countTitleReads(thread, title, countRenders);

  return {
    ship:
      branch === null
        ? { kind: "idle", status: null, loadingStatus: false }
        : {
            kind: "pushed",
            status: null,
            receipt: { branch, remote: "origin", compareUrl: null },
          },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

function running(
  threadId: string,
  title: string,
  options: ThreadViewOptions = {},
): AgentThreadView {
  return threadView(threadId, title, { status: { kind: "running" }, ...options });
}

function failed(threadId: string, title: string): AgentThreadView {
  return threadView(threadId, title, {
    endedAtEpochMs: NOW - 60_000,
    status: { kind: "failed", message: "boom" },
  });
}

function settled(
  threadId: string,
  title: string,
  options: ThreadViewOptions = {},
): AgentThreadView {
  return threadView(threadId, title, {
    endedAtEpochMs: NOW - 2 * 60_000,
    status: { kind: "exited", exitCode: 0 },
    viewedAtEpochMs: NOW,
    ...options,
  });
}

function nativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  expect(descriptor?.set).toBeTypeOf("function");
  descriptor?.set?.call(input, value);
}

function countTitleReads(thread: AgentThread, title: string, counter: { count: number }): void {
  Object.defineProperty(thread, "title", {
    configurable: true,
    enumerable: true,
    get: () => {
      counter.count += 1;
      return title;
    },
  });
}

describe("agentMode.css after the terminal sessions palette redesign", () => {
  const RETIRED_CLASSES = ["agent-terminal-sessions", "agent-rail__empty-import"];

  it("keeps no retired class in the stylesheet or in any agent mode component", () => {
    const directory = import.meta.dirname;
    const offenders = readdirSync(directory)
      .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
      .filter((name) => {
        const source = readFileSync(resolve(directory, name), "utf8");
        const applied = [...source.matchAll(/className="([^"]*)"/gu)].flatMap((match) =>
          (match[1] ?? "").split(/\s+/u),
        );
        return RETIRED_CLASSES.some((retired) => applied.includes(retired));
      });

    expect(offenders).toEqual([]);
    for (const retired of RETIRED_CLASSES) {
      expect(AGENT_MODE_CSS).not.toContain(`.${retired}`);
    }
  });
});
