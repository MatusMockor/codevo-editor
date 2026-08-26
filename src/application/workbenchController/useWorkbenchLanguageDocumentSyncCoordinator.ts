import { configureReplacedGitDiffDocumentClose } from "../configureReplacedGitDiffDocumentClose";
import { useDocumentSync } from "../useDocumentSync";
import { useJavaScriptTypeScriptIncrementalSyncComposition } from "../useJavaScriptTypeScriptIncrementalSyncComposition";
import { usePhpLanguageServerIndexWarmup } from "../usePhpLanguageServerIndexWarmup";

type DocumentSyncDependencies = Omit<
  Parameters<typeof useDocumentSync>[0],
  "warmUpPhpLanguageServerIndex"
>;
type IncrementalSyncDependencies = Omit<
  Parameters<typeof useJavaScriptTypeScriptIncrementalSyncComposition>[0],
  "isHandoffSafe" | "retireForHandoff" | "syncOpen"
>;
type ReplacedGitDiffCloseDependencies = Omit<
  Parameters<typeof configureReplacedGitDiffDocumentClose>[0],
  "syncJavaScriptTypeScript" | "syncPhp"
>;

export interface WorkbenchLanguageDocumentSyncCoordinatorDependencies {
  readonly documentSync: DocumentSyncDependencies;
  readonly incrementalSync: IncrementalSyncDependencies;
  readonly replacedGitDiffClose: ReplacedGitDiffCloseDependencies;
  readonly warmup: Parameters<typeof usePhpLanguageServerIndexWarmup>[0];
}

export type WorkbenchLanguageDocumentSyncCoordinator = Readonly<ReturnType<typeof useDocumentSync>>;

export function useWorkbenchLanguageDocumentSyncCoordinator({
  documentSync,
  incrementalSync,
  replacedGitDiffClose,
  warmup,
}: WorkbenchLanguageDocumentSyncCoordinatorDependencies): WorkbenchLanguageDocumentSyncCoordinator {
  const warmUpPhpLanguageServerIndex = usePhpLanguageServerIndexWarmup(warmup);
  const synchronization = useDocumentSync({
    ...documentSync,
    warmUpPhpLanguageServerIndex,
  });
  useJavaScriptTypeScriptIncrementalSyncComposition({
    ...incrementalSync,
    isHandoffSafe: synchronization.isJavaScriptTypeScriptLegacyHandoffSafe,
    retireForHandoff: synchronization.retireLegacyJavaScriptTypeScriptDocumentForIncrementalHandoff,
    syncOpen: synchronization.syncOpenJavaScriptTypeScriptDocument,
  });
  configureReplacedGitDiffDocumentClose({
    ...replacedGitDiffClose,
    syncJavaScriptTypeScript: synchronization.syncClosedJavaScriptTypeScriptDocument,
    syncPhp: synchronization.syncClosedDocument,
  });
  return synchronization;
}
