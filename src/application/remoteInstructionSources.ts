/** Only local source roots are persisted here; instruction contents stay private to each send. */
const STORAGE_KEY = "codevo.remote-instruction-sources.v1";
const MAX_ENTRIES = 256;
const MAX_STORAGE_CHARS = 2_000_000;
type Source = readonly [string, string];
let revision = 0;
const subscribers = new Set<() => void>();
function publishChange(): void {
  revision += 1;
  for (const notify of subscribers) notify();
}
export function subscribeRemoteInstructionSources(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) publishChange();
  });
}

export function readRemoteInstructionSourceRevision(): number {
  return revision;
}

function identity(serverId: string, runnerId: string, projectId: string): string {
  const parts = [serverId, runnerId, projectId];
  if (parts.some((part) => !part || part.length > 512 || /\p{Cc}/u.test(part))) {
    throw new Error("Invalid remote instruction source identity.");
  }
  return JSON.stringify(parts);
}

function validRoot(root: unknown): root is string {
  return (
    typeof root === "string" &&
    root.startsWith("/") &&
    root.length > 1 &&
    new TextEncoder().encode(root).length <= 4096 &&
    !/[\\\p{Cc}]/u.test(root) &&
    !root
      .slice(1)
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}

function readSources(): Source[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  if (raw.length > MAX_STORAGE_CHARS)
    throw new Error("Instruction source preferences are too large.");
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > MAX_ENTRIES)
    throw new Error("Invalid instruction source preferences.");
  const seen = new Set<string>();
  return values.map((value: unknown): Source => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      !validRoot(value[1])
    ) {
      throw new Error("Invalid instruction source preference.");
    }
    const parts: unknown = JSON.parse(value[0]);
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      !parts.every((part): part is string => typeof part === "string") ||
      identity(parts[0], parts[1], parts[2]) !== value[0] ||
      seen.has(value[0])
    ) {
      throw new Error("Invalid instruction source identity.");
    }
    seen.add(value[0]);
    return [value[0], value[1]];
  });
}

export function readRemoteInstructionRoot(
  serverId: string,
  runnerId: string,
  projectId: string,
): string | undefined {
  const key = identity(serverId, runnerId, projectId);
  return readSources().find(([candidate]) => candidate === key)?.[1];
}

/** Call only with the canonical root of an explicitly selected, trusted registered workspace. */
export function saveRemoteInstructionRoot(
  serverId: string,
  runnerId: string,
  projectId: string,
  canonicalRoot: string,
): void {
  if (!validRoot(canonicalRoot)) throw new Error("Select a valid local workspace folder.");
  const key = identity(serverId, runnerId, projectId);
  const records = readSources().filter(([candidate]) => candidate !== key);
  if (records.length >= MAX_ENTRIES)
    throw new Error("Remove an instruction source mapping before adding another.");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...records, [key, canonicalRoot]]));
  publishChange();
}

export function removeRemoteInstructionRoot(
  serverId: string,
  runnerId: string,
  projectId: string,
): void {
  const key = identity(serverId, runnerId, projectId);
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(readSources().filter(([candidate]) => candidate !== key)),
  );
  publishChange();
}
