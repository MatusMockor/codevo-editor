import { createCloneComposerAttachments } from "../../application/cloneComposerAttachments";
import { useEffect, useRef, useState } from "react";
import {
  useAgentProjectCreationLane,
  type AgentProjectCreationOptions,
} from "./useAgentProjectCreationLane";
import {
  type AgentProjectCloneLaneSession,
  MAX_PENDING_PROJECT_CLONES,
} from "./agentProjectCreationSession";

function newSession(): AgentProjectCloneLaneSession {
  return { creation: { current: null }, local: { current: null }, remote: { current: null } };
}

/** Fixed, independently owned lanes keep polling and receipts alive across selections. */
export function useAgentProjectCreation(options: AgentProjectCreationOptions) {
  const [selected, setSelectedState] = useState(
    () => options.chrome?.creationSession?.selectedLane ?? 0,
  );
  const setSelected = (index: number) => {
    if (options.chrome?.creationSession) options.chrome.creationSession.selectedLane = index;
    setSelectedState(index);
  };
  const receiptLane = useRef(options.chrome?.creationSession?.receiptLane);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const fallback = useRef<AgentProjectCloneLaneSession[] | null>(null);
  if (fallback.current === null) fallback.current = [newSession(), newSession(), newSession()];
  const session = options.chrome?.creationSession;
  if (session && !session.lanes) session.lanes = fallback.current;
  const retained = session?.lanes ?? fallback.current;
  const attachmentsRef = useRef<ReturnType<typeof createCloneComposerAttachments> | null>(null);
  if (attachmentsRef.current === null)
    attachmentsRef.current = session?.attachmentDrafts ?? createCloneComposerAttachments();
  if (session) session.attachmentDrafts = attachmentsRef.current;
  const reservations = useRef(new Set<number>());
  reservations.current.clear();
  const laneOptions = (index: number): AgentProjectCreationOptions => ({
    ...options,
    chrome:
      options.chrome === null
        ? null
        : {
            ...options.chrome,
            addProject(path: string) {
              receiptLane.current = index;
              if (session) session.receiptLane = index;
              return options.chrome!.addProject(path);
            },
            // A global workspace-opening receipt has exactly one consumer.
            ...(index !== (receiptLane.current ?? selected) ? { receipt: null } : {}),
            ...(index === 0
              ? {}
              : {
                  creationSession: retained[index - 1].creation,
                  localCloneSession: retained[index - 1].local,
                  remoteCloneSession: retained[index - 1].remote,
                }),
          },
  });
  const first = useAgentProjectCreationLane(laneOptions(0));
  const second = useAgentProjectCreationLane(laneOptions(1));
  const third = useAgentProjectCreationLane(laneOptions(2));
  const fourth = useAgentProjectCreationLane(laneOptions(3));
  const lanes = [first, second, third, fourth];
  const active = lanes[selected];
  const projectedClones = lanes.flatMap((lane, index) =>
    lane.pendingClone === null
      ? []
      : [{ ...lane.pendingClone, id: `${index}:${lane.pendingClone.id ?? "unstarted"}` }],
  );
  // Streaming a conversation must not invalidate the sidebar's unchanged clone rows.
  const pendingClonesRef = useRef(projectedClones);
  if (
    projectedClones.length !== pendingClonesRef.current.length ||
    projectedClones.some((clone, index) => {
      const previous = pendingClonesRef.current[index];
      return (
        previous === undefined ||
        clone.id !== previous.id ||
        clone.name !== previous.name ||
        clone.environment !== previous.environment ||
        clone.projectKey !== previous.projectKey ||
        clone.status !== previous.status ||
        clone.error !== previous.error
      );
    })
  )
    pendingClonesRef.current = projectedClones;
  const pendingClones = pendingClonesRef.current;
  const retainedKeys = useRef<readonly string[]>(session?.attachmentKeys ?? []);
  const currentKeys = lanes.flatMap((lane) =>
    lane.pending
      ? [lane.pending.draftKey ?? `clone:${lane.pending.environment ?? "local"}:${lane.pending.id}`]
      : [],
  );
  useEffect(() => {
    const next = new Set(currentKeys);
    for (const key of retainedKeys.current) {
      if (!next.has(key)) attachmentsRef.current?.removeClone(key);
    }
    retainedKeys.current = currentKeys;
    if (session) session.attachmentKeys = currentKeys;
  }, [currentKeys, session]);
  const laneIndexFor = (id?: string) => {
    if (id === undefined) return selected;
    const exact = lanes.findIndex(
      (lane, index) =>
        lane.pendingClone !== null && `${index}:${lane.pendingClone.id ?? "unstarted"}` === id,
    );
    if (exact >= 0) return exact;
    const matches = lanes.flatMap((lane, index) =>
      lane.pending?.id === id || lane.pendingClone?.id === id ? [index] : [],
    );
    return matches.length === 1 ? matches[0] : -1;
  };
  const laneFor = (id?: string) => lanes[laneIndexFor(id)];
  return {
    ...active,
    cancel(id?: string) {
      laneFor(id)?.cancel();
    },
    dismiss(id?: string) {
      const lane = laneFor(id);
      if (
        !lane ||
        lane.local.pending ||
        lane.pendingClone?.status === "running" ||
        lane.pendingClone?.status === "queued"
      )
        return;
      lane.dismiss();
      setCapacityError(null);
    },
    pendingClones,
    attachmentsStore: attachmentsRef.current,
    capacityError,
    error: capacityError ?? active.error,
    open() {
      setCapacityError(null);
      active.open();
    },
    choose(environment: string | null, action: "existing" | "clone") {
      if (action === "existing") {
        active.choose(environment, action);
        return;
      }
      const index = lanes.findIndex(
        (lane, index) =>
          !reservations.current.has(index) &&
          lane.pending === null &&
          !lane.local.busy &&
          lane.remoteAdd.pendingClone === null &&
          !lane.localDialogOpen &&
          !lane.remoteAdd.open,
      );
      if (index < 0) {
        setCapacityError(
          `You can keep up to ${MAX_PENDING_PROJECT_CLONES} clones open. Finish or remove one before starting another.`,
        );
        return;
      }
      reservations.current.add(index);
      active.closeEntry();
      active.hidePending();
      setCapacityError(null);
      setSelected(index);
      lanes[index].choose(environment, action);
    },
    showPending(id?: string) {
      const index = laneIndexFor(id);
      if (index < 0) return;
      if (index !== selected) active.hidePending();
      setCapacityError(null);
      setSelected(index);
      lanes[index].showPending();
    },
  };
}
