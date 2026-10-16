// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_PALETTE_FILE_DEBOUNCE_MS } from "./application/agentApp/useAgentPaletteFiles";
import { detectKeymapPlatform } from "./domain/keymap";
import type { FileSearchGateway } from "./domain/workspace";
import { defaultAppSettings } from "./domain/settings";
import {
  actAndSettle,
  agentAppGitGateway,
  renderAgentApp,
  settleAgentApp,
  unmountAgentAppHarnesses,
} from "./test/agentAppTestHarness";
import { waitForReact } from "./test/reactTestLifecycle";
import { fakeTerminalGateway } from "./components/agentMode/agentSurfaceTerminalTestSupport";

const APP_SETTINGS = {
  ...defaultAppSettings(),
  recentWorkspacePath: "/workspace-a",
  workspaceTabs: ["/workspace-a"],
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  unmountAgentAppHarnesses();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderOpenedApp(options: Parameters<typeof renderAgentApp>[0] = {}) {
  const app = await renderAgentApp({ appSettings: APP_SETTINGS, strictMode: true, ...options });
  await waitForReact(() =>
    expect(app.host.querySelector('section[aria-label="Agent mode"]')).not.toBeNull(),
  );
  await settleAgentApp();
  return app;
}

function pressShortcut(key: string, options: KeyboardEventInit = {}): void {
  const mac = detectKeymapPlatform() === "mac";
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: !mac,
      key,
      metaKey: mac,
      ...options,
    }),
  );
}

describe("AgentApp", () => {
  it("hands the workbench screen the adapter ports of its composition", async () => {
    const load = vi.fn(() => []);
    const threadNotificationPorts = vi.fn(() => ({
      focus: { isFocused: () => true, subscribe: () => () => undefined },
      system: {
        notify: async () => "unavailable" as const,
        setBadgeCount: async () => undefined,
        recheckPermission: () => undefined,
      },
    }));
    await renderOpenedApp({
      agentWorkbenchPorts: {
        sessionRestore: {
          projectSelections: { load, save: vi.fn() },
          composerDrafts: null,
          transcriptPositions: null,
        },
        threadNotificationPorts,
      },
    });

    expect(load).toHaveBeenCalled();
    expect(threadNotificationPorts).toHaveBeenCalled();
  });

  it("mounts the agent screen in StrictMode with the agent window title", async () => {
    const app = await renderOpenedApp();

    expect(document.title).toBe("Agents - workspace-a");
    expect(app.host.querySelector("main")).not.toBeNull();
    expect(app.host.querySelector('[data-slot="editor"]')).toBeNull();
    expect(app.host.querySelector(".bottom-panel")).toBeNull();
  });

  it("shows the terminal panel when the panel shortcut toggles it", async () => {
    const app = await renderOpenedApp();

    await actAndSettle(() => pressShortcut("j"));

    await waitForReact(() =>
      expect(app.host.querySelector('section[aria-label="Panel"]')).not.toBeNull(),
    );
    expect(app.host.querySelector(".bottom-panel-terminal-title")?.textContent).toContain(
      "Terminal",
    );
  });

  it("hides the terminal panel synchronously while the shell stop is still pending", async () => {
    const terminalGateway = fakeTerminalGateway();
    terminalGateway.stop.mockImplementation(() => new Promise<never>(() => undefined));
    const app = await renderOpenedApp({ terminalGateway });

    await actAndSettle(() => pressShortcut("j"));
    await waitForReact(() => expect(terminalGateway.acknowledgeStart).toHaveBeenCalledWith(1));
    const hide = app.host.querySelector<HTMLButtonElement>('button[aria-label="Hide panel"]');
    expect(hide).not.toBeNull();

    act(() => hide?.click());

    expect(app.host.querySelector('section[aria-label="Panel"]')).toBeNull();
    expect(terminalGateway.stop).toHaveBeenCalledTimes(1);
    expect(terminalGateway.stop).toHaveBeenCalledWith(1);
    expect(terminalGateway.start).toHaveBeenCalledTimes(1);
  });

  it("opens the settings surface and closes it again", async () => {
    const app = await renderOpenedApp();

    await actAndSettle(() => pressShortcut(","));

    await waitForReact(() =>
      expect(app.host.querySelector('[data-slot="settings"]')?.childElementCount).toBeGreaterThan(
        0,
      ),
    );
    const close = [
      ...app.host.querySelectorAll<HTMLButtonElement>('[data-slot="settings"] button'),
    ].find((button) => button.textContent?.trim() === "Back");
    expect(close).toBeDefined();
    await actAndSettle(() => close?.click());

    expect(app.host.querySelector('[data-slot="settings"]')).toBeNull();
  });

  it("closes the active right-panel surface on Cmd+W and does nothing without one", async () => {
    const app = await renderOpenedApp();
    const frame = () => app.host.querySelector<HTMLElement>(".workbench-frame");

    await actAndSettle(() => pressShortcut("f", { altKey: true, code: "KeyF" }));
    await waitForReact(() => expect(frame()?.dataset.rightPanel).not.toBe("hidden"));
    expect(app.host.querySelector('section[aria-label="Files"]')).not.toBeNull();

    await actAndSettle(() => pressShortcut("w", { code: "KeyW" }));
    await waitForReact(() =>
      expect(app.host.querySelector('section[aria-label="Files"]')).toBeNull(),
    );

    const before = app.host.innerHTML;
    await actAndSettle(() => pressShortcut("w", { code: "KeyW" }));
    expect(app.host.innerHTML).toBe(before);
  });

  it("keeps the active right-panel surface when Cmd+Enter submits from the composer", async () => {
    const app = await renderOpenedApp({
      appSettings: {
        ...APP_SETTINGS,
        keymap: { ...APP_SETTINGS.keymap, "git.commit": "Cmd+Enter" },
      },
    });

    await actAndSettle(() => pressShortcut("f", { altKey: true, code: "KeyF" }));
    await waitForReact(() =>
      expect(app.host.querySelector('section[aria-label="Files"]')).not.toBeNull(),
    );
    const composer = app.host.querySelector<HTMLTextAreaElement>("#agent-prompt");
    expect(composer).not.toBeNull();
    const mac = detectKeymapPlatform() === "mac";
    await actAndSettle(() =>
      composer?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: !mac,
          key: "Enter",
          metaKey: mac,
        }),
      ),
    );

    expect(app.host.querySelector('section[aria-label="Files"]')).not.toBeNull();
    expect(app.host.querySelector('section[aria-label="Git"]')).toBeNull();
  });

  it("opens a file from the palette files page in the agent file viewer", async () => {
    const fileSearch: FileSearchGateway = {
      searchFiles: async (root) => [
        { name: "orders.ts", path: `${root}/orders.ts`, relativePath: "orders.ts" },
      ],
    };
    const app = await renderOpenedApp({ fileSearch });

    await actAndSettle(() => pressShortcut("p", { code: "KeyP", shiftKey: true }));
    const paletteInput = await paletteSearchInput(app.host);
    await typeInto(paletteInput, "@orders");
    await elapseInAct(AGENT_PALETTE_FILE_DEBOUNCE_MS * 2);
    expect(document.body.textContent).toContain("orders.ts");
    const fileInput = await paletteSearchInput(app.host);
    await actAndSettle(() =>
      fileInput.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      ),
    );

    await waitForReact(() =>
      expect(app.host.querySelector('section[aria-label="Files"]')).not.toBeNull(),
    );
    expect(document.querySelector('[aria-label="Command palette"]')).toBeNull();
  });

  it("offers the active project's branches in the palette branch search", async () => {
    const gitGateway = agentAppGitGateway({
      branchList: async () => [
        { isCurrent: true, name: "main" },
        { isCurrent: false, name: "feature-login" },
      ],
    });
    const app = await renderOpenedApp({ gitGateway });

    await actAndSettle(() => pressShortcut("p", { code: "KeyP", shiftKey: true }));
    await typeInto(await paletteSearchInput(app.host), "feature");
    await elapseInAct(AGENT_PALETTE_FILE_DEBOUNCE_MS * 2);

    await waitForReact(() => expect(document.body.textContent).toContain("feature-login"));
    expect(document.body.textContent).not.toContain(
      "Branch switching for this project is not available here.",
    );
  });
});

async function paletteSearchInput(host: HTMLElement): Promise<HTMLInputElement> {
  let input: HTMLInputElement | null = null;
  await waitForReact(() => {
    input = document.querySelector<HTMLInputElement>('[aria-label="Command palette"] input');
    expect(input).not.toBeNull();
  });
  expect(host.isConnected).toBe(true);
  return input as unknown as HTMLInputElement;
}

async function elapseInAct(milliseconds: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
  await settleAgentApp();
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await actAndSettle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
