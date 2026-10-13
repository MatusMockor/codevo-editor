import { memo } from "react";
import { Download, FileText } from "lucide-react";
import { Spinner } from "../../ui/foundation/Spinner";
import { useAgentTurnAttachmentDownload } from "./agentTurnAttachmentFiles";
import {
  AGENT_ATTACHMENT_DOWNLOAD_TITLE,
  AGENT_ATTACHMENT_DOWNLOADING_TITLE,
  agentAttachmentDownloadLabel,
  formatAgentAttachmentBytes,
  type AgentTurnAttachmentRemoteFileView,
} from "./agentTurnAttachmentPresentation";

export const AgentTurnAttachmentFile = memo(function AgentTurnAttachmentFile({
  attachment,
}: {
  readonly attachment: AgentTurnAttachmentRemoteFileView;
}) {
  const download = useAgentTurnAttachmentDownload(attachment.attachmentId);
  const size = formatAgentAttachmentBytes(attachment.bytes);
  const downloading = download?.downloading ?? false;

  return (
    <span className="agent-attachments__chip" data-agent-attachment="file" title={attachment.name}>
      <FileText aria-hidden="true" size={14} />
      <span className="agent-attachments__name">{attachment.name}</span>
      {size !== "" && <span className="agent-attachments__size agent-num">{size}</span>}
      {download !== null && (
        <button
          aria-busy={downloading || undefined}
          aria-disabled={downloading || undefined}
          aria-label={agentAttachmentDownloadLabel(attachment.name)}
          className="agent-attachments__download"
          onClick={download.start}
          title={downloading ? AGENT_ATTACHMENT_DOWNLOADING_TITLE : AGENT_ATTACHMENT_DOWNLOAD_TITLE}
          type="button"
        >
          {downloading ? <Spinner /> : <Download aria-hidden="true" size={14} />}
        </button>
      )}
    </span>
  );
});
