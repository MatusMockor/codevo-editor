import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import type { GitFileDiff } from "../../domain/git";
import type { AgentTurnFileDiff } from "../../domain/agentTurnChanges";
import { detectLanguage } from "../../domain/workspace";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { MonacoAppTheme } from "../../domain/settings";
import { AgentTurnChangesCard } from "./AgentTurnChangesCard";
import "./agentRecordedTurnChanges.css";
export type AgentTurnFileDiffReader = NonNullable<AgentThreadsSurface["getTurnFileDiff"]>;

export interface AgentRecordedDiffSource {
  readonly threadId: string;
  readonly turnId: string;
  readonly revision?: object;
  readonly getTurnFileDiff: AgentTurnFileDiffReader;
  readonly monacoTheme: MonacoAppTheme;
}

const Preview = lazy(() =>
  import("../GitDiffPreview").then((m) => ({ default: m.GitDiffPreview })),
);
export interface AgentRecordedTurnSelection {
  readonly threadId: string;
  readonly summary: AgentTurnChangeSummary;
  readonly relativePath?: string;
  readonly revision?: object;
  readonly getTurnFileDiff: AgentTurnFileDiffReader;
}
export function AgentRecordedTurnDiff({
  selection,
  monacoTheme,
  onClose,
  ...editorSettings
}: {
  selection: AgentRecordedTurnSelection;
  monacoTheme: MonacoAppTheme;
  onClose(): void;
  editorFontFamily?: string;
  editorFontSize?: number;
  editorFontLigatures?: boolean;
}) {
  const [chosen, setChosen] = useState<{
    selection: AgentRecordedTurnSelection;
    path: string | null;
  } | null>(null);
  const path =
    chosen?.selection === selection
      ? chosen.path
      : (selection.relativePath ?? selection.summary.files[0]?.relativePath ?? null);
  const setPath = (path: string | null) => setChosen({ selection, path });
  const props = {
    ...editorSettings,
    revision: selection.revision,
    threadId: selection.threadId,
    turnId: selection.summary.turnId,
    getTurnFileDiff: selection.getTurnFileDiff,
    monacoTheme,
  };
  return (
    <section
      className="agent-surface-diff agent-recorded-turn-surface"
      aria-label="Recorded turn diff"
      data-agent-surface-diff
    >
      <header className="agent-surface__subhead">
        <span className="agent-microlabel">Changes in this turn</span>
        <span className="agent-session__spacer" />
        <button
          className="agent-iconbutton"
          type="button"
          onClick={onClose}
          aria-label="Close recorded diff"
        >
          ×
        </button>
      </header>
      <div className="agent-surface-diff__body">
        <div className="agent-surface-diff__list">
          <AgentTurnChangesCard
            summary={selection.summary}
            onOpenDiff={(relativePath) =>
              setPath(relativePath ?? selection.summary.files[0]?.relativePath ?? null)
            }
          />
        </div>
        <div className="agent-surface-diff__preview">
          {selection.summary.state === "ready" &&
          path &&
          selection.summary.files.some((file) => file.relativePath === path) ? (
            <RecordedDiff
              key={path}
              {...props}
              summary={selection.summary}
              relativePath={path}
              onClose={onClose}
            />
          ) : (
            <p className="agent-note">No recorded files are available.</p>
          )}
        </div>
      </div>
    </section>
  );
}
export function RecordedDiff({
  threadId,
  turnId,
  getTurnFileDiff,
  monacoTheme,
  revision,
  editorFontFamily,
  editorFontSize,
  editorFontLigatures,
  summary,
  relativePath,
  onClose,
}: AgentRecordedDiffSource & {
  editorFontFamily?: string;
  editorFontSize?: number;
  editorFontLigatures?: boolean;
  summary: AgentTurnChangeSummary;
  relativePath: string;
  onClose(): void;
}) {
  const identity = useMemo(
    () => ({ threadId, turnId, relativePath, getTurnFileDiff, revision }),
    [threadId, turnId, relativePath, getTurnFileDiff, revision],
  );
  const [result, setResult] = useState<{ identity: object; diff: AgentTurnFileDiff | null } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void getTurnFileDiff(threadId, turnId, relativePath)
      .then((diff) => {
        if (active) setResult({ identity, diff: diff.relativePath === relativePath ? diff : null });
      })
      .catch(() => {
        if (active) setResult({ identity, diff: null });
      });
    return () => {
      active = false;
    };
  }, [identity, getTurnFileDiff, threadId, turnId, relativePath]);
  const loaded = result?.identity === identity;
  const diff = loaded ? result.diff : null;
  const file = summary.files.find((item) => item.relativePath === relativePath);
  const preview: GitFileDiff | null =
    diff && file
      ? {
          change: {
            path: file.relativePath,
            relativePath: file.relativePath,
            oldPath: file.oldRelativePath,
            oldRelativePath: file.oldRelativePath,
            status: file.status,
            isStaged: false,
            isUnversioned: file.status === "untracked",
          },
          language: detectLanguage(relativePath),
          originalContent: diff.original.text,
          modifiedContent: diff.modified.text,
          previewUnavailableReason: diff.unavailableReason,
        }
      : null;
  return (
    <>
      {loaded && diff === null && (
        <p className="agent-note">
          This recorded diff is no longer available.{" "}
          <button type="button" onClick={onClose}>
            Close diff
          </button>
        </p>
      )}
      {diff && (diff.original.truncated || diff.modified.truncated) && (
        <p className="agent-note agent-note--warning">
          This recorded diff is partial because the snapshot reached its size limit.
        </p>
      )}
      {(!loaded || diff !== null) && (
        <div className="agent-recorded-diff__preview">
          <Suspense fallback={<p className="agent-note">Loading the diff viewer…</p>}>
            <Preview
              diff={preview}
              isLoading={!loaded}
              monacoTheme={monacoTheme}
              editorFontFamily={editorFontFamily}
              editorFontSize={editorFontSize}
              editorFontLigatures={editorFontLigatures}
              canRevertChange={false}
              comparisonLabels={{ original: "Before this turn", modified: "After this turn" }}
              previewIdentity={`${threadId}:${turnId}:${relativePath}`}
              onClose={onClose}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
