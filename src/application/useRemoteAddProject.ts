import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import { isRemoteProjectDirectoryPath } from "../domain/remoteProjectManagement";
import type { CloneProtocol } from "../domain/repositoryCloneUrl";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import type { RepositoryInfo, RemoteProjectSourceKind } from "../domain/repositoryLookup";
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
import {
  useRemoteCloneTracker,
  type RemoteCloneTrackerKey,
  type RemoteCloneTrackerSession,
} from "./useRemoteCloneTracker";
import { useRemoteProjectClone, type RemoteProjectCloneSession } from "./useRemoteProjectClone";
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

export type { RemoteAddProjectPendingClone } from "./remoteAddProjectPendingClone";
import {
  remoteAddProjectPendingClone,
  matchingCloneProjectKey,
  type RemoteAddProjectPendingClone,
} from "./remoteAddProjectPendingClone";

export interface RemoteAddProjectController {
  readonly open: boolean;
  readonly repositoryGateway?: RepositoryLookupGateway | null;
  readonly directoryGateway?: DirectoryListingGateway | null;
  readonly parentPath?: string | null;
  chooseRepository?(repository: RepositoryInfo): void;
  setParentPath?(path: string): void;
  readonly step: RemoteAddProjectStep;
  readonly serverProjects: readonly RemoteAddProjectServerProject[];
  readonly availability: Readonly<
    Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>
  >;
  readonly pendingClone: RemoteAddProjectPendingClone | null;
  readonly canRetryPendingClone?: boolean;
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
  retryPendingClone(): void;
  cancelPendingClone(): void;
  dismissPendingClone(): void;
}

export interface RemoteAddProjectSession {
  current: {
    runnerGateway: RemoteRunnerGateway | null;
    lookupGateway: RepositoryLookupGateway | null;
    serverId: string | null;
    workspaceOwner: string | null;
    clone: RemoteProjectCloneSession;
    tracker: RemoteCloneTrackerSession;
    retained: RetainedClone[];
    submission: RemoteAddProjectSubmission | null;
    retryInput: CloneRetryInput | null;
    runnerId: string | null;
  } | null;
}

export interface RemoteAddProjectOptions {
  readonly session?: RemoteAddProjectSession;
  readonly directoryGateway?: DirectoryListingGateway | null;
  readonly runnerGateway: RemoteRunnerGateway | null;
  readonly lookupGateway: RepositoryLookupGateway | null;
  readonly serverId: string | null;
  readonly workspaceOwner: string | null;
  readonly serverProjects: readonly RemoteAddProjectServerProject[];
  readonly selectionIdentity: unknown;
  refreshProjects(): Promise<void>;
  selectProject(key: string): void;
  onCloneStarted?(id: string, name: string, meta: Readonly<{ select: boolean }>): void;
  onCloneReady?(id: string, projectKey: string): void;
}

type RemoteAddProjectSubmission = Readonly<{
  jobId: string;
  runnerId: string | null;
  selectionIdentity: unknown;
}>;

type CloneRetryInput = Readonly<{ name: string; branch: string; url: string; parentPath?: string }>;
type RetainedClone = Readonly<{
  gateway: RemoteRunnerGateway;
  serverId: string;
  workspaceOwner: string | null;
  submission: RemoteAddProjectSubmission;
  input: CloneRetryInput;
}>;

type RemoteAddProjectAdoption = Readonly<{
  owner: object;
  projectKey: string;
  jobId: string;
  selectionIdentity: unknown;
}>;

type RemoteAddProjectFailure = Readonly<{ name: string; error: string }>;

const NAME_CONFLICT = /\(HTTP 409\)|already exists|name is (?:taken|in use)/iu;
const PROTOCOL_UNAVAILABLE = "This repository has no clone URL for the selected protocol.";
const CLONE_BUSY = "Another clone is already running on this server.";

export function useRemoteAddProject(options: RemoteAddProjectOptions): RemoteAddProjectController {
  const { runnerGateway, lookupGateway, serverId, workspaceOwner, serverProjects } = options;
  const selectionIdentity = options.selectionIdentity;
  const session = options.session;
  if (
    session &&
    (session.current === null ||
      session.current.runnerGateway !== runnerGateway ||
      session.current.lookupGateway !== lookupGateway ||
      session.current.serverId !== serverId ||
      session.current.workspaceOwner !== workspaceOwner)
  ) {
    session.current = {
      runnerGateway,
      lookupGateway,
      serverId,
      workspaceOwner,
      clone: { current: null },
      tracker: { current: null },
      retained: [],
      submission: null,
      retryInput: null,
      runnerId: null,
    };
  }
  const saved = session?.current;
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
  const [parentPath, setParentPath] = useState<string | null>(null);
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
    session: saved?.clone,
  });
  const cloneRef = useRef(clone);
  cloneRef.current = clone;
  const tracker = useRemoteCloneTracker(saved?.tracker);
  const trackerKey = useMemo<RemoteCloneTrackerKey>(
    () => ({ workspaceOwner: captured.workspaceOwner, serverId: captured.serverId }),
    [captured],
  );

  const context = useMemo<RemoteAddProjectContext>(
    () => ({
      serverProjects: parentPath === null ? serverProjects : [],
      hosts: hosts.hosts,
      hostsTruncated: hosts.hostsTruncated,
      availability: hosts.availability,
    }),
    [serverProjects, parentPath, hosts.hosts, hosts.hostsTruncated, hosts.availability],
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
  const retryInput = useRef<CloneRetryInput | null>(null);
  const retained = useRef<RetainedClone[]>([]);
  const delivered = useRef<string[]>([]);
  const [adoption, setAdoption] = useState<RemoteAddProjectAdoption | null>(null);
  const [failure, setFailure] = useState<RemoteAddProjectFailure | null>(null);

  useEffect(() => {
    mounted.current = true;
    submitted.current = saved?.submission ?? null;
    handled.current = null;
    resumed.current = null;
    submitting.current = false;
    retryInput.current = saved?.retryInput ?? null;
    if (saved) retained.current = saved.retained;
    runnerId.current = saved?.runnerId ?? null;
    setAdoption(null);
    setFailure(null);
    setState(INITIAL_REMOTE_ADD_PROJECT_STATE);
    setParentPath(null);
    return () => {
      mounted.current = false;
    };
  }, [captured, saved]);

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
    const saved = retained.current.find(
      (candidate) =>
        candidate.gateway === captured.runnerGateway &&
        candidate.serverId === captured.serverId &&
        candidate.workspaceOwner === captured.workspaceOwner &&
        candidate.submission.jobId === entry.cloneId,
    );
    if (saved !== undefined) {
      retryInput.current = saved.input;
      runnerId.current = saved.submission.runnerId;
      if (ports.current.onCloneReady !== undefined) submitted.current = saved.submission;
    }
    void cloneRef.current.resume(entry.cloneId);
  }, [captured, idle, tracker, trackerKey]);

  const job = clone.job;
  useEffect(() => {
    if (!saved || job === null || submitted.current !== null || saved.retryInput === null) return;
    const submission = { jobId: job.id, runnerId: saved.runnerId, selectionIdentity: null };
    submitted.current = submission;
    saved.submission = submission;
    tracker.remember(trackerKey, { cloneId: job.id, name: saved.retryInput.name });
    ports.current.onCloneStarted?.(job.id, saved.retryInput.name, { select: false });
  }, [job, saved, tracker, trackerKey]);
  useEffect(() => {
    if (job === null || job.status !== "succeeded") return;
    if (handled.current === job.id) return;
    handled.current = job.id;
    void refreshForAdoption(ports);
    const submission =
      submitted.current ??
      (saved?.runnerId != null && saved.retryInput !== null
        ? { jobId: job.id, runnerId: saved.runnerId, selectionIdentity: null }
        : null);
    if (submission === null || submission.jobId !== job.id) return;
    submitted.current = submission;
    if (saved) saved.submission = submission;
    const project = job.project;
    if (project === null || submission.runnerId === null || captured.serverId === null) return;
    setAdoption({
      owner: captured,
      projectKey: remoteAgentProjectKey(captured.serverId, submission.runnerId, project.id),
      jobId: job.id,
      selectionIdentity: submission.selectionIdentity,
    });
  }, [captured, job, saved]);

  useEffect(() => {
    if (adoption === null || adoption.owner !== captured || !valid()) return;
    if (
      adoption.selectionIdentity !== selectionIdentity &&
      ports.current.onCloneReady === undefined
    ) {
      setAdoption(null);
      return;
    }
    if (!serverProjects.some((project) => project.key === adoption.projectKey)) return;
    setAdoption(null);
    const deliveryKey = `${adoption.projectKey}\0${adoption.jobId}`;
    if (delivered.current.includes(deliveryKey)) return;
    delivered.current = [...delivered.current.slice(-31), deliveryKey];
    if (ports.current.onCloneReady !== undefined)
      ports.current.onCloneReady(adoption.jobId, adoption.projectKey);
    else ports.current.selectProject(adoption.projectKey);
  }, [adoption, captured, selectionIdentity, serverProjects, valid]);

  const tracked = tracker.find(trackerKey);
  const jobRunnerId =
    submitted.current?.jobId === job?.id
      ? (submitted.current?.runnerId ?? null)
      : (retained.current.find(
          (candidate) =>
            candidate.gateway === captured.runnerGateway &&
            candidate.serverId === captured.serverId &&
            candidate.workspaceOwner === captured.workspaceOwner &&
            candidate.submission.jobId === job?.id,
        )?.submission.runnerId ?? null);
  const confirmVisible = state.open && state.step.kind === "confirm";
  const pendingClone = useMemo<RemoteAddProjectPendingClone | null>(
    () =>
      remoteAddProjectPendingClone({
        job,
        projectKey:
          job?.status === "succeeded" && job.project !== null && serverId !== null
            ? matchingCloneProjectKey(serverProjects, serverId, jobRunnerId, job.project.id)
            : undefined,
        requestedName: clone.requestedName,
        trackedName: tracked?.name ?? null,
        cloneError: clone.error,
        failure,
        confirmVisible,
      }),
    [
      job,
      serverId,
      jobRunnerId,
      serverProjects,
      clone.requestedName,
      clone.error,
      tracked,
      failure,
      confirmVisible,
    ],
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
      await startClone(step.name, step.branch.trim(), url, parentPath ?? undefined);
    } finally {
      submitting.current = false;
    }
  }

  async function startClone(name: string, branch: string, url: string, destination?: string) {
    dispatch({ kind: "submitStarted" });
    const input = {
      url,
      name,
      ...(branch ? { branch } : {}),
      ...(destination ? { parentPath: destination } : {}),
    };
    const retry = { name, branch, url, ...(destination ? { parentPath: destination } : {}) };
    retryInput.current = retry;
    if (!valid()) return;
    submitted.current = null;
    if (saved) saved.submission = null;
    const submissionIdentity = ports.current.selectionIdentity;
    const submissionRunnerId = runnerId.current;
    if (saved) {
      saved.retryInput = retry;
      saved.runnerId = submissionRunnerId;
    }
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
    if (captured.runnerGateway !== null && captured.serverId !== null) {
      retained.current = retained.current
        .filter(
          (candidate) =>
            !(
              candidate.gateway === captured.runnerGateway &&
              candidate.serverId === captured.serverId &&
              candidate.workspaceOwner === captured.workspaceOwner
            ),
        )
        .slice(-31);
      retained.current.push({
        gateway: captured.runnerGateway,
        serverId: captured.serverId,
        workspaceOwner: captured.workspaceOwner,
        submission: submitted.current,
        input: retry,
      });
    }
    if (saved) {
      saved.retained = retained.current;
      saved.submission = submitted.current;
    }
    setAdoption(null);
    setFailure(null);
    dispatch({ kind: "submitted" });
    ports.current.onCloneStarted?.(result.job.id, name, {
      select: ports.current.selectionIdentity === submissionIdentity,
    });
  }

  function failSubmit(name: string, error: string, nameConflict: boolean) {
    dispatch({ kind: "submitFailed", error, nameConflict });
    if (nameConflict) return;
    setFailure({ name, error: boundedRemoteAddProjectError(error) });
  }

  return {
    open: state.open,
    repositoryGateway: lookupGateway,
    directoryGateway: options.directoryGateway ?? null,
    parentPath,
    setParentPath(path) {
      if (!valid() || stateRef.current.step.kind !== "confirm" || stateRef.current.step.submitting)
        return;
      if (!isRemoteProjectDirectoryPath(path)) return;
      setParentPath(path);
    },
    chooseRepository(repository) {
      if (!valid()) return;
      lookup.reset();
      dispatch({ kind: "chooseRepository", repository });
    },
    step: state.step,
    serverProjects,
    availability: hosts.availability,
    pendingClone,
    canRetryPendingClone:
      retryInput.current !== null &&
      !clone.busy &&
      (job?.status === "failed" || job?.status === "cancelled" || job?.status === "interrupted"),
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
    retryPendingClone() {
      const input = retryInput.current;
      if (
        !valid() ||
        input === null ||
        submitting.current ||
        cloneRef.current.busy ||
        (cloneRef.current.job?.status !== "failed" &&
          cloneRef.current.job?.status !== "cancelled" &&
          cloneRef.current.job?.status !== "interrupted")
      )
        return;
      submitting.current = true;
      void startClone(input.name, input.branch, input.url, input.parentPath).finally(() => {
        if (valid()) submitting.current = false;
      });
    },
    cancelPendingClone() {
      void cloneRef.current.cancel();
    },
    dismissPendingClone() {
      if (!valid() || cloneRef.current.busy) return;
      retryInput.current = null;
      retained.current = retained.current.filter(
        (candidate) =>
          !(
            candidate.gateway === captured.runnerGateway &&
            candidate.serverId === captured.serverId &&
            candidate.workspaceOwner === captured.workspaceOwner
          ),
      );
      if (saved) {
        saved.retryInput = null;
        saved.submission = null;
        saved.retained = retained.current;
      }
      tracker.forget(trackerKey);
      submitted.current = null;
      setAdoption(null);
      setFailure(null);
      cloneRef.current.dismiss();
    },
  };
}

async function refreshForAdoption(ports: { current: RemoteAddProjectOptions }): Promise<void> {
  try {
    await ports.current.refreshProjects();
  } catch {
    return;
  }
}
