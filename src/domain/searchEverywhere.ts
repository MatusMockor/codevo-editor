import type { Command, CommandContext } from "../application/commandRegistry";
import type { ProjectSymbolSearchResult } from "./projectSymbols";
import type { FileSearchResult } from "./workspace";

/**
 * "Search Everywhere" (PhpStorm double-Shift) aggregates the three existing
 * search sources - files, workspace symbols and runnable actions/commands -
 * into one categorized model. This module is the pure aggregation layer: it
 * never fetches anything itself (the controller reuses the existing file/symbol
 * gateways and the command registry and feeds the raw results in here), it only
 * groups, filters and flattens them. Keeping it pure makes keyboard navigation,
 * dispatch routing and section ordering trivially testable.
 */
export type SearchEverywhereItemKind = "file" | "symbol" | "action";

export interface SearchEverywhereFileItem {
  id: string;
  kind: "file";
  label: string;
  detail: string;
  file: FileSearchResult;
}

export interface SearchEverywhereSymbolItem {
  id: string;
  kind: "symbol";
  label: string;
  detail: string;
  symbol: ProjectSymbolSearchResult;
}

export interface SearchEverywhereActionItem {
  id: string;
  kind: "action";
  label: string;
  detail: string;
  shortcut: string | null;
  command: Command;
}

export type SearchEverywhereItem =
  | SearchEverywhereFileItem
  | SearchEverywhereSymbolItem
  | SearchEverywhereActionItem;

export interface SearchEverywhereSection {
  kind: SearchEverywhereItemKind;
  label: string;
  items: SearchEverywhereItem[];
}

export interface SearchEverywhereModel {
  query: string;
  sections: SearchEverywhereSection[];
}

export interface SearchEverywhereInput {
  query: string;
  files: FileSearchResult[];
  symbols: ProjectSymbolSearchResult[];
  commands: Command[];
  context: CommandContext;
}

const sectionLabels: Record<SearchEverywhereItemKind, string> = {
  file: "Files",
  symbol: "Symbols",
  action: "Actions",
};

function fileItem(file: FileSearchResult, index: number): SearchEverywhereFileItem {
  return {
    id: `file:${index}:${file.path}`,
    kind: "file",
    label: file.name,
    detail: file.relativePath,
    file,
  };
}

function symbolItem(
  symbol: ProjectSymbolSearchResult,
  index: number,
): SearchEverywhereSymbolItem {
  return {
    id: `symbol:${index}:${symbol.path}:${symbol.lineNumber}:${symbol.column}`,
    kind: "symbol",
    label: symbol.name,
    detail: `${symbol.kind} · ${symbol.relativePath}:${symbol.lineNumber}`,
    symbol,
  };
}

function actionItem(command: Command, index: number): SearchEverywhereActionItem {
  return {
    id: `action:${index}:${command.id}`,
    kind: "action",
    label: command.title,
    detail: command.category,
    shortcut: command.shortcut ?? null,
    command,
  };
}

function commandMatchesQuery(command: Command, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = `${command.category} ${command.title} ${command.id}`;
  return haystack.toLowerCase().includes(normalizedQuery);
}

function filterCommands(
  commands: Command[],
  context: CommandContext,
  normalizedQuery: string,
): Command[] {
  return commands.filter(
    (command) =>
      command.isEnabled(context) && commandMatchesQuery(command, normalizedQuery),
  );
}

function section(
  kind: SearchEverywhereItemKind,
  items: SearchEverywhereItem[],
): SearchEverywhereSection | null {
  if (items.length === 0) {
    return null;
  }

  return { kind, label: sectionLabels[kind], items };
}

export function buildSearchEverywhereModel(
  input: SearchEverywhereInput,
): SearchEverywhereModel {
  const normalizedQuery = input.query.trim().toLowerCase();

  const sections = [
    section(
      "file",
      input.files.map((file, index) => fileItem(file, index)),
    ),
    section(
      "symbol",
      input.symbols.map((symbol, index) => symbolItem(symbol, index)),
    ),
    section(
      "action",
      filterCommands(input.commands, input.context, normalizedQuery).map(
        (command, index) => actionItem(command, index),
      ),
    ),
  ].filter((value): value is SearchEverywhereSection => value !== null);

  return { query: input.query, sections };
}

export function flattenSearchEverywhereItems(
  model: SearchEverywhereModel,
): SearchEverywhereItem[] {
  return model.sections.flatMap((section) => section.items);
}
