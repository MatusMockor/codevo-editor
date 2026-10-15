import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  remoteSurfaceScopeKey,
  type RemoteDirectory,
  type RemoteFileContent,
  type RemoteRunnerSurfacesGateway,
  type RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import {
  remoteFileContentOutcome,
  remoteFileParentPath,
  remoteFileReadFailureOutcome,
  type RemoteFileRevealTarget,
} from "../../domain/remoteFileReveal";
import type { RemoteFileRevealRequest } from "../../application/remoteFileRevealRequest";
import { useRemoteSurfaceLease } from "./useRemoteSurfaceLease";

export type RemoteFileRevealPosition = RemoteFileRevealTarget & Readonly<{ id: number }>;

export type RemoteFilesGateway = Pick<RemoteRunnerSurfacesGateway, "listDirectory" | "readFile">;

export function useRemoteFiles(
  scope: RemoteSurfaceScope,
  gateway: RemoteFilesGateway,
  reveal: RemoteFileRevealRequest | null = null,
) {
  const { serverId, runnerId, projectId, taskId } = scope;
  const stableScope = useMemo(
    () => ({ serverId, runnerId, projectId, ...(taskId === undefined ? {} : { taskId }) }),
    [serverId, runnerId, projectId, taskId],
  );
  const lease = useRemoteSurfaceLease(stableScope);
  const sequence = useRef(0);
  const activeFile = useRef<RemoteFileContent | null>(null);
  const shownDirectory = useRef<string | null>(null);
  const revealRun = useRef<{ readonly id: number; readonly sequenceId: number } | null>(null);
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
  const [path, setPath] = useState("");
  const [offset, setOffset] = useState(0);
  const [file, setFile] = useState<RemoteFileContent | null>(null);
  const [comparison, setComparison] = useState<RemoteFileContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealAt, setRevealAt] = useState<RemoteFileRevealPosition | null>(null);
  const fail = (reason: unknown) =>
    setError(
      reason instanceof Error ? reason.message : "The server could not complete this operation.",
    );
  const showFile = (next: RemoteFileContent | null) => {
    activeFile.current = next;
    setFile(next);
    setComparison(null);
  };

  async function browse(nextPath: string, nextOffset = 0) {
    if (!lease.isCurrent()) return;
    const request = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.listDirectory({ ...scope, path: nextPath, offset: nextOffset });
      if (!lease.isCurrent() || request !== sequence.current) return;
      setDirectory(result);
      setPath(nextPath);
      shownDirectory.current = nextPath;
      setOffset(nextOffset);
      showFile(null);
      setRevealAt(null);
    } catch (reason) {
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      if (lease.isCurrent() && request === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    const request = ++sequence.current;
    setDirectory(null);
    shownDirectory.current = null;
    activeFile.current = null;
    setFile(null);
    setPath("");
    setOffset(0);
    setError(null);
    setComparison(null);
    setRevealAt(null);
    setBusy(true);
    void gateway
      .listDirectory({ ...stableScope, path: "", offset: 0 })
      .then((result) => {
        if (!lease.isCurrent() || request !== sequence.current) return;
        setDirectory(result);
        shownDirectory.current = "";
      })
      .catch((reason) => {
        if (lease.isCurrent() && request === sequence.current) fail(reason);
      })
      .finally(() => {
        if (lease.isCurrent() && request === sequence.current) setBusy(false);
      });
  }, [gateway, lease, stableScope]);

  async function open(nextPath: string) {
    if (!lease.isCurrent()) return;
    const request = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.readFile({ ...scope, path: nextPath });
      if (!lease.isCurrent() || request !== sequence.current) return;
      showFile(result);
      setRevealAt(null);
    } catch (reason) {
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      if (lease.isCurrent() && request === sequence.current) setBusy(false);
    }
  }
  async function revealFile(request: RemoteFileRevealRequest) {
    if (!lease.isCurrent() || remoteSurfaceScopeKey(request.scope) !== lease.key) {
      request.settle("superseded");
      return;
    }
    request.accept();
    const target = request.target;
    const sequenceId = ++sequence.current;
    revealRun.current = { id: request.id, sequenceId };
    const owned = () => lease.isCurrent() && sequenceId === sequence.current;
    const superseded = () => {
      const run = revealRun.current;
      if (run !== null && run.id === request.id && run.sequenceId !== sequenceId) return;
      request.settle("superseded");
    };
    let read = false;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.readFile({ ...scope, path: target.path });
      if (!owned()) return superseded();
      showFile(result);
      setRevealAt(result.unavailableReason === null ? { ...target, id: request.id } : null);
      read = true;
      request.settle(remoteFileContentOutcome(result));
    } catch (reason) {
      if (!owned()) return superseded();
      fail(reason);
      request.settle(remoteFileReadFailureOutcome(reason));
    } finally {
      if (owned()) setBusy(false);
    }
    if (!owned()) return;
    const candidates = revealDirectoryCandidates(
      read ? remoteFileParentPath(target.path) : null,
      shownDirectory.current,
    );
    for (const candidate of candidates) {
      const directory = await gateway
        .listDirectory({ ...scope, path: candidate, offset: 0 })
        .catch(() => null);
      if (!owned()) return;
      if (directory === null) continue;
      setDirectory(directory);
      setPath(candidate);
      setOffset(0);
      shownDirectory.current = candidate;
      return;
    }
  }
  const latestReveal = useRef(revealFile);
  useLayoutEffect(() => {
    latestReveal.current = revealFile;
  });
  useEffect(() => {
    if (reveal === null) return;
    void latestReveal.current(reveal);
  }, [reveal]);
  async function compare() {
    const shown = activeFile.current;
    if (!lease.isCurrent() || busy || shown === null || shown !== file) return;
    if (shown.unavailableReason !== null) return;
    const request = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const latest = await gateway.readFile({ ...scope, path: shown.path });
      if (!lease.isCurrent() || request !== sequence.current || activeFile.current !== shown)
        return;
      if (latest.unavailableReason !== null) {
        setError("The server file cannot be compared as text.");
        return;
      }
      setComparison(latest);
    } catch (reason) {
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      if (lease.isCurrent() && request === sequence.current) setBusy(false);
    }
  }
  function showLatest() {
    if (!lease.isCurrent() || busy || comparison === null || activeFile.current !== file) return;
    showFile(comparison);
    setRevealAt(null);
  }
  function closeComparison() {
    if (!lease.isCurrent()) return;
    setComparison(null);
  }
  return {
    directory,
    path,
    offset,
    file,
    busy,
    error,
    comparison,
    revealAt,
    browse,
    open,
    compare,
    showLatest,
    closeComparison,
  };
}

function revealDirectoryCandidates(
  parent: string | null,
  shown: string | null,
): ReadonlyArray<string> {
  if (parent === null) return shown === null ? [""] : [];
  if (parent === shown) return [];
  if (shown === null && parent !== "") return [parent, ""];
  return [parent];
}
