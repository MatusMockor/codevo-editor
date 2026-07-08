import type * as Monaco from "monaco-editor";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "../application/phpCodeActionTypes";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

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

export interface TemplateLanguageMonacoProviderContext {
  getActiveDocument(): EditorDocument | null;
  getUserSnippets?(): readonly UserSnippet[];
  getWorkspaceRoot?(): string | null;
  provideBladeDefinition?(source: string, offset: number): Promise<boolean>;
  provideBladeCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<BladeCompletion[]>;
  provideBladeCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideLatteDefinition?(source: string, offset: number): Promise<boolean>;
  provideLatteCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<LatteCompletion[]>;
  provideNeonDefinition?(source: string, offset: number): Promise<boolean>;
  provideNeonCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<NeonCompletion[]>;
  reportError(error: unknown): void;
}

export interface TemplateLanguageMonacoProviderHandlers<
  Context extends TemplateLanguageMonacoProviderContext,
> {
  provideBladeCodeActions(
    monaco: MonacoApi,
    context: Context,
    model: MonacoModel,
    range: Monaco.Range,
    actionContext: Monaco.languages.CodeActionContext,
  ): Promise<Monaco.languages.CodeActionList>;
  provideBladeCompletionItems(
    monaco: MonacoApi,
    context: Context,
    model: MonacoModel,
    position: MonacoPosition,
  ): Promise<Monaco.languages.CompletionList>;
  provideBladeDefinition(
    context: Context,
    model: MonacoModel,
    position: MonacoPosition,
  ): Promise<Monaco.languages.Location[] | null>;
  provideLatteCompletionItems(
    monaco: MonacoApi,
    context: Context,
    model: MonacoModel,
    position: MonacoPosition,
  ): Promise<Monaco.languages.CompletionList>;
  provideLatteDefinition(
    context: Context,
    model: MonacoModel,
    position: MonacoPosition,
  ): Promise<Monaco.languages.Location[] | null>;
  provideNeonCompletionItems(
    monaco: MonacoApi,
    context: Context,
    model: MonacoModel,
    position: MonacoPosition,
  ): Promise<Monaco.languages.CompletionList>;
  provideNeonDefinition(
    context: Context,
    model: MonacoModel,
    position: MonacoPosition,
  ): Promise<Monaco.languages.Location[] | null>;
}

export function registerTemplateLanguageMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const bladeDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("blade", {
        provideDefinition: (model, position) =>
          handlers.provideBladeDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const bladeCompletion = monaco.languages.registerCompletionItemProvider(
    "blade",
    {
      // `$` opens the view-variable list and `>` completes `->` member access
      // during natural typing.
      triggerCharacters: ["@", "'", "\"", "-", ".", "$", ">"],
      provideCompletionItems: (model, position) =>
        handlers.provideBladeCompletionItems(monaco, context, model, position),
    },
  );
  const bladeCodeActions = context.provideBladeCodeActions
    ? monaco.languages.registerCodeActionProvider(
        "blade",
        {
          provideCodeActions: (model, range, actionContext) =>
            handlers.provideBladeCodeActions(
              monaco,
              context,
              model,
              range,
              actionContext,
            ),
        },
        { providedCodeActionKinds: ["quickfix"] },
      )
    : { dispose: () => undefined };
  const latteDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("latte", {
        provideDefinition: (model, position) =>
          handlers.provideLatteDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const latteCompletion = monaco.languages.registerCompletionItemProvider(
    "latte",
    {
      triggerCharacters: ["{", "$", "-", ">", "|", "'", "\"", ".", "/"],
      provideCompletionItems: (model, position) =>
        handlers.provideLatteCompletionItems(monaco, context, model, position),
    },
  );
  const neonDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("neon", {
        provideDefinition: (model, position) =>
          handlers.provideNeonDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const neonCompletion = monaco.languages.registerCompletionItemProvider(
    "neon",
    {
      triggerCharacters: ["\\", ":", " ", "-", "%", "@"],
      provideCompletionItems: (model, position) =>
        handlers.provideNeonCompletionItems(monaco, context, model, position),
    },
  );

  return {
    dispose: () => {
      bladeDefinition.dispose();
      bladeCompletion.dispose();
      bladeCodeActions.dispose();
      latteDefinition.dispose();
      latteCompletion.dispose();
      neonDefinition.dispose();
      neonCompletion.dispose();
    },
  };
}
