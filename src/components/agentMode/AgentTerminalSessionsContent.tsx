import { Fragment, type ReactNode } from "react";
import type { ExternalSessionsSurface } from "../../application/agentThreadPorts";
import type { ExternalAgentSessionView } from "../../domain/externalAgentSession";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { AgentRelativeTime } from "./agentClock";
import { agentExternalSessionRowTitle } from "./agentSidebarPresentation";
import {
  terminalSessionMetaSegments,
  terminalSessionRoleChip,
  terminalSessionsEmptyNote,
  type AgentTerminalSessionMetaSegment,
  type AgentTerminalSessionPreviewView,
  type AgentTerminalSessionsStateKey,
} from "./agentTerminalSessionsPresentation";

export function SessionListState({
  projectLabel,
  surface,
}: {
  readonly projectLabel: string | null;
  readonly surface: ExternalSessionsSurface;
}) {
  if (surface.state === "loading") {
    return <StateBlock label="Loading" note="Loading terminal sessions…" stateKey="loading" />;
  }
  if (surface.state === "failed") {
    return (
      <StateBlock
        label="Unavailable"
        note="Terminal sessions could not be loaded."
        stateKey="failed"
        tone="bad"
      >
        <button className="agent-linkbutton" onClick={() => void surface.reload()} type="button">
          Retry
        </button>
      </StateBlock>
    );
  }
  return (
    <StateBlock
      label="Nothing yet"
      note={terminalSessionsEmptyNote(projectLabel)}
      stateKey="empty"
    />
  );
}

export function MetaSegments({
  segments,
}: {
  readonly segments: ReadonlyArray<AgentTerminalSessionMetaSegment>;
}) {
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={segment.kind}>
          {index > 0 && (
            <span aria-hidden="true" className="agent-tsp__sep">
              ·
            </span>
          )}
          <span className={metaSegmentClassName(segment)}>{segment.text}</span>
        </Fragment>
      ))}
    </>
  );
}

function metaSegmentClassName(segment: AgentTerminalSessionMetaSegment): string {
  if (segment.kind === "turns") return "agent-tsp__meta-segment agent-num";
  return "agent-tsp__meta-segment";
}

export function StateBlock({
  children,
  label,
  note,
  stateKey,
  tone = "neutral",
}: {
  readonly children?: ReactNode;
  readonly label: string;
  readonly note: string;
  readonly stateKey: AgentTerminalSessionsStateKey;
  readonly tone?: "neutral" | "bad";
}) {
  const labelClassName =
    tone === "bad" ? "agent-microlabel agent-microlabel--bad" : "agent-microlabel";
  return (
    <div className="agent-tsp__state" data-state={stateKey}>
      <span className={labelClassName}>{label}</span>
      <p className="agent-tsp__note">{note}</p>
      {children}
    </div>
  );
}

export function PreviewDrawer({
  active,
  onRetry,
  repositoryRoot,
  view,
}: {
  readonly active: ExternalAgentSessionView | null;
  onRetry(): void;
  readonly repositoryRoot: string | null;
  readonly view: AgentTerminalSessionPreviewView;
}) {
  if (active === null || view.kind === "idle") {
    return (
      <StateBlock label="Preview" note="Select a session to preview it." stateKey="preview-idle" />
    );
  }

  return (
    <>
      <div className="agent-tsp__drawer-head">
        <div className="agent-tsp__drawer-title">{agentExternalSessionRowTitle(active)}</div>
        <div className="agent-tsp__drawer-meta">
          <AgentProviderGlyph decorative kind={active.provider} />
          <MetaSegments segments={terminalSessionMetaSegments(active, repositoryRoot)} />
          <span aria-hidden="true" className="agent-tsp__sep">
            ·
          </span>
          <span className="agent-tsp__meta-segment">
            <AgentRelativeTime epochMs={active.lastActivityEpochMs} />
          </span>
        </div>
      </div>
      <PreviewBody onRetry={onRetry} view={view} />
    </>
  );
}

function PreviewBody({
  onRetry,
  view,
}: {
  onRetry(): void;
  readonly view: Exclude<AgentTerminalSessionPreviewView, { readonly kind: "idle" }>;
}) {
  if (view.kind === "loading") {
    return <StateBlock label="Preview" note="Loading preview…" stateKey="preview-loading" />;
  }
  if (view.kind === "failed") {
    return (
      <StateBlock
        label="Unavailable"
        note="The preview could not be loaded."
        stateKey="preview-failed"
        tone="bad"
      >
        <button className="agent-linkbutton" onClick={onRetry} type="button">
          Retry
        </button>
      </StateBlock>
    );
  }
  if (view.preview.exchanges.length === 0) {
    return (
      <StateBlock
        label="Preview"
        note="No readable messages in this session."
        stateKey="preview-empty"
      />
    );
  }

  return (
    <div className="agent-tsp__log">
      {view.preview.exchanges.map((exchange, index) => {
        const chip = terminalSessionRoleChip(exchange.role);
        return (
          <article className="agent-tsp__exchange" data-role={exchange.role} key={index}>
            <span className={chip.className}>{chip.label}</span>
            <p className="agent-tsp__exchange-text">{exchange.text}</p>
          </article>
        );
      })}
      {view.preview.exchangesTruncated && (
        <p className="agent-tsp__note agent-tsp__note--footnote">
          Preview shows the beginning and end of a long session.
        </p>
      )}
    </div>
  );
}
