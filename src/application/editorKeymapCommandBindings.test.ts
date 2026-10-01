import { describe, expect, it } from "vitest";
import { defaultKeymapSettings, type KeymapCommandId } from "../domain/keymap";
import { planEditorKeymapCommandBindings } from "./editorKeymapCommandBindings";

const NONE: ReadonlySet<KeymapCommandId> = new Set();

function bindingFor(
  bindings: ReturnType<typeof planEditorKeymapCommandBindings>,
  shortcut: string,
) {
  return bindings.find((binding) => binding.shortcut === shortcut);
}

describe("planEditorKeymapCommandBindings", () => {
  it("binds every editor-reachable chord and shadowed single-stroke default", () => {
    const bindings = planEditorKeymapCommandBindings(defaultKeymapSettings("mac"), "mac", NONE);

    expect(bindingFor(bindings, "Cmd+K Cmd+\\")?.commandIds).toEqual(["editor.splitDown"]);
    expect(bindingFor(bindings, "Cmd+K Cmd+ArrowRight")?.commandIds).toEqual([
      "editor.focusNextGroup",
    ]);
    expect(bindingFor(bindings, "Cmd+K W")?.commandIds).toEqual(["editor.closeGroup"]);
    expect(bindingFor(bindings, "Cmd+E")?.commandIds).toEqual(["editor.recentFiles"]);
    expect(bindingFor(bindings, "F8")?.commandIds).toEqual(["editor.nextProblem"]);
    expect(bindingFor(bindings, "Shift+F8")?.commandIds).toEqual(["editor.previousProblem"]);
    expect(bindingFor(bindings, "Shift+Alt+O")?.commandIds).toEqual([
      "editor.action.organizeImports",
    ]);
    expect(bindingFor(bindings, "Cmd+Shift+O")?.commandIds).toEqual(["agent.goToTurn"]);
    expect(bindingFor(bindings, "Cmd+Alt+F")?.commandIds).toEqual(["agent.openFilesSurface"]);
    expect(bindingFor(bindings, "Cmd+Enter")?.commandIds).toEqual(["git.commit"]);
  });

  it("keeps shared shortcuts in the workbench conflict-priority order", () => {
    const bindings = planEditorKeymapCommandBindings(defaultKeymapSettings("mac"), "mac", NONE);

    expect(bindingFor(bindings, "Cmd+Shift+K")?.commandIds).toEqual([
      "agent.searchThreads",
      "editor.deleteLine",
    ]);
  });

  it("leaves outside-editor and focus-scoped commands to Monaco so its defaults keep working", () => {
    const bindings = planEditorKeymapCommandBindings(defaultKeymapSettings("mac"), "mac", NONE);
    const commandIds = bindings.flatMap((binding) => binding.commandIds);

    expect(commandIds).not.toContain("palette.open");
    expect(commandIds).not.toContain("palette.shortcuts");
    expect(commandIds).not.toContain("agent.toggleSidebar");
    expect(commandIds).not.toContain("agent.findInThread");
    expect(bindingFor(bindings, "Cmd+/")).toBeUndefined();
    expect(bindingFor(bindings, "Cmd+F")).toBeUndefined();
    expect(bindingFor(bindings, "Enter")).toBeUndefined();
  });

  it("skips commands and shortcuts that an explicit editor action already owns", () => {
    const owned: ReadonlySet<KeymapCommandId> = new Set(["editor.deleteLine", "editor.rename"]);
    const bindings = planEditorKeymapCommandBindings(defaultKeymapSettings("mac"), "mac", owned);
    const commandIds = bindings.flatMap((binding) => binding.commandIds);

    expect(commandIds).not.toContain("editor.deleteLine");
    expect(commandIds).not.toContain("editor.rename");
    expect(bindingFor(bindings, "Cmd+Shift+K")).toBeUndefined();
    expect(bindingFor(bindings, "F2")).toBeUndefined();
  });

  it("follows keymap customisations", () => {
    const keymap = {
      ...defaultKeymapSettings("mac"),
      "editor.recentFiles": "Cmd+Alt+E",
      "editor.splitDown": "Cmd+K Cmd+D",
    };

    const bindings = planEditorKeymapCommandBindings(keymap, "mac", NONE);

    expect(bindingFor(bindings, "Cmd+E")).toBeUndefined();
    expect(bindingFor(bindings, "Cmd+Alt+E")?.commandIds).toEqual(["editor.recentFiles"]);
    expect(bindingFor(bindings, "Cmd+K Cmd+\\")).toBeUndefined();
    expect(bindingFor(bindings, "Cmd+K Cmd+D")?.commandIds).toEqual(["editor.splitDown"]);
  });

  it("never binds a first stroke that would swallow ordinary typing", () => {
    const keymap = {
      ...defaultKeymapSettings("mac"),
      "editor.recentFiles": "E",
      "editor.recentLocations": "Shift+E",
      "editor.splitDown": "Space",
    };

    const bindings = planEditorKeymapCommandBindings(keymap, "mac", NONE);

    expect(bindingFor(bindings, "E")).toBeUndefined();
    expect(bindingFor(bindings, "Shift+E")).toBeUndefined();
    expect(bindingFor(bindings, "Space")).toBeUndefined();
  });

  it("uses the platform shortcut form off macOS", () => {
    const bindings = planEditorKeymapCommandBindings(defaultKeymapSettings("linux"), "linux", NONE);

    expect(bindingFor(bindings, "Ctrl+K Ctrl+\\")?.commandIds).toEqual(["editor.splitDown"]);
    expect(bindingFor(bindings, "Ctrl+E")?.commandIds).toEqual(["editor.recentFiles"]);
  });
});
