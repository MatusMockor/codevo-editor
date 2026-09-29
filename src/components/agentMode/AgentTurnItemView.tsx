import { useMemo, type ReactNode } from "react";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import {
  AgentAssistantText,
  type AgentItemHighlight,
  type AgentProseContext,
  type AgentProseStream,
} from "./AgentAssistantText";
import { AgentCompactionBoundary } from "./AgentCompactionActivity";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { AgentThought } from "./AgentThought";
import { AgentToolRow } from "./AgentToolRow";
import { AgentTurnPrompt } from "./AgentTurnParts";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import type { AgentThoughtPresentation } from "./agentActivityGrouping";
import { HighlightRun } from "./agentThreadHighlight";
import { agentProviderErrorAdvice } from "./agentProviderErrorAdvice";
import { agentTurnAttachmentViews } from "./agentTurnAttachmentPresentation";
import { suppressGenericFailure, type AgentTurnErrorContext } from "./agentTurnErrorPresentation";
import type { AgentTurnHighlight } from "./agentTurnHighlightModel";
import type { AgentToolSettlement, AgentTurnItem } from "./agentTurnProjection";

export interface AgentTurnItemViewProps {
  readonly groupHighlight?: AgentTurnHighlight | null;
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentItemHighlight | null;
  readonly item: AgentTurnItem;
  readonly prose: AgentProseContext;
  readonly settlement: AgentToolSettlement;
  readonly stream: AgentProseStream;
  readonly textClipboard: TextClipboardGateway | null;
  readonly thought?: AgentThoughtPresentation | null;
}

export function AgentTurnItemView({
  attachmentImages,
  errorContext,
  highlight,
  item,
  prose,
  stream,
  textClipboard,
  thought = null,
}: AgentTurnItemViewProps) {
  switch (item.kind) {
    case "queued":
      return (
        <p className="agent-note" data-agent-event={item.key}>
          <span className="agent-prompt__chip agent-prompt__chip--queued">Queued</span> Message
          accepted for the next turn.
        </p>
      );
    case "userMessage":
      return (
        <AgentSteeredMessage
          attachmentImages={attachmentImages}
          highlight={highlight}
          item={item}
          textClipboard={textClipboard}
        />
      );
    case "assistantText":
      return (
        <AgentAssistantText
          eventKey={item.key}
          current={highlight?.current ?? null}
          prose={prose}
          query={highlight?.query ?? ""}
          stream={stream}
          text={item.text}
          textClipboard={textClipboard}
        />
      );
    case "reasoning":
      return (
        <AgentThought
          item={item}
          presentation={thought}
          prose={prose}
          textClipboard={textClipboard}
        />
      );
    case "tool":
      return <AgentToolRow item={item} />;
    case "result":
      return (
        <AgentResultItem
          errorContext={errorContext}
          highlight={highlight}
          item={item}
          textClipboard={textClipboard}
        />
      );
    case "contextCompaction":
      return <AgentCompactionBoundary item={item} />;
    case "error":
      return <AgentErrorItem errorContext={errorContext} item={item} />;
    default:
      return unsupportedItem(item);
  }
}

function AgentResultItem({
  errorContext,
  highlight,
  item,
  textClipboard,
}: {
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentItemHighlight | null;
  readonly item: Extract<AgentTurnItem, { kind: "result" }>;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const halt = item.isError ? errorContext.halt : null;
  if (halt !== null && item.text.trim() === "") return null;
  const error =
    item.isError && halt === null
      ? classifyAgentProviderError(item.text, errorContext.provider)
      : null;
  if (error !== null && suppressGenericFailure(error, errorContext)) return null;
  const text =
    error === null ? item.text : agentProviderErrorHeadline(error, errorContext.installedVersion);
  return (
    <section
      className={error === null ? "agent-finale" : "agent-finale agent-finale--bad"}
      data-agent-event={item.key}
    >
      <span
        className={error === null ? "agent-microlabel" : "agent-microlabel agent-microlabel--bad"}
      >
        {error === null ? (halt ?? "result") : "run failed"}
      </span>
      {text !== "" && (
        <p className="agent-finale__body">
          <HighlightRun
            current={highlight?.current ?? null}
            query={highlight?.query ?? ""}
            text={text}
          />
        </p>
      )}
      {error !== null && <AgentProviderErrorHint error={error} context={errorContext} />}
      {text !== "" && (
        <div className="agent-message-actions">
          <AgentMessageCopyButton clipboard={textClipboard} label="AI response" text={text} />
        </div>
      )}
    </section>
  );
}

function AgentErrorItem({
  errorContext,
  item,
}: {
  readonly errorContext: AgentTurnErrorContext;
  readonly item: Extract<AgentTurnItem, { kind: "error" }>;
}) {
  const error = classifyAgentProviderError(item.message, errorContext.provider);
  if (suppressGenericFailure(error, errorContext)) return null;
  if (error.detail.kind === "advisory") {
    return (
      <p className="agent-note" data-agent-event={item.key}>
        {error.detail.text}
      </p>
    );
  }
  return (
    <section className="agent-finale agent-finale--bad" data-agent-event={item.key}>
      <span className="agent-microlabel agent-microlabel--bad">error</span>
      <p className="agent-finale__body">
        {agentProviderErrorHeadline(error, errorContext.installedVersion)}
      </p>
      <AgentProviderErrorHint error={error} context={errorContext} />
    </section>
  );
}

function AgentSteeredMessage({
  attachmentImages,
  highlight,
  item,
  textClipboard,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly highlight: AgentItemHighlight | null;
  readonly item: Extract<AgentTurnItem, { kind: "userMessage" }>;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const attachments = useMemo(() => agentTurnAttachmentViews(item.attachments), [item.attachments]);

  return (
    <AgentTurnPrompt
      attachmentImages={attachments.length === 0 ? null : attachmentImages}
      attachments={attachments}
      current={highlight?.current ?? null}
      eventKey={item.key}
      prompt={item.text}
      query={highlight?.query ?? ""}
      role="steer"
      textClipboard={textClipboard}
    />
  );
}

export function AgentProviderErrorHint({
  error,
  context,
}: {
  readonly error: AgentProviderError;
  readonly context: AgentTurnErrorContext;
}): ReactNode {
  const hint = agentProviderErrorAdvice(error, context.executionTarget);
  if (hint === null) return null;
  return (
    <>
      <p className="agent-note">{hint}</p>
      <details className="agent-raw">
        <summary className="agent-raw__toggle">Provider message</summary>
        <pre className="agent-raw__lines">{error.raw}</pre>
      </details>
    </>
  );
}

function unsupportedItem(item: never): never {
  throw new TypeError(`Unsupported agent turn item: ${JSON.stringify(item)}.`);
}
