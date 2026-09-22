/** Runner-owned presentation state shared by every client of a conversation. */
export type RemoteThreadMetadata = Readonly<{
  taskId: string;
  revision: number;
  title: string | null;
  pinned: boolean;
  archived: boolean;
  removed: boolean;
  viewedAtEpochMs: number | null;
  snoozedUntil: number | null;
  settledAt: number | null;
  sortOrder: number | null;
}>;

export type RemoteThreadMetadataPatch = Readonly<{
  expectedRevision: number;
}> &
  Partial<Omit<RemoteThreadMetadata, "taskId" | "revision">>;

export type RemoteThreadMetadataPage = Readonly<{
  items: readonly RemoteThreadMetadata[];
  nextAfter: string | null;
}>;

const fields = [
  "title",
  "pinned",
  "archived",
  "removed",
  "viewedAtEpochMs",
  "snoozedUntil",
  "settledAt",
  "sortOrder",
] as const;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function validField(key: (typeof fields)[number], value: unknown): boolean {
  switch (key) {
    case "title":
      return (
        value === null ||
        (typeof value === "string" &&
          value.trim().length > 0 &&
          new TextEncoder().encode(value).length <= 256 &&
          !/[\u0000-\u001f\u007f]/u.test(value))
      );
    case "pinned":
    case "archived":
    case "removed":
      return typeof value === "boolean";
    case "sortOrder":
      return (
        value === null ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          Math.abs(value) <= Number.MAX_SAFE_INTEGER)
      );
    case "viewedAtEpochMs":
    case "snoozedUntil":
    case "settledAt":
      return value === null || (integer(value) && value <= 8_640_000_000_000_000);
  }
}
export function isRemoteThreadMetadata(value: unknown): value is RemoteThreadMetadata {
  return (
    record(value) &&
    Object.keys(value).length === fields.length + 2 &&
    uuid(value.taskId) &&
    integer(value.revision) &&
    !(value.snoozedUntil != null && value.settledAt != null) &&
    fields.every((key) => validField(key, value[key]))
  );
}
export function isRemoteThreadMetadataPatch(value: unknown): value is RemoteThreadMetadataPatch {
  return (
    record(value) &&
    integer(value.expectedRevision) &&
    !(value.snoozedUntil != null && value.settledAt != null) &&
    Object.keys(value).length > 1 &&
    Object.entries(value).every(
      ([key, entry]) =>
        key === "expectedRevision" ||
        (fields.includes(key as (typeof fields)[number]) &&
          validField(key as (typeof fields)[number], entry)),
    )
  );
}
export function isRemoteThreadMetadataPage(value: unknown): value is RemoteThreadMetadataPage {
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    !(value.nextAfter === null || uuid(value.nextAfter)) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !value.items.every(isRemoteThreadMetadata)
  )
    return false;
  return new Set(value.items.map((item) => item.taskId)).size === value.items.length;
}

export function isRemoteThreadMetadataChanges(
  value: unknown,
): value is readonly RemoteThreadMetadata[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(isRemoteThreadMetadata) &&
    new Set(value.map((item) => item.taskId)).size === value.length
  );
}
