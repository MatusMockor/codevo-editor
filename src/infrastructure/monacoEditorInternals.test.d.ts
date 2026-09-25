declare module "monaco-editor/esm/vs/platform/commands/common/commands.js" {
  export const CommandsRegistry: {
    getCommand(id: string): unknown;
  };
}

declare module "monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js" {
  export const KeyCode: typeof import("monaco-editor").KeyCode;
}

declare module "monaco-editor/esm/vs/editor/common/services/editorBaseApi.js" {
  export const KeyMod: typeof import("monaco-editor").KeyMod;
}
