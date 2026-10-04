// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentTurn } from "../../domain/agentThread";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  AGENT_RAIL_WORKING_RAIL_OFF,
  useAgentRailOrganizationClock,
  useAgentRailWorkingPendingInteractions,
  useAgentRailWorkingRail,
  type AgentRailWorkingRail,
  type AgentRailWorkingRailController,
} from "./useAgentRailWorkingRail";

const NO_PENDING: ReadonlyMap<string, AgentPendingInteraction> = new Map();

function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function runningView() {
  const base = surfaceThreadView().thread;
  const turn: AgentTurn = {
    turnId: "turn-1",
    prompt: "Continue",
    status: { kind: "running" },
    startedAtEpochMs: 4_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
  return surfaceThreadView({ thread: { ...base, threadId: "busy", turns: [turn] } });
}

describe("useAgentRailWorkingRail", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentRailWorkingRailController | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe({
    pending,
    preference,
  }: {
    readonly pending: ReadonlyMap<string, AgentPendingInteraction>;
    readonly preference: BrowserAgentRailWorkingSectionPreference | null;
  }) {
    const controller = useAgentRailWorkingRail(preference);
    useAgentRailWorkingPendingInteractions(controller, pending);
    latest = controller;
    return null;
  }

  function render(
    preference: BrowserAgentRailWorkingSectionPreference | null,
    pending: ReadonlyMap<string, AgentPendingInteraction> = NO_PENDING,
  ): void {
    act(() => root.render(<Probe pending={pending} preference={preference} />));
  }

  function controller(): AgentRailWorkingRailController {
    expect(latest).not.toBeNull();
    return latest as AgentRailWorkingRailController;
  }

  it("is off and collapsed without a stored preference", () => {
    render(null);

    expect(controller().rail.workingSection).toBe("off");
    expect(controller().rail.disclosure).toBe("collapsed");
    expect(controller().latestSplit.workingSection).toBe("off");
    expect(AGENT_RAIL_WORKING_RAIL_OFF.workingSection).toBe("off");
    expect(AGENT_RAIL_WORKING_RAIL_OFF.disclosure).toBe("collapsed");
    expect(AGENT_RAIL_WORKING_RAIL_OFF.toggleDisclosure()).toBeUndefined();
    expect(AGENT_RAIL_WORKING_RAIL_OFF.observeOrganizationClock(1)).toBeUndefined();
  });

  it("toggles the shelf for the session and keeps the rail and split in step", () => {
    render(null);
    const before = controller();

    act(() => before.rail.toggleDisclosure());
    expect(controller().rail.disclosure).toBe("expanded");
    expect(controller().latestSplit.disclosure).toBe("expanded");
    expect(controller().rail.toggleDisclosure).toBe(before.rail.toggleDisclosure);

    act(() => controller().rail.toggleDisclosure());
    expect(controller().rail.disclosure).toBe("collapsed");

    act(() => root.unmount());
    root = createRoot(host);
    render(null);
    expect(controller().rail.disclosure).toBe("collapsed");
  });

  it("follows the stored preference and later changes to it", () => {
    const storage = memoryStorage({ [AGENT_RAIL_WORKING_SECTION_STORAGE_KEY]: "on" });
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    render(preference);
    expect(controller().rail.workingSection).toBe("on");
    expect(controller().latestSplit.workingSection).toBe("on");

    act(() => {
      preference.save("off");
    });
    expect(controller().rail.workingSection).toBe("off");
    expect(controller().latestSplit.workingSection).toBe("off");
  });

  it("reads the latest pending interactions through a stable status lookup", () => {
    const view = runningView();
    render(null);
    const split = controller().latestSplit;
    expect(split.statusOf(view)).toEqual({ kind: "working", startedAtEpochMs: 4_000 });

    render(null, new Map([["busy", "approval"]]));
    expect(controller().latestSplit).toBe(split);
    expect(split.statusOf(view)).toEqual({ kind: "approval" });

    render(null, new Map([["busy", "input"]]));
    expect(split.statusOf(view)).toEqual({ kind: "input" });

    render(null);
    expect(split.statusOf(view)).toEqual({ kind: "working", startedAtEpochMs: 4_000 });
  });

  it("orders by the sidebar's clock while a sidebar reports one and by the wall clock otherwise", () => {
    render(null);
    const split = controller().latestSplit;
    expect(Math.abs(split.now() - Date.now())).toBeLessThan(5_000);

    const sidebarHost = document.createElement("div");
    document.body.append(sidebarHost);
    const sidebarRoot = createRoot(sidebarHost);
    function Sidebar({ now, rail }: { readonly now: number; readonly rail: AgentRailWorkingRail }) {
      useAgentRailOrganizationClock(rail, now);
      return null;
    }
    act(() => sidebarRoot.render(<Sidebar now={1_234} rail={controller().rail} />));
    expect(controller().latestSplit).toBe(split);
    expect(split.now()).toBe(1_234);

    act(() => sidebarRoot.render(<Sidebar now={5_678} rail={controller().rail} />));
    expect(split.now()).toBe(5_678);

    act(() => sidebarRoot.unmount());
    sidebarHost.remove();
    expect(Math.abs(split.now() - Date.now())).toBeLessThan(5_000);
  });

  it("keeps the same controller while nothing changes", () => {
    render(null);
    const first = controller();

    render(null);

    expect(controller()).toBe(first);
    expect(controller().rail).toBe(first.rail);
  });
});
