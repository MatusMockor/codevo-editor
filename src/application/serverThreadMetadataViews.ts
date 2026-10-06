import { normalizeAgentThreadTitle } from "../domain/agentThread";
import type { AgentThreadView } from "./agentThreadPorts";
import { presentRemoteAgentThread } from "./remoteAgentProjection";

export interface ServerThreadPresentationMetadata {
  readonly title?: string | null;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly viewedAtEpochMs?: number | null;
  readonly snoozedUntil?: number | null;
  readonly settledAt?: number | null;
  readonly sortOrder?: number | null;
}

interface PresentedView {
  readonly metadata: ServerThreadPresentationMetadata;
  readonly tracksViews: boolean;
  readonly view: AgentThreadView;
}

const samePresentation = (
  left: ServerThreadPresentationMetadata,
  right: ServerThreadPresentationMetadata,
): boolean =>
  left.title === right.title &&
  left.pinned === right.pinned &&
  left.archived === right.archived &&
  left.viewedAtEpochMs === right.viewedAtEpochMs &&
  left.snoozedUntil === right.snoozedUntil &&
  left.settledAt === right.settledAt &&
  left.sortOrder === right.sortOrder;

export class ServerThreadMetadataViews {
  private readonly cache = new WeakMap<AgentThreadView, PresentedView>();

  present(
    view: AgentThreadView,
    metadata: ServerThreadPresentationMetadata,
    tracksViews: boolean,
  ): AgentThreadView {
    const cached = this.cache.get(view);
    if (
      cached !== undefined &&
      cached.tracksViews === tracksViews &&
      samePresentation(cached.metadata, metadata)
    )
      return cached.view;
    const { title, pinned, archived, viewedAtEpochMs, snoozedUntil, settledAt, sortOrder } =
      metadata;
    const thread = {
      ...view.thread,
      snoozedUntil: snoozedUntil ?? null,
      settledAt: settledAt ?? null,
      sortOrder: sortOrder ?? null,
      title: normalizeAgentThreadTitle(title ?? "") ?? view.thread.title,
      pinned: pinned ?? view.thread.pinned,
      archived: archived ?? view.thread.archived,
      viewedAtEpochMs:
        viewedAtEpochMs === undefined ? view.thread.viewedAtEpochMs : viewedAtEpochMs,
    };
    const next = presentRemoteAgentThread(view, thread, tracksViews);
    this.cache.set(view, {
      metadata: { title, pinned, archived, viewedAtEpochMs, snoozedUntil, settledAt, sortOrder },
      tracksViews,
      view: next,
    });
    return next;
  }
}
