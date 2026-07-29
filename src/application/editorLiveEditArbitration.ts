export type EditorLiveEditArbitrationReceipt =
  { readonly status: "authoritative" } | { readonly status: "legacy-required" };

export const AUTHORITATIVE_EDITOR_LIVE_EDIT: EditorLiveEditArbitrationReceipt = Object.freeze({
  status: "authoritative",
});
export const LEGACY_REQUIRED_EDITOR_LIVE_EDIT: EditorLiveEditArbitrationReceipt = Object.freeze({
  status: "legacy-required",
});

export function editorLiveEditIsAuthoritative(receipt: EditorLiveEditArbitrationReceipt): boolean {
  try {
    return (
      receipt !== null &&
      typeof receipt === "object" &&
      Reflect.ownKeys(receipt).length === 1 &&
      receipt.status === "authoritative"
    );
  } catch {
    return false;
  }
}
