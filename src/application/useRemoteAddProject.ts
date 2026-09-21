import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../domain/remoteRunner";
import type { CloneProtocol } from "../domain/repositoryCloneUrl";
import type { RemoteProjectSourceKind } from "../domain/repositoryLookup";
import { remoteAgentProjectKey } from "./remoteAgentProjection";
import {
  boundedRemoteAddProjectError,
  INITIAL_REMOTE_ADD_PROJECT_STATE,
  planRemoteAddProjectEntry,
  reduceRemoteAddProject,
  remoteAddProjectCloneUrl,
  type RemoteAddProjectAction,
  type RemoteAddProjectContext,
  type RemoteAddProjectServerProject,
  type RemoteAddProjectSourceAvailability,
  type RemoteAddProjectStep,
} from "./remoteAddProjectMachine";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";
import { useRemoteCloneTracker, type RemoteCloneTrackerKey } from "./useRemoteCloneTracker";
import { useRemoteProjectClone } from "./useRemoteProjectClone";
import { useRepositoryHosts } from "./useRepositoryHosts";
import { useRepositoryLookup } from "./useRepositoryLookup";

export type {
  RemoteAddProjectCandidate,
  RemoteAddProjectLookupState,
  RemoteAddProjectServerProject,
  RemoteAddProjectSourceAvailability,
  RemoteAddProjectStep,
  RemoteAddProjectUnavailableReason,
} from "./remoteAddProjectMachine";

export type RemoteAddProjectPendingClone = Readonly<{
  name: string;
  status: RemoteRunnerCloneJob["status"];
  error: string | null;
}>;

export interface RemoteAddProjectController {
  readonly open: boolean;
  readonly step: RemoteAddProjectStep;
  readonly serverProjects: readonly RemoteAddProjectServerProject[];
  readonly availability: Readonly<
    Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>
  >;
  readonly pendingClone: RemoteAddProjectPendingClone | null;
  openDialog(): void;
  close(): void;
  back(): void;
  chooseSource(source: RemoteProjectSourceKind): void;
  useGitUrl(): void;
  retrySources(): void;
  chooseHost(host: string): void;
  submitEntry(raw: string): void;
  selectServerProject(key: string): void;
  setName(value: string): void;
  setBranch(value: string): void;
  setProtocol(value: CloneProtocol): void;
  confirmClone(): void;
  openExisting(): void;
  cancelPendingClone(): void;
  dismissPendingClone(): void;
}

export interface RemoteAddProjectOptions {
  readonly runnerGateway: RemoteRunnerGateway | null;
  readonly lookupGateway: RepositoryLookupGateway | null;
  readonly serverId: string | null;
  readonly workspaceOwner: string | null;
  readonly serverProjects: readonly RemoteAddProjectServerProject[];
  readonly selectionIdentity: unknown;
  refreshProjects(): Promise<void>;
  selectProject(key: string): void;
}

type RemoteAddProjectSubmission = Readonly<{
  jobId: string;
  runnerId: string | null;
  selectionIdentity: unknown;
}>;

type RemoteAddProjectAdoption = Readonly<{
  projectKey: string;
  selectionIdentity: unknown;
}>;

type RemoteAddProjectFailure = Readonly<{ name: string; error: string }>;

const NAME_CONFLICT = /\(HTTP 409\)|already exists|name is (?:taken|in use)/iu;
const PROTOCOL_UNAVAILABLE = "This repository has no clone URL for the selected protocol.";
const CLONE_BUSY = "Another clone is already running on this server.";

export function useRemoteAddProject(options: RemoteAddProjectOptions): RemoteAddProjectController {
  const { runnerGateway, lookupGateway, serverId, workspaceOwner, serverProjects } = options;
  const selectionIdentity = options.selectionIdentity;
  const owner = useRef({ runnerGateway, lookupGateway, serverId, workspaceOwner });
  if (
    owner.current.runnerGateway !== runnerGateway ||
    owner.current.lookupGateway !== lookupGateway ||
    owner.current.serverId !== serverId ||
    owner.current.workspaceOwner !== workspaceOwner
  )
    owner.current = { runnerGateway, lookupGateway, serverId, workspaceOwner };
  const captured = owner.current;
  const mounted = useRef(false);
  const valid = useCallback(() => mounted.current && owner.current === captured, [captured]);
  const ports = useRef(options);
  ports.current = options;

  const [state, setState] = useState(INITIAL_REMOTE_ADD_PROJECT_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hosts = useRepositoryHosts({
    runnerGateway,
    lookupGateway,
    serverId,
    workspaceOwner,
    open: state.open,
  });
  const runnerId = useRef<string | null>(null);
  if (hosts.runnerId !== null) runnerId.current = hosts.runnerId;
  const lookup = useRepositoryLookup({ gateway: lookupGateway, serverId, workspaceOwner });
  const clone = useRemoteProjectClone({
    gateway: runnerGateway,
    serverId: serverId ?? "",
    workspaceOwner,
  });
  const cloneRef = useRef(clone);
  cloneRef.current = clone;
  const tracker = useRemoteCloneTracker();
  const trackerKey = useMemo<RemoteCloneTrackerKey>(
    () => ({ workspaceOwner: captured.workspaceOwner, serverId: captured.serverId }),
    [captured],
  );

  const context = useMemo<RemoteAddProjectContext>(
    () => ({
      serverProjects,
      hosts: hosts.hosts,
      hostsTruncated: hosts.hostsTruncated,
      availability: hosts.availability,
    }),
    [serverProjects, hosts.hosts, hosts.hostsTruncated, hosts.availability],
  );
  const contextRef = useRef(context);
  contextRef.current = context;
  const dispatch = useCallback((action: RemoteAddProjectAction) => {
    setState((current) => reduceRemoteAddProject(current, action, contextRef.current));
  }, []);

  const submitted = useRef<RemoteAddProjectSubmission | null>(null);
  const handled = useRef<string | null>(null);
  const resumed = useRef<string | null>(null);
  const submitting = useRef(false);
  const [adoption, setAdoption] = useState<RemoteAddProjectAdoption | null>(null);
  const [failure, setFailure] = useState<RemoteAddProjectFailure | null>(null);

  useEffect(() => {
    mounted.current = true;
    submitted.current = null;
    handled.current = null;
    resumed.current = null;
    submitting.current = false;
    runnerId.current = null;
    setAdoption(null);
    setFailure(null);
    setState(INITIAL_REMOTE_ADD_PROJECT_STATE);
    return () => {
      mounted.current = false;
    };
  }, [captured]);

  useEffect(() => {
    dispatch({ kind: "syncContext" });
  }, [context, dispatch]);

  const idle = clone.job === null && !clone.busy;
  useEffect(() => {
    if (!idle) return;
    const entry = tracker.find(trackerKey);
    if (entry === null) return;
    if (resumed.current === entry.cloneId) return;
    resumed.current = entry.cloneId;
    void cloneRef.current.resume(entry.cloneId);
  }, [idle, tracker, trackerKey]);

  const job = clone.job;
  useEffect(() => {
    if (job === null || job.status !== "succeeded") return;
    if (handled.current === job.id) return;
    handled.current = job.id;
    void refreshForAdoption(ports);
    const submission = submitted.current;
    if (submission === null || submission.jobId !== job.id) return;
    const project = job.project;
    if (project === null || submission.runnerId === null || captured.serverId === null) return;
    setAdoption({
      projectKey: remoteAgentProjectKey(captured.serverId, submission.runnerId, project.id),
      selectionIdentity: submission.selectionIdentity,
    });
  }, [captured, job]);

  useEffect(() => {
    if (adoption === null) return;
    if (adoption.selectionIdentity !== selectionIdentity) {
      setAdoption(null);
      return;
    }
    if (!serverProjects.some((project) => project.key === adoption.projectKey)) return;
    setAdoption(null);
    ports.current.selectProject(adoption.projectKey);
  }, [adoption, selectionIdentity, serverProjects]);

  const tracked = tracker.find(trackerKey);
  const confirmVisible = state.open && state.step.kind === "confirm";
  const pendingClone = useMemo<RemoteAddProjectPendingClone | null>(
    () =>
      remoteAddProjectPendingClone({
        job,
        requestedName: clone.requestedName,
        trackedName: tracked?.name ?? null,
        cloneError: clone.error,
        failure,
        confirmVisible,
      }),
    [job, clone.requestedName, clone.error, tracked, failure, confirmVisible],
  );

  function choose(key: string) {
    setAdoption(null);
    submitted.current = null;
    ports.current.selectProject(key);
    lookup.reset();
    dispatch({ kind: "close" });
  }

  async function confirmClone() {
    if (submitting.current) return;
    const step = stateRef.current.step;
    if (step.kind !== "confirm" || step.submitting) return;
    if (step.nameError !== null || step.branchError !== null) return;
    if (captured.serverId === null || captured.runnerGateway === null) return;
    const url = remoteAddProjectCloneUrl(step.candidate, step.protocol);
    if (url === null) {
      dispatch({ kind: "submitFailed", error: PROTOCOL_UNAVAILABLE, nameConflict: false });
      return;
    }
    submitting.current = true;
    try {
      await startClone(step.name, step.branch.trim(), url);
    } finally {
      submitting.current = false;
    }
  }

  async function startClone(name: string, branch: string, url: string) {
    dispatch({ kind: "submitStarted" });
    const input = branch.length === 0 ? { url, name } : { url, name, branch };
    if (!valid()) return;
    const submissionIdentity = ports.current.selectionIdentity;
    const submissionRunnerId = runnerId.current;
    const result = await cloneRef.current.start(input);
    if (result.status === "started" || result.status === "orphaned") {
      tracker.remember(trackerKey, { cloneId: result.job.id, name });
    }
    if (!valid() || result.status === "orphaned") return;
    if (result.status === "ignored") {
      failSubmit(name, CLONE_BUSY, false);
      return;
    }
    if (result.status === "failed") {
      failSubmit(name, result.error, NAME_CONFLICT.test(result.error));
      return;
    }
    resumed.current = result.job.id;
    submitted.current = {
      jobId: result.job.id,
      runnerId: submissionRunnerId,
      selectionIdentity: submissionIdentity,
    };
    setAdoption(null);
    setFailure(null);
    dispatch({ kind: "submitted" });
  }

  function failSubmit(name: string, error: string, nameConflict: boolean) {
    dispatch({ kind: "submitFailed", error, nameConflict });
    if (nameConflict) return;
    setFailure({ name, error: boundedRemoteAddProjectError(error) });
  }

  return {
    open: state.open,
    step: state.step,
    serverProjects,
    availability: hosts.availability,
    pendingClone,
    openDialog() {
      lookup.reset();
      dispatch({ kind: "open" });
    },
    close() {
      lookup.reset();
      dispatch({ kind: "close" });
    },
    back() {
      lookup.reset();
      dispatch({ kind: "back" });
    },
    chooseSource(source: RemoteProjectSourceKind) {
      lookup.reset();
      dispatch({ kind: "chooseSource", source });
    },
    useGitUrl() {
      lookup.reset();
      dispatch({ kind: "useGitUrl" });
    },
    retrySources() {
      hosts.retry();
    },
    chooseHost(host: string) {
      lookup.reset();
      dispatch({ kind: "chooseHost", host });
    },
    submitEntry(raw: string) {
      const plan = planRemoteAddProjectEntry(stateRef.current.step, raw, contextRef.current);
      dispatch({ kind: "submitEntry", raw });
      if (plan.kind !== "lookup") return;
      void (async () => {
        const outcome = await lookup.submit(plan.request);
        if (outcome === null || !valid()) return;
        dispatch({ kind: "lookupSettled", outcome });
      })();
    },
    selectServerProject(key: string) {
      choose(key);
    },
    setName(value: string) {
      dispatch({ kind: "setName", value });
    },
    setBranch(value: string) {
      dispatch({ kind: "setBranch", value });
    },
    setProtocol(value: CloneProtocol) {
      dispatch({ kind: "setProtocol", value });
    },
    confirmClone() {
      void confirmClone();
    },
    openExisting() {
      const step = stateRef.current.step;
      if (step.kind !== "confirm" || step.existingProjectKey === null) return;
      choose(step.existingProjectKey);
    },
    cancelPendingClone() {
      void cloneRef.current.cancel();
    },
    dismissPendingClone() {
      tracker.forget(trackerKey);
      submitted.current = null;
      setAdoption(null);
      setFailure(null);
      cloneRef.current.dismiss();
    },
  };
}

function remoteAddProjectPendingClone(
  input: Readonly<{
    job: RemoteRunnerCloneJob | null;
    requestedName: string | null;
    trackedName: string | null;
    cloneError: string | null;
    failure: RemoteAddProjectFailure | null;
    confirmVisible: boolean;
  }>,
): RemoteAddProjectPendingClone | null {
  if (input.job !== null) {
    return {
      name: input.requestedName ?? input.trackedName ?? "",
      status: input.job.status,
      error: cloneError(input.job.error ?? input.cloneError),
    };
  }
  if (input.failure === null || input.confirmVisible) return null;
  return { name: input.failure.name, status: "failed", error: input.failure.error };
}

async function refreshForAdoption(ports: { current: RemoteAddProjectOptions }): Promise<void> {
  try {
    await ports.current.refreshProjects();
  } catch {
    return;
  }
}

function cloneError(value: string | null): string | null {
  if (value === null) return null;
  return boundedRemoteAddProjectError(value);
}
