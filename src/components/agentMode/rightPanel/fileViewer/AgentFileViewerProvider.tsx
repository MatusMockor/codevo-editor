import { useMemo, type ReactNode } from "react";
import type { FilePreviewReader } from "../../../../application/filePreview/filePreviewReader";
import { FilePreviewReaderContext } from "../../../../application/rightPanel/useAgentFilePreview";
import {
  AgentFileViewerSessionsContext,
  type AgentFileViewerSessions,
} from "../../../../application/rightPanel/useAgentFileViewerSessions";
import { FileViewerFontContext } from "./fileViewerFont";

export interface AgentFileViewerProviderProps {
  readonly reader: FilePreviewReader | null;
  readonly sessions: AgentFileViewerSessions;
  readonly fontFamily?: string | null;
  readonly fontSize?: number | null;
  readonly children: ReactNode;
}

export function AgentFileViewerProvider({
  children,
  fontFamily = null,
  fontSize = null,
  reader,
  sessions,
}: AgentFileViewerProviderProps) {
  const font = useMemo(() => ({ family: fontFamily, size: fontSize }), [fontFamily, fontSize]);
  return (
    <FilePreviewReaderContext.Provider value={reader}>
      <AgentFileViewerSessionsContext.Provider value={sessions}>
        <FileViewerFontContext.Provider value={font}>{children}</FileViewerFontContext.Provider>
      </AgentFileViewerSessionsContext.Provider>
    </FilePreviewReaderContext.Provider>
  );
}
