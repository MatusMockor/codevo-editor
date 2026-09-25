import { Update } from "@tauri-apps/plugin-updater";

export const APP_UPDATE_CHECK_COMMAND = "app_update_check";

export type AppUpdateMetadata = ConstructorParameters<typeof Update>[0];

export type AppUpdateCheckOutcome =
  | { readonly kind: "available"; readonly metadata: AppUpdateMetadata }
  | { readonly kind: "upToDate" };

export type InvokeAppUpdateCheck = (command: typeof APP_UPDATE_CHECK_COMMAND) => Promise<unknown>;

const AVAILABLE_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "rid",
  "currentVersion",
  "version",
  "date",
  "body",
  "rawJson",
]);
const UP_TO_DATE_KEYS: ReadonlySet<string> = new Set(["kind"]);

export function createAppUpdateCheck(
  invokeCommand: InvokeAppUpdateCheck,
  construct: (metadata: AppUpdateMetadata) => unknown = (metadata) => new Update(metadata),
): () => Promise<unknown> {
  return async () => {
    const raw = await invokeCommand(APP_UPDATE_CHECK_COMMAND);
    const outcome = parseAppUpdateCheckOutcome(raw);
    switch (outcome.kind) {
      case "available":
        return construct(outcome.metadata);
      case "upToDate":
        return null;
      default:
        return assertNever(outcome);
    }
  };
}

export function parseAppUpdateCheckOutcome(value: unknown): AppUpdateCheckOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid application update check outcome.");
  }
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case "available":
      requireExactKeys(record, AVAILABLE_KEYS);
      return { kind: "available", metadata: parseAppUpdateMetadata(record) };
    case "upToDate":
      requireExactKeys(record, UP_TO_DATE_KEYS);
      return { kind: "upToDate" };
    default:
      throw invalid("kind");
  }
}

function parseAppUpdateMetadata(record: Record<string, unknown>): AppUpdateMetadata {
  const rid = record.rid;
  if (typeof rid !== "number" || !Number.isSafeInteger(rid) || rid < 0) throw invalid("rid");
  if (typeof record.currentVersion !== "string") throw invalid("currentVersion");
  if (typeof record.version !== "string") throw invalid("version");
  const rawJson = record.rawJson;
  if (typeof rawJson !== "object" || rawJson === null || Array.isArray(rawJson)) {
    throw invalid("rawJson");
  }
  const date = optionalText(record.date, "date");
  const body = optionalText(record.body, "body");
  return {
    rid,
    currentVersion: record.currentVersion,
    version: record.version,
    rawJson: rawJson as Record<string, unknown>,
    ...(date === undefined ? {} : { date }),
    ...(body === undefined ? {} : { body }),
  };
}

function requireExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new TypeError("Invalid application update check outcome fields.");
  }
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(field);
  return value;
}

function invalid(field: string): TypeError {
  return new TypeError(`Invalid application update check outcome at ${field}.`);
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported application update check outcome: ${String(value)}.`);
}
