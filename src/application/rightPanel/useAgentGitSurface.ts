import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { withBoundedEntry } from "../../domain/boundedKeyedMap";
import { generateCommitMessage } from "../../domain/commitMessageDraft";
import type { GitChangeStatus, GitChangedFile, GitGateway } from "../../domain/git";
import {
  includeSelection,
  includeSummary,
  mergeChangesByPath,
  pruneExcluded,
  setAllIncluded,
  setIncluded,
  type CommitIncludeSummary,
} from "../../domain/gitCommitSelection";
import type { GitLineStat } from "../../domain/gitSurfaceStatus";
import { useLatest } from "../../ui/foundation/useLatest";
import type { AgentGitCommitOutcome, AgentGitCommitPort } from "./projectGitCommitPort";

export const MAX_COMMIT_MESSAGE_DRAFTS = 32;
export const MAX_REMEMBERED_OUTCOMES = 16;

export interface AgentGitChangeRow {
  readonly relativePath: string;
  readonly status: GitChangeStatus;
  readonly added: number | null;
  readonly deleted: number | null;
  readonly included: boolean;
}

export type AgentGitBusy = "idle" | "committing" | "pushing";

export interface AgentGitNotice {
  readonly kind: "ok" | "error";
  readonly text: string;
}

export interface AgentGitSurfaceState {
  readonly rows: ReadonlyArray<AgentGitChangeRow>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly summary: CommitIncludeSummary;
  readonly message: string;
  readonly busy: AgentGitBusy;
  readonly notice: AgentGitNotice | null;
  setMessage(message: string): void;
  setRowIncluded(relativePath: string, include: boolean): void;
  setAllIncluded(include: boolean): void;
  generate(): void;
  commit(): void;
  commitAndPush(): void;
  refresh(): void;
}

export interface UseAgentGitSurfaceOptions {
  readonly ownerKey: string | null;
  readonly rootPath: string | null;
  readonly git: Pick<GitGateway, "getStatus"> | null;
  readonly lineStats: ReadonlyArray<GitLineStat>;
  readonly port: AgentGitCommitPort | null;
  readonly threadTitle: string | null;
  readonly revision?: unknown;
  onCommitted(): void;
}

interface OwnerRun {
  readonly busy: AgentGitBusy;
  readonly notice: AgentGitNotice | null;
}

interface KeyedChanges {
  readonly key: string | null;
  readonly files: ReadonlyArray<GitChangedFile>;
}

const STATUS_FAILURE = "Git status is unavailable.";

export function useAgentGitSurface(options: UseAgentGitSurfaceOptions): AgentGitSurfaceState {
  const { lineStats, ownerKey, revision, rootPath, threadTitle } = options;
  const [changes, setChanges] = useState<KeyedChanges>({ key: null, files: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [runs, setRuns] = useState<ReadonlyMap<string, OwnerRun>>(() => new Map());
  const [nonce, setNonce] = useState(0);
  const loadGeneration = useRef(0);
  const activeKey = useRef<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const ownerRef = useLatest(ownerKey);
  const gitRef = useLatest(options.git);
  const portRef = useLatest(options.port);
  const onCommittedRef = useLatest(options.onCommitted);
  const statusKey =
    ownerKey === null || rootPath === null ? null : JSON.stringify([ownerKey, rootPath]);

  useLayoutEffect(() => {
    activeKey.current = statusKey;
    setExcluded(new Set());
    setError(null);
    return () => {
      activeKey.current = null;
    };
  }, [statusKey]);

  useEffect(() => {
    loadGeneration.current += 1;
    const current = loadGeneration.current;
    const gateway = gitRef.current;
    if (statusKey === null || rootPath === null || gateway === null) {
      setChanges({ key: statusKey, files: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    gateway.getStatus(rootPath).then(
      (status) => {
        if (loadGeneration.current !== current) return;
        setChanges({ key: statusKey, files: mergeChangesByPath(status.changes) });
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (loadGeneration.current !== current) return;
        setError(
          reason instanceof Error && reason.message.length > 0 ? reason.message : STATUS_FAILURE,
        );
        setLoading(false);
      },
    );
  }, [gitRef, nonce, revision, rootPath, statusKey]);

  useEffect(
    () => () => {
      loadGeneration.current += 1;
    },
    [],
  );

  const files = changes.key === statusKey ? changes.files : EMPTY_FILES;
  const paths = useMemo(() => files.map((file) => file.relativePath), [files]);
  const effectiveExcluded = useMemo(() => pruneExcluded(excluded, paths), [excluded, paths]);
  const stats = useMemo(
    () => new Map(lineStats.map((stat) => [stat.relativePath, stat])),
    [lineStats],
  );
  const rows = useMemo<ReadonlyArray<AgentGitChangeRow>>(
    () =>
      files.map((file) => ({
        relativePath: file.relativePath,
        status: file.status,
        added: stats.get(file.relativePath)?.added ?? null,
        deleted: stats.get(file.relativePath)?.deleted ?? null,
        included: !effectiveExcluded.has(file.relativePath),
      })),
    [effectiveExcluded, files, stats],
  );
  const summary = useMemo(
    () => includeSummary(paths, effectiveExcluded),
    [effectiveExcluded, paths],
  );
  const message = ownerKey === null ? "" : (drafts.get(ownerKey) ?? "");
  const ownerRun = (statusKey === null ? undefined : runs.get(statusKey)) ?? IDLE_RUN;

  const setMessage = useCallback(
    (next: string) => {
      const owner = ownerRef.current;
      if (owner === null) return;
      setDrafts((current) =>
        withBoundedEntry(current, owner, nonEmpty(next), MAX_COMMIT_MESSAGE_DRAFTS),
      );
    },
    [ownerRef],
  );

  const generated = (): string =>
    generateCommitMessage({
      files: rows
        .filter((row) => row.included)
        .map((row) => ({ relativePath: row.relativePath, status: row.status })),
      threadTitle,
    });

  const settle = (owner: string, key: string, outcome: AgentGitCommitOutcome): void => {
    inFlight.current.delete(key);
    const notice =
      outcome.kind === "failed" ? errorNotice(outcome.message) : successNotice(outcome);
    setRuns((current) =>
      withBoundedEntry(current, key, { busy: "idle", notice }, MAX_REMEMBERED_OUTCOMES),
    );
    if (outcome.kind === "failed") {
      if (activeKey.current === key) setNonce((value) => value + 1);
      return;
    }
    setDrafts((current) => withBoundedEntry(current, owner, null, MAX_COMMIT_MESSAGE_DRAFTS));
    if (activeKey.current !== key) return;
    setExcluded(new Set());
    setNonce((value) => value + 1);
    onCommittedRef.current();
  };

  const run = (push: boolean): void => {
    const owner = ownerRef.current;
    const key = activeKey.current;
    const port = portRef.current;
    if (owner === null || key === null || port === null || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const selection = includeSelection(paths, effectiveExcluded);
    const text = message.trim().length > 0 ? message.trim() : generated();
    const busy: AgentGitBusy = push ? "pushing" : "committing";
    setRuns((current) =>
      withBoundedEntry(current, key, { busy, notice: null }, MAX_REMEMBERED_OUTCOMES),
    );
    const pending = push ? port.commitAndPush(text, selection) : port.commit(text, selection);
    void pending.then(
      (outcome) => settle(owner, key, outcome),
      (reason: unknown) =>
        settle(owner, key, {
          kind: "failed",
          message: reason instanceof Error ? reason.message : "Git reported an error.",
        }),
    );
  };

  return {
    rows,
    loading,
    error,
    summary,
    message,
    busy: ownerRun.busy,
    notice: ownerRun.notice,
    setMessage,
    setRowIncluded: (relativePath, include) =>
      setExcluded((current) => setIncluded(current, relativePath, include)),
    setAllIncluded: (include) => setExcluded(setAllIncluded(paths, include)),
    generate: () => setMessage(generated()),
    commit: () => run(false),
    commitAndPush: () => run(true),
    refresh: () => setNonce((value) => value + 1),
  };
}

const EMPTY_FILES: ReadonlyArray<GitChangedFile> = [];
const IDLE_RUN: OwnerRun = { busy: "idle", notice: null };

function successNotice(
  outcome: Exclude<AgentGitCommitOutcome, { kind: "failed" }>,
): AgentGitNotice {
  switch (outcome.kind) {
    case "committed":
      return { kind: "ok", text: "Committed." };
    case "pushed":
      return { kind: "ok", text: "Committed and pushed." };
    case "pushFailed":
      return { kind: "error", text: outcome.message };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

function errorNotice(text: string): AgentGitNotice {
  return { kind: "error", text };
}

function nonEmpty(value: string): string | null {
  return value.length > 0 ? value : null;
}
