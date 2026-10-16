import { memo, type ComponentProps } from "react";
import type { AgentWorkbenchLayout } from "../../../domain/agentWorkbenchLayout";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentSurfaceHost } from "../AgentSurfaceHost";

export type AgentModeSurfaceRegionProps = ComponentProps<typeof AgentSurfaceHost> & {
  readonly mounted: boolean;
  readonly rightPanel: AgentWorkbenchLayout["rightPanel"];
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
};

export const AgentModeSurfaceRegion = memo(function AgentModeSurfaceRegion({
  mounted,
  rightPanel,
  selectedThreadId,
  selectedServerId,
  textClipboard,
  ...host
}: AgentModeSurfaceRegionProps) {
  if (!mounted) return null;
  return (
    <AgentRegionBoundary
      clipboard={textClipboard}
      hidden={host.hidden}
      region="rightPanel"
      resetKeys={[selectedThreadId, selectedServerId, host.layout.activeSurface, rightPanel]}
    >
      <AgentSurfaceHost {...host} />
    </AgentRegionBoundary>
  );
});
