import type * as Monaco from "monaco-editor";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpCodeActionWorkspaceEditApplier,
} from "../../application/phpCodeActionTypes";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
} from "../../application/workspaceEditApplication";
import type { LargeSmartDocumentPolicy } from "../../domain/largeDocumentPolicy";
import type {
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../../domain/languageServerFeatures";
import type { PhpParameterNameInlayHint } from "../../domain/phpInlayHints";
import type { EditorDocument } from "../../domain/workspace";
import type { PhpMethodCompletion, PhpMethodSignature } from "../../domain/phpMethodCompletions";
import type { PhpFrameworkMonacoProviderContext } from "../phpFrameworkMonacoProviders";
import type { WorkspaceIdentityDescriptor } from "../phpMonacoDocumentContext";
import type { TemplateLanguageMonacoProviderContext } from "../templateLanguageMonacoProviders";
import type { LanguageServerMonacoDocumentRequestLease } from "./providerRequestLifecycle";

type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type OpenPhpChangeSignaturePayload = NonNullable<PhpCodeActionDescriptor["interaction"]>;
type PhpWorkspaceEditApplicationContext = WorkspaceEditApplicationContext;
type PhpWorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: PhpWorkspaceEditApplicationContext,
) => Promise<WorkspaceEditApplicationDecision | void> | WorkspaceEditApplicationDecision | void;
export interface LanguageServerMonacoProviderContext
  extends TemplateLanguageMonacoProviderContext, PhpFrameworkMonacoProviderContext {
  getDocumentForModel?(model: MonacoModel): EditorDocument | null;
  getWorkspaceIdentityDescriptor?(): WorkspaceIdentityDescriptor | null;
  /**
   * Persists a PHP code action's new file (e.g. "Extract interface" writes a
   * sibling `<Class>Interface.php`) to DISK and opens it in a tab. When wired,
   * the code-action mapper routes the new file through this controller callback
   * (a monaco command) instead of monaco's in-memory file-create bulk edit, so
   * the interface is a real `.php` file that survives reopening the workspace.
   * The controller owns the gateway write, the file-tree refresh, the tab open
   * AND the per-project isolation (requested-root capture + re-check after each
   * await). RESOLVES `true` only when the file was freshly written; the command
   * applies the paired in-document edit (e.g. the `implements` clause) ONLY then,
   * so a pre-existing target or a failed write never leaves a partial class edit.
   * Omitted callers fall back to the legacy in-memory monaco file-create edit.
   */
  applyPhpCodeActionNewFile?(newFile: PhpCodeActionNewFile): Promise<boolean>;
  applyWorkspaceEdit?: PhpWorkspaceEditApplier;
  openPhpChangeSignature?(
    request: OpenPhpChangeSignaturePayload,
    applyWorkspaceEdit: PhpCodeActionWorkspaceEditApplier,
  ): void;
  clearLanguageServerDiagnosticsForPath?(path: string): void;
  coordinatePhpDocumentSymbols?(
    request: {
      content: string;
      lifecycleIdentity: number;
      path: string;
      rootPath: string;
      runtimeIdentity: object;
      sessionId: number;
    },
    load: () => ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>,
  ): ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>;
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  requestDocumentLease?(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerMonacoDocumentRequestLease | null>;
  isDocumentLeaseCurrent?(lease: LanguageServerMonacoDocumentRequestLease): boolean;
  getDocumentLifecycleIdentity?(rootPath: string, path: string): number | null;
  /**
   * Reports whether `path` has already been opened on the language server (its
   * `didOpen` was sent) for `rootPath`. Used to gate the `documentSymbol`
   * request so an outline / breadcrumb fetch never races ahead of the document
   * sync and triggers an `UnknownDocument` error. When omitted the provider
   * does not gate (the controller's `flushPendingDocumentChange` still opens the
   * document on demand for interactive requests).
   */
  isDocumentSynced?(rootPath: string, path: string): boolean;
  /**
   * Reports whether PHP inlay hints (both the managed phpactor hints and the
   * TS-domain parameter-name fallback) are enabled for the active workspace.
   * When omitted the provider treats PHP inlay hints as enabled so callers that
   * do not wire the toggle keep the prior behaviour.
   */
  isPhpInlayHintsEnabled?(): boolean;
  getLargeSmartDocumentPolicy?(): LargeSmartDocumentPolicy;
  limitNavigationResultsToOpenModels?: boolean;
  providePhpCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  providePhpMethodCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpMethodSignature?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodSignature | null>;
  /**
   * Resolves PHP parameter-name inlay hints for the call expressions whose
   * opening parenthesis sits inside `range` (a 0-based inclusive line span). The
   * controller reuses the signature-resolution flow to map parameter names onto
   * positional arguments and enforces per-project isolation (requested-root
   * capture + re-check after each await), dropping stale results on a tab
   * switch. Returns one hint per argument that should display its parameter
   * name, with 0-based `line`/`character` positions.
   */
  providePhpParameterInlayHints?(
    source: string,
    range: { endLine: number; startLine: number },
  ): Promise<PhpParameterNameInlayHint[]>;
  /**
   * Records the wall-clock latency (in milliseconds) of a PHP language-server
   * completion round-trip so it can surface in the runtime latency panel. The
   * provider calls this once per completion request it actually issues to the
   * gateway. Omitted when the host wires no latency instrumentation; the
   * provider then skips the timestamp delta entirely (no hot-path cost).
   */
  recordCompletionLatency?(durationMs: number, rootPath?: string): void;
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
}
