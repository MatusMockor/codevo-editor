import type { WorkspacePathKey } from "./workspacePath";

export interface SemanticEditWorkspaceIdentity {
  readonly generation: number;
  readonly ownerKey: string;
  readonly rootKey: string;
  readonly sessionId: number;
}

export interface SemanticEditOpenDocumentIdentity {
  readonly contentHash: string;
  /** Monotonic host epoch shared by open and closed states for this path. */
  readonly hostEpoch: number;
  readonly kind: "open";
  readonly lifecycle: number;
  readonly pathKey: WorkspacePathKey;
  readonly sessionId: number;
  readonly version: number;
}

export interface SemanticEditClosedDocumentIdentity {
  readonly contentHash: string;
  /** Monotonic host epoch shared by open and closed states for this path. */
  readonly hostEpoch: number;
  readonly kind: "closed";
  readonly pathKey: WorkspacePathKey;
  /** Monotonic filesystem/object revision, independent from content equality. */
  readonly revision: number;
}

export interface SemanticWorkspaceEditCasCapture {
  readonly owner: SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity;
  readonly template: SemanticEditOpenDocumentIdentity;
  readonly workspace: SemanticEditWorkspaceIdentity;
}

export type SemanticWorkspaceEditCasPreconditions = Readonly<SemanticWorkspaceEditCasCapture>;

export type SemanticWorkspaceEditCasMismatch =
  "invalidCapture" | "ownerChanged" | "templateChanged" | "workspaceChanged";

export type SemanticWorkspaceEditCasValidation =
  | { readonly kind: "current" }
  | {
      readonly kind: "stale";
      readonly reason: SemanticWorkspaceEditCasMismatch;
    };

const MAX_IDENTITY_LENGTH = 4_096;
const MAX_HASH_LENGTH = 256;

export function captureSemanticWorkspaceEditCasPreconditions(
  capture: SemanticWorkspaceEditCasCapture,
): SemanticWorkspaceEditCasPreconditions | null {
  try {
    const snapshot = snapshotCapture(capture);

    if (!snapshot || !validCapture(snapshot)) {
      return null;
    }

    return Object.freeze({
      owner: freezeDocumentIdentity(snapshot.owner),
      template: Object.freeze({ ...snapshot.template }),
      workspace: Object.freeze({ ...snapshot.workspace }),
    });
  } catch {
    return null;
  }
}

export function validateSemanticWorkspaceEditCasPreconditions(
  expected: SemanticWorkspaceEditCasPreconditions,
  current: SemanticWorkspaceEditCasCapture,
): SemanticWorkspaceEditCasValidation {
  try {
    const expectedSnapshot = snapshotCapture(expected);
    const currentSnapshot = snapshotCapture(current);

    if (
      !expectedSnapshot ||
      !currentSnapshot ||
      !validCapture(expectedSnapshot) ||
      !validCapture(currentSnapshot)
    ) {
      return { kind: "stale", reason: "invalidCapture" };
    }

    if (!sameWorkspace(expectedSnapshot.workspace, currentSnapshot.workspace)) {
      return { kind: "stale", reason: "workspaceChanged" };
    }

    if (!sameDocument(expectedSnapshot.template, currentSnapshot.template)) {
      return { kind: "stale", reason: "templateChanged" };
    }

    if (!sameDocument(expectedSnapshot.owner, currentSnapshot.owner)) {
      return { kind: "stale", reason: "ownerChanged" };
    }

    return { kind: "current" };
  } catch {
    return { kind: "stale", reason: "invalidCapture" };
  }
}

function snapshotCapture(value: unknown): SemanticWorkspaceEditCasCapture | null {
  if (!plainRecord(value) || !exactKeys(value, ["owner", "template", "workspace"])) {
    return null;
  }

  const owner = snapshotDocument(dataProperty(value, "owner"));
  const template = snapshotOpenDocument(dataProperty(value, "template"));
  const workspace = snapshotWorkspace(dataProperty(value, "workspace"));

  return owner && template && workspace ? { owner, template, workspace } : null;
}

function snapshotWorkspace(value: unknown): SemanticEditWorkspaceIdentity | null {
  if (
    !plainRecord(value) ||
    !exactKeys(value, ["generation", "ownerKey", "rootKey", "sessionId"])
  ) {
    return null;
  }

  const generation = dataProperty(value, "generation");
  const ownerKey = dataProperty(value, "ownerKey");
  const rootKey = dataProperty(value, "rootKey");
  const sessionId = dataProperty(value, "sessionId");

  return typeof ownerKey === "string" &&
    typeof rootKey === "string" &&
    typeof generation === "number" &&
    typeof sessionId === "number"
    ? { generation, ownerKey, rootKey, sessionId }
    : null;
}

function snapshotDocument(
  value: unknown,
): SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity | null {
  if (!plainRecord(value)) {
    return null;
  }

  const kind = dataProperty(value, "kind");

  if (kind === "open") {
    return snapshotOpenDocument(value);
  }

  if (
    kind !== "closed" ||
    !exactKeys(value, ["contentHash", "hostEpoch", "kind", "pathKey", "revision"])
  ) {
    return null;
  }

  const contentHash = dataProperty(value, "contentHash");
  const hostEpoch = dataProperty(value, "hostEpoch");
  const pathKey = dataProperty(value, "pathKey");
  const revision = dataProperty(value, "revision");

  return typeof contentHash === "string" &&
    typeof hostEpoch === "number" &&
    typeof pathKey === "string" &&
    typeof revision === "number"
    ? {
        contentHash,
        hostEpoch,
        kind,
        pathKey: pathKey as WorkspacePathKey,
        revision,
      }
    : null;
}

function snapshotOpenDocument(value: unknown): SemanticEditOpenDocumentIdentity | null {
  if (
    !plainRecord(value) ||
    !exactKeys(value, [
      "contentHash",
      "hostEpoch",
      "kind",
      "lifecycle",
      "pathKey",
      "sessionId",
      "version",
    ])
  ) {
    return null;
  }

  const contentHash = dataProperty(value, "contentHash");
  const hostEpoch = dataProperty(value, "hostEpoch");
  const kind = dataProperty(value, "kind");
  const lifecycle = dataProperty(value, "lifecycle");
  const pathKey = dataProperty(value, "pathKey");
  const sessionId = dataProperty(value, "sessionId");
  const version = dataProperty(value, "version");

  return kind === "open" &&
    typeof contentHash === "string" &&
    typeof hostEpoch === "number" &&
    typeof lifecycle === "number" &&
    typeof pathKey === "string" &&
    typeof sessionId === "number" &&
    typeof version === "number"
    ? {
        contentHash,
        hostEpoch,
        kind,
        lifecycle,
        pathKey: pathKey as WorkspacePathKey,
        sessionId,
        version,
      }
    : null;
}

function validCapture(capture: SemanticWorkspaceEditCasCapture): boolean {
  return (
    capture !== null &&
    typeof capture === "object" &&
    validWorkspace(capture.workspace) &&
    validOpenDocument(capture.template) &&
    validDocument(capture.owner) &&
    capture.template.pathKey !== capture.owner.pathKey
  );
}

function validWorkspace(identity: SemanticEditWorkspaceIdentity): boolean {
  return (
    identity !== null &&
    typeof identity === "object" &&
    validIdentity(identity.rootKey) &&
    validIdentity(identity.ownerKey) &&
    nonNegativeInteger(identity.generation) &&
    nonNegativeInteger(identity.sessionId)
  );
}

function validDocument(
  identity: SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity,
): boolean {
  return identity !== null && typeof identity === "object" && identity.kind === "open"
    ? validOpenDocument(identity)
    : identity?.kind === "closed" &&
        validPathKey(identity.pathKey) &&
        validHash(identity.contentHash) &&
        nonNegativeInteger(identity.hostEpoch) &&
        nonNegativeInteger(identity.revision);
}

function validOpenDocument(identity: SemanticEditOpenDocumentIdentity): boolean {
  return (
    identity !== null &&
    typeof identity === "object" &&
    identity.kind === "open" &&
    validPathKey(identity.pathKey) &&
    validHash(identity.contentHash) &&
    nonNegativeInteger(identity.hostEpoch) &&
    nonNegativeInteger(identity.lifecycle) &&
    nonNegativeInteger(identity.sessionId) &&
    nonNegativeInteger(identity.version)
  );
}

function sameWorkspace(
  expected: SemanticEditWorkspaceIdentity,
  current: SemanticEditWorkspaceIdentity,
): boolean {
  return (
    expected.rootKey === current.rootKey &&
    expected.ownerKey === current.ownerKey &&
    expected.generation === current.generation &&
    expected.sessionId === current.sessionId
  );
}

function sameDocument(
  expected: SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity,
  current: SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity,
): boolean {
  if (
    expected.kind !== current.kind ||
    expected.pathKey !== current.pathKey ||
    expected.contentHash !== current.contentHash ||
    expected.hostEpoch !== current.hostEpoch
  ) {
    return false;
  }

  return expected.kind === "closed"
    ? current.kind === "closed" && expected.revision === current.revision
    : current.kind === "open" &&
        expected.version === current.version &&
        expected.sessionId === current.sessionId &&
        expected.lifecycle === current.lifecycle;
}

function freezeDocumentIdentity(
  identity: SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity,
): SemanticEditClosedDocumentIdentity | SemanticEditOpenDocumentIdentity {
  return Object.freeze({ ...identity });
}

function validIdentity(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTITY_LENGTH &&
    !/\p{Cc}/u.test(value)
  );
}

function validPathKey(value: WorkspacePathKey): boolean {
  return validIdentity(value);
}

function validHash(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_HASH_LENGTH &&
    /^[A-Za-z0-9:_-]+$/.test(value)
  );
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);

  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function exactKeys(value: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);

  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
