// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentPanelLayoutControls,
  AgentPanelWindowControls,
  type AgentPanelLayoutControlsProps,
} from "./AgentPanelLayoutControls";
import { agentControlTooltip, agentShortcutGlyphs } from "./agentThreadHeaderPresentation";

const SHORTCUTS = {
  bottomPanel: "Cmd+J",
  rightPanel: "Cmd+Alt+R",
  sidebar: "Cmd+B",
  newThread: "Cmd+Shift+N",
};

describe("agentShortcutGlyphs", () => {
  it("renders chords as platform glyphs in a stable modifier order", () => {
    expect(agentShortcutGlyphs("Cmd+J")).toBe("⌘J");
    expect(agentShortcutGlyphs("Cmd+Alt+R")).toBe("⌥⌘R");
    expect(agentShortcutGlyphs("Ctrl+Shift+Enter")).toBe("⌃⇧↩");
    expect(agentShortcutGlyphs("")).toBe("");
    expect(agentControlTooltip("Toggle right panel", "")).toBe("Toggle right panel");
  });
});

describe("AgentPanelLayoutControls", () => {
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

  it("renders pressed toggles with keymap chords in the tooltip and aria-keyshortcuts", () => {
    render({ bottomPanelOpen: true, rightPanelOpen: false });

    const bottom = button("Toggle terminal panel");
    const right = button("Toggle right panel");
    expect(bottom.getAttribute("aria-pressed")).toBe("true");
    expect(right.getAttribute("aria-pressed")).toBe("false");
    expect(bottom.title).toBe("Toggle terminal panel (⌘J)");
    expect(right.title).toBe("Toggle right panel (⌥⌘R)");
    expect(bottom.getAttribute("aria-keyshortcuts")).toBe("Meta+J");
    expect(right.getAttribute("aria-keyshortcuts")).toBe("Meta+Alt+R");
  });

  it("invokes the toggle callbacks", () => {
    const onToggleBottomPanel = vi.fn();
    const onToggleRightPanel = vi.fn();
    render({ onToggleBottomPanel, onToggleRightPanel });

    act(() => button("Toggle terminal panel").click());
    act(() => button("Toggle right panel").click());

    expect(onToggleBottomPanel).toHaveBeenCalledTimes(1);
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps the right panel toggle enabled without a thread", () => {
    render({ rightPanelOpen: false });

    const right = button("Toggle right panel");
    expect(right.disabled).toBe(false);
    expect(right.title).toBe("Toggle right panel (⌥⌘R)");
  });

  function render(overrides: Partial<AgentPanelLayoutControlsProps>): void {
    const props: AgentPanelLayoutControlsProps = {
      bottomPanelOpen: false,
      rightPanelOpen: false,
      shortcuts: SHORTCUTS,
      onToggleBottomPanel: vi.fn(),
      onToggleRightPanel: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(<AgentPanelLayoutControls {...props} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element, `Missing button ${label}`).not.toBeNull();
    return element as HTMLButtonElement;
  }
});

describe("AgentPanelWindowControls", () => {
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

  it("maximizes, restores and closes the panel by swapping the label, never a pressed state", () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <AgentPanelWindowControls maximize={{ maximized: false, onToggle }} onClose={onClose} />,
      ),
    );
    const maximize = host.querySelector<HTMLButtonElement>('button[aria-label="Maximize panel"]');
    expect(maximize?.hasAttribute("aria-pressed")).toBe(false);
    act(() => maximize?.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')?.click());

    act(() =>
      root.render(
        <AgentPanelWindowControls maximize={{ maximized: true, onToggle }} onClose={onClose} />,
      ),
    );
    const restore = host.querySelector<HTMLButtonElement>('button[aria-label="Restore panel"]');
    expect(restore?.hasAttribute("aria-pressed")).toBe(false);
    expect(host.querySelector('button[aria-label="Maximize panel"]')).toBeNull();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
