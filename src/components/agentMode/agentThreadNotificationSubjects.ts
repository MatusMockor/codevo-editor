import { useMemo, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadNotificationState,
  type AgentThreadNotificationSubject,
} from "../../domain/agentNotification";
import type { AgentPendingInteractionIdentity } from "../../domain/agentPendingInteraction";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentSessionBackgroundIsLive } from "../../domain/agentSessionBackground";

type InteractionLookup = ReadonlyMap<string, AgentPendingInteractionIdentity | null>;

interface CachedSubject {
  readonly interactionKey: string;
  readonly projectLabel: string;
  readonly generation: number | null;
  readonly subject: AgentThreadNotificationSubject;
}

export function agentThreadNotificationOwnerKey(
  view: AgentThreadView,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): string {
  const project = projects.find((candidate) => candidate.rootKey === view.thread.owner.rootKey);
  return ownerKey(view, ownerGeneration(view, project));
}

export function useAgentThreadNotificationSubjects(
  views: ReadonlyArray<AgentThreadView>,
  interactions: InteractionLookup,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentThreadNotificationSubject> {
  const cache = useRef(new WeakMap<AgentThreadView, CachedSubject>());
  return useMemo(
    () => agentThreadNotificationSubjects(views, interactions, projects, cache.current),
    [interactions, projects, views],
  );
}

export function agentThreadNotificationSubjects(
  views: ReadonlyArray<AgentThreadView>,
  interactions: InteractionLookup,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  cache: WeakMap<AgentThreadView, CachedSubject> = new WeakMap(),
): ReadonlyArray<AgentThreadNotificationSubject> {
  const byRoot = new Map(projects.map((project) => [project.rootKey, project] as const));
  const subjects: AgentThreadNotificationSubject[] = [];
  for (const view of views) {
    if (view.thread.archived) continue;
    const project = byRoot.get(view.thread.owner.rootKey);
    const projectLabel = project?.label ?? view.repositoryLabel;
    const generation = ownerGeneration(view, project);
    const interaction = interactions.get(view.thread.threadId);
    const interactionKey = interactionCacheKey(interaction);
    const cached = cache.get(view);
    if (
      cached !== undefined &&
      cached.interactionKey === interactionKey &&
      cached.projectLabel === projectLabel &&
      cached.generation === generation
    ) {
      subjects.push(cached.subject);
      continue;
    }
    const subject: AgentThreadNotificationSubject = {
      threadId: view.thread.threadId,
      ownerKey: ownerKey(view, generation),
      whenMissing: isRemote(view) ? "retain" : "forget",
      title: view.thread.title,
      projectLabel,
      state: agentThreadNotificationState(
        view.thread,
        interaction,
        agentSessionBackgroundIsLive(view.sessionBackground) ? "live" : "idle",
      ),
    };
    cache.set(view, { interactionKey, projectLabel, generation, subject });
    subjects.push(subject);
  }
  return subjects;
}

function isRemote(view: AgentThreadView): boolean {
  return view.execution?.kind === "remote";
}

function ownerGeneration(
  view: AgentThreadView,
  project: AgentProjectDescriptor | undefined,
): number | null {
  if (isRemote(view)) return null;
  return project?.generation ?? null;
}

function ownerKey(view: AgentThreadView, generation: number | null): string {
  return JSON.stringify([view.thread.owner, view.execution?.serverId ?? null, generation]);
}

function interactionCacheKey(interaction: AgentPendingInteractionIdentity | null | undefined) {
  if (interaction === undefined) return "unknown";
  if (interaction === null) return "none";
  return JSON.stringify([interaction.kind, interaction.id]);
}
