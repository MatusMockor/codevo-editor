import { memo, type ComponentProps } from "react";
import type { AgentThreadBranchMemory } from "../../../domain/agentThreadBranchMemory";
import type { AgentWorkbenchLayout } from "../../../domain/agentWorkbenchLayout";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentRailResizeHandle } from "../AgentRailResizeHandle";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentThreadsSidebar } from "../AgentThreadsSidebar";
import { AgentThreadBranchMemoryContext } from "../agentThreadBranchMemoryContext";

export type AgentModeRailProps = ComponentProps<typeof AgentThreadsSidebar> & {
  readonly rail: AgentWorkbenchLayout["rail"];
  readonly railWidth: number;
  readonly resetThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly branchMemory: AgentThreadBranchMemory;
  onResetRailWidth(): void;
  onResizeRail(width: number): void;
};

export const AgentModeRail = memo(function AgentModeRail({
  rail,
  railWidth,
  resetThreadId,
  selectedServerId,
  textClipboard,
  branchMemory,
  onResetRailWidth,
  onResizeRail,
  ...sidebar
}: AgentModeRailProps) {
  return (
    <>
      {rail === "collapsed" ? null : (
        <AgentRegionBoundary
          clipboard={textClipboard}
          region="sidebar"
          resetKeys={[resetThreadId, selectedServerId, sidebar.scope?.projectRootKey ?? null]}
        >
          <AgentThreadBranchMemoryContext.Provider value={branchMemory}>
            <AgentThreadsSidebar {...sidebar} />
          </AgentThreadBranchMemoryContext.Provider>
        </AgentRegionBoundary>
      )}
      {rail === "expanded" && (
        <AgentRailResizeHandle
          onReset={onResetRailWidth}
          onResize={onResizeRail}
          width={railWidth}
        />
      )}
    </>
  );
});
