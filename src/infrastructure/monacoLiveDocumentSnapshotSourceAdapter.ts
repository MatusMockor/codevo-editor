import type * as Monaco from "monaco-editor";
import type {
  LiveDocumentSnapshotReadExpectation,
  LiveDocumentSnapshotSourcePort,
  LiveDocumentSnapshotSourceProbe,
  LiveDocumentSnapshotSourceRead,
} from "../application/liveDocumentSnapshotSourcePort";

export interface MonacoLiveDocumentSnapshotSourceRegistration {
  readonly isCurrentModel: (model: Monaco.editor.ITextModel) => boolean;
  readonly model: Monaco.editor.ITextModel;
  readonly modelAuthority: object;
}

interface MonacoModelSnapshotMetadata {
  readonly alternativeVersionId: number;
  readonly modelVersionId: number;
  readonly utf16Length: number;
}

/**
 * Adapts one exact Monaco model registration to the snapshot source port.
 *
 * `isCurrentModel` must synchronously identify the currently registered model.
 * The owner of the registration must synchronously publish every Monaco content
 * mutation through the canonical live-content coordinator ingress before that
 * mutation callback returns.
 */
export function createMonacoLiveDocumentSnapshotSource(
  registration: MonacoLiveDocumentSnapshotSourceRegistration,
): LiveDocumentSnapshotSourcePort {
  let model: Monaco.editor.ITextModel;
  let modelAuthority: object;
  let isCurrentModel: (model: Monaco.editor.ITextModel) => boolean;
  try {
    model = registration.model;
    modelAuthority = registration.modelAuthority;
    isCurrentModel = registration.isCurrentModel;
  } catch {
    throw new TypeError("Invalid Monaco live document snapshot source registration");
  }
  if (
    !isObjectIdentity(model) ||
    !isObjectIdentity(modelAuthority) ||
    typeof isCurrentModel !== "function"
  ) {
    throw new TypeError("Invalid Monaco live document snapshot source registration");
  }

  const sourceAuthority = Object.freeze({});

  return Object.freeze({
    modelAuthority,
    sourceAuthority,
    probe(): LiveDocumentSnapshotSourceProbe {
      const metadata = captureMetadata(model, isCurrentModel);
      return metadata
        ? Object.freeze({
            ...metadata,
            status: "available",
          })
        : UNAVAILABLE_PROBE;
    },
    readFullText(expectation: LiveDocumentSnapshotReadExpectation): LiveDocumentSnapshotSourceRead {
      assertExpectation(expectation, modelAuthority, sourceAuthority);
      const before = captureMetadata(model, isCurrentModel);
      if (!before || !metadataMatchesExpectation(before, expectation)) {
        throw new Error("Monaco snapshot source is stale or unavailable");
      }
      if (before.utf16Length > expectation.maxUtf16Units) {
        throw new Error("Monaco snapshot source exceeds the read limit");
      }

      const text = model.getValue();
      const after = captureMetadata(model, isCurrentModel);
      if (!after || !sameMetadata(before, after) || text.length !== before.utf16Length) {
        throw new Error("Monaco snapshot source changed during the atomic read");
      }

      return Object.freeze({
        alternativeVersionId: after.alternativeVersionId,
        modelAuthority,
        modelVersionId: after.modelVersionId,
        sourceAuthority,
        text,
        utf16Length: after.utf16Length,
      });
    },
  });
}

function captureMetadata(
  model: Monaco.editor.ITextModel,
  isCurrentModel: (model: Monaco.editor.ITextModel) => boolean,
): MonacoModelSnapshotMetadata | null {
  try {
    if (!isCurrentModel(model) || model.isDisposed()) return null;
    const modelVersionId = model.getVersionId();
    const alternativeVersionId = model.getAlternativeVersionId();
    const utf16Length = model.getValueLength();
    if (
      !positive(modelVersionId) ||
      !positive(alternativeVersionId) ||
      !nonNegative(utf16Length) ||
      model.isDisposed() ||
      !isCurrentModel(model) ||
      model.getVersionId() !== modelVersionId ||
      model.getAlternativeVersionId() !== alternativeVersionId
    ) {
      return null;
    }
    return Object.freeze({
      alternativeVersionId,
      modelVersionId,
      utf16Length,
    });
  } catch {
    return null;
  }
}

function assertExpectation(
  expectation: LiveDocumentSnapshotReadExpectation,
  modelAuthority: object,
  sourceAuthority: object,
): void {
  if (
    expectation.modelAuthority !== modelAuthority ||
    expectation.sourceAuthority !== sourceAuthority ||
    !positive(expectation.modelVersionId) ||
    !positive(expectation.alternativeVersionId) ||
    !nonNegative(expectation.utf16Length) ||
    !nonNegative(expectation.maxUtf16Units)
  ) {
    throw new Error("Invalid Monaco snapshot read expectation");
  }
}

function metadataMatchesExpectation(
  metadata: MonacoModelSnapshotMetadata,
  expectation: LiveDocumentSnapshotReadExpectation,
): boolean {
  return (
    metadata.modelVersionId === expectation.modelVersionId &&
    metadata.alternativeVersionId === expectation.alternativeVersionId &&
    metadata.utf16Length === expectation.utf16Length
  );
}

function sameMetadata(
  left: MonacoModelSnapshotMetadata,
  right: MonacoModelSnapshotMetadata,
): boolean {
  return (
    left.modelVersionId === right.modelVersionId &&
    left.alternativeVersionId === right.alternativeVersionId &&
    left.utf16Length === right.utf16Length
  );
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

const UNAVAILABLE_PROBE = Object.freeze({
  status: "unavailable",
}) satisfies LiveDocumentSnapshotSourceProbe;
