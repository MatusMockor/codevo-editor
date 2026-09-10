import { MAX_APP_UPDATE_NOTES_LENGTH, MAX_APP_UPDATE_VERSION_LENGTH } from "./appUpdater";
import { compareAppVersions, parseAppVersion, type AppVersion } from "./appVersionOrder";

export const MAX_APP_UPDATE_NOTES_ENTRIES = 8;
export const MAX_APP_UPDATE_NOTES_SOURCE_ENTRIES = 64;

export const APP_UPDATE_RELEASE_NOTES_FIELD = "releaseNotes";

const RELEASE_HEADING_PATTERN = /^#{2,3} \[[^\]\n]{1,64}\](?: - [^\n]{0,64})?\r?\n/;

export interface AppUpdateReleaseNote {
  readonly version: string;
  readonly notes: string;
}

export type AppUpdateNotesSpan =
  | { readonly kind: "single"; readonly notes: string | null }
  | { readonly kind: "complete"; readonly entries: readonly AppUpdateReleaseNote[] }
  | { readonly kind: "bounded"; readonly entries: readonly AppUpdateReleaseNote[] };

export interface AppUpdateNotesSource {
  readonly currentVersion: string;
  readonly version: string;
  readonly notes: string | null;
  readonly manifest: unknown;
}

interface ParsedReleaseNote extends AppUpdateReleaseNote {
  readonly order: AppVersion;
}

export function singleAppUpdateNotesSpan(notes: string | null): AppUpdateNotesSpan {
  return { kind: "single", notes };
}

export function parseAppUpdateNotesSpan(source: AppUpdateNotesSource): AppUpdateNotesSpan {
  const fallback = singleAppUpdateNotesSpan(withoutReleaseHeading(source.notes));
  const releases = readReleaseNotesField(source.manifest);
  if (releases === null) return fallback;
  const installed = parseAppVersion(source.currentVersion);
  if (installed === null) return fallback;
  const offered = parseAppVersion(source.version);
  if (offered === null) return fallback;
  const parsed = parseReleaseNoteEntries(releases);
  if (parsed === null) return fallback;
  const span = spanEntries(parsed, installed, offered);
  if (span.length === 0) return fallback;
  if (span.length === 1) return singleAppUpdateNotesSpan(span[0].notes);
  const entries = span.slice(0, MAX_APP_UPDATE_NOTES_ENTRIES).map(toEntry);
  if (span.length > MAX_APP_UPDATE_NOTES_ENTRIES) return { kind: "bounded", entries };
  if (!coversWholeSpan(parsed, span, installed, offered)) return { kind: "bounded", entries };
  return { kind: "complete", entries };
}

export function appUpdateNotesSpanEntries(
  span: AppUpdateNotesSpan,
): readonly AppUpdateReleaseNote[] {
  if (span.kind === "single") return [];
  return span.entries;
}

export function appUpdateNotesSpanSummary(span: AppUpdateNotesSpan): string | null {
  switch (span.kind) {
    case "single":
      return null;
    case "complete":
      return `Includes notes for ${span.entries.length} releases.`;
    case "bounded":
      return `Showing the last ${span.entries.length} releases of a longer span.`;
  }
}

function readReleaseNotesField(manifest: unknown): readonly unknown[] | null {
  if (!isRecord(manifest)) return null;
  const releases = manifest[APP_UPDATE_RELEASE_NOTES_FIELD];
  if (!Array.isArray(releases)) return null;
  if (releases.length === 0) return null;
  if (releases.length > MAX_APP_UPDATE_NOTES_SOURCE_ENTRIES) return null;
  return releases;
}

function parseReleaseNoteEntries(
  releases: readonly unknown[],
): readonly ParsedReleaseNote[] | null {
  const seen = new Set<string>();
  const entries: ParsedReleaseNote[] = [];
  for (const raw of releases) {
    const entry = parseReleaseNoteEntry(raw);
    if (entry === null) return null;
    if (seen.has(entry.version)) return null;
    seen.add(entry.version);
    entries.push(entry);
  }
  return entries;
}

function parseReleaseNoteEntry(raw: unknown): ParsedReleaseNote | null {
  if (!isRecord(raw)) return null;
  const version = boundedText(raw.version, MAX_APP_UPDATE_VERSION_LENGTH);
  if (version === null) return null;
  const notes = boundedText(raw.notes, MAX_APP_UPDATE_NOTES_LENGTH);
  if (notes === null) return null;
  const order = parseAppVersion(version);
  if (order === null) return null;
  return { version, notes, order };
}

function spanEntries(
  entries: readonly ParsedReleaseNote[],
  installed: AppVersion,
  offered: AppVersion,
): readonly ParsedReleaseNote[] {
  return entries
    .filter((entry) => compareAppVersions(entry.order, installed) > 0)
    .filter((entry) => compareAppVersions(entry.order, offered) <= 0)
    .sort((left, right) => compareAppVersions(right.order, left.order));
}

function coversWholeSpan(
  parsed: readonly ParsedReleaseNote[],
  span: readonly ParsedReleaseNote[],
  installed: AppVersion,
  offered: AppVersion,
): boolean {
  if (compareAppVersions(span[0].order, offered) !== 0) return false;
  return parsed.some((entry) => compareAppVersions(entry.order, installed) <= 0);
}

function withoutReleaseHeading(notes: string | null): string | null {
  if (notes === null) return null;
  const stripped = notes.replace(RELEASE_HEADING_PATTERN, "").trim();
  if (stripped.length === 0) return notes;
  return stripped;
}

function toEntry(entry: ParsedReleaseNote): AppUpdateReleaseNote {
  return { version: entry.version, notes: entry.notes };
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximumLength) return null;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
