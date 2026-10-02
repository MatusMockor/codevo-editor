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
import { remoteFileDrafts } from "../../application/remoteFileDrafts";
import type { RemoteFileRevealRequest } from "../../application/remoteFileRevealRequest";
import { useRemoteSurfaceLease } from "./useRemoteSurfaceLease";

export type RemoteFileRevealPosition = RemoteFileRevealTarget & Readonly<{ id: number }>;

export type RemoteFilesGateway = Pick<
  RemoteRunnerSurfacesGateway,
  "listDirectory" | "readFile" | "writeFile"
>;

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
  const saving = useRef(false);
  const activeFile = useRef<RemoteFileContent | null>(null);
  const loadingFile = useRef(false);
  const shownDirectory = useRef<string | null>(null);
  const revealRun = useRef<{ readonly id: number; readonly sequenceId: number } | null>(null);
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
  const [path, setPath] = useState("");
  const [offset, setOffset] = useState(0);
  const [file, setFile] = useState<RemoteFileContent | null>(null);
  const [comparison, setComparison] = useState<RemoteFileContent | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealAt, setRevealAt] = useState<RemoteFileRevealPosition | null>(null);
  const dirty = file !== null && file.text !== text;
  const fail = (reason: unknown) =>
    setError(
      reason instanceof Error ? reason.message : "The server could not complete this operation.",
    );

  useEffect(
    () =>
      remoteFileDrafts.subscribe(stableScope, (event) => {
        if (
          !lease.isCurrent() ||
          activeFile.current?.path !== event.file.path ||
          activeFile.current.version !== event.expectedVersion
        )
          return;
        activeFile.current = event.file;
        setFile(event.file);
        setText(event.text);
        setComparison(null);
      }),
    [stableScope, lease],
  );

  async function browse(nextPath: string, nextOffset = 0) {
    if (!lease.isCurrent() || saving.current || dirty) return;
    const request = ++sequence.current;
    loadingFile.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.listDirectory({ ...scope, path: nextPath, offset: nextOffset });
      if (!lease.isCurrent() || request !== sequence.current) return;
      setDirectory(result);
      setPath(nextPath);
      shownDirectory.current = nextPath;
      setOffset(nextOffset);
      activeFile.current = null;
      setFile(null);
      setRevealAt(null);
      setComparison(null);
    } catch (reason) {
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      if (lease.isCurrent() && request === sequence.current) {
        loadingFile.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const request = ++sequence.current;
    const draft = remoteFileDrafts.first(stableScope);
    setDirectory(null);
    shownDirectory.current = null;
    const restoredFile: RemoteFileContent | null = draft
      ? {
          path: draft.path,
          text: draft.original,
          version: draft.version,
          unavailableReason: null,
        }
      : null;
    activeFile.current = restoredFile;
    setFile(restoredFile);
    setText(draft?.text ?? "");
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
        if (lease.isCurrent() && request === sequence.current) {
          loadingFile.current = false;
          setBusy(false);
        }
      });
  }, [gateway, lease, stableScope]);

  async function open(nextPath: string) {
    if (!lease.isCurrent() || saving.current || dirty) return;
    const request = ++sequence.current;
    loadingFile.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.readFile({ ...scope, path: nextPath });
      if (!lease.isCurrent() || request !== sequence.current) return;
      const draft = remoteFileDrafts.get(scope, nextPath);
      const opened = draft ? { ...result, text: draft.original, version: draft.version } : result;
      activeFile.current = opened;
      setFile(opened);
      setComparison(null);
      setRevealAt(null);
      setText(draft?.text ?? result.text);
    } catch (reason) {
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      if (lease.isCurrent() && request === sequence.current) {
        loadingFile.current = false;
        setBusy(false);
      }
    }
  }
  async function revealFile(request: RemoteFileRevealRequest) {
    if (!lease.isCurrent() || remoteSurfaceScopeKey(request.scope) !== lease.key) {
      request.settle("superseded");
      return;
    }
    request.accept();
    const target = request.target;
    const shown = activeFile.current?.path === target.path;
    if (saving.current && !shown) {
      request.settle("saveInProgress");
      return;
    }
    if (remoteFileDrafts.hasDraftOutside(scope, target.path)) {
      request.settle("unsavedChanges");
      return;
    }
    if (shown && (saving.current || remoteFileDrafts.get(scope, target.path) !== undefined)) {
      setRevealAt({ ...target, id: request.id });
      request.settle("opened");
      return;
    }
    const sequenceId = ++sequence.current;
    revealRun.current = { id: request.id, sequenceId };
    const owned = () => lease.isCurrent() && sequenceId === sequence.current;
    const superseded = () => {
      const run = revealRun.current;
      if (run !== null && run.id === request.id && run.sequenceId !== sequenceId) return;
      request.settle("superseded");
    };
    let read = false;
    loadingFile.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.readFile({ ...scope, path: target.path });
      if (!owned()) return superseded();
      const draft = remoteFileDrafts.get(scope, target.path);
      const opened = draft ? { ...result, text: draft.original, version: draft.version } : result;
      activeFile.current = opened;
      setFile(opened);
      setComparison(null);
      setText(draft?.text ?? result.text);
      setRevealAt(result.unavailableReason === null ? { ...target, id: request.id } : null);
      read = true;
      request.settle(remoteFileContentOutcome(result));
    } catch (reason) {
      if (!owned()) return superseded();
      fail(reason);
      request.settle(remoteFileReadFailureOutcome(reason));
    } finally {
      if (owned()) {
        loadingFile.current = false;
        setBusy(false);
      }
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
  async function save() {
    if (
      !lease.isCurrent() ||
      saving.current ||
      loadingFile.current ||
      activeFile.current !== file ||
      file?.version == null ||
      !dirty
    )
      return;
    const currentFile = file;
    const submitted = text;
    const ticket = remoteFileDrafts.beginSave(scope, currentFile.path, currentFile.version!);
    if (!ticket) {
      setError("Wait for another server file save to finish before saving again.");
      return;
    }
    const request = ++sequence.current;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.writeFile({
        ...scope,
        path: currentFile.path,
        text: submitted,
        expectedVersion: currentFile.version!,
      });
      remoteFileDrafts.completeSave(scope, ticket, result);
      if (!lease.isCurrent() || request !== sequence.current) return;
      setComparison(null);
    } catch (reason) {
      remoteFileDrafts.failSave(ticket);
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      saving.current = false;
      if (lease.isCurrent() && request === sequence.current) {
        loadingFile.current = false;
        setBusy(false);
      }
    }
  }
  async function compare() {
    if (!lease.isCurrent() || busy || !file || activeFile.current !== file) return;
    const request = ++sequence.current;
    loadingFile.current = true;
    setBusy(true);
    setError(null);
    try {
      const latest = await gateway.readFile({ ...scope, path: file.path });
      if (!lease.isCurrent() || request !== sequence.current) return;
      if (latest.unavailableReason || latest.version === null) {
        setError("The server file cannot be compared as text.");
        return;
      }
      setComparison(latest);
    } catch (reason) {
      if (lease.isCurrent() && request === sequence.current) fail(reason);
    } finally {
      if (lease.isCurrent() && request === sequence.current) {
        loadingFile.current = false;
        setBusy(false);
      }
    }
  }
  function resolveComparison(keepMine: boolean) {
    if (
      !lease.isCurrent() ||
      busy ||
      !comparison ||
      !comparison.version ||
      !file ||
      activeFile.current !== file
    )
      return;
    if (keepMine && text !== comparison.text) {
      if (
        !remoteFileDrafts.put(scope, {
          path: comparison.path,
          text,
          original: comparison.text,
          version: comparison.version,
        })
      ) {
        setError("Save or discard another unsaved server file before keeping this comparison.");
        return;
      }
    } else remoteFileDrafts.remove(scope, file.path);
    activeFile.current = comparison;
    setFile(comparison);
    if (!keepMine) setText(comparison.text);
    setComparison(null);
    setError(null);
  }
  return {
    directory,
    path,
    offset,
    file,
    text,
    busy,
    error,
    dirty,
    comparison,
    revealAt,
    compare,
    resolveComparison,
    canEdit: !busy || saving.current,
    browse,
    open,
    save,
    edit: (value: string) => {
      if (
        !lease.isCurrent() ||
        loadingFile.current ||
        activeFile.current !== file ||
        !file ||
        file.version === null
      )
        return;
      if (value === file.text && !remoteFileDrafts.isSaving(scope, file.path))
        remoteFileDrafts.remove(scope, file.path);
      else if (
        !remoteFileDrafts.put(scope, {
          path: file.path,
          text: value,
          original: file.text,
          version: file.version,
        })
      ) {
        setError("Save or discard another unsaved server file before adding more edits.");
        return;
      }
      setText(value);
    },
    discard: () => {
      if (lease.isCurrent() && !busy && file && activeFile.current === file) {
        remoteFileDrafts.remove(scope, file.path);
        setText(file.text);
        setComparison(null);
        setError(null);
      }
    },
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
