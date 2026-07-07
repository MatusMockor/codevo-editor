import type { EditorPosition } from "../domain/languageServerFeatures";
import type {
  PhpFrameworkProvider,
  PhpFrameworkViewDataEntry,
} from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type {
  detectLatteLinkAt,
  detectPhpPresenterLinkAt,
  NetteLinkTarget,
  nettePresenterLinkCompletionContextAt,
} from "../domain/latteLinkNavigation";
import type { LatteCompletionItem } from "./latteCompletionItems";
import type { LatteDirectoryEntry } from "./netteTemplateDiscovery";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

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
  currentWorkspaceRootRef: { readonly current: string | null };
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
  openPhpMethodTarget(className: string, methodName: string): Promise<boolean>;
  openPhpPropertyTarget(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
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

export interface LatteIntelligence {
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]>;
  provideLatteDefinition(source: string, offset: number): Promise<boolean>;
  shouldBlockLatteDefinitionFallback(source: string, offset: number): boolean;
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
  ): Promise<boolean>;
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
}

export interface LatteFrameworkCapabilities {
  detectLattePresenterLinkAt(
    source: string,
    offset: number,
  ): ReturnType<typeof detectLatteLinkAt>;
  detectPhpPresenterLinkAt(
    source: string,
    offset: number,
  ): ReturnType<typeof detectPhpPresenterLinkAt>;
  presenterLinkCompletionContextAt(
    source: string,
    offset: number,
    language: "latte" | "php",
  ): ReturnType<typeof nettePresenterLinkCompletionContextAt>;
  parsePresenterLinkTarget(target: string): NetteLinkTarget | null;
  presenterActionMethodCandidates(
    action: string,
    isSignal: boolean,
  ): string[];
  presenterClassCandidatePathsForLink(
    target: NetteLinkTarget,
    currentRelativePath: string,
  ): string[];
  presenterLinkTargetsFromSource(path: string, source: string): string[];
  presenterScanDirectories: readonly string[];
  isPresenterSourcePath(path: string): boolean;
  supportsLattePresenterLinkIntelligence(
    providers: readonly PhpFrameworkProvider[],
  ): boolean;
  supportsLatteTemplateIntelligence(
    providers: readonly PhpFrameworkProvider[],
  ): boolean;
  viewDataEntryFromSource(
    source: string,
    providers: readonly PhpFrameworkProvider[],
  ): PhpFrameworkViewDataEntry | null;
  viewDataSearchQueries(
    providers: readonly PhpFrameworkProvider[],
  ): readonly string[];
}
