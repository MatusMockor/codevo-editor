import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type {
  PhpFrameworkProvider,
  PhpFrameworkViewDataEntry,
} from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { LatteCompletionItem } from "./latteCompletionItems";
import type { LatteDirectoryEntry } from "./netteTemplateDiscovery";
import type { NavigationRequest } from "./navigationRequest";
import type {
  PhpCodeActionContext,
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

/** The minimal shape of the active editor document the hook reads (its path). */
export interface LatteIntelligenceActiveDocument {
  path: string;
}

/**
 * The injected surface Latte intelligence needs. Every member is a value or a
 * tiny function so the logic can be exercised with plain fakes - no controller,
 * no Monaco, no React.
 */
export interface LatteIntelligenceDependencies {
  /** Live workspace root, read AFTER each await to drop stale results. */
  collectTranslationTargets: PhpFrameworkTargets["collectTranslationTargets"];
  currentWorkspaceRootRef: { readonly current: string | null };
  findTranslationTarget: PhpFrameworkTargets["findTranslationTarget"];
  frameworkIntelligence: PhpFrameworkIntelligence;
  getActiveDocument(): LatteIntelligenceActiveDocument | null;
  isSemanticIntelligenceActive: boolean;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  openPhpMethodTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpPropertyTarget(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  readPhpClassSource?(
    className: string,
  ): Promise<{ path: string; source: string } | null>;
  resolvePhpClassSourcePaths?(
    className: string,
  ): Promise<readonly string[]>;
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
  resolveExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  searchText(
    rootPath: string,
    query: string,
    maxResults: number,
  ): Promise<{ path: string }[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
  toRelativePath(rootPath: string, path: string): string;
  /** The requested workspace root, captured up front by each async flow. */
  workspaceRoot: string | null;
}

export interface LatteDefinitionOutcome {
  handled: boolean;
  shouldBlockFallback: boolean;
}

export interface LatteIntelligence {
  collectCompleteLatteTemplateRelativePaths(): Promise<readonly string[]>;
  collectLatteTemplateRelativePaths(): Promise<readonly string[]>;
  invalidateLatteExpressionDataForPath(rootPath: string, path: string): void;
  invalidateNeonConfigForPath(rootPath: string, path: string): void;
  provideLatteCodeActions(
    source: string,
    range: PhpCodeActionRange,
    context?: PhpCodeActionContext,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]>;
  provideLatteDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  provideLatteDefinitionOutcome(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<LatteDefinitionOutcome>;
  provideLattePresenterLinkDiagnostics(
    source: string,
    currentTemplateRelativePath: string,
  ): Promise<LanguageServerDiagnostic[]>;
  providePhpPresenterLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  isPhpPresenterLinkCompletionContext(source: string, offset: number): boolean;
  /**
   * @deprecated Use {@link providePhpPresenterLinkDefinition}. Kept as a
   * temporary compatibility alias while Nette-specific callers migrate.
   */
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkCompletions}. Kept as a
   * temporary compatibility alias while Nette-specific callers migrate.
   */
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
}

export interface LattePresenterLinkDetection {
  target: string;
  targetEnd: number;
  targetStart: number;
}

export interface LattePresenterLinkCompletionContext {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

export interface LattePresenterLinkTarget {
  absolute: boolean;
  action: string;
  isSignal: boolean;
  module: string | null;
  presenter: string | null;
}

export interface LatteFrameworkCapabilities {
  supportsFactoryTemplateOwnerIntelligence(): boolean;
  detectLattePresenterLinkAt(
    source: string,
    offset: number,
  ): LattePresenterLinkDetection | null;
  lattePresenterLinkCompletionContextAt(
    source: string,
    offset: number,
  ): LattePresenterLinkCompletionContext | null;
  parsePresenterLinkTarget(target: string): LattePresenterLinkTarget | null;
  presenterActionMethodCandidates(
    action: string,
    isSignal: boolean,
  ): string[];
  presenterClassCandidatePathsForLink(
    target: LattePresenterLinkTarget,
    currentRelativePath: string,
  ): string[];
  presenterLinkTargetsFromSource(path: string, source: string): string[];
  presenterScanDirectories: readonly string[];
  isPresenterSourcePath(path: string): boolean;
  viewDataEntryFromSource(
    source: string,
    providers: readonly PhpFrameworkProvider[],
  ): PhpFrameworkViewDataEntry | null;
  viewDataSearchQueries(
    providers: readonly PhpFrameworkProvider[],
  ): readonly string[];
}
