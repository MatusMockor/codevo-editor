import { Paperclip } from "lucide-react";
import "./agentAttachmentDropOverlay.css";

export const AGENT_ATTACHMENT_DROP_OVERLAY_LABEL = "Drop files to attach";

const FRAME_CORNER_RADIUS = 12;

export function AgentAttachmentDropOverlay() {
  return (
    <div className="agent-attachment-drop-overlay" data-agent-attachment-drop-overlay="active">
      <svg className="agent-attachment-drop-overlay__frame" aria-hidden="true" focusable="false">
        <rect width="100%" height="100%" rx={FRAME_CORNER_RADIUS} />
      </svg>
      <div className="agent-attachment-drop-overlay__pill" role="status">
        <Paperclip aria-hidden="true" size={14} strokeWidth={1.5} />
        {AGENT_ATTACHMENT_DROP_OVERLAY_LABEL}
      </div>
    </div>
  );
}
