declare module "monaco-editor/esm/vs/platform/contextkey/common/contextkey.js" {
  export interface ContextKeyExpression {
    serialize(): string;
  }
  export const ContextKeyExpr: {
    false(): ContextKeyExpression;
  };
}

declare module "monaco-editor/esm/vs/platform/actions/common/actions.js" {
  import type { ContextKeyExpression } from "monaco-editor/esm/vs/platform/contextkey/common/contextkey.js";

  export interface MenuItemRegistration {
    readonly command?: { readonly id: string; readonly title?: unknown };
    readonly group?: string;
    readonly order?: number;
    when?: ContextKeyExpression;
  }
  export const MenuId: { readonly EditorContext: unknown };
  export const MenuRegistry: {
    getMenuItems(id: unknown): MenuItemRegistration[];
  };
}

declare module "monaco-editor/esm/vs/platform/keybinding/common/keybindingsRegistry.js" {
  import type { ContextKeyExpression } from "monaco-editor/esm/vs/platform/contextkey/common/contextkey.js";
  import type { MonacoKeybinding } from "monaco-editor/esm/vs/base/common/keybindings.js";

  export interface KeybindingRegistration {
    readonly command: string | null;
    readonly keybinding: MonacoKeybinding | null;
    readonly weight1: number;
    when?: ContextKeyExpression | null;
  }
  export const KeybindingsRegistry: {
    getDefaultKeybindings(): readonly KeybindingRegistration[];
  };
}

declare module "monaco-editor/esm/vs/base/common/keybindings.js" {
  export interface MonacoKeybindingChord {
    equals(other: MonacoKeybindingChord): boolean;
  }
  export interface MonacoKeybinding {
    readonly chords: readonly MonacoKeybindingChord[];
  }
  export function decodeKeybinding(keybinding: number, os: number): MonacoKeybinding | null;
}

declare module "monaco-editor/esm/vs/base/common/platform.js" {
  export const OS: number;
}

declare module "monaco-editor/esm/vs/base/common/uri.js" {
  export const URI: {
    parse(value: string): { toString(skipEncoding?: boolean): string };
  };
}

declare module "monaco-editor/esm/vs/editor/browser/editorExtensions.js" {
  export interface EditorActionTarget {
    getAction(id: string): { run(args?: unknown): Promise<void> } | null;
  }
  export interface EditorActionRegistration {
    readonly id: string;
    run(accessor: unknown, editor: EditorActionTarget, args?: unknown): void | Promise<void>;
  }
  export const EditorExtensionsRegistry: {
    getEditorActions(): readonly EditorActionRegistration[];
    getEditorContributions(): ReadonlyArray<{ readonly id: string }>;
  };
}
