import type * as Monaco from "monaco-editor";
import type {
  LiveModelRevision,
  LiveModelSourceHandle,
} from "../application/liveModelIngressCoordinator";
import type { IncrementalDocumentContentEvent } from "../domain/incrementalDocumentSync";
import type { LiveDocumentContentChangeEvent } from "../domain/liveDocumentContentAuthority";
import {
  AUTHORITATIVE_EDITOR_LIVE_EDIT,
  LEGACY_REQUIRED_EDITOR_LIVE_EDIT,
  editorLiveEditIsAuthoritative,
  type EditorLiveEditArbitrationReceipt,
} from "../application/editorLiveEditArbitration";

export type EditorModelContentSyncReceipt = EditorLiveEditArbitrationReceipt;

export interface EditorModelLiveRevision {
  readonly contentEvent: IncrementalDocumentContentEvent;
  readonly groupId: string;
  readonly path: string;
  readonly sourceHandleAuthority: object;
  readonly revision: LiveModelRevision;
}

export interface EditorModelContentSyncRegistration {
  activePath: string | null;
  boundModel?: Monaco.editor.ITextModel | null;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  getModel(): Monaco.editor.ITextModel | null;
  groupId: string;
  liveIngress?: LiveModelSourceHandle | null;
  modelBindingAuthority?: object | null;
  onChange(content: string): boolean | void;
  onLiveRevision?(revision: EditorModelLiveRevision): EditorModelContentSyncReceipt;
}

interface Disposable {
  dispose(): void;
}

interface OwnedModelContentListener extends Disposable {
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
}

interface RecordedLiveRevision {
  readonly channelAuthority: object;
  readonly contentEvent: IncrementalDocumentContentEvent;
  readonly modelAuthority: object;
  readonly revision: LiveModelRevision;
}

export class EditorModelContentSyncCoordinator {
  private readonly editorListeners = new Map<Monaco.editor.IStandaloneCodeEditor, Disposable>();
  private readonly modelListeners = new Map<Monaco.editor.ITextModel, OwnedModelContentListener>();
  private readonly suspendedEditors = new Set<Monaco.editor.IStandaloneCodeEditor>();
  private readonly registrationsByModel = new Map<
    Monaco.editor.ITextModel,
    readonly EditorModelContentSyncRegistration[]
  >();
  private registrations: readonly EditorModelContentSyncRegistration[] = [];
  private focusedGroupId: string | null = null;

  update(
    registrations: readonly EditorModelContentSyncRegistration[],
    focusedGroupId: string | null,
  ): void {
    this.registrations = registrations;
    this.focusedGroupId = focusedGroupId;
    for (const registration of registrations) {
      const { boundModel, editor, modelBindingAuthority } = registration;
      if (editor && boundModel && modelBindingAuthority && editor.getModel() === boundModel) {
        this.suspendedEditors.delete(editor);
      }
    }
    this.reconcileEditorListeners();
    this.reconcileModelListeners();
  }

  dispose(): void {
    disposeAll(this.editorListeners);
    disposeAll(this.modelListeners);
    this.registrations = [];
    this.registrationsByModel.clear();
    this.suspendedEditors.clear();
  }

  private reconcileEditorListeners(): void {
    const retainedEditors = new Set(
      this.registrations.flatMap(({ editor }) => (editor ? [editor] : [])),
    );

    for (const [editor, listener] of this.editorListeners) {
      if (retainedEditors.has(editor)) {
        continue;
      }
      listener.dispose();
      this.editorListeners.delete(editor);
      this.suspendedEditors.delete(editor);
    }

    for (const editor of retainedEditors) {
      if (this.editorListeners.has(editor)) {
        continue;
      }
      let active = true;
      const subscription = editor.onDidChangeModel(() => {
        if (!active) {
          return;
        }
        this.suspendedEditors.add(editor);
        this.reconcileModelListeners();
      });
      this.editorListeners.set(editor, {
        dispose: () => {
          active = false;
          subscription.dispose();
        },
      });
    }
  }

  private reconcileModelListeners(): void {
    const registrationsByModel = new Map<
      Monaco.editor.ITextModel,
      EditorModelContentSyncRegistration[]
    >();
    for (const registration of this.registrations) {
      const { activePath, boundModel, editor, getModel, modelBindingAuthority } = registration;
      if (!activePath || (editor && this.suspendedEditors.has(editor))) {
        continue;
      }
      const hasExactBinding = boundModel !== undefined;
      const model = hasExactBinding ? boundModel : getModel();
      if (!model) {
        continue;
      }
      if (hasExactBinding && (!editor || editor.getModel() !== model || !modelBindingAuthority)) {
        continue;
      }
      const candidates = registrationsByModel.get(model) ?? [];
      candidates.push(registration);
      registrationsByModel.set(model, candidates);
    }
    this.registrationsByModel.clear();
    for (const [model, registrations] of registrationsByModel) {
      this.registrationsByModel.set(model, registrations);
    }

    for (const [model, listener] of this.modelListeners) {
      const candidates = registrationsByModel.get(model);
      if (candidates?.some(({ editor }) => editor === listener.editor)) {
        continue;
      }
      listener.dispose();
      this.modelListeners.delete(model);
    }

    for (const [model, registrations] of registrationsByModel) {
      if (this.modelListeners.has(model)) {
        continue;
      }
      const owner = registrations.find(
        (
          registration,
        ): registration is EditorModelContentSyncRegistration & {
          editor: Monaco.editor.IStandaloneCodeEditor;
        } => registration.editor !== null,
      )?.editor;
      if (!owner || typeof owner.onDidChangeModelContent !== "function") {
        continue;
      }
      const subscription = owner.onDidChangeModelContent((event) =>
        this.routeModelChange(model, event),
      );
      this.modelListeners.set(
        model,
        Object.freeze({
          dispose: () => subscription.dispose(),
          editor: owner,
        }),
      );
    }
  }

  private routeModelChange(
    model: Monaco.editor.ITextModel,
    event: Monaco.editor.IModelContentChangedEvent,
  ): void {
    const candidates = this.registrationsByModel.get(model) ?? [];
    const target =
      candidates.find(({ groupId }) => groupId === this.focusedGroupId) ?? candidates[0];
    if (!target) {
      return;
    }

    const recordedRevision = this.recordLiveModelChange(model, event, candidates);
    const receipt = recordedRevision
      ? this.publishLiveRevision(model, recordedRevision)
      : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    if (editorLiveEditIsAuthoritative(receipt)) {
      return;
    }
    this.publishLegacyModelChange(model, target);
  }

  private recordLiveModelChange(
    model: Monaco.editor.ITextModel,
    event: Monaco.editor.IModelContentChangedEvent,
    candidates: readonly EditorModelContentSyncRegistration[],
  ): RecordedLiveRevision | null {
    const attemptedHandles = new Set<object>();
    const handles: {
      readonly handle: LiveModelSourceHandle;
      readonly channelAuthority: object;
      readonly handleAuthority: object;
      readonly modelAuthority: object;
    }[] = [];
    for (const candidate of candidates) {
      try {
        const handle = candidate.liveIngress;
        if (!handle) {
          continue;
        }
        const handleAuthority = handle.handleAuthority;
        if (attemptedHandles.has(handleAuthority)) {
          continue;
        }
        attemptedHandles.add(handleAuthority);
        handles.push({
          channelAuthority: handle.channelAuthority,
          handle,
          handleAuthority,
          modelAuthority: handle.modelAuthority,
        });
      } catch {
        // Malformed shadow registrations must not affect legacy editing.
      }
    }
    if (handles.length === 0) {
      return null;
    }

    const copiedEvent = copyMonacoContentEvent(model, event);
    const incrementalEvent = incrementalContentEvent(model, copiedEvent);
    for (const candidate of handles) {
      try {
        const receipt = candidate.handle.recordChange(copiedEvent);
        if (receipt.status === "committed") {
          return Object.freeze({
            channelAuthority: candidate.channelAuthority,
            contentEvent: incrementalEvent,
            modelAuthority: candidate.modelAuthority,
            revision: receipt.revision,
          });
        }
      } catch {
        // Shadow ingress must never suppress the legacy full-content path.
      }
    }
    return null;
  }

  private publishLiveRevision(
    model: Monaco.editor.ITextModel,
    committed: RecordedLiveRevision,
  ): EditorModelContentSyncReceipt {
    try {
      const candidates = this.registrationsByModel.get(model) ?? [];
      const target =
        candidates.find(({ groupId }) => groupId === this.focusedGroupId) ?? candidates[0];
      if (!target) {
        return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
      }
      const targetIngress = target.liveIngress;
      const onLiveRevision = target.onLiveRevision;
      const path = target.activePath;
      if (!targetIngress || !onLiveRevision || !path) {
        return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
      }
      if (
        targetIngress.channelAuthority !== committed.channelAuthority ||
        targetIngress.modelAuthority !== committed.modelAuthority
      ) {
        return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
      }
      const targetRevision = targetIngress.currentRevision();
      if (!targetRevision || !sameLiveRevision(targetRevision, committed.revision)) {
        return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
      }
      const receipt = onLiveRevision(
        Object.freeze({
          contentEvent: committed.contentEvent,
          groupId: target.groupId,
          path,
          revision: targetRevision,
          sourceHandleAuthority: targetIngress.handleAuthority,
        }),
      );
      const accepted = editorLiveEditIsAuthoritative(receipt);
      const currentCandidates = this.registrationsByModel.get(model) ?? [];
      const currentTarget =
        currentCandidates.find(({ groupId }) => groupId === this.focusedGroupId) ??
        currentCandidates[0];
      const currentIngress = target.liveIngress;
      const currentRevision = currentIngress?.currentRevision() ?? null;
      return currentTarget === target &&
        currentIngress === targetIngress &&
        target.activePath === path &&
        target.getModel() === model &&
        currentIngress.channelAuthority === committed.channelAuthority &&
        currentIngress.handleAuthority === targetIngress.handleAuthority &&
        currentIngress.modelAuthority === committed.modelAuthority &&
        currentRevision !== null &&
        sameLiveRevision(currentRevision, committed.revision) &&
        accepted
        ? AUTHORITATIVE_EDITOR_LIVE_EDIT
        : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    } catch {
      // Compact external-store observers are isolated from legacy editing.
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
  }

  private publishLegacyModelChange(
    model: Monaco.editor.ITextModel,
    target: EditorModelContentSyncRegistration,
  ): void {
    try {
      const versionId = model.getVersionId();
      const alternativeVersionId = model.getAlternativeVersionId();
      if (!this.isExactLegacyTarget(model, target, versionId, alternativeVersionId)) {
        return;
      }
      const content = model.getValue();
      if (!this.isExactLegacyTarget(model, target, versionId, alternativeVersionId)) {
        return;
      }
      target.onChange(content);
    } catch {
      // A failed or reentrant full read is stale; never retry the hot path.
    }
  }

  private isExactLegacyTarget(
    model: Monaco.editor.ITextModel,
    target: EditorModelContentSyncRegistration,
    versionId: number,
    alternativeVersionId: number,
  ): boolean {
    const candidates = this.registrationsByModel.get(model) ?? [];
    const current =
      candidates.find(({ groupId }) => groupId === this.focusedGroupId) ?? candidates[0];
    return (
      current === target &&
      target.getModel() === model &&
      model.getVersionId() === versionId &&
      model.getAlternativeVersionId() === alternativeVersionId
    );
  }
}

function sameLiveRevision(current: LiveModelRevision, expected: LiveModelRevision): boolean {
  return (
    current.alternativeVersionId === expected.alternativeVersionId &&
    current.contentVersion === expected.contentVersion &&
    current.modelVersionId === expected.modelVersionId &&
    current.utf16Length === expected.utf16Length
  );
}

function incrementalContentEvent(
  model: Monaco.editor.ITextModel,
  event: LiveDocumentContentChangeEvent,
): IncrementalDocumentContentEvent {
  return Object.freeze({
    alternativeVersionId: event.alternativeVersionId,
    changes: event.changes,
    eol: safeEol(model),
    isEolChange: event.isEolChange,
    isFlush: event.isFlush,
    isRedoing: event.isRedoing,
    isUndoing: event.isUndoing,
    versionId: event.modelVersionId,
  });
}

function safeEol(model: Monaco.editor.ITextModel): string {
  try {
    const eol = model.getEOL();
    return eol === "\r\n" ? "\r\n" : "\n";
  } catch {
    return "\n";
  }
}

function copyMonacoContentEvent(
  model: Monaco.editor.ITextModel,
  event: Monaco.editor.IModelContentChangedEvent,
): LiveDocumentContentChangeEvent {
  try {
    if (event.changes.length > MAX_COPIED_MONACO_CHANGES) {
      return Object.freeze({
        alternativeVersionId: model.getAlternativeVersionId(),
        changes: Object.freeze([]),
        isEolChange: false,
        isFlush: true,
        isRedoing: event.isRedoing,
        isUndoing: event.isUndoing,
        modelVersionId: event.versionId,
        postUtf16Length: model.getValueLength(),
      });
    }
    const changes = event.changes.slice(0, MAX_COPIED_MONACO_CHANGES).map((change) =>
      Object.freeze({
        range: Object.freeze({
          endColumn: change.range.endColumn,
          endLineNumber: change.range.endLineNumber,
          startColumn: change.range.startColumn,
          startLineNumber: change.range.startLineNumber,
        }),
        rangeLength: change.rangeLength,
        rangeOffset: change.rangeOffset,
        text: change.text,
      }),
    );
    return Object.freeze({
      alternativeVersionId: model.getAlternativeVersionId(),
      changes: Object.freeze(changes),
      isEolChange: event.isEolChange,
      isFlush: event.isFlush,
      isRedoing: event.isRedoing,
      isUndoing: event.isUndoing,
      modelVersionId: event.versionId,
      postUtf16Length: model.getValueLength(),
    });
  } catch {
    return Object.freeze({
      alternativeVersionId: safePositive(() => model.getAlternativeVersionId()),
      changes: Object.freeze([]),
      isEolChange: false,
      isFlush: true,
      isRedoing: false,
      isUndoing: false,
      modelVersionId: safePositive(() => event.versionId),
      postUtf16Length: safeNonNegative(() => model.getValueLength()),
    });
  }
}

function safePositive(read: () => number): number {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

function safeNonNegative(read: () => number): number {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

const MAX_COPIED_MONACO_CHANGES = 65;

function disposeAll<T>(listeners: Map<T, Disposable>): void {
  for (const listener of listeners.values()) {
    listener.dispose();
  }
  listeners.clear();
}
