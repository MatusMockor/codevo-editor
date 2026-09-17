import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  RemoteCommitFiles,
  RemoteGitHistory,
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import type { RemoteRunnerTaskFileDiff } from "../../domain/remoteRunner";
import type { MonacoAppTheme } from "../../domain/settings";
import type { GitFileDiff } from "../../domain/git";
import { useRemoteSurfaceLease } from "./useRemoteSurfaceLease";
import "./remoteSurfacePanels.css";

const DiffPreview = lazy(() =>
  import("../GitDiffPreview").then((module) => ({ default: module.GitDiffPreview })),
);
type Props = Readonly<{
  scope: RemoteSurfaceScope;
  gateway: RemoteRunnerSurfacesGateway;
  monacoTheme?: MonacoAppTheme;
}>;
type Selection = Readonly<{
  commit: string;
  files: RemoteCommitFiles;
  diff: RemoteRunnerTaskFileDiff | null;
}>;

export function RemoteGitHistoryPanel(props: Props) {
  const key = JSON.stringify([
    props.scope.serverId,
    props.scope.runnerId,
    props.scope.projectId,
    props.scope.taskId ?? null,
  ]);
  const { serverId, runnerId, projectId, taskId } = props.scope;
  const scope = useMemo(
    () => ({ serverId, runnerId, projectId, ...(taskId === undefined ? {} : { taskId }) }),
    [serverId, runnerId, projectId, taskId],
  );
  return <HistoryContent key={key} {...props} scope={scope} />;
}

function HistoryContent({ scope, gateway, monacoTheme = "calm-dark" }: Props) {
  const lease = useRemoteSurfaceLease(scope);
  const [offsets, setOffsets] = useState([0]);
  const [page, setPage] = useState<RemoteGitHistory | null>(null);
  const [fileOffset, setFileOffset] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const offset = offsets[offsets.length - 1];
  useEffect(() => {
    const request = ++generation.current;
    setBusy(true);
    setPage(null);
    setSelection(null);
    setError(null);
    const current = () => lease.isCurrent() && generation.current === request;
    void gateway
      .history({ ...scope, offset })
      .then(
        (result) => {
          if (current()) setPage(result);
        },
        () => {
          if (current())
            setError("Could not load server history. Check the server connection and retry.");
        },
      )
      .finally(() => {
        if (current()) setBusy(false);
      });
  }, [gateway, lease, offset, refresh, scope]);

  async function chooseCommit(commit: string) {
    setFileOffset(0);
    const request = ++generation.current;
    setBusy(true);
    setSelection(null);
    setError(null);
    try {
      const files = await gateway.commitFiles({ ...scope, commit });
      if (lease.isCurrent() && generation.current === request)
        setSelection({ commit, files, diff: null });
    } catch {
      if (lease.isCurrent() && generation.current === request)
        setError("Could not load this commit's files. Select the commit to retry.");
    } finally {
      if (lease.isCurrent() && generation.current === request) setBusy(false);
    }
  }
  async function chooseFile(path: string) {
    if (!selection) return;
    const captured = selection;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    setSelection({ ...captured, diff: null });
    try {
      const diff = await gateway.commitDiff({ ...scope, commit: captured.commit, path });
      if (lease.isCurrent() && generation.current === request) setSelection({ ...captured, diff });
    } catch {
      if (lease.isCurrent() && generation.current === request)
        setError("Could not load this server diff. Select the file to retry.");
    } finally {
      if (lease.isCurrent() && generation.current === request) setBusy(false);
    }
  }
  function closeCommit() {
    generation.current++;
    setSelection(null);
    setBusy(false);
    setError(null);
  }
  const diff = selection?.diff;
  const file = selection?.files.files.find((item) => item.path === diff?.path);
  const preview: GitFileDiff | null =
    diff && file
      ? {
          change: {
            path: file.path,
            relativePath: file.path,
            oldPath: file.oldPath ?? null,
            oldRelativePath: file.oldPath ?? null,
            isStaged: false,
            isUnversioned: false,
            status: file.status,
          },
          language: "plaintext",
          originalContent: diff.original.text,
          modifiedContent: diff.modified.text,
          previewUnavailableReason: diff.unavailableReason,
        }
      : null;
  return (
    <section aria-label="Server Git history" className="remote-surface-panel">
      <header className="remote-surface-toolbar">
        <strong>{selection ? `Commit ${selection.commit.slice(0, 8)}` : "History"}</strong>
        {selection && (
          <button type="button" onClick={closeCommit}>
            Back to history
          </button>
        )}
        <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
          Refresh history
        </button>
      </header>
      {busy && (
        <p role="status" className="remote-surface-note">
          Loading server history…
        </p>
      )}
      {error && (
        <p role="alert" className="remote-surface-error">
          {error}
        </p>
      )}
      {!selection && page && (
        <>
          <div className="remote-surface-list" aria-label="Commits">
            {page.commits.map((commit) => (
              <button
                className="remote-surface-row"
                type="button"
                key={commit.id}
                onClick={() => void chooseCommit(commit.id)}
              >
                <code>{commit.id.slice(0, 8)}</code>
                <span>
                  {commit.subject}
                  <small>
                    {" "}
                    · {commit.authorName} · {commit.authoredAt}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {page.commits.length === 0 && (
            <p className="remote-surface-note">No commits in this checkout.</p>
          )}
          {page.truncated && (
            <p className="remote-surface-note">Showing a bounded page of server history.</p>
          )}
          <nav className="remote-surface-toolbar" aria-label="History pages">
            <button
              type="button"
              disabled={busy || offsets.length === 1}
              onClick={() => setOffsets((values) => values.slice(0, -1))}
            >
              Previous commits
            </button>
            <button
              type="button"
              disabled={busy || page.nextOffset === null}
              onClick={() => {
                if (page.nextOffset !== null) setOffsets((values) => [...values, page.nextOffset!]);
              }}
            >
              Older commits
            </button>
          </nav>
        </>
      )}
      {selection && (
        <>
          <div className="remote-surface-list" aria-label="Commit files">
            {selection.files.files.slice(fileOffset, fileOffset + 100).map((item) => (
              <button
                type="button"
                className="remote-surface-row"
                aria-current={diff?.path === item.path}
                key={item.path}
                onClick={() => void chooseFile(item.path)}
              >
                <span>{item.status}</span>
                <span>
                  {item.oldPath ? `${item.oldPath} → ` : ""}
                  {item.path}
                </span>
              </button>
            ))}
          </div>
          {selection.files.files.length > 100 && (
            <nav className="remote-surface-toolbar" aria-label="Commit file pages">
              <button
                type="button"
                disabled={fileOffset === 0}
                onClick={() => setFileOffset((value) => Math.max(0, value - 100))}
              >
                Previous files
              </button>
              <span>
                {fileOffset + 1}–{Math.min(fileOffset + 100, selection.files.files.length)} of{" "}
                {selection.files.files.length} files
              </span>
              <button
                type="button"
                disabled={fileOffset + 100 >= selection.files.files.length}
                onClick={() => setFileOffset((value) => value + 100)}
              >
                Next files
              </button>
            </nav>
          )}
          {selection.files.files.length === 0 && (
            <p className="remote-surface-note">No changed files in this commit.</p>
          )}
          {selection.files.truncated && (
            <p className="remote-surface-note">
              This commit's file list is incomplete because it exceeded the server limit.
            </p>
          )}
          {diff && (diff.original.truncated || diff.modified.truncated) && (
            <p role="status" className="remote-surface-note">
              This diff is incomplete because it exceeded the server preview limit.
            </p>
          )}
          {preview && (
            <div className="remote-surface-editor remote-surface-diff">
              <Suspense fallback={<p className="remote-surface-note">Loading diff…</p>}>
                <DiffPreview
                  diff={preview}
                  isLoading={false}
                  monacoTheme={monacoTheme}
                  canRevertChange={false}
                  comparisonLabels={{ original: "Parent", modified: "Commit" }}
                  previewIdentity={`${lease.key}:${selection.commit}:${diff?.path}`}
                  onClose={() => {
                    generation.current++;
                    setSelection({ ...selection, diff: null });
                  }}
                />
              </Suspense>
            </div>
          )}
        </>
      )}
    </section>
  );
}
