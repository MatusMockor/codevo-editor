import type { OwnedEditorChangeHunksState } from "../application/useOwnedEditorChangeHunks";
import type { LargeSmartDocumentStatus } from "../domain/largeDocumentPolicy";

export function editorChangeHunksStatus(
  largeDocumentStatus: LargeSmartDocumentStatus | null,
  changeHunksState: OwnedEditorChangeHunksState,
): LargeSmartDocumentStatus | null {
  if (largeDocumentStatus) {
    return largeDocumentStatus;
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
