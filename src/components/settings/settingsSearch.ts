import { matchesQuery } from "../../domain/matchHighlight";
import type { SettingsRowDescriptor } from "./settingsRegistry";

export type SettingsSearchMatch = "title" | "description" | "keywords";

export interface SettingsSearchHit {
  readonly row: SettingsRowDescriptor;
  readonly matchedIn: SettingsSearchMatch;
}

const TITLE_PREFIX_RANK = 0;
const TITLE_RANK = 1;
const SECONDARY_RANK = 2;

export function searchSettingsRows(
  query: string,
  rows: ReadonlyArray<SettingsRowDescriptor>,
  hasWorkspace: boolean,
  limit = 50,
): ReadonlyArray<SettingsSearchHit> {
  const trimmed = query.trim();

  if (trimmed === "" || limit <= 0) {
    return [];
  }

  const ranked: Array<{ readonly hit: SettingsSearchHit; readonly rank: number }> = [];

  for (const row of rows) {
    if (!isAvailable(row, hasWorkspace)) {
      continue;
    }

    const scored = scoreRow(row, trimmed);

    if (scored === null) {
      continue;
    }

    ranked.push(scored);
  }

  return ranked
    .map((entry, position) => ({ ...entry, position }))
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .slice(0, limit)
    .map((entry) => entry.hit);
}

function isAvailable(row: SettingsRowDescriptor, hasWorkspace: boolean): boolean {
  switch (row.availability) {
    case "always":
      return true;
    case "workspace":
      return hasWorkspace;
    default:
      return row.availability satisfies never;
  }
}

function scoreRow(
  row: SettingsRowDescriptor,
  query: string,
): { readonly hit: SettingsSearchHit; readonly rank: number } | null {
  if (row.title.toLowerCase().startsWith(query.toLowerCase())) {
    return { hit: { row, matchedIn: "title" }, rank: TITLE_PREFIX_RANK };
  }

  if (matchesQuery(row.title, query)) {
    return { hit: { row, matchedIn: "title" }, rank: TITLE_RANK };
  }

  if (row.description !== null && matchesQuery(row.description, query)) {
    return { hit: { row, matchedIn: "description" }, rank: SECONDARY_RANK };
  }

  if (row.keywords.some((keyword) => matchesQuery(keyword, query))) {
    return { hit: { row, matchedIn: "keywords" }, rank: SECONDARY_RANK };
  }

  return null;
}
