// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanelLayoutControls } from "./AgentPanelLayoutControls";

const preloadTerminalTabsPanel = vi.hoisted(() => vi.fn());

vi.mock("../terminalTabsPanelChunk", () => ({ preloadTerminalTabsPanel }));

describe("AgentPanelLayoutControls terminal preload", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    preloadTerminalTabsPanel.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root.render(
        <AgentPanelLayoutControls
          bottomPanelOpen={false}
          onToggleBottomPanel={vi.fn()}
          onToggleRightPanel={vi.fn()}
          rightPanelOpen={false}
          shortcuts={null}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function button(label: string): HTMLButtonElement {
    const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  }

  it("preloads the terminal chunk when the terminal toggle is hovered or focused", () => {
    const toggle = button("Toggle terminal panel");

    act(() => {
      toggle.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(preloadTerminalTabsPanel).toHaveBeenCalledTimes(1);

    act(() => toggle.focus());
    expect(preloadTerminalTabsPanel).toHaveBeenCalledTimes(2);
  });

  it("does not preload the terminal chunk from the right panel toggle", () => {
    const toggle = button("Toggle right panel");

    act(() => {
      toggle.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      toggle.focus();
    });

    expect(preloadTerminalTabsPanel).not.toHaveBeenCalled();
  });
});
