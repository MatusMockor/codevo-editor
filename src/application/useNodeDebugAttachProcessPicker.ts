import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugRuntimeStatus } from "../domain/debug";
import type {
  NodeDebugAttachCandidate,
  NodeDebugAttachCandidateListResult,
} from "../domain/nodeDebugAttachCandidate";

export interface NodeDebugAttachCandidatePresentation {
  readonly presentationId: string;
  readonly label: string;
  readonly detail: string;
  readonly port: number;
}

export type NodeDebugAttachPickerResult =
  | {
      readonly status: "ok";
      readonly candidates: readonly NodeDebugAttachCandidatePresentation[];
      readonly truncated: boolean;
    }
  | {
      readonly status: "unavailable";
    }
  | {
      readonly status: "error";
    };

export interface NodeDebugAttachCandidateListGateway {
  list(rootPath: string): Promise<NodeDebugAttachCandidateListResult>;
}

export type StartNodeDebugAttachCandidate = (
  rootPath: string,
  candidateLeaseId: string,
) => Promise<DebugRuntimeStatus>;

interface NodeDebugAttachProcessPickerOptions {
  readonly enabled: boolean;
  readonly listGateway: NodeDebugAttachCandidateListGateway;
  readonly onManualAttach: () => void;
  readonly rootPath: string | null;
  /**
   * The workbench-owned lifecycle wrapper. It supplies the current debug
   * configuration, starts the gateway request, and adopts the returned session.
   */
  readonly startCandidate: StartNodeDebugAttachCandidate;
}

export interface NodeDebugAttachProcessPickerController {
  readonly isOpen: boolean;
  readonly result: NodeDebugAttachPickerResult | null;
  readonly open: () => void;
  readonly close: () => void;
  readonly retry: () => void;
  readonly selectCandidate: (presentationId: string) => Promise<void>;
  readonly attachByPort: () => void;
}

interface MutableOptions {
  enabled: boolean;
  listGateway: NodeDebugAttachCandidateListGateway;
  onManualAttach: () => void;
  rootPath: string | null;
  startCandidate: StartNodeDebugAttachCandidate;
}

export function useNodeDebugAttachProcessPicker({
  enabled,
  listGateway,
  onManualAttach,
  rootPath,
  startCandidate,
}: NodeDebugAttachProcessPickerOptions): NodeDebugAttachProcessPickerController {
  const optionsRef = useRef<MutableOptions>({
    enabled,
    listGateway,
    onManualAttach,
    rootPath,
    startCandidate,
  });
  optionsRef.current = { enabled, listGateway, onManualAttach, rootPath, startCandidate };

  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<NodeDebugAttachPickerResult | null>(null);
  const capabilitiesRef = useRef(new Map<string, string>());
  const epochRef = useRef(0);
  const isMountedRef = useRef(true);
  const isOpenRef = useRef(false);
  const loadQueuedRef = useRef(false);
  const loadRunnerRef = useRef<Promise<void> | null>(null);
  const presentationSequenceRef = useRef(0);
  const previousRootRef = useRef(rootPath);

  const invalidate = useCallback((nextOpen: boolean) => {
    epochRef.current += 1;
    isOpenRef.current = nextOpen;
    loadQueuedRef.current = false;
    capabilitiesRef.current.clear();
    if (isMountedRef.current) {
      setIsOpen(nextOpen);
      setResult(null);
    }
  }, []);

  const drainLoadQueue = useCallback(async () => {
    while (loadQueuedRef.current && isOpenRef.current) {
      loadQueuedRef.current = false;
      const requestEpoch = epochRef.current;
      const requestRoot = optionsRef.current.rootPath;
      if (!requestRoot) return;

      let listed: NodeDebugAttachCandidateListResult;
      try {
        listed = await optionsRef.current.listGateway.list(requestRoot);
      } catch {
        listed = Object.freeze({ status: "error" });
      }

      if (
        !isMountedRef.current ||
        !isOpenRef.current ||
        epochRef.current !== requestEpoch ||
        optionsRef.current.rootPath !== requestRoot
      ) {
        continue;
      }
      // A queued refresh will revoke this listing in the backend transaction.
      // Never briefly publish an already superseded set of presentation IDs.
      if (loadQueuedRef.current) continue;

      const projection = projectResult(listed, capabilitiesRef.current, presentationSequenceRef);
      setResult(projection);
    }
  }, []);

  const queueLoad = useCallback(() => {
    if (!isOpenRef.current || !optionsRef.current.enabled || !optionsRef.current.rootPath) return;
    loadQueuedRef.current = true;
    capabilitiesRef.current.clear();
    setResult(null);
    if (loadRunnerRef.current) return;

    const runner = drainLoadQueue();
    loadRunnerRef.current = runner;
    void runner.finally(() => {
      if (loadRunnerRef.current === runner) loadRunnerRef.current = null;
      if (loadQueuedRef.current && isOpenRef.current) queueMicrotask(queueLoad);
    });
  }, [drainLoadQueue]);

  const open = useCallback(() => {
    if (!optionsRef.current.enabled || !optionsRef.current.rootPath) return;
    invalidate(true);
    queueMicrotask(queueLoad);
  }, [invalidate, queueLoad]);

  const close = useCallback(() => {
    invalidate(false);
  }, [invalidate]);

  const retry = useCallback(() => {
    queueLoad();
  }, [queueLoad]);

  const selectCandidate = useCallback(
    async (presentationId: string) => {
      if (!optionsRef.current.enabled) {
        invalidate(false);
        return;
      }
      const leaseId = capabilitiesRef.current.get(presentationId);
      if (!leaseId) return;

      // A capability is one-shot in the application layer too. Delete it
      // synchronously before yielding to the injected start lifecycle.
      capabilitiesRef.current.delete(presentationId);
      const selectedRoot = optionsRef.current.rootPath;
      if (!selectedRoot) return;

      invalidate(false);
      const startEpoch = epochRef.current;
      let status: DebugRuntimeStatus;
      try {
        status = await optionsRef.current.startCandidate(selectedRoot, leaseId);
      } catch {
        status = { kind: "error", message: "Node attach could not be started." };
      }

      if (
        status.kind !== "ok" &&
        isMountedRef.current &&
        epochRef.current === startEpoch &&
        optionsRef.current.rootPath === selectedRoot
      ) {
        isOpenRef.current = true;
        setIsOpen(true);
        setResult(Object.freeze({ status: "error" }));
      }
    },
    [invalidate],
  );

  const attachByPort = useCallback(() => {
    const manualAttach = optionsRef.current.onManualAttach;
    invalidate(false);
    manualAttach();
  }, [invalidate]);

  useEffect(() => {
    if (previousRootRef.current === rootPath) return;
    previousRootRef.current = rootPath;
    invalidate(false);
  }, [invalidate, rootPath]);

  useEffect(() => {
    if (!enabled && isOpenRef.current) invalidate(false);
  }, [enabled, invalidate]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      epochRef.current += 1;
      isOpenRef.current = false;
      loadQueuedRef.current = false;
      capabilitiesRef.current.clear();
    },
    [],
  );

  return {
    isOpen,
    result,
    open,
    close,
    retry,
    selectCandidate,
    attachByPort,
  };
}

function projectResult(
  result: NodeDebugAttachCandidateListResult,
  capabilities: Map<string, string>,
  sequence: { current: number },
): NodeDebugAttachPickerResult {
  capabilities.clear();
  if (result.status !== "ok") return Object.freeze({ status: result.status });

  const candidates = result.candidates.map((candidate) =>
    projectCandidate(candidate, capabilities, sequence),
  );
  return Object.freeze({
    status: "ok",
    candidates: Object.freeze(candidates),
    truncated: result.truncated,
  });
}

function projectCandidate(
  candidate: NodeDebugAttachCandidate,
  capabilities: Map<string, string>,
  sequence: { current: number },
): NodeDebugAttachCandidatePresentation {
  sequence.current += 1;
  const presentationId = `node-attach-candidate-${sequence.current}`;
  capabilities.set(presentationId, candidate.candidateLeaseId);
  return Object.freeze({
    presentationId,
    label: candidate.label,
    detail: candidate.detail,
    port: candidate.port,
  });
}
