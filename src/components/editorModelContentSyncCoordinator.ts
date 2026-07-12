import type * as Monaco from "monaco-editor";

export interface EditorModelContentSyncRegistration {
  activePath: string | null;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  getModel(): Monaco.editor.ITextModel | null;
  groupId: string;
  onChange(content: string): void;
}

interface Disposable {
  dispose(): void;
}

export class EditorModelContentSyncCoordinator {
  private readonly editorListeners = new Map<
    Monaco.editor.IStandaloneCodeEditor,
    Disposable
  >();
  private readonly modelListeners = new Map<Monaco.editor.ITextModel, Disposable>();
  private registrations: readonly EditorModelContentSyncRegistration[] = [];
  private focusedGroupId: string | null = null;

  update(
    registrations: readonly EditorModelContentSyncRegistration[],
    focusedGroupId: string | null,
  ): void {
    this.registrations = registrations;
    this.focusedGroupId = focusedGroupId;
    this.reconcileEditorListeners();
    this.reconcileModelListeners();
  }

  dispose(): void {
    disposeAll(this.editorListeners);
    disposeAll(this.modelListeners);
    this.registrations = [];
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
    }

    for (const editor of retainedEditors) {
      if (this.editorListeners.has(editor)) {
        continue;
      }
      this.editorListeners.set(
        editor,
        editor.onDidChangeModel(() => this.reconcileModelListeners()),
      );
    }
  }

  private reconcileModelListeners(): void {
    const retainedModels = new Set(
      this.registrations.flatMap(({ activePath, getModel }) => {
        const model = getModel();
        return activePath && model ? [model] : [];
      }),
    );

    for (const [model, listener] of this.modelListeners) {
      if (retainedModels.has(model)) {
        continue;
      }
      listener.dispose();
      this.modelListeners.delete(model);
    }

    for (const model of retainedModels) {
      if (this.modelListeners.has(model)) {
        continue;
      }
      if (typeof model.onDidChangeContent !== "function") {
        continue;
      }
      this.modelListeners.set(
        model,
        model.onDidChangeContent(() => this.routeModelChange(model)),
      );
    }
  }

  private routeModelChange(model: Monaco.editor.ITextModel): void {
    const candidates = this.registrations.filter(
      ({ activePath, getModel }) => activePath && getModel() === model,
    );
    const target =
      candidates.find(({ groupId }) => groupId === this.focusedGroupId) ??
      candidates[0];
    if (!target) {
      return;
    }

    target.onChange(model.getValue());
  }
}

function disposeAll<T>(listeners: Map<T, Disposable>): void {
  for (const listener of listeners.values()) {
    listener.dispose();
  }
  listeners.clear();
}
