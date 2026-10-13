import {
  Fragment,
  memo,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  MessageCircleQuestion,
  Shield,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from "lucide-react";
import type { AgentTurnEvent } from "../../domain/agentThread";
import {
  AGENT_REQUEST_UNANCHORED_SLOT,
  AGENT_REQUEST_WORK_SLOT,
  type AgentTurnRequestSlot,
  type ClosedAgentRuntimeRequest,
} from "../../domain/agentTurnRequestRows";
import { AgentQuestionToolRow } from "./AgentQuestionToolRow";
import {
  AgentRuntimeRequestsContext,
  AgentTurnRequestsScopeContext,
  createAgentRuntimeRequestsStore,
  useAgentToolOwnsQuestion,
  useAgentToolRequestHistory,
  useAgentTurnRequestsScope,
  useAgentTurnWorkHeld,
  useAgentUnanchoredRequests,
  useAgentWorkRequests,
  type AgentRuntimeRequestsByTurn,
  type AgentRuntimeRequestsSource,
  type AgentTurnRequestsChannel,
  type AgentTurnRequestsScope,
} from "./AgentRuntimeRequestsContext";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import { AgentTurnAttachments, type AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import {
  AGENT_REQUEST_TRUNCATION_MARKER,
  presentAgentRuntimeRequest,
  type AgentRequestClampedText,
  type AgentRequestQuestionView,
  type AgentRuntimeRequestDetailView,
  type AgentRuntimeRequestGlyph,
  type AgentRuntimeRequestView,
} from "./agentRuntimeRequestPresentation";
import type { AgentTurnItem } from "./agentTurnProjection";

type QuestionDetail = Extract<AgentRuntimeRequestDetailView, { readonly kind: "question" }>;
type ApprovalDetail = Extract<AgentRuntimeRequestDetailView, { readonly kind: "approval" }>;
type ToolItem = Extract<AgentTurnItem, { readonly kind: "tool" }>;

interface AgentTurnRuntimeRequestsProps {
  readonly children: ReactNode;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly eventsTruncated: boolean;
  readonly turnId: string;
  readonly visibleItems: ReadonlyArray<AgentTurnItem>;
  readonly workItems: ReadonlyArray<AgentTurnItem> | null;
}

const GLYPHS: Readonly<Record<AgentRuntimeRequestGlyph, LucideIcon>> = {
  question: MessageCircleQuestion,
  approval: Shield,
  approved: ShieldCheck,
  denied: ShieldX,
};

export function AgentRuntimeRequestsProvider({
  children,
  requests,
}: {
  readonly children: ReactNode;
  readonly requests: AgentRuntimeRequestsByTurn;
}) {
  const [store] = useState(() => createAgentRuntimeRequestsStore(requests));
  useLayoutEffect(() => store.publish(requests), [requests, store]);
  return (
    <AgentRuntimeRequestsContext.Provider value={store}>
      {children}
    </AgentRuntimeRequestsContext.Provider>
  );
}

export function AgentTurnRuntimeRequests(props: AgentTurnRuntimeRequestsProps) {
  const source = useContext(AgentRuntimeRequestsContext);
  if (source.inert) return props.children;
  return <AgentTurnRequestsScopeProvider {...props} source={source} />;
}

function AgentTurnRequestsScopeProvider({
  children,
  events,
  eventsTruncated,
  source,
  turnId,
  visibleItems,
  workItems,
}: AgentTurnRuntimeRequestsProps & { readonly source: AgentRuntimeRequestsSource }) {
  const scope = useAgentTurnRequestsScope(
    source,
    turnId,
    workItems,
    visibleItems,
    events,
    eventsTruncated,
  );
  return (
    <AgentTurnRequestsScopeContext.Provider value={scope}>
      {children}
    </AgentTurnRequestsScopeContext.Provider>
  );
}

export function AgentTurnUnanchoredRequests({
  attachmentImages,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
}) {
  const scope = useContext(AgentTurnRequestsScopeContext);
  if (scope === null) return null;
  return <AgentUnanchoredRequestRows attachmentImages={attachmentImages} scope={scope} />;
}

function AgentUnanchoredRequestRows({
  attachmentImages,
  scope,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly scope: AgentTurnRequestsScope;
}) {
  const requests = useAgentUnanchoredRequests(scope);
  return (
    <AgentRuntimeRequestRows
      attachmentImages={attachmentImages}
      channel={scope.channel}
      requests={requests}
      slot={AGENT_REQUEST_UNANCHORED_SLOT}
    />
  );
}

export function AgentTurnWorkInstance({
  children,
  running,
}: {
  readonly children: (focusHeld: boolean) => ReactNode;
  readonly running: boolean;
}) {
  const held = useAgentTurnWorkHeld(useContext(AgentTurnRequestsScopeContext));
  const [settled, setSettled] = useState(!running);
  const next = workInstanceSettled(running, held, settled);
  if (next !== settled) setSettled(next);
  return (
    <Fragment key={next ? "settled-work" : "running-work"}>{children(held && !next)}</Fragment>
  );
}

function workInstanceSettled(running: boolean, held: boolean, settled: boolean): boolean {
  if (running) return false;
  if (held) return settled;
  return true;
}

export function AgentTurnWorkRequests({
  attachmentImages,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
}) {
  const scope = useContext(AgentTurnRequestsScopeContext);
  if (scope === null) return null;
  return <AgentWorkRequestRows attachmentImages={attachmentImages} scope={scope} />;
}

function AgentWorkRequestRows({
  attachmentImages,
  scope,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly scope: AgentTurnRequestsScope;
}) {
  const requests = useAgentWorkRequests(scope);
  return (
    <AgentRuntimeRequestRows
      attachmentImages={attachmentImages}
      channel={scope.channel}
      requests={requests}
      slot={AGENT_REQUEST_WORK_SLOT}
    />
  );
}

export function AgentToolRequestHistory({
  attachmentImages,
  itemKey,
  scope,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly itemKey: string;
  readonly scope: AgentTurnRequestsScope;
}) {
  const requests = useAgentToolRequestHistory(scope, itemKey);
  const slot = useMemo<AgentTurnRequestSlot>(() => ({ kind: "anchor", key: itemKey }), [itemKey]);
  return (
    <AgentRuntimeRequestRows
      attachmentImages={attachmentImages}
      channel={scope.channel}
      requests={requests}
      slot={slot}
    />
  );
}

export function AgentQuestionToolRequests({
  attachmentImages,
  item,
  scope,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly item: ToolItem;
  readonly scope: AgentTurnRequestsScope;
}) {
  const owned = useAgentToolOwnsQuestion(scope, item.toolId);
  return (
    <>
      {!owned && <AgentQuestionToolRow attachmentImages={attachmentImages} item={item} />}
      {scope.anchors.toolIdByKey.has(item.key) && (
        <AgentToolRequestHistory
          attachmentImages={attachmentImages}
          itemKey={item.key}
          scope={scope}
        />
      )}
    </>
  );
}

function AgentRuntimeRequestRows({
  attachmentImages,
  channel,
  requests,
  slot,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly channel: AgentTurnRequestsChannel;
  readonly requests: readonly ClosedAgentRuntimeRequest[];
  readonly slot: AgentTurnRequestSlot;
}) {
  if (requests.length === 0) return null;
  return requests.map((request) => (
    <AgentRuntimeRequestRow
      attachmentImages={attachmentImages}
      channel={channel}
      key={request.id}
      request={request}
      slot={slot}
    />
  ));
}

export const AgentRuntimeRequestRow = memo(function AgentRuntimeRequestRow({
  attachmentImages,
  channel = null,
  request,
  slot = AGENT_REQUEST_UNANCHORED_SLOT,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly channel?: AgentTurnRequestsChannel | null;
  readonly request: ClosedAgentRuntimeRequest;
  readonly slot?: AgentTurnRequestSlot;
}) {
  const view = useMemo(() => presentAgentRuntimeRequest(request), [request]);
  const disclosure = useAgentToolDisclosure(JSON.stringify(["request", request.id]));
  const detailId = useId();
  const endingId = useId();
  const expanded = disclosure.expanded;
  const Icon = GLYPHS[view.glyph];
  useEffect(() => {
    if (channel === null) return undefined;
    return () => channel.release(request.id);
  }, [channel, request.id]);
  const releaseOnLeave = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    channel?.release(request.id);
  };

  return (
    <div
      className="agent-request-row"
      data-agent-request={view.id}
      onBlur={releaseOnLeave}
      onFocus={() => channel?.hold(request.id, slot)}
    >
      <button
        aria-controls={detailId}
        aria-describedby={view.settled ? undefined : endingId}
        aria-expanded={expanded}
        className="cv-work-row agent-request-row__toggle"
        onClick={disclosure.toggle}
        type="button"
      >
        <span aria-hidden="true" className="cv-work-row__icon">
          <Icon size={16} strokeWidth={1.5} />
        </span>
        <span className="agent-request-row__label">{view.label}</span>
        <span className="agent-request-row__title cv-work-row__label">{view.title}</span>
        {view.summary !== null && (
          <span className="agent-request-row__summary">{view.summary}</span>
        )}
        <ChevronRight aria-hidden="true" className="cv-work-row__chevron" size={14} />
      </button>
      {!view.settled && (
        <p className="agent-request-row__ending" id={endingId}>
          {view.ending}
        </p>
      )}
      <div className="agent-request-row__detail" hidden={!expanded} id={detailId}>
        {expanded && <AgentRuntimeRequestDetail images={attachmentImages} view={view} />}
      </div>
    </div>
  );
});

function AgentRuntimeRequestDetail({
  images,
  view,
}: {
  readonly images: AgentTurnAttachmentImageViewer | null;
  readonly view: AgentRuntimeRequestView;
}) {
  return (
    <>
      {detailBody(view.id, view.detail, images)}
      {view.settled && <p className="agent-request-row__note">{view.ending}</p>}
    </>
  );
}

function detailBody(
  requestId: string,
  detail: AgentRuntimeRequestDetailView,
  images: AgentTurnAttachmentImageViewer | null,
): ReactNode {
  switch (detail.kind) {
    case "question":
      return <AgentRequestQuestionDetail detail={detail} images={images} requestId={requestId} />;
    case "approval":
      return <AgentRequestApprovalDetail detail={detail} requestId={requestId} />;
    default:
      return unsupportedDetail(detail);
  }
}

function AgentRequestQuestionDetail({
  detail,
  images,
  requestId,
}: {
  readonly detail: QuestionDetail;
  readonly images: AgentTurnAttachmentImageViewer | null;
  readonly requestId: string;
}) {
  return (
    <>
      <dl className="agent-request-row__pairs">
        {detail.questions.map((question) => (
          <div className="agent-request-row__pair" key={question.key}>
            <dt>
              <AgentRequestText
                field={[requestId, "prompt", question.key]}
                text={question.prompt}
              />
            </dt>
            <dd>
              <AgentRequestAnswer images={images} question={question} requestId={requestId} />
            </dd>
          </div>
        ))}
      </dl>
      {detail.omittedQuestions > 0 && (
        <p className="agent-request-row__note">
          {countLabel(detail.omittedQuestions, "more question")} not shown.
        </p>
      )}
    </>
  );
}

function AgentRequestAnswer({
  images,
  question,
  requestId,
}: {
  readonly images: AgentTurnAttachmentImageViewer | null;
  readonly question: AgentRequestQuestionView;
  readonly requestId: string;
}) {
  return (
    <>
      {question.selected.length > 0 && (
        <ul aria-label="Selected" className="agent-request-row__chosen">
          {question.selected.map((label, index) => (
            <li key={index}>{label}</li>
          ))}
        </ul>
      )}
      {question.text !== null && (
        <AgentRequestText field={[requestId, "answer", question.key]} text={question.text} />
      )}
      {question.attachments.length > 0 && (
        <div className="agent-request-row__attachments">
          <AgentTurnAttachments attachments={question.attachments} images={images} />
        </div>
      )}
      {question.emptyNote !== null && (
        <span className="agent-request-row__empty">{question.emptyNote}</span>
      )}
      {question.notChosen.length > 0 && (
        <p className="agent-request-row__others">
          <span className="agent-request-row__caption">
            {question.emptyNote === null ? "Not chosen" : "Options"}
          </span>
          {question.notChosen.join(" · ")}
        </p>
      )}
      {question.omittedOptions > 0 && (
        <p className="agent-request-row__note">
          {countLabel(question.omittedOptions, "more option")} not shown.
        </p>
      )}
    </>
  );
}

function AgentRequestApprovalDetail({
  detail,
  requestId,
}: {
  readonly detail: ApprovalDetail;
  readonly requestId: string;
}) {
  return (
    <>
      <p className="agent-request-row__heading">
        <AgentRequestText field={[requestId, "heading"]} text={detail.heading} />
      </p>
      {detail.detail !== null && (
        <div className="agent-request-row__block">
          <span className="agent-request-row__caption">{detail.detailLabel}</span>
          <AgentRequestText code field={[requestId, "detail"]} text={detail.detail} />
          {detail.truncatedNote !== null && (
            <p className="agent-request-row__note">{detail.truncatedNote}</p>
          )}
        </div>
      )}
      {detail.facts.length > 0 && (
        <dl className="agent-request-row__facts">
          {detail.facts.map((fact) => (
            <div className="agent-request-row__fact" key={fact.key}>
              <dt>{fact.label}</dt>
              <dd>
                <AgentRequestText field={[requestId, "fact", fact.key]} text={fact.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {detail.omittedFacts > 0 && (
        <p className="agent-request-row__note">
          {countLabel(detail.omittedFacts, "more detail")} not shown.
        </p>
      )}
    </>
  );
}

function AgentRequestText({
  code = false,
  field,
  text,
}: {
  readonly code?: boolean;
  readonly field: readonly string[];
  readonly text: AgentRequestClampedText;
}) {
  const disclosure = useAgentToolDisclosure(JSON.stringify(["request-text", ...field]));
  const open = disclosure.expanded;
  const bodyId = useId();
  const shown =
    open || !text.clamped ? text.full : `${text.preview}${AGENT_REQUEST_TRUNCATION_MARKER}`;
  return (
    <>
      {code ? (
        <pre className="agent-request-row__code" id={bodyId}>
          {shown}
        </pre>
      ) : (
        <span className="agent-request-row__text" id={bodyId}>
          {shown}
        </span>
      )}
      {text.clamped && " "}
      {text.clamped && (
        <button
          aria-controls={bodyId}
          aria-expanded={open}
          className="agent-request-row__more"
          onClick={disclosure.toggle}
          type="button"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

function countLabel(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

function unsupportedDetail(detail: never): never {
  throw new TypeError(`Unsupported agent runtime request detail: ${JSON.stringify(detail)}.`);
}
