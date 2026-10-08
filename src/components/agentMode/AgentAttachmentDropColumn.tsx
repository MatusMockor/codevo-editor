import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { AgentAttachmentDropOverlay } from "./AgentAttachmentDropOverlay";
import {
  AgentAttachmentDropZoneContext,
  type AgentAttachmentDropZone,
} from "./agentAttachmentDropZone";

export interface AgentAttachmentDropColumnProps {
  readonly columnRef: RefObject<HTMLDivElement | null>;
  readonly inert: boolean;
  readonly children: ReactNode;
}

export function AgentAttachmentDropColumn({
  columnRef,
  inert,
  children,
}: AgentAttachmentDropColumnProps) {
  const [overlayHolders, setOverlayHolders] = useState(0);
  const zone = useMemo<AgentAttachmentDropZone>(
    () => ({
      columnRef,
      available: !inert,
      showOverlay: () => {
        let held = true;
        setOverlayHolders((count) => count + 1);
        return () => {
          if (!held) return;
          held = false;
          setOverlayHolders((count) => count - 1);
        };
      },
    }),
    [columnRef, inert],
  );
  return (
    <div
      className="agent-mode__center agent-attachment-drop-column"
      inert={inert || undefined}
      ref={columnRef}
    >
      <AgentAttachmentDropZoneContext.Provider value={zone}>
        {children}
      </AgentAttachmentDropZoneContext.Provider>
      {!inert && overlayHolders > 0 && <AgentAttachmentDropOverlay />}
    </div>
  );
}
