// @vitest-environment jsdom

import { Terminal } from "@xterm/xterm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classicTerminalTheme } from "../domain/editorColorThemes";
import type { TerminalProfile } from "../domain/terminal";
import {
  fakeTerminalGateway,
  installResizeObserver,
  type FakeTerminalGateway,
} from "./agentMode/agentSurfaceTerminalTestSupport";
import { BottomPanel } from "./BottomPanel";
import { loadTerminalTabsPanel } from "./terminalTabsPanelChunk";

vi.mock("@xterm/xterm", async () =>
  (await import("./agentMode/agentSurfaceTerminalTestSupport")).xtermMockModule(),
);
vi.mock("@xterm/addon-fit", async () =>
  (await import("./agentMode/agentSurfaceTerminalTestSupport")).fitAddonMockModule(),
);

const PROFILES: TerminalProfile[] = [
  { command: null, id: "default", label: "Default Shell" },
  { command: "/bin/zsh", id: "zsh", label: "Zsh" },
];

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("BottomPanel terminal start", () => {
  let host: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installResizeObserver();
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      frames.delete(frameId);
    });
    vi.mocked(Terminal).mockClear();
    await loadTerminalTabsPanel();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();
    });
  }

  async function runFrames(): Promise<void> {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
    await settle();
  }

  async function renderPanel(gateway: FakeTerminalGateway): Promise<void> {
    await act(async () => {
      root.render(
        <BottomPanel
          onClose={vi.fn()}
          onOpenProblem={vi.fn(async () => true)}
          onResizeStart={vi.fn()}
          onTrustWorkspace={vi.fn()}
          terminalGateway={gateway}
          terminalOwnerKey="workspace-a"
          terminalShellIntegrationEnabled={false}
          terminalTheme={classicTerminalTheme("classicDark")}
          workspaceRoot="/workspace"
          workspaceTrusted
        />,
      );
    });
    await settle();
  }

  it("starts once when the profile list resolves after the shell started", async () => {
    const gateway = fakeTerminalGateway();
    const profiles = deferred<TerminalProfile[]>();
    gateway.listProfiles = vi.fn(() => profiles.promise);

    await renderPanel(gateway);
    await runFrames();
    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.acknowledgeStart).toHaveBeenCalledWith(1);

    await act(async () => profiles.resolve(PROFILES));
    await settle();
    await runFrames();

    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();
    expect(vi.mocked(Terminal)).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Terminal profile"]')?.value).toBe(
      "default",
    );
  });

  it("starts once when the profile list resolves before the first frame", async () => {
    const gateway = fakeTerminalGateway();
    const profiles = deferred<TerminalProfile[]>();
    gateway.listProfiles = vi.fn(() => profiles.promise);

    await renderPanel(gateway);
    expect(frames.size).toBeGreaterThan(0);
    await act(async () => profiles.resolve(PROFILES));
    await settle();
    await runFrames();
    await runFrames();

    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();
    expect(vi.mocked(Terminal)).toHaveBeenCalledTimes(1);
  });

  it("reuses the loaded profile list when the panel is reopened", async () => {
    const gateway = fakeTerminalGateway();
    gateway.listProfiles = vi.fn(async () => PROFILES);

    await renderPanel(gateway);
    await runFrames();
    act(() => root.unmount());
    expect(gateway.stop).toHaveBeenCalledTimes(1);
    expect(gateway.stop).toHaveBeenCalledWith(1);

    root = createRoot(host);
    await renderPanel(gateway);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Terminal profile"]')?.value).toBe(
      "default",
    );
    await runFrames();

    expect(gateway.listProfiles).toHaveBeenCalledTimes(1);
    expect(gateway.start).toHaveBeenCalledTimes(2);
    expect(gateway.stop).toHaveBeenCalledTimes(1);
  });

  it("still restarts the shell when the user picks a different profile", async () => {
    const gateway = fakeTerminalGateway();
    gateway.listProfiles = vi.fn(async () => PROFILES);

    await renderPanel(gateway);
    await runFrames();
    expect(gateway.start).toHaveBeenCalledTimes(1);

    const select = host.querySelector<HTMLSelectElement>('[aria-label="Terminal profile"]');
    if (!select) throw new Error("Missing terminal profile selector");
    act(() => {
      select.value = "zsh";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await runFrames();

    expect(gateway.stop).toHaveBeenCalledTimes(1);
    expect(gateway.stop).toHaveBeenCalledWith(1);
    expect(gateway.start).toHaveBeenCalledTimes(2);
    expect(gateway.start.mock.calls[1]?.[2]).toBe("zsh");
  });
});
