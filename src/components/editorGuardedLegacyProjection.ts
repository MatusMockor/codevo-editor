import type * as Monaco from "monaco-editor";
import type { EditorGroupDocumentSessionAuthority } from "../application/useEditorSessionState";
import type {
  LiveModelRevision,
  LiveModelSourceHandle,
} from "../application/liveModelIngressCoordinator";
import type { EditorRuntimeSurfaceRegistration } from "./editorRuntimeContext";
import { EditorLiveDocumentBindingCoordinator } from "./editorLiveDocumentBindingCoordinator";
import { monacoModelRegistry } from "./monacoModelRegistry";

export interface GuardedLegacyProjection {
  readonly admittedContent: string | null;
  readonly alternativeVersionId: number;
  readonly document: object;
  readonly handleAuthority: object;
  readonly model: Monaco.editor.ITextModel;
  readonly modelVersionId: number;
  readonly utf16Length: number;
}

export function publishGuardedLegacyProjection(
  projections: Map<string, GuardedLegacyProjection>,
  id: string,
  handle: LiveModelSourceHandle,
  model: Monaco.editor.ITextModel,
  isCurrent: () => boolean,
  document: object,
  content: string,
  publish: () => boolean | void,
): boolean {
  try {
    const before = handle.currentRevision();
    const beforeLength = model.getValueLength();
    if (
      !before ||
      !safelyCurrent(isCurrent) ||
      before.modelVersionId !== model.getVersionId() ||
      before.alternativeVersionId !== model.getAlternativeVersionId() ||
      beforeLength !== content.length
    ) {
      return false;
    }
    projections.set(id, projection(before, handle, model, document, beforeLength, null));

    let admitted = false;
    try {
      admitted = publish() !== false;
    } catch {
      admitted = false;
    }

    const after = handle.currentRevision();
    if (!after || !safelyCurrent(isCurrent)) {
      projections.delete(id);
      return false;
    }
    const afterLength = model.getValueLength();
    const exact =
      sameRevision(after, before) &&
      after.modelVersionId === model.getVersionId() &&
      after.alternativeVersionId === model.getAlternativeVersionId() &&
      afterLength === beforeLength;
    projections.set(
      id,
      projection(after, handle, model, document, afterLength, exact && admitted ? content : null),
    );
    return exact && admitted;
  } catch {
    return false;
  }
}

export function ownsGuardedLegacyProjection(
  projections: Map<string, GuardedLegacyProjection>,
  registrations: Map<string, EditorRuntimeSurfaceRegistration>,
  liveBindingCoordinator: EditorLiveDocumentBindingCoordinator | null,
  resolveAuthority: ((groupId: string) => EditorGroupDocumentSessionAuthority | null) | undefined,
  isAuthorityCurrent: ((authority: EditorGroupDocumentSessionAuthority) => boolean) | undefined,
  groupId: string,
  path: string,
  model: Monaco.editor.ITextModel,
): boolean {
  try {
    const entry = [...registrations].find(([, registration]) => registration.groupId === groupId);
    if (!entry) return false;
    const [id, registration] = entry;
    const guarded = projections.get(id);
    const authority = resolveAuthority?.(groupId) ?? null;
    const handle = liveBindingCoordinator?.currentHandle(id) ?? null;
    const revision = handle?.currentRevision() ?? null;
    const document = registration.routing.activeDocumentRef.current;
    const registry = registration.monacoApi ? monacoModelRegistry(registration.monacoApi) : null;
    return Boolean(
      guarded &&
      authority &&
      handle &&
      revision &&
      document &&
      guarded.model === model &&
      guarded.handleAuthority === handle.handleAuthority &&
      guarded.modelVersionId === revision.modelVersionId &&
      guarded.alternativeVersionId === revision.alternativeVersionId &&
      guarded.utf16Length === model.getValueLength() &&
      model.getVersionId() === revision.modelVersionId &&
      model.getAlternativeVersionId() === revision.alternativeVersionId &&
      registration.activePath === path &&
      registration.editor?.getModel() === model &&
      document.path === path &&
      authority.path === path &&
      authority.groupId === groupId &&
      isAuthorityCurrent?.(authority) === true &&
      registry?.modelForPath(registration.workspaceRoot, path) === model &&
      registry.modelAuthority(model) === handle.modelAuthority &&
      (guarded.admittedContent === null
        ? document === guarded.document
        : document.content === guarded.admittedContent),
    );
  } catch {
    return false;
  }
}

function projection(
  revision: LiveModelRevision,
  handle: LiveModelSourceHandle,
  model: Monaco.editor.ITextModel,
  document: object,
  utf16Length: number,
  admittedContent: string | null,
): GuardedLegacyProjection {
  return {
    admittedContent,
    alternativeVersionId: revision.alternativeVersionId,
    document,
    handleAuthority: handle.handleAuthority,
    model,
    modelVersionId: revision.modelVersionId,
    utf16Length,
  };
}

function sameRevision(left: LiveModelRevision, right: LiveModelRevision): boolean {
  return (
    left.alternativeVersionId === right.alternativeVersionId &&
    left.contentVersion === right.contentVersion &&
    left.mode === right.mode &&
    left.modelVersionId === right.modelVersionId &&
    left.utf16Length === right.utf16Length
  );
}

function safelyCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent();
  } catch {
    return false;
  }
}
