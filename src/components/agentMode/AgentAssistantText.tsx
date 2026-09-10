import { memo, useLayoutEffect, useRef, type MouseEvent } from "react";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import { highlightOccurrences } from "../../domain/agentThreadHighlight";
import {
  agentMarkdownPlainReasonLabel,
  type AgentMarkdownPresentation,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMarkdownBlockView } from "./AgentMarkdown";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { agentTextParagraphs } from "./agentModePresentation";
import { handleAgentMarkdownLinkClick, type AgentExternalLinkOpener } from "./agentMarkdownLinks";
import { HighlightRun } from "./agentThreadHighlight";
import {
  useAgentMarkdown,
  useAgentMarkdownGate,
  type AgentMarkdownRendererState,
} from "./useAgentMarkdown";

const NO_PARAGRAPHS: ReadonlyArray<string> = [];

export type AgentProseStream = "streaming" | "streamed" | "settled";

export interface AgentProseContext {
  readonly markdown: AgentMarkdownRendererState;
  readonly openExternalLink: AgentExternalLinkOpener;
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
    const highlight = query === "" ? null : { query, current };
    const note = agentMarkdownNote(presentation);
    const paragraphs = presentation.kind === "pending" ? NO_PARAGRAPHS : agentTextParagraphs(text);
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
            <HighlightRun current={run.current} query={query} text={run.text} />
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

  const openLink = (event: MouseEvent<HTMLElement>): void =>
    handleAgentMarkdownLinkClick(event, prose.openExternalLink);
  return (
    <div
      aria-label={label}
      className="agent-text"
      data-agent-event={eventKey}
      data-agent-markdown="rendered"
      onAuxClick={openLink}
      onClick={openLink}
      ref={host}
      role={label === undefined ? undefined : "article"}
    >
      {presentation.blocks.map((block, index) => (
        <AgentMarkdownBlockView
          block={block}
          current={current}
          hitOffset={presentation.hitOffsets[index] ?? 0}
          key={block.key}
          query={query}
          textClipboard={textClipboard}
        />
      ))}
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
