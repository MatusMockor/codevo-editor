import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentShipState } from "../domain/agentShip";
import type { RemoteGitProjectKey, RemoteGitSyncPort } from "../domain/remoteGitSync";
import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import type { RemoteRunnerServer } from "../domain/remoteRunner";
import type { AgentTasksNotice, AgentThreadView, RemoteAgentGitAccess } from "./agentThreadPorts";
import { remoteAgentProjectKey } from "./remoteAgentProjection";
import type { RemoteShipTarget } from "./remoteThreadShip";
import {
  SYSTEM_REPOSITORY_IDENTITY_TIMERS,
  type RepositoryIdentityTimers,
} from "./repositoryIdentityRetry";
import type { ExternalUrlOpenerPort } from "./useAgentShipFlow";
import type { RemoteAgentInventorySnapshot } from "./useRemoteAgentInventory";
import { useRemoteShipIdentities } from "./useRemoteShipIdentities";
import { useRemoteThreadShip, type RemoteThreadShipSurface } from "./useRemoteThreadShip";

export { MAX_REMOTE_SHIP_IDENTITIES } from "./useRemoteShipIdentities";

export interface RemoteAgentShipOptions {
  readonly port: RemoteGitSyncPort | null;
  readonly identity: RemoteRepositoryIdentityGateway | null;
  readonly identityTimers?: RepositoryIdentityTimers;
  readonly externalUrlOpener: ExternalUrlOpenerPort | null;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly servers: readonly RemoteRunnerServer[];
  readonly views: ReadonlyMap<string, AgentThreadView>;
  readonly selectedThreadId: string | null;
  readonly report: (message: string) => void;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface RemoteAgentShip {
  readonly ship: RemoteThreadShipSurface;
  readonly access: RemoteAgentGitAccess | undefined;
  supports(threadId: string): boolean;
  present(view: AgentThreadView): AgentThreadView;
}

type GitSyncProjects = ReadonlyMap<string, RemoteGitProjectKey>;

interface PresentedView {
  readonly ship: AgentShipState;
  readonly view: AgentThreadView;
}

const runnerKey = (serverId: string, runnerId: string) => JSON.stringify([serverId, runnerId]);

function projectIdentityKey(project: RemoteGitProjectKey): string {
  return JSON.stringify([project.serverId, project.runnerId, project.projectId]);
}

function gitSyncProjectSignature(
  snapshots: readonly RemoteAgentInventorySnapshot[],
  servers: readonly RemoteRunnerServer[],
): string {
  const entries: [string, RemoteGitProjectKey][] = [];
  for (const snapshot of snapshots) {
    const descriptor = snapshot.descriptor;
    if (
      descriptor === null ||
      !snapshot.connected ||
      descriptor.capabilities.gitSync !== true ||
      !servers.some((server) => server.id === snapshot.serverId && server.connected)
    )
      continue;
    for (const project of snapshot.projects) {
      entries.push([
        remoteAgentProjectKey(snapshot.serverId, descriptor.runnerId, project.id),
        { serverId: snapshot.serverId, runnerId: descriptor.runnerId, projectId: project.id },
      ]);
    }
  }
  return JSON.stringify(entries);
}

function remoteProjectOf(view: AgentThreadView | undefined): RemoteGitProjectKey | null {
  const execution = view?.execution;
  if (execution?.kind !== "remote") return null;
  return {
    serverId: execution.serverId,
    runnerId: execution.runnerId,
    projectId: execution.projectId,
  };
}

export function useRemoteAgentShip(options: RemoteAgentShipOptions): RemoteAgentShip {
  const { identity, port, report, reportError, selectedThreadId, views } = options;
  const identityTimers = options.identityTimers ?? SYSTEM_REPOSITORY_IDENTITY_TIMERS;
  const signature = gitSyncProjectSignature(options.snapshots, options.servers);
  const projects = useMemo<GitSyncProjects>(
    () => new Map(JSON.parse(signature) as [string, RemoteGitProjectKey][]),
    [signature],
  );
  const runners = useMemo(
    () =>
      new Set(
        [...projects.values()].map((project) => runnerKey(project.serverId, project.runnerId)),
      ),
    [projects],
  );
  const shipProject = useCallback(
    (view: AgentThreadView | undefined): RemoteGitProjectKey | null => {
      const project = remoteProjectOf(view);
      if (port === null || project === null) return null;
      return runners.has(runnerKey(project.serverId, project.runnerId)) ? project : null;
    },
    [port, runners],
  );

  const wanted =
    selectedThreadId === null ? null : shipProject(views.get(selectedThreadId) ?? undefined);
  const wantedKey = wanted === null ? null : projectIdentityKey(wanted);
  const identities = useRemoteShipIdentities({
    identity,
    timers: identityTimers,
    wantedKey,
    report,
  });

  const resolveView = useCallback(
    (view: AgentThreadView | undefined): RemoteShipTarget | null => {
      const project = shipProject(view);
      if (view === undefined || project === null || identities === null) return null;
      const known = identities.get(projectIdentityKey(project));
      if (known === undefined) return null;
      return {
        threadId: view.thread.threadId,
        serverId: project.serverId,
        runnerId: project.runnerId,
        conversationId: view.execution!.conversationId,
        repositoryKey: known.kind === "read" ? known.repositoryKey : null,
        running: view.lifecycle === "running",
      };
    },
    [identities, shipProject],
  );

  const setNotice = useCallback(
    (notice: AgentTasksNotice | null) => {
      if (notice !== null) report(notice.message);
    },
    [report],
  );
  const ship = useRemoteThreadShip({
    port,
    resolve: (threadId) => resolveView(views.get(threadId)),
    externalUrlOpener: options.externalUrlOpener,
    setNotice,
    reportError,
  });

  const { retain } = ship;
  useEffect(() => {
    retain(views);
  }, [retain, views]);

  const states = ship.states;
  const presented = useRef(new WeakMap<AgentThreadView, PresentedView>());
  const present = useCallback(
    (view: AgentThreadView): AgentThreadView => {
      if (resolveView(view) === null) return view;
      const shipState = states.get(view.thread.threadId) ?? view.ship;
      const cached = presented.current.get(view);
      if (cached !== undefined && cached.ship === shipState) return cached.view;
      const next: AgentThreadView = {
        ...view,
        ship: shipState,
        execution: { ...view.execution!, gitShip: true },
      };
      presented.current.set(view, { ship: shipState, view: next });
      return next;
    },
    [resolveView, states],
  );
  const supports = useCallback(
    (threadId: string) => resolveView(views.get(threadId)) !== null,
    [resolveView, views],
  );
  const access = useMemo<RemoteAgentGitAccess | undefined>(
    () =>
      port === null || projects.size === 0
        ? undefined
        : { port, project: (projectRootKey) => projects.get(projectRootKey) ?? null },
    [port, projects],
  );
  return { ship, access, supports, present };
}
