import { describe, expect, it, vi } from "vitest";
import { detectKeymapPlatform, type KeymapCommandId } from "../domain/keymap";
import { KEYMAP_DEFAULTS_REVISION } from "../domain/keymapDefaultsMigration";
import { normalizeAppSettings } from "../domain/settings";
import { CommandRegistry, executeCommand, type CommandContext } from "./commandRegistry";
import { dispatchWorkbenchShortcutCommand } from "./workbenchShortcutCommandDispatcher";
import {
  dispatchWorkbenchWindowZoomPhysicalShortcut,
  windowZoomShortcutNeedsCapture,
} from "./workbenchWindowZoomShortcutDispatcher";

const commandContext: CommandContext = {
  activeDocumentDirty: true,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("persisted keymap window zoom migration dispatch", () => {
  it.each([
    ["workbench.zoomIn", "=", "Equal"],
    ["workbench.zoomOut", "-", "Minus"],
    ["workbench.zoomReset", "0", "Digit0"],
  ] as const)(
    "keeps Save on the preserved default of %s after settings roundtrip",
    (commandId, key, code) => {
      const platform = detectKeymapPlatform();
      const shortcut = `${platform === "mac" ? "Cmd" : "Ctrl"}+${key}`;
      const loaded = normalizeAppSettings({
        keymap: { "editor.fontZoomIn": "", "editor.save": shortcut },
        keymapDefaultsRevision: 1,
      });
      const settings = normalizeAppSettings(JSON.parse(JSON.stringify(loaded)));
      expect(settings.keymapDefaultsRevision).toBe(KEYMAP_DEFAULTS_REVISION);
      expect(settings.keymap[commandId]).toBe("");
      expect(settings.keymap["editor.save"]).toBe(shortcut);
      expect(settings.keymap).toEqual(loaded.keymap);

      const save = vi.fn();
      const zoom = vi.fn();
      const commandRegistry = new CommandRegistry();
      for (const [id, run] of [
        ["editor.save", save],
        [commandId, zoom],
      ] as const) {
        commandRegistry.register({
          category: "Workbench",
          id,
          isEnabled: () => true,
          run,
          title: id,
        });
      }
      const runCommand = (id: string, context = commandContext) =>
        executeCommand(commandRegistry, id, context);
      const event = {
        altKey: false,
        code,
        ctrlKey: platform !== "mac",
        isComposing: false,
        key,
        metaKey: platform === "mac",
        preventDefault: vi.fn(),
        shiftKey: false,
        stopImmediatePropagation: vi.fn(),
      } as unknown as KeyboardEvent;
      expect(
        dispatchWorkbenchWindowZoomPhysicalShortcut({
          commandContext,
          commandRegistry,
          event,
          keymap: settings.keymap,
          platform,
          runCommand,
        }),
      ).toBe(false);
      expect(windowZoomShortcutNeedsCapture(settings.keymap, event, platform)).toBe(false);
      expect(
        dispatchWorkbenchShortcutCommand({
          commandContext,
          commandIds: ["editor.save", commandId] satisfies readonly KeymapCommandId[],
          commandRegistry,
          event,
          keymap: settings.keymap,
          runCommand,
        }),
      ).toBe(true);
      expect(save).toHaveBeenCalledOnce();
      expect(zoom).not.toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    },
  );
});
