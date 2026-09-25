import { describe, expect, it } from "vitest";
import {
  availablePaletteActions,
  paletteActionCommandIds,
  type PaletteActionAvailability,
} from "./commandPaletteActions";

function availability(
  overrides: Partial<PaletteActionAvailability> = {},
): PaletteActionAvailability {
  return {
    commandState: () => "enabled",
    agentProvider: true,
    composerModels: true,
    ...overrides,
  };
}

describe("availablePaletteActions", () => {
  it("lists the mockup actions in order when everything is available", () => {
    expect(availablePaletteActions(availability()).map((action) => action.title)).toEqual([
      "New thread",
      "New thread in…",
      "Add project…",
      "Switch project",
      "Go to file",
      "Go to line",
      "Run script",
      "Switch branch",
      "Show diff panel",
      "Show terminal",
      "Show files panel",
      "Toggle maximized panel",
      "Change model",
      "Change theme",
      "Change appearance",
      "Keyboard shortcuts",
      "Open settings",
    ]);
  });

  it("hides agent-only pages without an agent provider and the model page without a composer", () => {
    const titles = availablePaletteActions(
      availability({ agentProvider: false, composerModels: false }),
    ).map((action) => action.title);
    expect(titles).not.toContain("New thread in…");
    expect(titles).not.toContain("Change model");
    expect(titles).toContain("Switch project");
  });

  it("uses the first registered command id and hides actions with none registered", () => {
    const actions = availablePaletteActions(
      availability({
        commandState: (id) => {
          if (id === "agent.openTerminalSurface" || id === "project.add") return "missing";
          if (id === "terminal.show") return "disabled";
          return "enabled";
        },
      }),
    );
    const terminal = actions.find((action) => action.id === "terminal");
    expect(terminal?.intent).toEqual({ kind: "command", commandId: "terminal.show" });
    expect(terminal?.disabled).toBe(true);
    expect(actions.some((action) => action.id === "addProject")).toBe(false);
  });

  it("opens Go to line as the files page in line mode and gates it on the editor command", () => {
    const goToLine = (state: "enabled" | "disabled" | "missing") =>
      availablePaletteActions(
        availability({ commandState: (id) => (id === "editor.gotoLine" ? state : "enabled") }),
      ).find((action) => action.id === "goToLine");

    expect(goToLine("enabled")?.intent).toEqual({ kind: "page", page: "files", query: ":" });
    expect(goToLine("enabled")?.disabled).toBe(false);
    expect(goToLine("disabled")?.disabled).toBe(true);
    expect(goToLine("missing")).toBeUndefined();
    expect(paletteActionCommandIds().has("editor.gotoLine")).toBe(true);
  });
});
