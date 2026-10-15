import type {
  AgentFileViewerMarkdownMode,
  AgentFileViewerTarget,
} from "../../../../application/rightPanel/useAgentFileViewerSessions";
import type { CodeLanguageId } from "../../../../domain/codeHighlight/codeLanguage";
import type { FilePreview } from "../../../../domain/filePreview";
import { FileViewerCode } from "./FileViewerCode";
import { FileViewerMarkdown } from "./FileViewerMarkdown";
import { formatFileSize, truncatedPreviewNote } from "./fileViewerModel";

export interface FileViewerPreviewBodyProps {
  readonly preview: FilePreview;
  readonly target: AgentFileViewerTarget;
  readonly language: CodeLanguageId;
  readonly markdownMode: AgentFileViewerMarkdownMode | null;
  readonly wrap: boolean;
  onScrollTopChange(scrollTop: number): void;
}

export function FileViewerPreviewBody({
  language,
  markdownMode,
  onScrollTopChange,
  preview,
  target,
  wrap,
}: FileViewerPreviewBodyProps) {
  switch (preview.kind) {
    case "binary":
      return (
        <p className="cv-file-viewer__state">
          Binary file ({formatFileSize(preview.byteLength)}) is not shown.
        </p>
      );
    case "image":
      return (
        <p className="cv-file-viewer__state">
          Image file ({formatFileSize(preview.byteLength)}) is not previewed here.
        </p>
      );
    case "text": {
      const code = (
        <FileViewerCode
          initialScrollTop={target.scrollTop}
          language={language}
          onScrollTopChange={onScrollTopChange}
          revealLine={target.revealLine}
          revealSequence={target.revealSequence}
          text={preview.contents}
          wrap={wrap}
        />
      );
      return (
        <>
          {preview.truncated && (
            <p className="cv-file-viewer__note cv-file-viewer__note--warning" role="note">
              {truncatedPreviewNote(preview.byteLength)}
            </p>
          )}
          {markdownMode === "rendered" ? (
            <FileViewerMarkdown source={code} text={preview.contents} />
          ) : (
            code
          )}
        </>
      );
    }
    default:
      return unsupportedPreview(preview);
  }
}

function unsupportedPreview(preview: never): never {
  throw new TypeError(`Unsupported file preview: ${String(preview)}`);
}
