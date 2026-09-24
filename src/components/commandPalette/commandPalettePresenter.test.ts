import { describe, expect, it } from "vitest";
import type { Command } from "../../application/commandRegistry";
import type { AgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import { DEFAULT_APPEARANCE } from "../../domain/appearance";
import { buildPaletteGroups, type PalettePresenterInput } from "./commandPalettePresenter";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

const agent: AgentPaletteProvider = {
  projects: [
    { key: "orders", label: "orders-api", path: "/Users/me/Developer/orders-api", current: true },
    {
      key: "web",
      label: "web-dashboard",
      path: "/Users/me/Developer/web-dashboard",
      current: false,
    },
  ],
  threads: [
    {
      id: "t1",
      title: "Idempotency keys for POST /orders",
      projectLabel: "orders-api",
      updatedAtMs: NOW - 4 * 60_000,
      current: true,
    },
    {
      id: "t2",
      title: "Vitest coverage thresholds",
      projectLabel: "web-dashboard",
      updatedAtMs: NOW - 3 * 86_400_000,
      current: false,
    },
  ],
  scripts: [{ key: "test", name: "test", detail: "vitest run", runnable: true }],
  scriptsTruncated: false,
  activeProjectKey: "orders",
  openThread: () => true,
  switchProject: () => true,
  newThreadIn: () => true,
  runScript: () => true,
};

function command(id: string, title: string, overrides: Partial<Command> = {}): Command {
  return {
    id,
    title,
    category: "Workbench",
    isEnabled: () => true,
    run: () => undefined,
    ...overrides,
  };
}

function input(overrides: Partial<PalettePresenterInput> = {}): PalettePresenterInput {
  return {
    page: "root",
    query: "",
    actions: [
      {
        id: "newThread",
        title: "New thread",
        glyph: "newThread",
        keywords: ["create"],
        shortcutCommandId: "agent.newThread",
        commandIds: ["agent.newThread"],
        intent: { kind: "command", commandId: "agent.newThread" },
        disabled: false,
      },
      {
        id: "switchProject",
        title: "Switch project",
        glyph: "folder",
        keywords: ["open"],
        shortcutCommandId: null,
        commandIds: [],
        intent: { kind: "page", page: "switchProject" },
        disabled: false,
      },
    ],
    commands: [
      command("panel.showProblems", "Show Problems"),
      command("hidden", "Hidden", { visibleInCommandPalette: false }),
    ],
    commandEnabled: () => true,
    agent,
    editorProjects: [],
    editorScripts: [],
    editorScriptsTruncated: false,
    rootFiles: [],
    branches: { status: "idle" },
    models: null,
    appearance: DEFAULT_APPEARANCE,
    resolvedScheme: "dark",
    shortcutGroups: [],
    nowMs: NOW,
    shortcutLabel: (id) => (id === "agent.newThread" ? "⌘N" : null),
    rawShortcutLabel: () => null,
    canAddProject: true,
    ...overrides,
  };
}

describe("buildPaletteGroups", () => {
  it("shows actions and recent threads for an empty root query", () => {
    const groups = buildPaletteGroups(input());
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Recent Threads"]);
    const recent = groups[1]?.items ?? [];
    expect(recent.map((item) => item.title.text)).toEqual([
      "Idempotency keys for POST /orders",
      "Vitest coverage thresholds",
    ]);
    expect(recent[0]?.timestamp).toBe("4m");
    expect(recent[0]?.description?.text).toBe("orders-api · Current thread");
    expect(groups[0]?.items[0]?.shortcut).toBe("⌘N");
  });

  it("searches every source and highlights token matches in order", () => {
    const groups = buildPaletteGroups(
      input({
        query: "orders",
        rootFiles: [
          {
            name: "orders.ts",
            path: "/r/src/routes/orders.ts",
            relativePath: "src/routes/orders.ts",
          },
        ],
        branches: {
          status: "ready",
          scopeLabel: "orders-api",
          branches: [{ name: "feat/orders-events", current: false, remote: false }],
        },
      }),
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Projects",
      "Threads",
      "Files",
      "Branches",
    ]);
    expect(groups[1]?.items[0]?.title.ranges).toEqual([{ start: 27, end: 33 }]);
    expect(groups[2]?.items[0]?.title.style).toBe("fuzzy");
  });

  it("limits root to actions and registry commands in > mode and lists every visible command", () => {
    const groups = buildPaletteGroups(input({ query: ">" }));
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Commands"]);
    expect(groups[1]?.items.map((item) => item.title.text)).toEqual(["Show Problems"]);
  });

  it("matches registry commands by subsequence in > mode", () => {
    const commands = [
      command("editor.splitRight", "Split Editor Right", { category: "View" }),
      command("editor.goToDefinition", "Go to Definition", { category: "Editor" }),
      command("panel.showProblems", "Show Problems"),
    ];
    const titles = (query: string) =>
      buildPaletteGroups(input({ query, commands }))
        .flatMap((group) => group.items)
        .map((item) => item.title.text);

    expect(titles(">splt")).toEqual(["Split Editor Right"]);
    expect(titles(">gtdef")).toEqual(["Go to Definition"]);
    const split = buildPaletteGroups(input({ query: ">splt", commands }))[0]?.items[0];
    expect(split?.title.style).toBe("fuzzy");
    expect(split?.title.ranges.length).toBeGreaterThan(0);
  });

  it("reaches a curated action through its registry title, category and id in > mode", () => {
    const terminal = {
      id: "terminal",
      title: "Show terminal",
      glyph: "terminal" as const,
      keywords: ["shell"],
      shortcutCommandId: "terminal.show",
      commandIds: ["terminal.show"],
      intent: { kind: "command" as const, commandId: "terminal.show" },
      disabled: false,
    };
    const commands = [command("terminal.show", "Focus Integrated Console", { category: "Panel" })];
    const titles = (query: string) =>
      buildPaletteGroups(input({ query, commands, actions: [terminal] }))
        .flatMap((group) => group.items)
        .map((item) => item.title.text);

    expect(titles(">show terminal")).toEqual(["Show terminal"]);
    expect(titles(">terminal.show")).toEqual(["Show terminal"]);
    expect(titles(">integrated console")).toEqual(["Show terminal"]);
  });

  it("returns no groups for a query nothing matches", () => {
    expect(buildPaletteGroups(input({ query: "kubectl rollout" }))).toEqual([]);
  });

  it("marks the current project and appends Add project on the switch page", () => {
    const groups = buildPaletteGroups(input({ page: "switchProject" }));
    const items = groups[0]?.items ?? [];
    expect(items.map((item) => item.title.text)).toEqual([
      "orders-api",
      "web-dashboard",
      "Add project…",
    ]);
    expect(items[0]?.current).toBe(true);
    expect(items[2]?.intent).toEqual({ kind: "command", commandId: "project.add" });
  });

  it("uses editor projects and scripts when no agent provider is published", () => {
    const groups = buildPaletteGroups(
      input({
        page: "runScript",
        agent: null,
        editorScripts: [{ key: "k1", name: "lint", detail: "npm run lint", runnable: false }],
        editorScriptsTruncated: true,
      }),
    );
    expect(groups[0]?.items[0]?.disabled).toBe(true);
    const items = groups[0]?.items ?? [];
    const last = items[items.length - 1];
    expect(last?.title.text).toBe("Showing first 1 scripts");
    expect(last?.intent).toEqual({ kind: "none" });
  });

  it("lists palettes with swatches and marks the current palette and scheme", () => {
    const theme = buildPaletteGroups(input({ page: "theme" }))[0]?.items ?? [];
    expect(theme).toHaveLength(6);
    expect(theme[0]?.current).toBe(true);
    expect(theme[0]?.icon?.kind).toBe("swatch");
    const appearance = buildPaletteGroups(input({ page: "appearance" }))[0]?.items ?? [];
    expect(appearance.map((item) => item.title.text)).toEqual(["System", "Light", "Dark"]);
    expect(appearance[0]?.current).toBe(true);
  });

  it("explains an unavailable branch source instead of an empty list", () => {
    const groups = buildPaletteGroups(
      input({
        page: "switchBranch",
        branches: {
          status: "unavailable",
          reason: "Branch switching for this project is not available here.",
        },
      }),
    );
    expect(groups[0]?.items[0]?.title.text).toBe(
      "Branch switching for this project is not available here.",
    );
    expect(groups[0]?.items[0]?.disabled).toBe(true);
  });
});
