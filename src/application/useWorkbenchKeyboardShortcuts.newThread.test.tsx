// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetKeymapPlatformCacheForTests,
  defaultKeymapSettings,
  keymapCommands,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import { APP_SETTINGS_KEY, BrowserSettingsGateway } from "../infrastructure/browserSettingsGateway";
import { createAgentViewCommandBridge } from "./agentViewCommandBridge";
import { CommandRegistry, executeCommand, type CommandContext } from "./commandRegistry";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";
import { workbenchAgentCommands } from "./workbenchAgentCommands";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context: CommandContext = {
  hasWorkspace: true,
};
const SHIFTED_N_EVENTS = [
  { code: "KeyN", key: "N" },
  { code: "KeyN", key: "n" },
] as const;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Harness({
  keymap,
  registry,
}: {
  readonly keymap: KeymapSettings;
  readonly registry: CommandRegistry;
}) {
  const appSettings: AppSettings = { ...defaultAppSettings(), keymap };
  useWorkbenchKeyboardShortcuts({
    appSettingsRef: { current: appSettings },
    bareKeyShortcutsRef: { current: { keymap: null, keys: new Set<string>() } },
    closeFloatingSurface: () => false,
    commandContext: context,
    commandRegistry: registry,
    keymap,
    runCommand: (commandId, commandContext = context) =>
      executeCommand(registry, commandId, commandContext),
  });
  return (
    <div>
      <textarea aria-label="composer" />
      <input aria-label="search" />
    </div>
  );
}

function render(keymap: KeymapSettings, registry: CommandRegistry): void {
  host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  root = mounted;
  act(() => mounted.render(<Harness keymap={keymap} registry={registry} />));
}

function target(label: "composer" | "search"): Element {
  const element = host?.querySelector(`[aria-label="${label}"]`) ?? null;
  expect(element).not.toBeNull();
  return element ?? document.body;
}

function keydown(element: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

function agentRegistry(calls: string[]): CommandRegistry {
  const bridge = createAgentViewCommandBridge();
  bridge.bind({
    surfaceBlocked: () => false,
    newThread: () => calls.push("newThread"),
    newThreadIn: () => calls.push("picker"),
    previousThread: () => undefined,
    nextThread: () => undefined,
    jumpToThread: () => undefined,
    searchThreads: () => undefined,
    findInThread: () => undefined,
    threadSelected: () => true,
  });
  const registry = new CommandRegistry();
  for (const command of workbenchAgentCommands({ viewCommands: bridge })) {
    registry.register(command);
  }
  return registry;
}

async function loadKeymap(persisted: Record<string, unknown> | null): Promise<KeymapSettings> {
  const values = new Map<string, string>();
  if (persisted !== null) values.set(APP_SETTINGS_KEY, JSON.stringify(persisted));
  const gateway = new BrowserSettingsGateway({
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
  return (await gateway.loadAppSettings()).keymap;
}

function persistedSettings(
  keymap: Record<string, unknown>,
  keymapDefaultsRevision: number,
): Record<string, unknown> {
  return { ...defaultAppSettings(), keymap, keymapDefaultsRevision };
}

function persistedKeymapWithout(
  commandId: KeymapCommandId,
  overrides: Record<string, string>,
): Record<string, unknown> {
  const keymap: Record<string, unknown> = { ...defaultKeymapSettings("mac"), ...overrides };
  Reflect.deleteProperty(keymap, commandId);
  return keymap;
}

beforeEach(() => {
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  __resetKeymapPlatformCacheForTests();
});

afterEach(() => {
  const mounted = root;
  if (mounted !== null) act(() => mounted.unmount());
  root = null;
  host?.remove();
  host = null;
  Reflect.deleteProperty(window.navigator, "platform");
  __resetKeymapPlatformCacheForTests();
});

describe("New Thread shortcuts from persisted settings", () => {
  it.each([
    ["fresh settings", null],
    [
      "a keymap where both commands were saved on Shift+Cmd+N",
      persistedSettings(
        {
          ...defaultKeymapSettings("mac"),
          "agent.newThread": "Cmd+Shift+N",
          "agent.newThreadIn": "Cmd+Shift+N",
        },
        2,
      ),
    ],
    [
      "a keymap that lost the picker binding after the defaults were swapped",
      persistedSettings(
        persistedKeymapWithout("agent.newThreadIn", { "agent.newThread": "Cmd+Shift+N" }),
        2,
      ),
    ],
    [
      "a keymap saved before New Thread in… existed",
      persistedSettings(
        persistedKeymapWithout("agent.newThreadIn", { "agent.newThread": "Cmd+N" }),
        1,
      ),
    ],
  ] as const)(
    "creates in place on Shift+Cmd+N and opens the picker on Cmd+N for %s",
    async (_name, persisted) => {
      const keymap = await loadKeymap(persisted);
      const calls: string[] = [];
      render(keymap, agentRegistry(calls));
      const composer = target("composer");

      for (const init of SHIFTED_N_EVENTS) {
        calls.length = 0;
        const event = keydown(composer, { ...init, metaKey: true, shiftKey: true });
        expect(event.defaultPrevented).toBe(true);
        expect(calls).toEqual(["newThread"]);
      }

      calls.length = 0;
      const picker = keydown(composer, { code: "KeyN", key: "n", metaKey: true });
      expect(picker.defaultPrevented).toBe(true);
      expect(calls).toEqual(["picker"]);
    },
  );
});

describe("default Shift+Cmd+letter shortcuts", () => {
  const keymap = defaultKeymapSettings("mac");
  const shiftedLetterCommands = keymapCommands.flatMap((command) => {
    const match = /^Cmd\+Shift\+([A-Z])$/.exec(command.defaultShortcut);
    if (match?.[1] === undefined) return [];
    return [{ id: command.id, letter: match[1] }];
  });

  it("covers the agent New Thread binding", () => {
    expect(shiftedLetterCommands).toContainEqual({ id: "agent.newThread", letter: "N" });
  });

  it.each(shiftedLetterCommands)(
    "runs a Shift+Cmd+$letter owner for $id and never an unshifted neighbour",
    ({ letter }) => {
      const calls: KeymapCommandId[] = [];
      const registry = new CommandRegistry();
      for (const command of keymapCommands) {
        registry.register({
          category: "Test",
          id: command.id,
          isEnabled: () => true,
          run: () => {
            calls.push(command.id);
          },
          title: command.label,
        });
      }
      render(keymap, registry);

      for (const key of [letter, letter.toLowerCase()]) {
        calls.length = 0;
        for (const label of ["composer", "search"] as const) {
          keydown(target(label), { code: `Key${letter}`, key, metaKey: true, shiftKey: true });
        }
        expect(calls.length).toBeGreaterThan(0);
        expect(
          calls.filter(
            (commandId) => shortcutForCommand(keymap, commandId, "mac") !== `Cmd+Shift+${letter}`,
          ),
        ).toEqual([]);
      }
    },
  );
});
