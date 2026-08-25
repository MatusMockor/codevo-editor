// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentPanelLayoutControls,
  type AgentPanelLayoutControlsProps,
} from "./AgentPanelLayoutControls";
import { agentControlTooltip, agentShortcutGlyphs } from "./agentThreadHeaderPresentation";

const SHORTCUTS = { bottomPanel: "Cmd+J", rightPanel: "Cmd+Alt+R", expandEditor: "Cmd+Alt+E" };

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

  it("renders pressed toggles with keymap chords in the tooltip", () => {
    render({ bottomPanelOpen: true, rightPanelOpen: false });

    const bottom = button("Toggle terminal panel (⌘J)");
    const right = button("Toggle right panel (⌥⌘R)");
    expect(bottom.getAttribute("aria-pressed")).toBe("true");
    expect(right.getAttribute("aria-pressed")).toBe("false");
    expect(bottom.title).toBe("Toggle terminal panel (⌘J)");
    expect(host.querySelector('[aria-label^="Expand to editor"]')).toBeNull();
  });

  it("invokes the toggle callbacks", () => {
    const onToggleBottomPanel = vi.fn();
    const onToggleRightPanel = vi.fn();
    render({ onToggleBottomPanel, onToggleRightPanel });

    act(() => button("Toggle terminal panel (⌘J)").click());
    act(() => button("Toggle right panel (⌥⌘R)").click());

    expect(onToggleBottomPanel).toHaveBeenCalledTimes(1);
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps the right panel toggle enabled without a thread", () => {
    render({ rightPanelOpen: false });

    const right = button("Toggle right panel (⌥⌘R)");
    expect(right.disabled).toBe(false);
    expect(right.title).toBe("Toggle right panel (⌥⌘R)");
  });

  it("shows the expand button only when an expand handler is given", () => {
    const onExpandEditor = vi.fn();
    render({ onExpandEditor });

    act(() => button("Expand to editor (⌥⌘E)").click());
    expect(onExpandEditor).toHaveBeenCalledTimes(1);
  });

  function render(overrides: Partial<AgentPanelLayoutControlsProps>): void {
    const props: AgentPanelLayoutControlsProps = {
      bottomPanelOpen: false,
      rightPanelOpen: false,
      shortcuts: SHORTCUTS,
      onToggleBottomPanel: vi.fn(),
      onToggleRightPanel: vi.fn(),
      onExpandEditor: null,
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
