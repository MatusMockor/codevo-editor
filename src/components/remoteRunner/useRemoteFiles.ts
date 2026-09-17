import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RemoteDirectory,
  RemoteFileContent,
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { remoteFileDrafts } from "../../application/remoteFileDrafts";
import { useRemoteSurfaceLease } from "./useRemoteSurfaceLease";

export type RemoteFilesGateway = Pick<
  RemoteRunnerSurfacesGateway,
  "listDirectory" | "readFile" | "writeFile"
>;

export function useRemoteFiles(scope: RemoteSurfaceScope, gateway: RemoteFilesGateway) {
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
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
  const [path, setPath] = useState("");
  const [offset, setOffset] = useState(0);
  const [file, setFile] = useState<RemoteFileContent | null>(null);
  const [comparison, setComparison] = useState<RemoteFileContent | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setOffset(nextOffset);
      activeFile.current = null;
      setFile(null);
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
    setBusy(true);
    void gateway
      .listDirectory({ ...stableScope, path: "", offset: 0 })
      .then((result) => {
        if (lease.isCurrent() && request === sequence.current) setDirectory(result);
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
