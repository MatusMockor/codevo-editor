import type { PaletteGlyph, PaletteIntent } from "../../domain/commandPalette/paletteItem";
import type { PalettePageId } from "../../domain/commandPalette/palettePages";

export type PaletteCommandState = "enabled" | "disabled" | "missing";
export type PaletteRequirement = "none" | "agentProvider" | "composerModels";

type PaletteActionTarget =
  | { readonly kind: "page"; readonly page: PalettePageId; readonly requires: PaletteRequirement }
  | { readonly kind: "command"; readonly commandIds: readonly string[] };

interface PaletteActionDefinition {
  readonly id: string;
  readonly title: string;
  readonly glyph: PaletteGlyph;
  readonly keywords: readonly string[];
  readonly shortcutCommandId: string | null;
  readonly target: PaletteActionTarget;
}

export interface PaletteActionAvailability {
  commandState(commandId: string): PaletteCommandState;
  readonly agentProvider: boolean;
  readonly composerModels: boolean;
}

export interface PaletteActionView {
  readonly id: string;
  readonly title: string;
  readonly glyph: PaletteGlyph;
  readonly keywords: readonly string[];
  readonly shortcutCommandId: string | null;
  readonly commandIds: readonly string[];
  readonly intent: PaletteIntent;
  readonly disabled: boolean;
}

const page = (
  value: PalettePageId,
  requires: PaletteRequirement = "none",
): PaletteActionTarget => ({
  kind: "page",
  page: value,
  requires,
});
const command = (...commandIds: string[]): PaletteActionTarget => ({ kind: "command", commandIds });

export const PALETTE_ACTIONS: readonly PaletteActionDefinition[] = [
  {
    id: "newThread",
    title: "New thread",
    glyph: "newThread",
    keywords: ["create", "chat"],
    shortcutCommandId: "agent.newThread",
    target: command("agent.newThread"),
  },
  {
    id: "newThreadIn",
    title: "New thread in…",
    glyph: "newThread",
    keywords: ["project"],
    shortcutCommandId: null,
    target: page("newThreadIn", "agentProvider"),
  },
  {
    id: "addProject",
    title: "Add project…",
    glyph: "folderPlus",
    keywords: ["open folder", "clone", "git", "github", "gitlab"],
    shortcutCommandId: "project.add",
    target: command("project.add"),
  },
  {
    id: "switchProject",
    title: "Switch project",
    glyph: "folder",
    keywords: ["open"],
    shortcutCommandId: null,
    target: page("switchProject"),
  },
  {
    id: "goToFile",
    title: "Go to file",
    glyph: "fileSearch",
    keywords: ["open file", "quick open"],
    shortcutCommandId: "file.quickOpen",
    target: page("files"),
  },
  {
    id: "runScript",
    title: "Run script",
    glyph: "play",
    keywords: ["npm", "package"],
    shortcutCommandId: null,
    target: page("runScript"),
  },
  {
    id: "switchBranch",
    title: "Switch branch",
    glyph: "branch",
    keywords: ["git", "checkout"],
    shortcutCommandId: null,
    target: page("switchBranch"),
  },
  {
    id: "diff",
    title: "Show diff panel",
    glyph: "diff",
    keywords: ["changes"],
    shortcutCommandId: "agent.openDiffSurface",
    target: command("agent.openDiffSurface"),
  },
  {
    id: "terminal",
    title: "Show terminal",
    glyph: "terminal",
    keywords: ["shell"],
    shortcutCommandId: "agent.openTerminalSurface",
    target: command("agent.openTerminalSurface", "terminal.show"),
  },
  {
    id: "filesPanel",
    title: "Show files panel",
    glyph: "panelRight",
    keywords: ["explorer", "tree"],
    shortcutCommandId: "agent.openFilesSurface",
    target: command("agent.openFilesSurface"),
  },
  {
    id: "maximize",
    title: "Toggle maximized panel",
    glyph: "maximize",
    keywords: ["focus", "zoom"],
    shortcutCommandId: "panel.toggleMaximized",
    target: command("panel.toggleMaximized"),
  },
  {
    id: "changeModel",
    title: "Change model",
    glyph: "cpu",
    keywords: ["provider"],
    shortcutCommandId: null,
    target: page("changeModel", "composerModels"),
  },
  {
    id: "theme",
    title: "Change theme",
    glyph: "palette",
    keywords: ["color", "palette"],
    shortcutCommandId: null,
    target: page("theme"),
  },
  {
    id: "appearance",
    title: "Change appearance",
    glyph: "monitor",
    keywords: ["dark", "light", "system"],
    shortcutCommandId: null,
    target: page("appearance"),
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    glyph: "keyboard",
    keywords: ["keybindings", "hotkeys"],
    shortcutCommandId: "palette.shortcuts",
    target: page("shortcuts"),
  },
  {
    id: "settings",
    title: "Open settings",
    glyph: "gear",
    keywords: ["preferences"],
    shortcutCommandId: "workbench.openSettings",
    target: command("workbench.openSettings"),
  },
];

export function paletteActionCommandIds(): ReadonlySet<string> {
  return new Set(
    PALETTE_ACTIONS.flatMap((action) =>
      action.target.kind === "command" ? action.target.commandIds : [],
    ),
  );
}

export function availablePaletteActions(
  availability: PaletteActionAvailability,
): readonly PaletteActionView[] {
  return PALETTE_ACTIONS.flatMap((action) => {
    const view = actionView(action, availability);
    return view === null ? [] : [view];
  });
}

function actionView(
  action: PaletteActionDefinition,
  availability: PaletteActionAvailability,
): PaletteActionView | null {
  const base = {
    id: action.id,
    title: action.title,
    glyph: action.glyph,
    keywords: action.keywords,
    shortcutCommandId: action.shortcutCommandId,
  };
  if (action.target.kind === "page") {
    if (!requirementMet(action.target.requires, availability)) return null;
    return {
      ...base,
      commandIds: [],
      intent: { kind: "page", page: action.target.page },
      disabled: false,
    };
  }
  const registered = action.target.commandIds.filter(
    (id) => availability.commandState(id) !== "missing",
  );
  const enabled = registered.find((id) => availability.commandState(id) === "enabled");
  const chosen = enabled ?? registered[0];
  if (chosen === undefined) return null;
  return {
    ...base,
    shortcutCommandId: action.shortcutCommandId === null ? null : chosen,
    commandIds: registered,
    intent: { kind: "command", commandId: chosen },
    disabled: enabled === undefined,
  };
}

function requirementMet(
  requirement: PaletteRequirement,
  availability: PaletteActionAvailability,
): boolean {
  if (requirement === "agentProvider") return availability.agentProvider;
  if (requirement === "composerModels") return availability.composerModels;
  return true;
}
