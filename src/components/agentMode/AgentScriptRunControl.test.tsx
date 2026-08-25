// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadScriptEntry,
  AgentThreadScriptsSurface,
} from "../../application/useAgentThreadScripts";
import { AGENT_SCRIPT_BUSY_REASON } from "../../application/useAgentThreadScripts";
import { AgentScriptRunControl } from "./AgentScriptRunControl";
import {
  AGENT_SCRIPT_ELSEWHERE_SUFFIX,
  AGENT_SCRIPT_NONE_LABEL,
} from "./agentThreadHeaderPresentation";

describe("AgentScriptRunControl", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("runs the preferred script from the primary button", () => {
    const scripts = surface({ entries: [entry("dev"), entry("test")], preferred: entry("dev") });
    render(scripts, null);

    const primary = button("Run dev");
    expect(primary.textContent).toContain("dev");
    act(() => primary.click());

    expect(scripts.runScript).toHaveBeenCalledWith("dev");
  });

  it("turns into Stop while a script runs and disables the entries", () => {
    const scripts = surface({
      entries: [entry("dev")],
      preferred: entry("dev"),
      run: { kind: "running", key: "dev", label: "dev", stoppable: true, reason: null },
    });
    render(scripts, null);

    act(() => button("Stop dev").click());
    expect(scripts.stopScript).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".agent-split")?.getAttribute("data-running")).toBe("true");

    act(() => button("Choose a script").click());
    expect(menuItem("dev").disabled).toBe(true);
  });

  it("shows a script started elsewhere as disabled with the busy reason", () => {
    const busy = entry("dev", { kind: "blocked", reason: AGENT_SCRIPT_BUSY_REASON });
    const scripts = surface({
      entries: [busy],
      preferred: busy,
      run: {
        kind: "running",
        key: "dev",
        label: "dev",
        stoppable: false,
        reason: AGENT_SCRIPT_BUSY_REASON,
      },
    });
    render(scripts, null);

    const primary = button(`dev ${AGENT_SCRIPT_ELSEWHERE_SUFFIX}`);
    expect(primary.disabled).toBe(true);
    expect(primary.title).toBe(AGENT_SCRIPT_BUSY_REASON);
    expect(host.querySelector(".agent-split")?.getAttribute("data-run-owner")).toBe("elsewhere");

    act(() => primary.click());
    expect(scripts.stopScript).not.toHaveBeenCalled();
    expect(scripts.runScript).not.toHaveBeenCalled();
  });

  it("disables the primary with the blocked reason and shows it in the menu", () => {
    const blocked = entry("dev", { kind: "blocked", reason: "Runs in the main checkout only" });
    const scripts = surface({ entries: [blocked], preferred: blocked });
    render(scripts, null);

    const primary = button("Run dev");
    expect(primary.disabled).toBe(true);
    expect(primary.title).toBe("Runs in the main checkout only");

    act(() => button("Choose a script").click());
    expect(menuItem("dev").disabled).toBe(true);
    expect(host.querySelector(".agent-menu__reason")?.textContent).toBe(
      "Runs in the main checkout only",
    );
  });

  it("runs a picked entry from the menu and returns focus to the chevron", async () => {
    const scripts = surface({ entries: [entry("dev"), entry("lint")], preferred: entry("dev") });
    render(scripts, null);

    act(() => button("Choose a script").click());
    await act(async () => {});
    expect(document.activeElement?.getAttribute("data-script-key")).toBe("dev");
    expect(menuItem("dev").getAttribute("aria-current")).toBe("true");

    act(() => menuItem("lint").click());

    expect(scripts.runScript).toHaveBeenCalledWith("lint");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button("Choose a script"));
  });

  it("offers the scripts view and a note when nothing is discovered", () => {
    const onOpenScriptsView = vi.fn();
    render(surface({ entries: [], preferred: null, truncated: true }), onOpenScriptsView);

    const primary = button(AGENT_SCRIPT_NONE_LABEL);
    expect(primary.disabled).toBe(true);

    act(() => button("Choose a script").click());
    expect(host.querySelectorAll(".agent-menu__note")).toHaveLength(2);
    act(() => menuItem("Open Scripts and Tasks").click());
    expect(onOpenScriptsView).toHaveBeenCalledTimes(1);
  });

  it("disables the chevron when there is neither an entry nor a scripts view", () => {
    render(surface({ entries: [], preferred: null }), null);
    expect(button("Choose a script").disabled).toBe(true);
  });

  function render(
    scripts: AgentThreadScriptsSurface,
    onOpenScriptsView: (() => void) | null,
  ): void {
    act(() => {
      root.render(
        <AgentScriptRunControl onOpenScriptsView={onOpenScriptsView} scripts={scripts} />,
      );
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element, `Missing button ${label}`).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function menuItem(label: string): HTMLButtonElement {
    const element = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent?.startsWith(label) === true,
    );
    expect(element, `Missing item ${label}`).toBeDefined();
    return element as HTMLButtonElement;
  }
});

function entry(
  name: string,
  availability: AgentThreadScriptEntry["availability"] = { kind: "available" },
): AgentThreadScriptEntry {
  return { key: name, label: name, detail: null, availability };
}

function surface(overrides: Partial<AgentThreadScriptsSurface>): AgentThreadScriptsSurface {
  return {
    entries: [],
    preferred: null,
    truncated: false,
    run: { kind: "idle" },
    ...overrides,
    runScript: vi.fn(() => true),
    stopScript: vi.fn(),
  };
}
