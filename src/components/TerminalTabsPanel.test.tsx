// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TERMINAL_TABS } from "../domain/terminalTabSet";
import type { TerminalGateway } from "../domain/terminal";
import { terminalThemeForAppTheme } from "../domain/settings";

interface CapturedTerminal {
  readonly isActive: boolean;
  readonly labelledBy?: string;
  readonly panelId?: string;
  readonly profileId: string | null;
  onCwdChange?(cwd: string | null): void;
  onOpenLink?(path: string, line?: number, column?: number): void;
  onSessionReady?(sessionId: number | null): void;
}

const mocks = vi.hoisted(() => ({
  mounted: new Map<string, CapturedTerminal>(),
  unmounted: [] as string[],
}));

vi.mock("./TerminalPanel", async () => {
  const React = await import("react");
  return {
    TerminalPanel: (props: CapturedTerminal) => {
      const id = React.useId();
      const propsRef = React.useRef(props);
      propsRef.current = props;
      React.useEffect(() => {
        mocks.mounted.set(id, propsRef.current);
        return () => {
          mocks.mounted.delete(id);
          mocks.unmounted.push(id);
        };
      }, [id]);
      mocks.mounted.set(id, props);
      return (
        <div
          aria-label={`Child terminal ${id}`}
          aria-labelledby={props.labelledBy}
          id={props.panelId}
          role="tabpanel"
        />
      );
    },
  };
});

import { TerminalTabsPanel } from "./TerminalTabsPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("TerminalTabsPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  const sessions = vi.fn();
  const cwds = vi.fn();
  const profiles = vi.fn();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mocks.mounted.clear();
    mocks.unmounted.length = 0;
    sessions.mockClear();
    cwds.mockClear();
    profiles.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("mounts isolated sessions, switches without unmounting, and publishes only active runtime", () => {
    render();
    click("New Terminal");
    expect(mocks.mounted.size).toBe(2);
    const [first, second] = [...mocks.mounted.values()];
    act(() => first?.onSessionReady?.(11));
    expect(sessions).not.toHaveBeenLastCalledWith(11);
    act(() => second?.onSessionReady?.(22));
    expect(sessions).toHaveBeenLastCalledWith(22);

    tab("Terminal 1").click();
    expect(sessions).toHaveBeenLastCalledWith(11);
    expect(mocks.mounted.size).toBe(2);
    act(() => second?.onCwdChange?.("/workspace/web"));
    expect(cwds).not.toHaveBeenLastCalledWith("/workspace/web");
    act(() => first?.onCwdChange?.("/workspace/api"));
    expect(cwds).toHaveBeenLastCalledWith("/workspace/api");
  });

  it("closes only its child and stale callbacks cannot replace the active session", () => {
    render();
    click("New Terminal");
    const [first, second] = [...mocks.mounted.values()];
    act(() => first?.onSessionReady?.(1));
    act(() => second?.onSessionReady?.(2));
    click("Close Terminal 2");
    expect(mocks.mounted.size).toBe(1);
    expect(mocks.unmounted).toHaveLength(1);
    expect(sessions).toHaveBeenLastCalledWith(1);
    act(() => second?.onSessionReady?.(99));
    expect(sessions).toHaveBeenLastCalledWith(1);
  });

  it("supports roving keyboard tabs and enforces the maximum", () => {
    render();
    click("New Terminal");
    const first = tab("Terminal 1");
    first.focus();
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
    expect(tab("Terminal 2").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Terminal 2"));
    expect(first.tabIndex).toBe(-1);

    for (let index = 2; index < MAX_TERMINAL_TABS; index += 1) click("New Terminal");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(MAX_TERMINAL_TABS);
    expect(button("New Terminal").disabled).toBe(true);
  });

  it("restores focus to the MRU tab after closing the focused active tab", () => {
    render();
    click("New Terminal");
    const close = button("Close Terminal 2");
    close.focus();
    click("Close Terminal 2");

    expect(document.activeElement).toBe(tab("Terminal 1"));
  });

  it("falls back to a bounded title before mutating runtime and wires tabpanel aria", () => {
    render("workspace-a", sessions, false, "x".repeat(129));
    click("New Terminal");

    expect(tab("Terminal 2").getAttribute("aria-controls")).toBe("terminal-1-panel");
    const panel = host.querySelector('[role="tabpanel"][id="terminal-1-panel"]');
    expect(panel?.getAttribute("aria-labelledby")).toBe("terminal-1-tab");
    expect(mocks.mounted.size).toBe(2);
  });

  it("drops link activation from an inactive or closed tab", () => {
    const onOpenLink = vi.fn();
    render("workspace-a", sessions, false, null, onOpenLink);
    const [first] = [...mocks.mounted.values()];
    click("New Terminal");
    const second = [...mocks.mounted.values()][1];

    act(() => first?.onOpenLink?.("/workspace/inactive.ts", 1, 1));
    expect(onOpenLink).not.toHaveBeenCalled();
    click("Close Terminal 2");
    act(() => second?.onOpenLink?.("/workspace/closed.ts", 1, 1));
    act(() => first?.onOpenLink?.("/workspace/active.ts", 2, 3));
    expect(onOpenLink).toHaveBeenCalledExactlyOnceWith("/workspace/active.ts", 2, 3);
  });

  it("applies a late default to the active tab and preserves profiles across tab switches", () => {
    render("workspace-a", sessions, false, null, undefined, null, profiles);
    expect([...mocks.mounted.values()][0]?.profileId).toBeNull();

    render("workspace-a", sessions, false, null, undefined, "zsh", profiles);
    expect([...mocks.mounted.values()][0]?.profileId).toBe("zsh");
    click("New Terminal");
    render("workspace-a", sessions, false, null, undefined, "fish", profiles);
    const [first, second] = [...mocks.mounted.values()];
    expect(first?.profileId).toBe("zsh");
    expect(second?.profileId).toBe("fish");

    tab("Terminal 1").click();
    expect(profiles).toHaveBeenLastCalledWith("zsh");
    tab("Terminal 2").click();
    expect(profiles).toHaveBeenLastCalledWith("fish");
  });

  it("keeps one terminal alive and remains callback-safe in StrictMode", () => {
    const latestSessions = vi.fn();
    render("workspace-a", sessions, true);
    expect(button("Close Terminal 1").disabled).toBe(true);
    click("Close Terminal 1");
    expect(mocks.mounted.size).toBe(1);

    render("workspace-a", latestSessions, true);
    const [terminal] = [...mocks.mounted.values()];
    act(() => terminal?.onSessionReady?.(7));
    expect(latestSessions).toHaveBeenLastCalledWith(7);
  });

  it("a same-root owner replacement unmounts every old session and creates a fresh first tab", () => {
    render("workspace-a");
    click("New Terminal");
    expect(mocks.mounted.size).toBe(2);
    render("workspace-b");
    expect(mocks.unmounted).toHaveLength(2);
    expect(mocks.mounted.size).toBe(1);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  function render(
    ownerKey = "workspace-a",
    onSessionReady = sessions,
    strict = false,
    profileLabel: string | null = null,
    onOpenLink?: (path: string, line?: number, column?: number) => void,
    profileId: string | null = "zsh",
    onProfileChange = profiles,
  ) {
    const panel = (
      <TerminalTabsPanel
        isActive
        key={ownerKey}
        onActiveCwdChange={cwds}
        onActiveProfileChange={onProfileChange}
        onActiveSessionReady={onSessionReady}
        onOpenLink={onOpenLink}
        ownerKey={JSON.stringify([ownerKey, "/workspace"])}
        profileId={profileId}
        profileLabel={profileLabel}
        rootPath="/workspace"
        shellIntegrationEnabled={false}
        terminalGateway={{} as TerminalGateway}
        terminalTheme={terminalThemeForAppTheme("dark")}
      />
    );
    act(() => {
      root.render(strict ? <StrictMode>{panel}</StrictMode> : panel);
    });
  }

  function click(label: string) {
    act(() => button(label).click());
  }

  function button(label: string): HTMLButtonElement {
    const result = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    if (!result) throw new Error(`Missing ${label}`);
    return result;
  }

  function tab(label: string): HTMLButtonElement {
    const result = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (candidate) => candidate.textContent === label,
    );
    if (!result) throw new Error(`Missing tab ${label}`);
    return result;
  }
});
