import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import { highlightOccurrences } from "../../domain/agentThreadHighlight";
import { MAX_AGENT_INLINE_IMAGES_PER_MESSAGE } from "../../domain/agentMarkdown/agentInlineImage";
import {
  AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE,
  agentMarkdownPlainPreview,
  agentMarkdownPlainReasonLabel,
  type AgentMarkdownPresentation,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMarkdownBlockView } from "./AgentMarkdown";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { agentTextParagraphs } from "./agentModePresentation";
import type { AgentInlineImageViewer } from "./agentInlineImagePort";
import type {
  AgentExternalLinkOpener,
  AgentLinkTitle,
  AgentLocalFileLinkScope,
} from "./agentMarkdownLinks";
import { agentMarkdownPathLinks } from "./agentMarkdownPathLinks";
import { HighlightRun } from "./agentThreadHighlight";
import { useAgentMarkdownLinkActivation } from "./useAgentMarkdownLinkActivation";
import { useAgentMessageInlineImages } from "./useAgentMessageInlineImages";
import {
  useAgentMarkdown,
  useAgentMarkdownGate,
  type AgentMarkdownRendererState,
} from "./useAgentMarkdown";

export type AgentProseStream = "streaming" | "streamed" | "settled";

export const AGENT_INLINE_IMAGES_TRUNCATED_NOTE = `Only the first ${MAX_AGENT_INLINE_IMAGES_PER_MESSAGE} images of this answer are shown.`;

export interface AgentProseContext {
  readonly markdown: AgentMarkdownRendererState;
  readonly openExternalLink: AgentExternalLinkOpener;
  readonly localFiles: AgentLocalFileLinkScope | null;
  readonly linkTitle?: AgentLinkTitle | null;
  readonly viewport: AgentMarkdownViewport | null;
  readonly inlineImages?: AgentInlineImageViewer | null;
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
  const { activateLink, unavailableLinks } = useAgentMarkdownLinkActivation(
    openExternal,
    localFiles,
  );
  const pathLinks = useMemo(() => agentMarkdownPathLinks(localFiles), [localFiles]);
  const onImageLayout = useCallback((): void => {
    if (query !== "") return;
    onParsed();
  }, [onParsed, query]);
  const inlineImages = useAgentMessageInlineImages(
    {
      viewer: prose.inlineImages ?? null,
      localFiles,
      viewport: prose.viewport,
      onLayout: onImageLayout,
    },
    presentation.kind === "rendered" ? presentation.blocks : null,
    text,
  );

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
          imageOffset={inlineImages.blocks?.[index]?.offset ?? 0}
          imageSlots={inlineImages.blocks?.[index]?.slots ?? null}
          images={inlineImages.images}
          key={block.key}
          linkTitle={prose.linkTitle ?? null}
          onActivateLink={activateLink}
          pathLinks={pathLinks}
          query={query}
          textClipboard={textClipboard}
          unavailableLinks={unavailableLinks}
        />
      ))}
      {(presentation.sourceBlockCount ?? 0) > 0 && (
        <p className="agent-note agent-md__note" role="note">
          {AGENT_MARKDOWN_SOURCE_BLOCKS_NOTE}
        </p>
      )}
      {inlineImages.truncated && (
        <p className="agent-note agent-md__note" role="note">
          {AGENT_INLINE_IMAGES_TRUNCATED_NOTE}
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
