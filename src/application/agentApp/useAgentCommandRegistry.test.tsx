// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  __resetKeymapPlatformCacheForTests,
  detectKeymapPlatform,
  keymapCommands,
} from "../../domain/keymap";
import { defaultAppSettings, type AppSettings } from "../../domain/settings";
import {
  actAndSettle,
  renderAgentAppController,
  settleAgentApp,
  unmountAgentAppHarnesses,
} from "../../test/agentAppTestHarness";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  dispatchNativeMenuCommand,
  NATIVE_MENU_EVENT_NAMES,
} from "../workbenchNativeMenuCommandDispatcher";
import { AGENT_CLOSE_ACTIVE_COMMAND } from "./useAgentCommandRegistry";

function settingsWithTabs(...tabs: string[]): AppSettings {
  return { ...defaultAppSettings(), recentWorkspacePath: tabs[0] ?? null, workspaceTabs: tabs };
}

async function renderOpened() {
  const harness = renderAgentAppController({ appSettings: settingsWithTabs("/workspace-a") });
  await waitForReact(() => expect(harness.current().workspaceRoot).toBe("/workspace-a"));
  await settleAgentApp();
  return harness;
}

function pressPrimaryW(): KeyboardEvent {
  __resetKeymapPlatformCacheForTests();
  const mac = detectKeymapPlatform() === "mac";
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: !mac,
    key: "w",
    metaKey: mac,
  });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  unmountAgentAppHarnesses();
  __resetKeymapPlatformCacheForTests();
});

describe("useAgentCommandRegistry", () => {
  it("registers the app-level close command under workbench.closeActive", () => {
    expect(AGENT_CLOSE_ACTIVE_COMMAND).toBe("workbench.closeActive");
  });

  it("closes the active right-panel surface from the Cmd+W keydown and is a no-op without one", async () => {
    const harness = await renderOpened();

    await actAndSettle(() =>
      harness.current().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }),
    );
    expect(harness.current().agentWorkbench.layout.activeSurface).toBe("diff");

    let closing: KeyboardEvent | null = null;
    await actAndSettle(() => {
      closing = pressPrimaryW();
    });
    expect(closing).not.toBeNull();
    expect((closing as KeyboardEvent | null)?.defaultPrevented).toBe(true);
    expect(harness.current().agentWorkbench.layout.openSurfaces).not.toContain("diff");

    const layout = harness.current().agentWorkbench.layout;
    await actAndSettle(() => {
      pressPrimaryW();
    });
    expect(harness.current().agentWorkbench.layout).toBe(layout);
  });

  it("maps every native menu event to a registered agent command", async () => {
    const harness = await renderOpened();
    const outcomes: string[] = [];

    for (const eventName of NATIVE_MENU_EVENT_NAMES) {
      await actAndSettle(() => {
        const dispatched = dispatchNativeMenuCommand({
          commandContext: harness.current().commandContext,
          eventName,
          runCommand: (commandId, context) => {
            const outcome = harness.current().runCommand(commandId, context);
            outcomes.push(`${eventName}:${outcome}`);
            return outcome;
          },
        });
        expect(dispatched).toBe(true);
      });
    }

    expect(outcomes).toEqual(NATIVE_MENU_EVENT_NAMES.map((eventName) => `${eventName}:executed`));
  });

  it("registers a handler for every keymap command the agent app supports", async () => {
    const harness = await renderOpened();
    const registered = new Set(harness.current().commands.map((command) => command.id));

    expect(keymapCommands.map((command) => command.id).filter((id) => !registered.has(id))).toEqual(
      [],
    );
  });
});
