import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import type { RemoteProjectRegistration } from "../domain/remoteProjectRegistration";
import {
  INITIAL_REMOTE_ADD_PROJECT_FOLDER,
  reduceRemoteAddProjectFolder,
  remoteAddProjectFolderAwaits,
  remoteAddProjectFolderInput,
  type RemoteAddProjectFolderAction,
  type RemoteAddProjectFolderFailure,
  type RemoteAddProjectFolderState,
  type RemoteRunnerFolderProjectSupport,
} from "./remoteAddProjectFolder";
import type { RemoteAddProjectServerProject } from "./remoteAddProjectMachine";
import { matchingCloneProjectKey } from "./remoteAddProjectPendingClone";
import type {
  RemoteProjectRegistrationGateway,
  RemoteProjectRegistrationRunner,
} from "./remoteProjectRegistrationGateway";

export const REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS = 10_000;

const RUNNER_OUTDATED = /\(HTTP 404\)/u;

export type RemoteProjectFolderOwner = Readonly<{
  serverId: string;
  workspaceOwner: string | null;
  directoryGateway: DirectoryListingGateway | null;
  registrationGateway: RemoteProjectRegistrationGateway | null;
}>;

export interface RemoteProjectFolderRegistrationOptions {
  readonly owner: RemoteProjectFolderOwner | null;
  readonly serverProjects: readonly RemoteAddProjectServerProject[];
  readonly selectionIdentity: unknown;
  refreshProjects(): Promise<void>;
  selectProject(key: string): void;
  onClose(): void;
}

export interface RemoteProjectFolderController {
  readonly open: boolean;
  readonly directoryGateway: DirectoryListingGateway | null;
  readonly folder: RemoteAddProjectFolderState;
  chooseFolder(path: string): void;
  setName(value: string): void;
  back(): void;
  submit(): void;
  close(): void;
}

type FolderAdoption = Readonly<{
  submission: number;
  runnerId: string;
  projectId: string;
  selectionIdentity: unknown;
  deadline: number;
}>;

type FolderFlow = Readonly<{
  owner: RemoteProjectFolderOwner | null;
  folder: RemoteAddProjectFolderState;
  adoption: FolderAdoption | null;
  described: number;
}>;

type Outcome<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: RemoteAddProjectFolderFailure }>;

export function remoteProjectFolderFailure(error: unknown): RemoteAddProjectFolderFailure {
  if (RUNNER_OUTDATED.test(errorText(error))) return { kind: "runnerOutdated" };
  return { kind: "unknown" };
}

export function useRemoteProjectFolderRegistration(
  options: RemoteProjectFolderRegistrationOptions,
): RemoteProjectFolderController {
  const { owner, selectionIdentity, serverProjects } = options;
  const [stored, setFlow] = useState<FolderFlow>(() => freshFlow(owner));
  if (stored.owner !== owner) setFlow(freshFlow(owner));
  const flow = stored.owner === owner ? stored : freshFlow(owner);
  const folder = flow.folder;
  const latest = useRef({ options, folder });
  useLayoutEffect(() => {
    latest.current = { options, folder };
  });
  const mounted = useRef(false);
  const counter = useRef(0);
  const reads = useRef(0);
  const pending = useRef<Readonly<{ owner: RemoteProjectFolderOwner; submission: number }> | null>(
    null,
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const adoption = flow.adoption;
  useEffect(() => {
    if (owner === null || adoption === null) return;
    const ports = latest.current.options;
    if (adoption.selectionIdentity !== selectionIdentity) {
      ports.onClose();
      return;
    }
    const key = matchingCloneProjectKey(
      serverProjects,
      owner.serverId,
      adoption.runnerId,
      adoption.projectId,
    );
    if (key !== undefined) {
      ports.selectProject(key);
      ports.onClose();
      return;
    }
    const timer = setTimeout(
      () => {
        setFlow((current) => {
          if (current.owner !== owner || current.adoption !== adoption) return current;
          return {
            ...current,
            adoption: null,
            folder: reduceRemoteAddProjectFolder(current.folder, {
              kind: "submitFailed",
              submission: adoption.submission,
              failure: { kind: "projectMissing" },
            }),
          };
        });
      },
      Math.max(0, adoption.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [owner, adoption, selectionIdentity, serverProjects]);

  useEffect(() => {
    if (owner === null) return;
    const gateway = owner.registrationGateway;
    if (gateway === null) return;
    reads.current += 1;
    const read = reads.current;
    void identified(gateway).then((runner) => {
      if (!runner.ok) return;
      if (!mounted.current || latest.current.options.owner !== owner) return;
      setFlow((current) => describedFlow(current, owner, read, runner.value.folderProjects));
    });
  }, [owner]);

  function holds(captured: RemoteProjectFolderOwner): boolean {
    return mounted.current && latest.current.options.owner === captured;
  }

  function dispatch(captured: RemoteProjectFolderOwner, action: RemoteAddProjectFolderAction) {
    setFlow((current) => {
      if (current.owner !== captured) return current;
      const folder = reduceRemoteAddProjectFolder(current.folder, action);
      if (folder === current.folder) return current;
      return { ...current, folder };
    });
  }

  function change(action: RemoteAddProjectFolderAction) {
    const current = latest.current.options.owner;
    if (current === null || !mounted.current) return;
    dispatch(current, action);
  }

  async function submit() {
    const captured = latest.current.options.owner;
    if (captured === null || !mounted.current) return;
    if (pending.current?.owner === captured) return;
    const input = remoteAddProjectFolderInput(latest.current.folder);
    if (input === null) return;
    counter.current += 1;
    const submission = counter.current;
    const identity = latest.current.options.selectionIdentity;
    const fail = (failure: RemoteAddProjectFolderFailure) =>
      dispatch(captured, { kind: "submitFailed", submission, failure });
    pending.current = { owner: captured, submission };
    dispatch(captured, { kind: "submitStarted", submission });
    try {
      const gateway = captured.registrationGateway;
      if (gateway === null) {
        fail({ kind: "runnerUnreachable" });
        return;
      }
      reads.current += 1;
      const read = reads.current;
      const runner = await identified(gateway);
      if (!holds(captured)) return;
      if (!runner.ok) {
        fail(runner.failure);
        return;
      }
      setFlow((current) => describedFlow(current, captured, read, runner.value.folderProjects));
      const result = await settled(gateway.registerProject(input), remoteProjectFolderFailure);
      if (!holds(captured)) return;
      if (!result.ok) {
        fail(result.failure);
        return;
      }
      const registration: RemoteProjectRegistration = result.value;
      if (registration.status === "rejected") {
        dispatch(captured, { kind: "submitRejected", submission, reason: registration.reason });
        return;
      }
      const waiting: FolderAdoption = {
        submission,
        runnerId: runner.value.runnerId,
        projectId: registration.project.id,
        selectionIdentity: identity,
        deadline: Date.now() + REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS,
      };
      setFlow((current) => {
        if (current.owner !== captured) return current;
        if (!remoteAddProjectFolderAwaits(current.folder, submission)) return current;
        return { ...current, adoption: waiting };
      });
      void refreshed(latest.current.options);
    } finally {
      if (pending.current?.submission === submission) pending.current = null;
    }
  }

  return {
    open: owner !== null,
    directoryGateway: owner?.directoryGateway ?? null,
    folder,
    chooseFolder(path) {
      change({ kind: "chooseFolder", path });
    },
    setName(value) {
      change({ kind: "setName", value });
    },
    back() {
      change({ kind: "back" });
    },
    submit() {
      void submit();
    },
    close() {
      latest.current.options.onClose();
    },
  };
}

function freshFlow(owner: RemoteProjectFolderOwner | null): FolderFlow {
  return { owner, folder: INITIAL_REMOTE_ADD_PROJECT_FOLDER, adoption: null, described: 0 };
}

function describedFlow(
  current: FolderFlow,
  captured: RemoteProjectFolderOwner,
  read: number,
  folderProjects: RemoteRunnerFolderProjectSupport,
): FolderFlow {
  if (current.owner !== captured || current.described >= read) return current;
  return {
    ...current,
    described: read,
    folder: reduceRemoteAddProjectFolder(current.folder, {
      kind: "runnerDescribed",
      folderProjects,
    }),
  };
}

function identified(
  gateway: RemoteProjectRegistrationGateway,
): Promise<Outcome<RemoteProjectRegistrationRunner>> {
  return settled(gateway.identifyRunner(), () => ({ kind: "runnerUnreachable" }));
}

async function settled<T>(
  request: Promise<T>,
  classify: (error: unknown) => RemoteAddProjectFolderFailure,
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await request };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
}

async function refreshed(ports: Pick<RemoteProjectFolderRegistrationOptions, "refreshProjects">) {
  try {
    await ports.refreshProjects();
  } catch {
    return;
  }
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}
