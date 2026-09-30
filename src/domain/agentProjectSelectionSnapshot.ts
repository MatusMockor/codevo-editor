export interface PersistedAgentProjectSelection {
  readonly projectRootKey: string;
  readonly threadId: string | null;
  readonly repositoryRoot: string | null;
}

export const AGENT_PROJECT_SELECTION_SNAPSHOT_VERSION = 1;
export const MAX_PERSISTED_AGENT_PROJECT_SELECTIONS = 64;
export const MAX_AGENT_PROJECT_SELECTION_SNAPSHOT_CHARS = 256 * 1_024;

const MAX_PROJECT_ROOT_KEY_CHARS = 4_096;
const MAX_THREAD_ID_CHARS = 256;
const MAX_REPOSITORY_ROOT_CHARS = 4_096;
const SNAPSHOT_KEYS = ["selections", "version"];
const SELECTION_KEYS = ["projectRootKey", "repositoryRoot", "threadId"];
const REMOTE_PROJECT_PREFIX = "remote:";
const REMOTE_THREAD_PREFIX = "remote-thread:";
const EMPTY: ReadonlyArray<PersistedAgentProjectSelection> = Object.freeze([]);

export function parseAgentProjectSelectionSnapshot(
  raw: string | null,
): ReadonlyArray<PersistedAgentProjectSelection> {
  if (raw === null || raw === "" || raw.length > MAX_AGENT_PROJECT_SELECTION_SNAPSHOT_CHARS) {
    return EMPTY;
  }
  const value = parseJson(raw);
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return EMPTY;
  if (value.version !== AGENT_PROJECT_SELECTION_SNAPSHOT_VERSION) return EMPTY;
  if (!Array.isArray(value.selections)) return EMPTY;
  const parsed: PersistedAgentProjectSelection[] = [];
  for (const candidate of value.selections) {
    const selection = parseSelection(candidate);
    if (selection !== null) parsed.push(selection);
  }
  return newestBounded(parsed);
}

export function serializeAgentProjectSelectionSnapshot(
  entries: ReadonlyArray<PersistedAgentProjectSelection>,
): string {
  const valid = newestBounded(
    entries.flatMap((entry) => {
      const selection = parseSelection({ ...entry });
      return selection === null ? [] : [selection];
    }),
  );
  let start = 0;
  let raw = encode(valid);
  while (raw.length > MAX_AGENT_PROJECT_SELECTION_SNAPSHOT_CHARS && start < valid.length) {
    start += 1;
    raw = encode(valid.slice(start));
  }
  return raw;
}

function encode(selections: ReadonlyArray<PersistedAgentProjectSelection>): string {
  return JSON.stringify({ version: AGENT_PROJECT_SELECTION_SNAPSHOT_VERSION, selections });
}

function newestBounded(
  entries: ReadonlyArray<PersistedAgentProjectSelection>,
): ReadonlyArray<PersistedAgentProjectSelection> {
  const byProject = new Map<string, PersistedAgentProjectSelection>();
  for (const entry of entries) {
    byProject.delete(entry.projectRootKey);
    byProject.set(entry.projectRootKey, entry);
  }
  const ordered = [...byProject.values()];
  return ordered.slice(Math.max(0, ordered.length - MAX_PERSISTED_AGENT_PROJECT_SELECTIONS));
}

function parseSelection(value: unknown): PersistedAgentProjectSelection | null {
  if (!isRecord(value) || !hasExactKeys(value, SELECTION_KEYS)) return null;
  const { projectRootKey, threadId, repositoryRoot } = value;
  if (!boundedString(projectRootKey, MAX_PROJECT_ROOT_KEY_CHARS)) return null;
  if (projectRootKey.startsWith(REMOTE_PROJECT_PREFIX)) return null;
  if (threadId === null) {
    if (repositoryRoot !== null && typeof repositoryRoot !== "string") return null;
    return { projectRootKey, threadId: null, repositoryRoot: null };
  }
  if (!boundedString(threadId, MAX_THREAD_ID_CHARS)) return null;
  if (threadId.startsWith(REMOTE_THREAD_PREFIX)) return null;
  if (!boundedString(repositoryRoot, MAX_REPOSITORY_ROOT_CHARS)) return null;
  return { projectRootKey, threadId, repositoryRoot };
}

function boundedString(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value !== "" && value.length <= maxChars;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
