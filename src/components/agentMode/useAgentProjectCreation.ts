import {
  MAX_PENDING_CLONE_DRAFT_CHARS,
  type PendingProjectClone,
} from "./agentProjectCreationSession";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { useRemoteAddProject } from "../../application/useRemoteAddProject";
import { useLocalProjectClone } from "../../application/useLocalProjectClone";
import { useAgentAddProject, type AgentAddProjectOptions } from "./useAgentAddProject";
import { remoteAddProjectServerProjects } from "./remoteAddProject/remoteAddProjectPresentation";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";

type Pending = PendingProjectClone;
interface Options extends AgentAddProjectOptions {
  readonly selectedServerId: string | null;
  refreshProjects(): Promise<void>;
}

export function useAgentProjectCreation(options: Options) {
  const remote = useRemoteRunnerContext();
  const localGateway = options.chrome?.cloneGateway ?? null;
  const remoteGateway = remote?.gateway ?? null;
  const lookupGateway = remote?.repositoryLookup ?? null;
  const session = options.chrome?.creationSession;
  const saved = session?.current;
  const savedRemote = options.chrome?.remoteCloneSession?.current;
  const recoveringRemote = useRef(
    savedRemote &&
      savedRemote.runnerGateway === remoteGateway &&
      savedRemote.lookupGateway === lookupGateway &&
      (savedRemote.clone.current?.request != null || savedRemote.clone.current?.job != null)
      ? { serverId: savedRemote.serverId, workspaceOwner: savedRemote.workspaceOwner }
      : null,
  ).current;

  const restored = useRef(
    saved &&
      (saved.pending.environment === null
        ? saved.localGateway === localGateway
        : saved.remoteGateway === remoteGateway && saved.lookupGateway === lookupGateway)
      ? saved
      : null,
  ).current;
  const operationOwner = useRef({
    localGateway: restored?.localGateway ?? localGateway,
    remoteGateway: restored?.remoteGateway ?? remoteGateway,
    lookupGateway: restored?.lookupGateway ?? lookupGateway,
  });
  const [entryOpen, setEntryOpen] = useState(false);
  const [localDialogOpen, setLocalDialogOpen] = useState(false);
  const [existingServerId, setExistingServerId] = useState<string | null>(null);
  const [cloneWorkspaceOwner, setCloneWorkspaceOwner] = useState(
    restored === null
      ? recoveringRemote === null
        ? options.workspaceRoot
        : recoveringRemote.workspaceOwner
      : restored.workspaceOwner,
  );
  const [serverId, setServerId] = useState(
    restored === null
      ? recoveringRemote === null
        ? options.selectedServerId
        : recoveringRemote.serverId
      : restored.serverId,
  );
  const [remoteAction, setRemoteAction] = useState<"existing" | "clone" | null>(null);
  const [pending, setPending] = useState<Pending | null>(restored?.pending ?? null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(restored?.draft ?? "");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const openReceipt = useRef<{ readonly id: string; readonly path: string } | null>(null);
  const retryDraft = useRef<string | null>(null);
  const stagedLocalDraft = useRef<{
    cloneId: string;
    key: string;
    previous: string;
    merged: string;
  } | null>(null);
  const started = (id: string, name: string, environment: string | null, select = true) => {
    if (pendingRef.current?.id === id && pendingRef.current.environment === environment) {
      if (select) setVisible(true);
      return;
    }
    operationOwner.current = { localGateway, remoteGateway, lookupGateway };
    setPending({ id, name, environment, target: null });
    const key = `clone:${environment ?? "local"}:${id}`;
    const retained = retryDraft.current ?? agentComposerDraftStore.readDraft(key);
    if (retryDraft.current !== null) agentComposerDraftStore.writeDraft(key, retained);
    retryDraft.current = null;
    setDraft(retained);
    setError(null);
    if (select) setVisible(true);
  };
  const ready = (id: string, target: NonNullable<Pending["target"]>) =>
    setPending((current) => (current?.id === id ? { ...current, target } : current));
  const transfer = (
    project: Pick<AgentProjectDescriptor, "rootKey">,
    localCloneId?: string,
  ): boolean => {
    const source = pendingRef.current;
    if (source === null) return false;
    const text = draftRef.current;
    const destination = `new:${project.rootKey}`;
    const stored = agentComposerDraftStore.readDraft(destination);
    const staged = stagedLocalDraft.current;
    const existing =
      localCloneId !== undefined &&
      staged?.cloneId === localCloneId &&
      staged.key === destination &&
      stored === staged.merged
        ? staged.previous
        : stored;
    const merged =
      existing === "" || existing === text
        ? text
        : text === ""
          ? existing
          : `${existing}\n\n${text}`;
    if (new TextEncoder().encode(merged).length > MAX_AGENT_TASK_PROMPT_BYTES) {
      setError("The combined draft is too long. Shorten it before continuing.");
      return false;
    }
    agentComposerDraftStore.writeDraft(destination, merged);
    if (localCloneId !== undefined)
      stagedLocalDraft.current = {
        cloneId: localCloneId,
        key: destination,
        previous: existing,
        merged,
      };
    return true;
  };
  const addProject = useAgentAddProject({
    ...options,
    onProjectAdded(project) {
      const receipt = openReceipt.current;
      openReceipt.current = null;
      if (
        receipt !== null &&
        (receipt.id !== pendingRef.current?.id ||
          receipt.path !== project.rootPath ||
          normalizedWorkspaceRootKey(receipt.path) !== project.rootKey)
      )
        return;
      options.onProjectAdded(project);
      if (receipt !== null) {
        setVisible(false);
        setPending(null);
        local.dismiss();
        retryDraft.current = null;
      }
    },
  });
  const local = useLocalProjectClone({
    gateway: localGateway,
    session: options.chrome?.localCloneSession,
    selectionIdentity: options.selectionIdentity,
    onStarted(id, name, meta) {
      started(id, name, null, meta.select);
      setLocalDialogOpen(false);
    },
    onReady(id, path) {
      ready(id, { kind: "local", path });
    },
  });
  const serverProjects = useMemo(
    () => remoteAddProjectServerProjects(options.projects, serverId),
    [options.projects, serverId],
  );
  const remoteAdd = useRemoteAddProject({
    runnerGateway: remoteGateway,
    lookupGateway,
    serverId,
    workspaceOwner: cloneWorkspaceOwner,
    session: options.chrome?.remoteCloneSession,
    serverProjects,
    selectionIdentity: options.selectionIdentity,
    refreshProjects: options.refreshProjects,
    selectProject(key) {
      const project = options.projects.find((entry) => entry.rootKey === key);
      if (project) options.onProjectAdded(project);
    },
    onCloneStarted(id, name, meta) {
      started(id, name, serverId, meta.select);
    },
    onCloneReady(id, key) {
      ready(id, { kind: "remote", key });
    },
  });
  useEffect(() => {
    if (remoteAction === null) return;
    remoteAdd.openDialog();
    setRemoteAction(null);
  }, [remoteAction, remoteAdd]);
  const previousSelection = useRef(options.selectionIdentity);
  useEffect(() => {
    if (previousSelection.current !== options.selectionIdentity) setVisible(false);
    previousSelection.current = options.selectionIdentity;
  }, [options.selectionIdentity]);
  const changeDraft = useCallback((text: string) => {
    if (text.length > MAX_PENDING_CLONE_DRAFT_CHARS) {
      setError("This draft is too large to retain. Shorten it before pasting more text.");
      return;
    }
    const current = pendingRef.current;
    if (current === null) return;
    agentComposerDraftStore.writeDraft(
      `clone:${current.environment ?? "local"}:${current.id}`,
      text,
    );
    setDraft(text);
    setError(null);
  }, []);
  const ownerCurrent =
    pending === null ||
    (pending.environment === null
      ? operationOwner.current.localGateway === localGateway
      : operationOwner.current.remoteGateway === remoteGateway &&
        operationOwner.current.lookupGateway === lookupGateway);
  if (session !== undefined)
    session.current =
      pending !== null && ownerCurrent && openReceipt.current === null
        ? {
            ...operationOwner.current,
            pending,
            draft,
            serverId,
            workspaceOwner: cloneWorkspaceOwner,
          }
        : null;
  useEffect(() => {
    if (!ownerCurrent) {
      setPending(null);
      setVisible(false);
    }
  }, [ownerCurrent]);
  const restoredRemoteProject = remoteAdd.pendingClone?.projectKey;
  const restoredRemoteId = remoteAdd.pendingClone?.id;
  useEffect(() => {
    if (restoredRemoteProject === undefined || restoredRemoteId === undefined) return;
    setPending((current) =>
      current?.id === restoredRemoteId && current.environment !== null
        ? { ...current, target: { kind: "remote", key: restoredRemoteProject } }
        : current,
    );
  }, [restoredRemoteId, restoredRemoteProject]);
  const continueDraft = () => {
    const current = pendingRef.current;
    if (current?.target == null || !ownerCurrent) return;
    if (current.target.kind === "local") {
      // Opening changes the workspace key and can unmount this hook before its
      // receipt settles. Stage the draft for the exact completed native path first.
      const job = local.job;
      if (
        job?.status !== "completed" ||
        job.cloneId !== current.id ||
        job.path !== current.target.path
      )
        return;
      if (!transfer({ rootKey: normalizedWorkspaceRootKey(job.path) }, job.cloneId)) return;
      openReceipt.current = { id: current.id, path: current.target.path };
      if (session !== undefined) session.current = null;
      const localSession = options.chrome?.localCloneSession;
      if (
        localSession?.current?.gateway === localGateway &&
        localSession.current?.job?.cloneId === job.cloneId
      )
        localSession.current = null;
      addProject.addProject(current.target.path);
      return;
    }
    const key = current.target.key;
    const project = options.projects.find((entry) => entry.rootKey === key);
    if (project === undefined || !transfer(project)) return;
    options.onProjectAdded(project);
    setVisible(false);
    setPending(null);
    remoteAdd.dismissPendingClone();
    retryDraft.current = null;
  };
  const pendingClone =
    pending?.environment === null
      ? local.job?.cloneId === pending.id
        ? {
            id: local.job.cloneId,
            environment: "local" as const,
            name: pending.name,
            status: local.job.status === "completed" ? ("succeeded" as const) : local.job.status,
            error: local.error ?? local.job.error,
          }
        : {
            id: pending.id,
            environment: "local" as const,
            name: pending.name,
            status: "running" as const,
            error: local.error,
          }
      : pending !== null && remoteAdd.pendingClone?.id !== pending.id
        ? null
        : remoteAdd.pendingClone;
  return {
    addProject,
    local,
    remoteAdd,
    entryOpen,
    existingServerProjects:
      existingServerId === null
        ? null
        : remoteAddProjectServerProjects(options.projects, existingServerId),
    closeExisting() {
      setExistingServerId(null);
    },
    selectExisting(key: string) {
      if (existingServerId === null) return;
      const entries = remoteAddProjectServerProjects(options.projects, existingServerId);
      if (!entries.some((entry) => entry.key === key)) return;
      const project = options.projects.find((entry) => entry.rootKey === key);
      if (project === undefined) return;
      setExistingServerId(null);
      options.onProjectAdded(project);
    },
    localDialogOpen,
    pending,
    pendingClone,
    visible,
    draft,
    error,
    canRetry: pending?.environment === null ? true : remoteAdd.canRetryPendingClone === true,
    open() {
      setEntryOpen(true);
    },
    closeEntry() {
      setEntryOpen(false);
    },
    closeLocal() {
      setLocalDialogOpen(false);
    },
    choose(environment: string | null, action: "existing" | "clone") {
      setEntryOpen(false);
      openReceipt.current = null;
      if (action === "existing" && environment !== null) {
        setExistingServerId(environment);
        void options.refreshProjects().catch(() => undefined);
        return;
      }
      if (environment === null) {
        if (action === "existing") addProject.openDialog();
        else if (pending === null) setLocalDialogOpen(true);
      } else {
        if (action === "clone" && pending !== null) return;
        setCloneWorkspaceOwner(options.workspaceRoot);
        setServerId(environment);
        setRemoteAction(action);
      }
    },
    showPending() {
      if (pending === null && remoteAdd.pendingClone?.id !== undefined) {
        const clone = remoteAdd.pendingClone;
        started(clone.id!, clone.name, serverId);
        if (clone.projectKey !== undefined)
          ready(clone.id!, { kind: "remote", key: clone.projectKey });
      } else if (pending !== null) setVisible(true);
    },
    hidePending() {
      openReceipt.current = null;
      setVisible(false);
    },
    changeDraft,
    continueDraft,
    cancel() {
      if (pending?.environment === null) local.cancel();
      else remoteAdd.cancelPendingClone();
    },
    retry() {
      retryDraft.current =
        pending?.environment === null && local.job?.status === "running" ? null : draft;
      if (pending?.environment === null) local.retry();
      else remoteAdd.retryPendingClone();
    },
    dismiss() {
      if (pending?.environment === null) local.dismiss();
      else remoteAdd.dismissPendingClone();
      setVisible(false);
      setPending(null);
      openReceipt.current = null;
      retryDraft.current = null;
    },
  };
}
