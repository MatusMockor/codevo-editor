import type { ReactNode } from "react";
import { MAX_AGENT_MARKDOWN_CHARS } from "../../../../domain/agentMarkdown/agentMarkdownTree";
import { AgentMarkdownBlockView, type AgentMarkdownLinkActivation } from "../../AgentMarkdown";
import { useAgentMarkdown, useAgentMarkdownRenderer } from "../../useAgentMarkdown";
import "../../conversation/agentProse.css";

export const FILE_VIEWER_MARKDOWN_TOO_LONG_NOTE = `Rendered view covers Markdown files up to ${MAX_AGENT_MARKDOWN_CHARS.toLocaleString("en-US")} characters. Showing the source.`;
export const FILE_VIEWER_MARKDOWN_FAILED_NOTE =
  "This file could not be rendered as Markdown. Showing the source.";

export interface FileViewerMarkdownProps {
  readonly text: string;
  readonly source: ReactNode;
}

const ignoreLink: AgentMarkdownLinkActivation = (event) => event.preventDefault();

export function FileViewerMarkdown({ source, text }: FileViewerMarkdownProps) {
  const renderer = useAgentMarkdownRenderer(null);
  const presentation = useAgentMarkdown(renderer, text, false, "", "parse");
  switch (presentation.kind) {
    case "rendered":
      return (
        <div className="cv-file-viewer__markdown" data-file-viewer-markdown="rendered">
          <div className="agent-text">
            {presentation.blocks.map((block) => (
              <AgentMarkdownBlockView
                block={block}
                current={null}
                hitOffset={0}
                key={block.key}
                onActivateLink={ignoreLink}
                query=""
                textClipboard={null}
              />
            ))}
          </div>
        </div>
      );
    case "pending":
    case "deferred":
      return (
        <p className="cv-file-viewer__state" role="status">
          Rendering Markdown…
        </p>
      );
    case "plain":
      return (
        <>
          <p className="cv-file-viewer__note" role="note">
            {presentation.reason === "too-long"
              ? FILE_VIEWER_MARKDOWN_TOO_LONG_NOTE
              : FILE_VIEWER_MARKDOWN_FAILED_NOTE}
          </p>
          {source}
        </>
      );
    default:
      return unsupportedPresentation(presentation);
  }
}

function unsupportedPresentation(presentation: never): never {
  throw new TypeError(`Unsupported markdown presentation: ${String(presentation)}`);
}
