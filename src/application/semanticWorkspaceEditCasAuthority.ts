import type { LanguageServerWorkspaceEdit } from "../domain/languageServerFeatures";
import {
  captureSemanticWorkspaceEditCasPreconditions,
  validateSemanticWorkspaceEditCasPreconditions,
  type SemanticWorkspaceEditCasCapture,
  type SemanticWorkspaceEditCasMismatch,
  type SemanticWorkspaceEditCasPreconditions,
} from "../domain/semanticWorkspaceEditCas";

export interface SemanticWorkspaceEditAtomicCasRequest {
  readonly edit: LanguageServerWorkspaceEdit;
  readonly preconditions: SemanticWorkspaceEditCasPreconditions;
}

export type SemanticWorkspaceEditAtomicCasDecision =
  | { readonly kind: "accepted" }
  | {
      readonly kind: "rejected";
      readonly reason:
        "atomicCasUnavailable" | "ownerChanged" | "templateChanged" | "workspaceChanged";
    };

/**
 * Backend seam: implementations must compare every precondition and commit the
 * complete edit atomically. A read-then-write adapter does not satisfy this port.
 */
export interface SemanticWorkspaceEditAtomicCasPort {
  compareAndSwap(
    request: SemanticWorkspaceEditAtomicCasRequest,
  ): Promise<SemanticWorkspaceEditAtomicCasDecision>;
}

export interface SemanticWorkspaceEditCasLease {
  readonly preconditions: SemanticWorkspaceEditCasPreconditions;
}

export type SemanticWorkspaceEditCasResult =
  | SemanticWorkspaceEditAtomicCasDecision
  | {
      readonly kind: "rejected";
      readonly reason:
        | SemanticWorkspaceEditCasMismatch
        | "alreadyConsumed"
        | "foreignLease"
        | "invalidEdit"
        | "invalidPortResult";
    };

export interface SemanticWorkspaceEditCasOptions {
  readonly current: SemanticWorkspaceEditCasCapture;
  readonly edit: LanguageServerWorkspaceEdit;
  readonly port: SemanticWorkspaceEditAtomicCasPort;
}

export interface SemanticWorkspaceEditCasAuthority {
  issue(capture: SemanticWorkspaceEditCasCapture): SemanticWorkspaceEditCasLease | null;
  compareAndSwap(
    lease: SemanticWorkspaceEditCasLease,
    options: SemanticWorkspaceEditCasOptions,
  ): Promise<SemanticWorkspaceEditCasResult>;
}

const ATOMIC_REJECTIONS = new Set([
  "atomicCasUnavailable",
  "ownerChanged",
  "templateChanged",
  "workspaceChanged",
]);
const MAX_DOCUMENTS = 32;
const MAX_EDITS = 512;
const MAX_FILE_OPERATIONS = 64;
const MAX_TEXT_CHARACTERS = 1_000_000;
const MAX_URI_CHARACTERS = 4_096;
// Shared with the Rust foundation. Existing semantic bounds keep every valid request below this
// ceiling, including worst-case JSON escaping of the one-million UTF-16-unit text budget.
const MAX_ATOMIC_CAS_WIRE_BYTES = 16 * 1024 * 1024;

/** Single-use lease authority; consumption precedes caller-controlled reads. */
export function createSemanticWorkspaceEditCasAuthority(): SemanticWorkspaceEditCasAuthority {
  const issued = new WeakSet<SemanticWorkspaceEditCasLease>();
  const consumed = new WeakSet<SemanticWorkspaceEditCasLease>();

  return {
    issue(capture) {
      const preconditions = captureSemanticWorkspaceEditCasPreconditions(capture);

      if (!preconditions) {
        return null;
      }

      const lease = Object.freeze({ preconditions });
      issued.add(lease);
      return lease;
    },
    async compareAndSwap(lease, options) {
      if (!issued.has(lease)) {
        return { kind: "rejected", reason: "foreignLease" };
      }

      if (consumed.has(lease)) {
        return { kind: "rejected", reason: "alreadyConsumed" };
      }

      consumed.add(lease);

      try {
        const current = dataProperty(options, "current");
        const edit = snapshotWorkspaceEdit(dataProperty(options, "edit"));
        const port = dataProperty(options, "port");

        if (!edit) {
          return { kind: "rejected", reason: "invalidEdit" };
        }

        const validation = validateSemanticWorkspaceEditCasPreconditions(
          lease.preconditions,
          current as SemanticWorkspaceEditCasCapture,
        );

        if (validation.kind === "stale") {
          return { kind: "rejected", reason: validation.reason };
        }

        const compareAndSwap = dataProperty(port, "compareAndSwap");

        if (typeof compareAndSwap !== "function") {
          return { kind: "rejected", reason: "atomicCasUnavailable" };
        }

        const request = Object.freeze({
          edit,
          preconditions: lease.preconditions,
        });

        if (!boundedWireRequest(request)) {
          return { kind: "rejected", reason: "invalidEdit" };
        }

        const decision: unknown = await Reflect.apply(compareAndSwap, port, [request]);

        return decodeAtomicDecision(decision);
      } catch {
        return { kind: "rejected", reason: "atomicCasUnavailable" };
      }
    },
  };
}

function boundedWireRequest(request: SemanticWorkspaceEditAtomicCasRequest): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(request)).byteLength <= MAX_ATOMIC_CAS_WIRE_BYTES
    );
  } catch {
    return false;
  }
}

function snapshotWorkspaceEdit(value: unknown): LanguageServerWorkspaceEdit | null {
  if (!record(value)) {
    return null;
  }

  const rawChanges = dataProperty(value, "changes");
  const rawVersions = optionalDataProperty(value, "documentVersions");
  const rawOperations = optionalDataProperty(value, "fileOperations");

  if (
    !record(rawChanges) ||
    !exactKeys(value, ["changes", "documentVersions", "fileOperations"]) ||
    (rawVersions !== undefined && !record(rawVersions))
  ) {
    return null;
  }

  const fileOperations = snapshotFileOperations(rawOperations);

  if (rawOperations !== undefined && !fileOperations) {
    return null;
  }

  const uris = Object.keys(rawChanges);

  if (
    uris.length > MAX_DOCUMENTS ||
    (uris.length === 0 && (!fileOperations || fileOperations.length === 0))
  ) {
    return null;
  }

  const changes: LanguageServerWorkspaceEdit["changes"] = Object.create(
    null,
  ) as LanguageServerWorkspaceEdit["changes"];
  const documentVersions: Record<string, number | null> = Object.create(null) as Record<
    string,
    number | null
  >;
  let editCount = 0;
  let textCharacters = 0;

  for (const uri of uris) {
    if (!validText(uri, MAX_URI_CHARACTERS)) {
      return null;
    }

    const rawEdits = dataProperty(rawChanges, uri);

    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      return null;
    }

    const edits = [];

    for (let index = 0; index < rawEdits.length; index += 1) {
      const edit = snapshotTextEdit(dataProperty(rawEdits, String(index)));

      if (!edit) {
        return null;
      }

      editCount += 1;
      textCharacters += edit.newText.length;

      if (editCount > MAX_EDITS || textCharacters > MAX_TEXT_CHARACTERS) {
        return null;
      }

      edits.push(edit);
    }

    changes[uri] = Object.freeze(edits) as unknown as typeof edits;

    if (rawVersions !== undefined) {
      const version = dataProperty(rawVersions, uri);

      if (version !== undefined && !nonNegativeInteger(version)) {
        return null;
      }

      if (version !== undefined) {
        documentVersions[uri] = version as number | null;
      }
    }
  }

  if (
    rawVersions !== undefined &&
    Object.keys(rawVersions).some((uri) => !Object.prototype.hasOwnProperty.call(changes, uri))
  ) {
    return null;
  }

  return Object.freeze({
    changes: Object.freeze(changes),
    ...(rawVersions === undefined ? {} : { documentVersions: Object.freeze(documentVersions) }),
    ...(fileOperations ? { fileOperations } : {}),
  });
}

function snapshotTextEdit(
  value: unknown,
): LanguageServerWorkspaceEdit["changes"][string][number] | null {
  if (!record(value)) {
    return null;
  }

  const newText = dataProperty(value, "newText");
  const range = dataProperty(value, "range");

  if (
    typeof newText !== "string" ||
    newText.length > MAX_TEXT_CHARACTERS ||
    !record(range) ||
    !exactKeys(value, ["newText", "range"]) ||
    !exactKeys(range, ["end", "start"])
  ) {
    return null;
  }

  const start = snapshotPosition(dataProperty(range, "start"));
  const end = snapshotPosition(dataProperty(range, "end"));

  if (
    !start ||
    !end ||
    end.line < start.line ||
    (end.line === start.line && end.character < start.character)
  ) {
    return null;
  }

  return Object.freeze({
    newText,
    range: Object.freeze({ end, start }),
  });
}

function snapshotPosition(
  value: unknown,
): { readonly character: number; readonly line: number } | null {
  if (!record(value)) {
    return null;
  }

  const character = dataProperty(value, "character");
  const line = dataProperty(value, "line");

  return exactKeys(value, ["character", "line"]) &&
    nonNegativeInteger(character) &&
    nonNegativeInteger(line)
    ? Object.freeze({ character, line })
    : null;
}

function snapshotFileOperations(
  value: unknown,
): LanguageServerWorkspaceEdit["fileOperations"] | null {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value) || value.length > MAX_FILE_OPERATIONS) {
    return null;
  }

  const operations: NonNullable<LanguageServerWorkspaceEdit["fileOperations"]> = [];

  for (let index = 0; index < value.length; index += 1) {
    const raw = dataProperty(value, String(index));

    if (!record(raw)) {
      return null;
    }

    const kind = dataProperty(raw, "kind");
    const rawOptions = optionalDataProperty(raw, "options");
    const options = snapshotFileOperationOptions(rawOptions);

    if (rawOptions !== undefined && options === undefined) {
      return null;
    }

    if (kind === "rename") {
      const oldUri = dataProperty(raw, "oldUri");
      const newUri = dataProperty(raw, "newUri");

      if (
        !exactKeys(raw, ["kind", "newUri", "oldUri", "options"]) ||
        typeof oldUri !== "string" ||
        typeof newUri !== "string" ||
        !validText(oldUri, MAX_URI_CHARACTERS) ||
        !validText(newUri, MAX_URI_CHARACTERS)
      ) {
        return null;
      }

      operations.push(
        Object.freeze({
          kind,
          newUri,
          oldUri,
          ...(options === null || options === undefined ? {} : { options }),
        }),
      );
      continue;
    }

    if (kind === "create" || kind === "delete") {
      const uri = dataProperty(raw, "uri");

      if (
        !exactKeys(raw, ["kind", "options", "uri"]) ||
        typeof uri !== "string" ||
        !validText(uri, MAX_URI_CHARACTERS)
      ) {
        return null;
      }

      operations.push(
        Object.freeze({
          kind,
          uri,
          ...(options === null || options === undefined ? {} : { options }),
        }),
      );
      continue;
    }

    return null;
  }

  return Object.freeze(operations) as unknown as typeof operations;
}

function snapshotFileOperationOptions(value: unknown):
  | Readonly<{
      ignoreIfExists?: boolean;
      ignoreIfNotExists?: boolean;
      overwrite?: boolean;
      recursive?: boolean;
    }>
  | null
  | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (
    !record(value) ||
    !exactKeys(value, ["ignoreIfExists", "ignoreIfNotExists", "overwrite", "recursive"])
  ) {
    return undefined;
  }

  const snapshot: Record<string, boolean> = {};

  for (const key of ["ignoreIfExists", "ignoreIfNotExists", "overwrite", "recursive"]) {
    const option = optionalDataProperty(value, key);

    if (option !== undefined && typeof option !== "boolean") {
      return undefined;
    }

    if (typeof option === "boolean") {
      snapshot[key] = option;
    }
  }

  return Object.freeze(snapshot);
}

function decodeAtomicDecision(value: unknown): SemanticWorkspaceEditCasResult {
  if (!record(value)) {
    return { kind: "rejected", reason: "invalidPortResult" };
  }

  const kind = dataProperty(value, "kind");

  if (kind === "accepted" && Object.keys(value).length === 1) {
    return { kind: "accepted" };
  }

  const reason = dataProperty(value, "reason");

  if (
    kind === "rejected" &&
    typeof reason === "string" &&
    ATOMIC_REJECTIONS.has(reason) &&
    Object.keys(value).length === 2
  ) {
    return {
      kind: "rejected",
      reason: reason as Extract<
        SemanticWorkspaceEditAtomicCasDecision,
        { kind: "rejected" }
      >["reason"],
    };
  }

  return { kind: "rejected", reason: "invalidPortResult" };
}

function dataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, key);

  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function optionalDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);

  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function exactKeys(value: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);

  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function validText(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !/\p{Cc}/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
