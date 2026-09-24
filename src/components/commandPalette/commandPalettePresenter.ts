import type { Command } from "../../application/commandRegistry";
import {
  paletteActionCommandIds,
  type PaletteActionView,
} from "../../application/commandPalette/commandPaletteActions";
import type {
  AgentPaletteProvider,
  ComposerPaletteModels,
  PaletteBranchesView,
  PaletteProject,
  PaletteScript,
  PaletteThread,
} from "../../application/commandPalette/commandPaletteProvider";
import type { AppearanceSettings, ResolvedColorScheme } from "../../domain/appearance";
import { compactAgeLabel } from "../../domain/commandPalette/paletteAge";
import {
  paletteGroup as group,
  plainText,
  tokenText,
  type PaletteGroup,
  type PaletteItem,
  type PaletteText,
} from "../../domain/commandPalette/paletteItem";
import {
  MAX_PALETTE_QUERY_CHARS,
  fuzzyHighlightRanges,
  fuzzySubsequence,
  matchesAllTokens,
  paletteQueryTokens,
  type HighlightRange,
} from "../../domain/commandPalette/paletteMatch";
import type { PalettePageId } from "../../domain/commandPalette/palettePages";
import { matchesQuery, splitQueryHighlight } from "../../domain/matchHighlight";
import { parsePaletteRootQuery } from "../../domain/commandPalette/paletteRootQuery";
import type { FileSearchResult } from "../../domain/workspace";
import {
  appearanceItems,
  modelGroups,
  shortcutGroupsView,
  themeItems,
} from "./paletteSettingsPages";
import type { PaletteShortcutGroup } from "./paletteShortcuts";

const RECENT_THREAD_LIMIT = 12;
const SEARCH_LIMITS = {
  projects: 6,
  threads: 8,
  scripts: 8,
  files: 5,
  branches: 6,
  commands: 8,
} as const;

export type { PaletteBranchesView } from "../../application/commandPalette/commandPaletteProvider";

export interface PalettePresenterInput {
  readonly page: PalettePageId;
  readonly query: string;
  readonly actions: readonly PaletteActionView[];
  readonly commands: readonly Command[];
  commandEnabled(command: Command): boolean;
  readonly agent: AgentPaletteProvider | null;
  readonly editorProjects: readonly PaletteProject[];
  readonly editorScripts: readonly PaletteScript[];
  readonly editorScriptsTruncated: boolean;
  readonly rootFiles: readonly FileSearchResult[];
  readonly branches: PaletteBranchesView;
  readonly models: ComposerPaletteModels | null;
  readonly appearance: AppearanceSettings;
  readonly resolvedScheme: ResolvedColorScheme;
  readonly shortcutGroups: readonly PaletteShortcutGroup[];
  readonly nowMs: number;
  readonly canAddProject: boolean;
  shortcutLabel(commandId: string): string | null;
  rawShortcutLabel(shortcut: string): string | null;
}

export function buildPaletteGroups(input: PalettePresenterInput): readonly PaletteGroup[] {
  return nonEmpty(groupsForPage(input));
}

function groupsForPage(input: PalettePresenterInput): readonly PaletteGroup[] {
  const tokens = paletteQueryTokens(input.query);
  switch (input.page) {
    case "root":
      return rootGroups(input);
    case "files":
      return [];
    case "newThreadIn":
      return [
        group("projects", "Projects", projectItems(projectsOf(input), tokens, "newThreadIn")),
      ];
    case "switchProject":
      return [
        group("projects", "Projects", [
          ...projectItems(projectsOf(input), tokens, "switchProject"),
          ...addProjectItem(input, tokens),
        ]),
      ];
    case "runScript":
      return [group("scripts", scriptsLabel(input), scriptItems(input, tokens, false))];
    case "switchBranch":
      return [branchGroup(input, tokens)];
    case "changeModel":
      return modelGroups(input.models, tokens);
    case "theme":
      return [
        group("theme", "Change theme", themeItems(input.appearance, input.resolvedScheme, tokens)),
      ];
    case "appearance":
      return [group("appearance", "Change appearance", appearanceItems(input.appearance, tokens))];
    case "shortcuts":
      return shortcutGroupsView(input.shortcutGroups, input.commands, tokens);
    default:
      return unreachablePage(input.page);
  }
}

function rootGroups(input: PalettePresenterInput): readonly PaletteGroup[] {
  const parsed = parsePaletteRootQuery(input.query);
  switch (parsed.kind) {
    case "empty":
    case "files":
      return [
        group("actions", "Actions", actionItems(input, tokenMatcher([]))),
        group(
          "recent",
          "Recent Threads",
          recentThreads(input).map((thread) => threadItem(thread, [], input.nowMs)),
        ),
      ];
    case "actions": {
      const matcher = subsequenceMatcher(parsed.text);
      return [
        group("actions", "Actions", actionItems(input, matcher)),
        group("commands", "Commands", commandItems(input, matcher, Number.POSITIVE_INFINITY)),
      ];
    }
    case "search": {
      const tokens = paletteQueryTokens(parsed.text);
      const matcher = tokenMatcher(tokens);
      return [
        group("actions", "Actions", actionItems(input, matcher)),
        group("commands", "Commands", commandItems(input, matcher, SEARCH_LIMITS.commands)),
        group(
          "projects",
          "Projects",
          projectItems(projectsOf(input), tokens, "switchProject").slice(0, SEARCH_LIMITS.projects),
        ),
        group(
          "threads",
          "Threads",
          filterThreads(input, tokens)
            .slice(0, SEARCH_LIMITS.threads)
            .map((thread) => threadItem(thread, tokens, input.nowMs)),
        ),
        group(
          "scripts",
          "Scripts",
          scriptItems(input, tokens, true).slice(0, SEARCH_LIMITS.scripts),
        ),
        group(
          "files",
          "Files",
          input.rootFiles.slice(0, SEARCH_LIMITS.files).map((file) => fileItem(file, parsed.text)),
        ),
        group("branches", "Branches", branchItems(input, tokens).slice(0, SEARCH_LIMITS.branches)),
      ];
    }
    default:
      return unreachableRoot(parsed);
  }
}

interface PaletteTermMatcher {
  matches(terms: readonly string[]): boolean;
  text(value: string): PaletteText;
}

function tokenMatcher(tokens: readonly string[]): PaletteTermMatcher {
  return {
    matches: (terms) => matchesAllTokens(terms, tokens),
    text: (value) => tokenText(value, tokens),
  };
}

function subsequenceMatcher(raw: string): PaletteTermMatcher {
  const query = raw.slice(0, MAX_PALETTE_QUERY_CHARS);
  return {
    matches: (terms) => matchesQuery(terms.join(" "), query),
    text: (value) => ({ text: value, ranges: subsequenceRanges(value, query), style: "fuzzy" }),
  };
}

function subsequenceRanges(value: string, query: string): readonly HighlightRange[] {
  const ranges: HighlightRange[] = [];
  let cursor = 0;
  for (const segment of splitQueryHighlight(value, query)) {
    const end = cursor + segment.text.length;
    if (segment.highlighted) ranges.push({ start: cursor, end });
    cursor = end;
  }
  return ranges;
}

function actionTerms(input: PalettePresenterInput, action: PaletteActionView): readonly string[] {
  const registry = action.commandIds.flatMap((id) => {
    const command = input.commands.find((candidate) => candidate.id === id);
    if (command === undefined) return [id];
    return [command.category, command.title, command.id];
  });
  return [action.title, ...action.keywords, ...registry];
}

function actionItems(
  input: PalettePresenterInput,
  matcher: PaletteTermMatcher,
): readonly PaletteItem[] {
  return input.actions
    .filter((action) => matcher.matches(actionTerms(input, action)))
    .map((action) => ({
      key: `action:${action.id}`,
      intent: action.intent,
      icon: { kind: "glyph", glyph: action.glyph },
      title: matcher.text(action.title),
      description: null,
      timestamp: null,
      shortcut:
        action.shortcutCommandId === null ? null : input.shortcutLabel(action.shortcutCommandId),
      current: false,
      disabled: action.disabled,
    }));
}

function commandItems(
  input: PalettePresenterInput,
  matcher: PaletteTermMatcher,
  limit: number,
): readonly PaletteItem[] {
  const represented = paletteActionCommandIds();
  return input.commands
    .filter((command) => command.visibleInCommandPalette !== false)
    .filter((command) => !represented.has(command.id) && !command.id.startsWith("palette."))
    .filter((command) => matcher.matches([command.category, command.title, command.id]))
    .slice(0, limit)
    .map((command) => ({
      key: `command:${command.id}`,
      intent: { kind: "command", commandId: command.id },
      icon: { kind: "glyph", glyph: "command" },
      title: matcher.text(command.title),
      description: matcher.text(command.category),
      timestamp: null,
      shortcut: command.shortcut === undefined ? null : input.rawShortcutLabel(command.shortcut),
      current: false,
      disabled: !input.commandEnabled(command),
    }));
}

function projectsOf(input: PalettePresenterInput): readonly PaletteProject[] {
  return input.agent?.projects ?? input.editorProjects;
}

function projectItems(
  projects: readonly PaletteProject[],
  tokens: readonly string[],
  kind: "newThreadIn" | "switchProject",
): readonly PaletteItem[] {
  return projects
    .filter((project) => matchesAllTokens([project.label, project.path], tokens))
    .map((project) => ({
      key: `project:${kind}:${project.key}`,
      intent: { kind, projectKey: project.key },
      icon: { kind: "monogram", letter: monogram(project.label) },
      title: tokenText(project.label, tokens),
      description: tokenText(project.path, tokens),
      timestamp: null,
      shortcut: null,
      current: kind === "switchProject" && project.current,
      disabled: false,
    }));
}

function addProjectItem(
  input: PalettePresenterInput,
  tokens: readonly string[],
): readonly PaletteItem[] {
  if (!input.canAddProject) return [];
  if (!matchesAllTokens(["Add project…", "open folder", "clone"], tokens)) return [];
  return [
    {
      key: "project:add",
      intent: { kind: "command", commandId: "project.add" },
      icon: { kind: "glyph", glyph: "folderPlus" },
      title: plainText("Add project…"),
      description: null,
      timestamp: null,
      shortcut: null,
      current: false,
      disabled: false,
    },
  ];
}

function recentThreads(input: PalettePresenterInput): readonly PaletteThread[] {
  return [...(input.agent?.threads ?? [])]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, RECENT_THREAD_LIMIT);
}

function filterThreads(
  input: PalettePresenterInput,
  tokens: readonly string[],
): readonly PaletteThread[] {
  return recentThreadsAll(input).filter((thread) =>
    matchesAllTokens([thread.title, thread.projectLabel], tokens),
  );
}

function recentThreadsAll(input: PalettePresenterInput): readonly PaletteThread[] {
  return [...(input.agent?.threads ?? [])].sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs,
  );
}

function threadItem(thread: PaletteThread, tokens: readonly string[], nowMs: number): PaletteItem {
  const description = thread.current
    ? `${thread.projectLabel} · Current thread`
    : thread.projectLabel;
  return {
    key: `thread:${thread.id}`,
    intent: { kind: "openThread", threadId: thread.id },
    icon: { kind: "glyph", glyph: "message" },
    title: tokenText(thread.title, tokens),
    description: tokenText(description, tokens),
    timestamp: compactAgeLabel(nowMs, thread.updatedAtMs),
    shortcut: null,
    current: false,
    disabled: false,
  };
}

function scriptsOf(input: PalettePresenterInput): readonly PaletteScript[] {
  return input.agent?.scripts ?? input.editorScripts;
}

function scriptsTruncated(input: PalettePresenterInput): boolean {
  return input.agent?.scriptsTruncated ?? input.editorScriptsTruncated;
}

function scriptsLabel(input: PalettePresenterInput): string {
  const project = projectsOf(input).find((candidate) => candidate.current);
  if (project === undefined) return "Scripts";
  return `Scripts · ${project.label}`;
}

function scriptItems(
  input: PalettePresenterInput,
  tokens: readonly string[],
  prefixed: boolean,
): readonly PaletteItem[] {
  const scripts = scriptsOf(input);
  const items: PaletteItem[] = scripts
    .map((script) => ({ script, title: prefixed ? `Run script: ${script.name}` : script.name }))
    .filter(({ script, title }) => matchesAllTokens([title, script.detail ?? ""], tokens))
    .map(({ script, title }) => ({
      key: `script:${script.key}`,
      intent: { kind: "runScript", scriptKey: script.key },
      icon: { kind: "glyph", glyph: "play" },
      title: tokenText(title, tokens),
      description: script.detail === null ? null : tokenText(script.detail, tokens),
      timestamp: null,
      shortcut: null,
      current: false,
      disabled: !script.runnable,
    }));
  if (prefixed || !scriptsTruncated(input)) return items;
  return [...items, noticeItem("scripts:truncated", `Showing first ${scripts.length} scripts`)];
}

function fileItem(file: FileSearchResult, query: string): PaletteItem {
  const nameMatch = fuzzySubsequence(file.name, query);
  const pathMatch = fuzzySubsequence(file.relativePath, query);
  return {
    key: `file:${file.path}`,
    intent: { kind: "openFile", result: file },
    icon: { kind: "glyph", glyph: "file" },
    title: { text: file.name, ranges: fuzzyHighlightRanges(nameMatch), style: "fuzzy" },
    description: {
      text: file.relativePath,
      ranges: fuzzyHighlightRanges(pathMatch),
      style: "fuzzy",
    },
    timestamp: null,
    shortcut: null,
    current: false,
    disabled: false,
  };
}

function branchItems(
  input: PalettePresenterInput,
  tokens: readonly string[],
): readonly PaletteItem[] {
  if (input.branches.status !== "ready") return [];
  return input.branches.branches
    .filter((branch) => matchesAllTokens([branch.name], tokens))
    .map((branch) => ({
      key: `branch:${branch.remote ? "remote" : "local"}:${branch.name}`,
      intent: { kind: "switchBranch", name: branch.name, remote: branch.remote },
      icon: { kind: "glyph", glyph: "branch" },
      title: tokenText(branch.name, tokens),
      description: branch.remote ? plainText("Remote") : null,
      timestamp: null,
      shortcut: null,
      current: branch.current,
      disabled: false,
    }));
}

function branchGroup(input: PalettePresenterInput, tokens: readonly string[]): PaletteGroup {
  const branches = input.branches;
  switch (branches.status) {
    case "ready":
      return group("branches", branches.scopeLabel, branchItems(input, tokens));
    case "idle":
    case "loading":
      return group("branches", "Branches", [noticeItem("branches:loading", "Loading branches…")]);
    case "unavailable":
      return group("branches", "Branches", [noticeItem("branches:unavailable", branches.reason)]);
    case "error":
      return group("branches", "Branches", [noticeItem("branches:error", branches.message)]);
    default:
      return unreachableBranches(branches);
  }
}

function noticeItem(key: string, text: string): PaletteItem {
  return {
    key,
    intent: { kind: "none" },
    icon: null,
    title: plainText(text),
    description: null,
    timestamp: null,
    shortcut: null,
    current: false,
    disabled: true,
  };
}

function nonEmpty(groups: readonly PaletteGroup[]): readonly PaletteGroup[] {
  return groups.filter((candidate) => candidate.items.length > 0);
}

function monogram(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

function unreachablePage(page: never): never {
  return page;
}

function unreachableRoot(query: never): never {
  return query;
}

function unreachableBranches(branches: never): never {
  return branches;
}
