import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { NeonCompletionItem } from "./neonCompletionItems";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

/** The minimal shape of the active editor document the hook reads (its path). */
export interface NeonIntelligenceActiveDocument {
  path: string;
}

/** A workspace directory entry, narrowed to what the `.neon` config scan needs. */
export interface NeonDirectoryEntry {
  kind: "directory" | "file";
  path: string;
}

/**
 * The injected surface the NEON provider flow needs. Every member is a value or
 * a tiny function so the logic can be exercised with plain fakes - no
 * controller, no Monaco, no React.
 */
export interface NeonIntelligenceDependencies {
  /** Live workspace root, read AFTER each await to drop stale results. */
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkIntelligence: PhpFrameworkIntelligence;
  getActiveDocument(): NeonIntelligenceActiveDocument | null;
  isSemanticIntelligenceActive: boolean;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<NeonDirectoryEntry[]>;
  openClassTarget(className: string): Promise<boolean>;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  searchClassNames(
    rootPath: string,
    prefix: string,
    maxResults: number,
  ): Promise<string[]>;
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
  toRelativePath(rootPath: string, path: string): string;
  /** The requested workspace root, captured up front by each async flow. */
  workspaceRoot: string | null;
}

export interface NeonIntelligence {
  provideNeonCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]>;
  provideNeonDefinition(source: string, offset: number): Promise<boolean>;
}
