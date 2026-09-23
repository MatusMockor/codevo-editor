import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import { highlightOccurrences } from "../../domain/agentThreadHighlight";
import {
  AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE,
  agentMarkdownPlainPreview,
  agentMarkdownPlainReasonLabel,
  type AgentMarkdownPresentation,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMarkdownBlockView, type AgentMarkdownLinkActivation } from "./AgentMarkdown";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { agentTextParagraphs } from "./agentModePresentation";
import {
  activateAgentMarkdownLink,
  type AgentExternalLinkOpener,
  type AgentLocalFileLinkScope,
} from "./agentMarkdownLinks";
import { agentMarkdownPathLinks } from "./agentMarkdownPathLinks";
import { HighlightRun } from "./agentThreadHighlight";
import {
  useAgentMarkdown,
  useAgentMarkdownGate,
  type AgentMarkdownRendererState,
} from "./useAgentMarkdown";

export type AgentProseStream = "streaming" | "streamed" | "settled";

export interface AgentProseContext {
  readonly markdown: AgentMarkdownRendererState;
  readonly openExternalLink: AgentExternalLinkOpener;
  readonly localFiles: AgentLocalFileLinkScope | null;
  readonly viewport: AgentMarkdownViewport | null;
  readonly onParsed: () => void;
}

export interface AgentItemHighlight {
  readonly query: string;
  readonly current: number | null;
}

interface AgentParagraphRun {
  readonly text: string;
  readonly current: number | null;
}

export const AgentAssistantText = memo(function AgentAssistantText({
  eventKey,
  current,
  label,
  prose,
  query,
  stream,
  text,
  textClipboard,
}: {
  readonly eventKey: string;
  readonly current: number | null;
  readonly label?: string;
  readonly prose: AgentProseContext;
  readonly query: string;
  readonly stream: AgentProseStream;
  readonly text: string;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const live = stream === "streaming";
  const required = stream === "streamed" || current !== null;
  const gate = useAgentMarkdownGate(prose.viewport, host, live, required);
  const presentation = useAgentMarkdown(prose.markdown, text, live, query, gate);
  const parsed = presentation.kind === "rendered";
  const onParsed = prose.onParsed;
  const { openExternalLink: openExternal, localFiles } = prose;
  const activateLink = useCallback<AgentMarkdownLinkActivation>(
    (event, link) => activateAgentMarkdownLink(event, link, { openExternal, localFiles }),
    [localFiles, openExternal],
  );
  const pathLinks = useMemo(() => agentMarkdownPathLinks(localFiles), [localFiles]);

  useLayoutEffect(() => {
    if (!parsed) return;
    if (query !== "") return;
    onParsed();
  }, [onParsed, parsed, query]);

  const actions = (
    <div className="agent-message-actions">
      <AgentMessageCopyButton clipboard={textClipboard} label="AI response" text={text} />
    </div>
  );

  if (presentation.kind !== "rendered") {
    const pending = presentation.kind === "pending";
    const highlight = query === "" || pending ? null : { query, current };
    const note = agentMarkdownNote(presentation);
    const paragraphs = agentTextParagraphs(pending ? agentMarkdownPlainPreview(text) : text);
    return (
      <div
        aria-label={label}
        className="agent-text"
        data-agent-event={eventKey}
        data-agent-markdown={presentation.kind}
        ref={host}
        role={label === undefined ? undefined : "article"}
      >
        {paragraphRuns(paragraphs, highlight).map((run, index) => (
          <p className="agent-text__paragraph" key={`${eventKey}p${index}`}>
            <HighlightRun
              current={run.current}
              query={highlight === null ? "" : query}
              text={run.text}
            />
          </p>
        ))}
        {note !== null && (
          <p className="agent-note agent-md__note" role="note">
            {note}
          </p>
        )}
        {actions}
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className="agent-text"
      data-agent-event={eventKey}
      data-agent-markdown="rendered"
      ref={host}
      role={label === undefined ? undefined : "article"}
    >
      {presentation.blocks.map((block, index) => (
        <AgentMarkdownBlockView
          block={block}
          current={current}
          hitOffset={presentation.hitOffsets[index] ?? 0}
          key={block.key}
          onActivateLink={activateLink}
          pathLinks={pathLinks}
          query={query}
          textClipboard={textClipboard}
        />
      ))}
      {(presentation.sourceBlockCount ?? 0) > 0 && (
        <p className="agent-note agent-md__note" role="note">
          {AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE}
        </p>
      )}
      {actions}
    </div>
  );
});

function agentMarkdownNote(presentation: AgentMarkdownPresentation): string | null {
  switch (presentation.kind) {
    case "plain":
      return agentMarkdownPlainReasonLabel(presentation.reason);
    case "rendered":
    case "pending":
    case "deferred":
      return null;
    default:
      return unsupportedPresentation(presentation);
  }
}

function paragraphRuns(
  paragraphs: ReadonlyArray<string>,
  highlight: AgentItemHighlight | null,
): ReadonlyArray<AgentParagraphRun> {
  if (highlight === null) return paragraphs.map((text) => ({ text, current: null }));

  const runs: AgentParagraphRun[] = [];
  let consumed = 0;
  for (const text of paragraphs) {
    const start = consumed;
    consumed += highlightOccurrences(text, highlight.query);
    const current = highlight.current;
    const local =
      current !== null && current >= start && current < consumed ? current - start : null;
    runs.push({ text, current: local });
  }
  return runs;
}

function unsupportedPresentation(presentation: never): never {
  throw new Error(`Unsupported markdown presentation: ${String(presentation)}`);
}
