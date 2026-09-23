import { useMemo, type ReactNode } from "react";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentActivityItems } from "./AgentActivityItems";
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
import {
  agentActivityAttentionCount,
  type AgentThoughtPresentation,
} from "./agentActivityGrouping";
import type { AgentAppServerGroup } from "./agentAppServerGroups";
import { agentTurnDurationLabel } from "./agentModePresentation";
import { HighlightRun } from "./agentThreadHighlight";
import { agentTurnAttachmentViews } from "./agentTurnAttachmentPresentation";
import { suppressGenericFailure, type AgentTurnErrorContext } from "./agentTurnErrorPresentation";
import { itemHighlight, type AgentTurnHighlight } from "./agentTurnHighlightModel";
import { agentTurnItemKey } from "./agentTurnItemKeys";
import { agentSubagentTokensLabel } from "./agentTurnMetaPresentation";
import {
  agentSubagentGroupSettlement,
  agentTurnProjection,
  type AgentToolSettlement,
  type AgentTurnItem,
} from "./agentTurnProjection";

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
  groupHighlight = null,
  attachmentImages,
  errorContext,
  highlight,
  item,
  prose,
  settlement,
  stream,
  textClipboard,
  thought = null,
}: AgentTurnItemViewProps) {
  switch (item.kind) {
    case "subagentGroup":
      return (
        <AgentSubagentGroupView
          errorContext={errorContext}
          group={item.group}
          groupHighlight={groupHighlight}
          itemKey={item.key}
          prose={prose}
          settlement={settlement}
          stream={stream}
          textClipboard={textClipboard}
        />
      );
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

function AgentSubagentGroupView({
  errorContext,
  group,
  groupHighlight,
  itemKey,
  prose,
  settlement,
  stream,
  textClipboard,
}: {
  readonly errorContext: AgentTurnErrorContext;
  readonly group: AgentAppServerGroup;
  readonly groupHighlight: AgentTurnHighlight | null;
  readonly itemKey: string;
  readonly prose: AgentProseContext;
  readonly settlement: AgentToolSettlement;
  readonly stream: AgentProseStream;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const cursor = groupHighlight?.current;
  const childIndex = cursor?.kind === "event" ? group.sourceOffsets.indexOf(cursor.eventIndex) : -1;
  const occurrence = cursor?.occurrence ?? 0;
  const query = groupHighlight?.query ?? null;
  const childHighlight = useMemo<AgentTurnHighlight | null>(() => {
    if (query === null) return null;
    if (childIndex < 0) return { query, current: null };
    return { query, current: { kind: "event", eventIndex: childIndex, occurrence } };
  }, [childIndex, occurrence, query]);
  const childSettlement = agentSubagentGroupSettlement(group.state, settlement);
  const childProjection = useMemo(
    () =>
      agentTurnProjection(group.events, childIndex < 0 ? null : childIndex, null, childSettlement),
    [childIndex, childSettlement, group.events],
  );
  const attention = useMemo(
    () => agentActivityAttentionCount(childProjection.items),
    [childProjection.items],
  );
  const childHiddenCount = group.hiddenCount + childProjection.hiddenCount;
  const tokens = agentSubagentTokensLabel(group.usage);
  return (
    <details
      className="agent-reasoning"
      data-agent-event={itemKey}
      open={childIndex >= 0 || undefined}
    >
      <summary className="agent-microlabel">
        {group.path} · {group.state}
        {attention > 0 && ` · ${attention} need attention`}
        {group.durationMs !== null && ` · ${agentTurnDurationLabel(group.durationMs)}`}
        {tokens !== null && ` · ${tokens}`}
      </summary>
      {childHiddenCount > 0 && (
        <p className="agent-note">{childHiddenCount} subagent events hidden</p>
      )}
      <AgentActivityItems
        items={childProjection.items}
        scope={group.agentThreadId}
        currentEventKey={childIndex < 0 ? null : agentTurnItemKey(childIndex)}
        turn={group.state === "running" ? "live" : "settled"}
        renderItem={(child, thought) => (
          <AgentTurnItemView
            item={child}
            attachmentImages={null}
            errorContext={errorContext}
            highlight={itemHighlight(childHighlight, child.key)}
            groupHighlight={childHighlight}
            prose={prose}
            settlement={childSettlement}
            stream={stream}
            textClipboard={textClipboard}
            thought={thought}
          />
        )}
      />
    </details>
  );
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
  const error = item.isError ? classifyAgentProviderError(item.text, errorContext.provider) : null;
  if (error !== null && suppressGenericFailure(error, errorContext)) return null;
  const text =
    error === null ? item.text : agentProviderErrorHeadline(error, errorContext.installedVersion);
  return (
    <section
      className={item.isError ? "agent-finale agent-finale--bad" : "agent-finale"}
      data-agent-event={item.key}
    >
      <span
        className={item.isError ? "agent-microlabel agent-microlabel--bad" : "agent-microlabel"}
      >
        {item.isError ? "run failed" : "result"}
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
  const hint = providerErrorHint(error, context.executionTarget === "remote");
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

function providerErrorHint(error: AgentProviderError, remote: boolean): string | null {
  switch (error.detail.kind) {
    case "authenticationRequired":
      return remote
        ? "Sign in to the provider on the server running this thread, then try again."
        : "Sign in to the provider on this computer, then try again.";
    case "protocolFailure":
      return remote
        ? "The server could not continue the provider session. Check the runner on that server and try again."
        : "The provider session could not continue. Check the provider CLI and try again.";
    case "unsupportedModelForCliVersion":
      return remote
        ? "Update the CLI on the server running this thread, then try again."
        : "Open Settings > Agents to update it.";
    default:
      return null;
  }
}

function unsupportedItem(item: never): never {
  throw new TypeError(`Unsupported agent turn item: ${JSON.stringify(item)}.`);
}
