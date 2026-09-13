import type {
  RemoteAgentMetadata,
  RemoteAgentMetadataRepository,
} from "../application/remoteAgentMetadata";

const STORAGE_KEY = "codevo.remote-thread-metadata.v1";
const MAX_RECORDS = 4096;
const MAX_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const fields = new Set(["threadId", "title", "pinned", "archived", "removed", "viewedAtEpochMs"]);

type MetadataStorage = Pick<Storage, "getItem" | "setItem">;

/** Stores presentation preferences only, separate from local thread execution state. */
export class BrowserRemoteAgentMetadataRepository implements RemoteAgentMetadataRepository {
  constructor(private readonly storage: () => MetadataStorage | null) {}

  load(): readonly RemoteAgentMetadata[] {
    try {
      const raw = this.storage()?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return [];
      if (raw.length > MAX_BYTES || encoder.encode(raw).length > MAX_BYTES) return [];
      return parseRecords(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  save(records: readonly RemoteAgentMetadata[]): void {
    const parsed = parseRecords(records);
    const raw = JSON.stringify(parsed);
    if (encoder.encode(raw).length > MAX_BYTES)
      throw new Error("Remote thread preferences exceed the storage limit.");
    const storage = this.storage();
    if (storage === null) throw new Error("Remote thread preferences cannot be saved.");
    storage.setItem(STORAGE_KEY, raw);
  }
}

function parseRecords(value: unknown): readonly RemoteAgentMetadata[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS)
    throw new Error("Invalid remote thread preferences.");
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid remote thread preference.");
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).some((key) => !fields.has(key)))
      throw new Error("Unknown remote thread preference.");
    const id = record.threadId;
    if (
      typeof id !== "string" ||
      encoder.encode(id).length > 1024 ||
      !validThreadKey(id) ||
      seen.has(id)
    )
      throw new Error("Invalid remote thread identity.");
    seen.add(id);
    if (
      record.title !== undefined &&
      (typeof record.title !== "string" ||
        encoder.encode(record.title).length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(record.title))
    )
      throw new Error("Invalid remote thread title.");
    for (const key of ["pinned", "archived", "removed"] as const) {
      if (record[key] !== undefined && typeof record[key] !== "boolean")
        throw new Error("Invalid remote thread flag.");
    }
    const viewed = record.viewedAtEpochMs;
    if (
      viewed !== undefined &&
      viewed !== null &&
      (typeof viewed !== "number" || !Number.isSafeInteger(viewed) || viewed < 0)
    )
      throw new Error("Invalid remote thread read time.");
    return {
      threadId: id,
      ...(record.title === undefined ? {} : { title: record.title as string }),
      ...(record.pinned === undefined ? {} : { pinned: record.pinned as boolean }),
      ...(record.archived === undefined ? {} : { archived: record.archived as boolean }),
      ...(record.removed === undefined ? {} : { removed: record.removed as boolean }),
      ...(viewed === undefined ? {} : { viewedAtEpochMs: viewed as number | null }),
    };
  });
}

function validThreadKey(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "remote-thread") return false;
  return parts.slice(1).every((part) => {
    try {
      const decoded = decodeURIComponent(part);
      return (
        decoded.length > 0 &&
        !/[\u0000-\u001f\u007f]/u.test(decoded) &&
        encodeURIComponent(decoded) === part
      );
    } catch {
      return false;
    }
  });
}
