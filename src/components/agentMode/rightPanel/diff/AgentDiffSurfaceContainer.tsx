import { Suspense, lazy } from "react";
import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import type { GitChangedFile } from "../../../../domain/git";
import { inlineDiffViewGateway } from "../../../../infrastructure/inlineDiffViewGateway";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentDiffSurface } from "./AgentDiffSurface";
import { useAgentDiffSurfaceSource } from "./useAgentDiffSurfaceSource";

const LazyAgentSurfaceDiff = lazy(() =>
  import("../../AgentSurfaceDiff").then((module) => ({ default: module.AgentSurfaceDiff })),
);

export function AgentDiffSurfaceContainer() {
  const context = useAgentRightPanelContext();
  const model = useAgentDiffSurfaceSource(context);
  const { agents, chrome, legacyWorkingTreeDiff, thread } = context;
  const openFile = (file: AgentDiffFile) => {
    const root = file.repositoryRoot;
    if (root === null) return;
    if (thread === null) {
      context.openFile(joinPath(root, file.relativePath));
      return;
    }
    const change = gitChange(root, file);
    if (context.diffScope.kind === "workingTree") {
      void agents.openChangedFileDiff(thread.thread.threadId, change);
      return;
    }
    void agents.openChangedFile(thread.thread.threadId, change);
  };
  return (
    <AgentDiffSurface
      choices={model.choices}
      computation={chrome?.gateways.diffComputation ?? inlineDiffViewGateway}
      emptyReason={model.emptyReason}
      reveal={model.reveal}
      warning={model.warning}
      onOpenFile={openFile}
      onRefresh={model.refresh}
      onScopeChange={context.onDiffScopeChange}
      replacementBody={
        model.remoteWorkingTree && legacyWorkingTreeDiff !== null && thread !== null ? (
          <Suspense fallback={<p className="cv-rp-note">Loading the diff…</p>}>
            <LazyAgentSurfaceDiff {...legacyWorkingTreeDiff} thread={thread} />
          </Suspense>
        ) : null
      }
      scope={context.diffScope}
      scopeLabel={model.scopeLabel}
      source={model.source}
    />
  );
}

function gitChange(root: string, file: AgentDiffFile): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: file.status === "untracked",
    oldPath: file.oldRelativePath === null ? null : joinPath(root, file.oldRelativePath),
    oldRelativePath: file.oldRelativePath,
    path: joinPath(root, file.relativePath),
    relativePath: file.relativePath,
    status: file.status,
  };
}

function joinPath(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/, "")}/${relativePath}`;
}
