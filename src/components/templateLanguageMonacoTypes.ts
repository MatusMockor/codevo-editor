import type * as Monaco from "monaco-editor";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "../application/phpCodeActionTypes";
import type { NavigationRequest } from "../application/navigationRequest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;

/**
 * A single Blade completion item produced by the controller. Blade has no
 * managed language server (its syntax is Shiki's job), so completions are pure
 * data the Monaco provider maps to `Monaco.languages.CompletionItem`. The kind
 * picks the Monaco icon (directive -> keyword, view -> file, component -> field).
 */
export type BladeCompletionKind =
  | "directive"
  | "view"
  | "component"
  | "variable"
  | "helper"
  | "member";

export interface BladeCompletion {
  detail?: string;
  insertText: string;
  kind: BladeCompletionKind;
  label: string;
  /**
   * Optional 0-based character offset span the item replaces. When omitted the
   * provider falls back to the word Monaco computed at the cursor.
   */
  replaceStart?: number;
  replaceEnd?: number;
}

/**
 * The Monaco icon bucket a Latte completion maps to: a Latte tag name (`{if}`,
 * `{include}`, ...) is a keyword; a template name inside an `{include '...'}`
 * literal is a file; a `{$var}` template variable is a variable; a `{$var->}`
 * member is a field; a `|filter` name is a function.
 */
export type LatteCompletionKind =
  | "tag"
  | "template"
  | "variable"
  | "member"
  | "filter"
  | "link"
  | "component";

/**
 * A single Latte completion item produced by the controller. Like Blade, Latte
 * has no managed language server (its syntax is a vendored Shiki grammar), so
 * completions are pure data the Monaco provider maps to a
 * `Monaco.languages.CompletionItem`.
 */
export interface LatteCompletion {
  detail?: string;
  insertText: string;
  kind: LatteCompletionKind;
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export type NeonCompletionKind = "class" | "method" | "parameter" | "service";

/**
 * A single NEON completion item produced by the controller. Like Latte, NEON has
 * no managed language server (its syntax is a vendored Shiki grammar), so
 * completions are pure data the Monaco provider maps to a
 * `Monaco.languages.CompletionItem`.
 */
export interface NeonCompletion {
  detail?: string;
  insertText: string;
  kind: NeonCompletionKind;
  label: string;
  /** Optional 0-based character offset span the item replaces. */
  replaceStart?: number;
  replaceEnd?: number;
}

export interface TemplateLanguageProviderRegistry {
  blade: {
    provideCodeActions(
      source: string,
      range: PhpCodeActionRange,
    ): Promise<PhpCodeActionDescriptor[]>;
    provideCompletions(
      source: string,
      position: EditorPosition,
    ): Promise<BladeCompletion[]>;
    provideDefinition(
      source: string,
      offset: number,
      request?: NavigationRequest,
    ): Promise<boolean>;
  };
  latte: {
    provideCompletions(
      source: string,
      position: EditorPosition,
    ): Promise<LatteCompletion[]>;
    provideDefinition(
      source: string,
      offset: number,
      request?: NavigationRequest,
    ): Promise<boolean>;
  };
  neon: {
    provideCompletions(
      source: string,
      position: EditorPosition,
    ): Promise<NeonCompletion[]>;
    provideDefinition(
      source: string,
      offset: number,
      request?: NavigationRequest,
    ): Promise<boolean>;
  };
}

export interface TemplateLanguageMonacoProviderContext {
  getActiveDocument(): EditorDocument | null;
  getTemplateLanguageProviders(): TemplateLanguageProviderRegistry;
  getUserSnippets?(): readonly UserSnippet[];
  getWorkspaceRoot?(): string | null;
  reportError(error: unknown): void;
}

export interface TemplateLanguageMonacoProviderHandlers<
  Context extends TemplateLanguageMonacoProviderContext,
> {
  toCodeAction(
    monaco: MonacoApi,
    context: Context,
    model: MonacoModel,
    descriptor: PhpCodeActionDescriptor,
  ): Monaco.languages.CodeAction;
}
