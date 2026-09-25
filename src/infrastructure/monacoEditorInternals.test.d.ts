declare module "monaco-editor/esm/vs/editor/browser/editorExtensions.js" {
  export const EditorExtensionsRegistry: {
    getEditorActions(): ReadonlyArray<{ readonly id: string }>;
    getEditorContributions(): ReadonlyArray<{ readonly id: string }>;
  };
}

declare module "monaco-editor/esm/vs/platform/commands/common/commands.js" {
  export const CommandsRegistry: {
    getCommand(id: string): unknown;
  };
}
