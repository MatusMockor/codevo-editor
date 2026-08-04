import type { OwnedEditorChangeHunksState } from "../application/useOwnedEditorChangeHunks";
import type { LargeSmartDocumentStatus } from "../domain/largeDocumentPolicy";

export const SEMANTIC_HIGHLIGHTING_DISABLED_REASON =
  "Semantic highlighting is disabled for this file.";

const reportedLargeDocumentStatuses = new WeakMap<
  LargeSmartDocumentStatus,
  LargeSmartDocumentStatus
>();

export function editorChangeHunksStatus(
  largeDocumentStatus: LargeSmartDocumentStatus | null,
  changeHunksState: OwnedEditorChangeHunksState,
): LargeSmartDocumentStatus | null {
  if (largeDocumentStatus) {
    return reportedLargeDocumentStatus(largeDocumentStatus);
  }
  if (changeHunksState.status === "degraded") {
    return {
      label: "Change markers limited",
      title:
        "Change markers are disabled because the current or saved file exceeds the configured large-file limit.",
    };
  }
  if (changeHunksState.status === "error") {
    return {
      label: "Change markers unavailable",
      title: changeHunksState.message,
    };
  }
  return null;
}

function reportedLargeDocumentStatus(status: LargeSmartDocumentStatus): LargeSmartDocumentStatus {
  const reported = reportedLargeDocumentStatuses.get(status);
  if (reported) {
    return reported;
  }

  const augmented: LargeSmartDocumentStatus = Object.freeze({
    label: status.label,
    title: `${status.title} ${SEMANTIC_HIGHLIGHTING_DISABLED_REASON}`,
  });
  reportedLargeDocumentStatuses.set(status, augmented);

  return augmented;
}
