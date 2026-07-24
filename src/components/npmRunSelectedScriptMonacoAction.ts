import { useEffect, useRef, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { CommandContext, CommandExecutionRunner } from "../application/commandRegistry";
import type { NpmRunSelectedScriptContextCapture } from "../domain/command";
import { getFileName, type EditorDocument } from "../domain/workspace";

export const npmRunSelectedScriptMonacoActionId = "npm.runSelectedScript";

interface NpmRunSelectedScriptCaptureOptions {
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly modelMatchesDocument: (
    model: Monaco.editor.ITextModel,
    rootPath: string | null,
    documentPath: string,
  ) => boolean;
  readonly workspaceRootRef: MutableRefObject<string | null | undefined>;
}

interface NpmRunSelectedScriptActionOptions extends NpmRunSelectedScriptCaptureOptions {
  readonly keybindings?: readonly number[];
  run(capture: NpmRunSelectedScriptContextCapture): void;
}

interface UseNpmRunSelectedScriptMonacoActionOptions extends Omit<
  NpmRunSelectedScriptCaptureOptions,
  "editor"
> {
  readonly activeDocumentPath: string | null | undefined;
  readonly commandContext: CommandContext;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly keybindings: readonly number[];
  readonly runCommand?: CommandExecutionRunner;
}

export function isNpmPackageManifestPath(path: string | null | undefined): boolean {
  return typeof path === "string" && getFileName(path) === "package.json";
}

/** Captures one exact live package.json buffer/cursor tuple without requiring editor focus. */
export function captureNpmRunSelectedScriptContext({
  activeDocumentRef,
  editor,
  modelMatchesDocument,
  workspaceRootRef,
}: NpmRunSelectedScriptCaptureOptions): NpmRunSelectedScriptContextCapture | null {
  try {
    const document = activeDocumentRef.current;
    const model = editor.getModel();
    const selection = editor.getSelection();
    const rootPath = workspaceRootRef.current;
    if (
      !document ||
      document.readOnly ||
      !model ||
      !selection ||
      !rootPath ||
      !isNpmPackageManifestPath(document.path) ||
      !modelMatchesDocument(model, rootPath, document.path)
    ) {
      return null;
    }

    const modelVersion = model.getVersionId();
    const content = model.getValue();
    const anchor = {
      column: selection.selectionStartColumn,
      lineNumber: selection.selectionStartLineNumber,
    };
    const anchorOffset = model.getOffsetAt(anchor);
    const currentSelection = editor.getSelection();
    if (
      editor.getModel() !== model ||
      activeDocumentRef.current !== document ||
      workspaceRootRef.current !== rootPath ||
      model.getVersionId() !== modelVersion ||
      !currentSelection ||
      currentSelection.selectionStartLineNumber !== selection.selectionStartLineNumber ||
      currentSelection.selectionStartColumn !== selection.selectionStartColumn ||
      !Number.isSafeInteger(anchorOffset) ||
      anchorOffset < 0 ||
      anchorOffset > content.length ||
      !modelMatchesDocument(model, rootPath, document.path)
    ) {
      return null;
    }

    return Object.freeze({
      anchorOffset,
      content,
      documentPath: document.path,
      modelIdentity: model,
      modelVersion,
    });
  } catch {
    return null;
  }
}

/** Registers the official unbound npm package.json editor-context action. */
export function registerNpmRunSelectedScriptMonacoAction({
  keybindings = [],
  run,
  ...captureOptions
}: NpmRunSelectedScriptActionOptions): Monaco.IDisposable {
  return captureOptions.editor.addAction({
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1,
    id: npmRunSelectedScriptMonacoActionId,
    keybindings: [...keybindings],
    label: "Run Script",
    precondition: "!editorReadonly",
    run: () => {
      const capture = captureNpmRunSelectedScriptContext(captureOptions);
      if (capture) run(capture);
    },
  });
}

/** Owns the context-action lifetime while keeping live command context out of effect deps. */
export function useNpmRunSelectedScriptMonacoAction({
  activeDocumentPath,
  activeDocumentRef,
  commandContext,
  editor,
  keybindings,
  modelMatchesDocument,
  runCommand,
  workspaceRootRef,
}: UseNpmRunSelectedScriptMonacoActionOptions): void {
  const invocationRef = useRef({ commandContext, runCommand });
  invocationRef.current = { commandContext, runCommand };

  useEffect(() => {
    if (!editor || !isNpmPackageManifestPath(activeDocumentPath) || !runCommand) return;
    const disposable = registerNpmRunSelectedScriptMonacoAction({
      activeDocumentRef,
      editor,
      keybindings,
      modelMatchesDocument,
      run: (capture) => {
        const invocation = invocationRef.current;
        invocation.runCommand?.(npmRunSelectedScriptMonacoActionId, {
          ...invocation.commandContext,
          npmRunSelectedScriptCapture: capture,
        });
      },
      workspaceRootRef,
    });
    return () => disposable.dispose();
  }, [
    activeDocumentPath,
    activeDocumentRef,
    editor,
    keybindings,
    modelMatchesDocument,
    runCommand,
    workspaceRootRef,
  ]);
}
