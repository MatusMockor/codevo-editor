import type * as Monaco from "monaco-editor";
import type { AppliedJavaScriptTypeScriptWorkspaceEditCommit } from "./javascriptTypescriptWorkspaceEditApplication";

export interface JavaScriptTypeScriptWorkspaceEditCommitReceipt {
  active: boolean;
  readonly content: string;
  readonly model: Monaco.editor.ITextModel;
  readonly modelVersion: number;
  readonly ownerEpoch: number;
  readonly ownerIdentity: object;
  readonly path: string;
}

export function createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
  authority: { readonly model: Monaco.editor.ITextModel; readonly path: string } | undefined,
  path: string | undefined,
  ownerEpoch: number,
  ownerIdentity: object | null,
  commit: AppliedJavaScriptTypeScriptWorkspaceEditCommit,
): JavaScriptTypeScriptWorkspaceEditCommitReceipt | null {
  const document = commit.documents[0];
  if (
    !authority ||
    !path ||
    !ownerIdentity ||
    commit.documents.length !== 1 ||
    !document ||
    document.path !== path ||
    authority.model.getVersionId() !== document.versionId ||
    authority.model.getValue() !== document.content
  ) {
    return null;
  }

  return {
    active: true,
    content: document.content,
    model: authority.model,
    modelVersion: document.versionId,
    ownerEpoch,
    ownerIdentity,
    path,
  };
}

export function isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive(
  receipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt,
  ownerEpoch: number,
  ownerIdentity: object | null,
  authorityIsActive: () => boolean,
): boolean {
  return (
    receipt.active &&
    receipt.model.getVersionId() === receipt.modelVersion &&
    receipt.model.getValue() === receipt.content &&
    ownerIdentity === receipt.ownerIdentity &&
    (ownerEpoch === receipt.ownerEpoch || ownerEpoch === receipt.ownerEpoch + 1) &&
    authorityIsActive()
  );
}

export function consumeJavaScriptTypeScriptWorkspaceEditCommitReceipt(
  receipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt,
  ownerEpoch: number,
  ownerIdentity: object | null,
  authorityIsActive: () => boolean,
): boolean {
  const active = isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive(
    receipt,
    ownerEpoch,
    ownerIdentity,
    authorityIsActive,
  );
  receipt.active = false;
  return active;
}
