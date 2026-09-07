import type { DocumentSessionMutationResult } from "../domain/documentSession";
import type { EditorDocument } from "../domain/workspace";
import { snapshotSaveAcknowledgement } from "./documentSessionLiveSavePermit";
import { estimatedDocumentBytes, freezeDocument } from "./documentSessionStoreValue";

type Rejection = Extract<DocumentSessionMutationResult, { status: "rejected" }>;
export function prepareDocumentSessionCleanRefresh(input: {
  readonly content: string;
  readonly revision: EditorDocument["revision"];
  readonly document: Readonly<EditorDocument>;
  readonly dirty: boolean;
  readonly mode: "clean-refresh" | "discard-reload";
  readonly saveInFlight: boolean;
  readonly retainedBytes: number;
  readonly byteLimit: number;
  readonly admitBytes: (bytes: number) => boolean;
}): { readonly status: "prepared"; readonly document: Readonly<EditorDocument> } | Rejection {
  const reject = (reason: Rejection["reason"]): Rejection => ({ status: "rejected", reason });
  if (input.dirty && input.mode === "clean-refresh") return reject("dirty-document");
  if (input.saveInFlight) return reject("save-in-flight");
  const acknowledgement = snapshotSaveAcknowledgement({ revision: input.revision });
  if (typeof input.content !== "string" || !acknowledgement) return reject("invalid-document");
  if (input.content.length > Math.floor(input.byteLimit / 4)) return reject("content-budget");
  const document = freezeDocument({
    ...input.document,
    content: input.content,
    savedContent: input.content,
    revision: acknowledgement.revision,
  });
  const additionalBytes = estimatedDocumentBytes(document) - input.retainedBytes;
  if (additionalBytes > 0 && !input.admitBytes(additionalBytes)) return reject("content-budget");
  return { status: "prepared", document };
}
