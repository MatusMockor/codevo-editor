import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  MAX_RENDERED_DIFF_LINES_PER_FILE,
  groupDiffHunks,
  limitDiffHunks,
  type DiffHunk,
} from "../../domain/diffView/diffHunks";
import type { DiffViewComputationGateway } from "../diffViewComputation";
import type { AgentDiffFile, AgentDiffSidesUnavailable, AgentDiffSource } from "./agentDiffSources";

export const MAX_EXPANDED_DIFF_FILES = 12;
export const INITIALLY_EXPANDED_DIFF_FILES = 3;
export const DIFF_TOO_LARGE_REASON = "This diff is too large to show here. Open it in the editor.";

const UNAVAILABLE_REASONS: Readonly<Record<AgentDiffSidesUnavailable, string>> = {
  binary: "Binary file. Open it in the editor to inspect it.",
  large: "This file is too large to show here. Open it in the editor.",
  missing: "This file no longer has changes. Refresh the diff.",
};

export type AgentDiffFileBody =
  | { readonly kind: "collapsed" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly hunks: ReadonlyArray<DiffHunk>;
      readonly added: number;
      readonly deleted: number;
      readonly hiddenChangedLines: number;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface AgentDiffFileView {
  readonly file: AgentDiffFile;
  readonly body: AgentDiffFileBody;
}

export type AgentDiffListStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly truncated: boolean; readonly statsPartial: boolean }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly message: string };

export interface AgentDiffRevealRequest {
  readonly relativePath: string;
}

export interface AgentDiffRevealed {
  readonly request: AgentDiffRevealRequest;
  readonly displayPath: string;
}

export interface AgentDiffSurfaceState {
  readonly status: AgentDiffListStatus;
  readonly files: ReadonlyArray<AgentDiffFileView>;
  readonly revealed: AgentDiffRevealed | null;
  readonly reloadError: string | null;
  toggleFile(displayPath: string): void;
  revealFile(displayPath: string): void;
  collapseAll(): void;
  refresh(): void;
}

export interface UseAgentDiffSurfaceOptions {
  readonly source: AgentDiffSource | null;
  readonly computation: DiffViewComputationGateway;
  readonly ignoreWhitespace: boolean;
  readonly reveal: AgentDiffRevealRequest | null;
}

interface ListState {
  readonly key: string | null;
  readonly identity: string | null;
  readonly source: AgentDiffSource | null;
  readonly status: AgentDiffListStatus;
  readonly files: ReadonlyArray<AgentDiffFile>;
  readonly reloadError: string | null;
}

const IDLE_LIST: ListState = {
  key: null,
  identity: null,
  source: null,
  status: { kind: "idle" },
  files: [],
  reloadError: null,
};

export function useAgentDiffSurface({
  computation,
  ignoreWhitespace,
  reveal,
  source,
}: UseAgentDiffSurfaceOptions): AgentDiffSurfaceState {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [list, setList] = useState<ListState>(IDLE_LIST);
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([]);
  const [bodies, setBodies] = useState<ReadonlyMap<string, AgentDiffFileBody>>(() => new Map());
  const [revealed, setRevealed] = useState<AgentDiffRevealed | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const sourceRef = useLatestValue(source);
  const listRef = useLatestValue(list);
  const computationRef = useLatestValue(computation);
  const requestedRef = useRef(new Set<string>());
  const handledRevealRef = useRef<AgentDiffRevealRequest | null>(null);
  const sourceKey = source?.key ?? null;

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    requestedRef.current = new Set();
    const current = sourceRef.current;
    if (current === null || sourceKey === null) {
      setList(IDLE_LIST);
      setExpanded([]);
      setBodies(new Map());
      return () => controller.abort();
    }
    const previous = listRef.current;
    const inPlace = previous.identity === current.identity && previous.status.kind === "ready";
    if (inPlace) {
      setList({ ...previous, key: null });
    }
    if (!inPlace) {
      setBodies(new Map());
      setList({
        key: sourceKey,
        identity: current.identity,
        source: current,
        status: { kind: "loading" },
        files: [],
        reloadError: null,
      });
    }
    current.listFiles().then(
      (result) => {
        if (generationRef.current !== generation) return;
        if (result.unavailableReason !== null) {
          setList({
            key: sourceKey,
            identity: current.identity,
            source: current,
            status: { kind: "unavailable", reason: result.unavailableReason },
            files: [],
            reloadError: null,
          });
          setExpanded([]);
          return;
        }
        const paths = new Set(result.files.map((entry) => entry.displayPath));
        setList({
          key: sourceKey,
          identity: current.identity,
          source: current,
          status: { kind: "ready", truncated: result.truncated, statsPartial: result.statsPartial },
          files: result.files,
          reloadError: null,
        });
        if (inPlace) {
          setExpanded((kept) => kept.filter((path) => paths.has(path)));
          setBodies((kept) => retainBodies(kept, paths));
          return;
        }
        setExpanded(
          result.files.slice(0, INITIALLY_EXPANDED_DIFF_FILES).map((entry) => entry.displayPath),
        );
      },
      (error: unknown) => {
        if (generationRef.current !== generation) return;
        if (inPlace) {
          setList({ ...previous, key: sourceKey, reloadError: errorMessage(error) });
          return;
        }
        setList({
          key: sourceKey,
          identity: current.identity,
          source: current,
          status: { kind: "failed", message: errorMessage(error) },
          files: [],
          reloadError: null,
        });
        setExpanded([]);
      },
    );
    return () => controller.abort();
  }, [sourceKey, refreshNonce, sourceRef, listRef]);

  useEffect(() => {
    const producer = list.source;
    const controller = controllerRef.current;
    if (producer === null || controller === null || list.key === null) return;
    if (list.key !== sourceKey) return;
    const generation = generationRef.current;
    const byPath = new Map(list.files.map((entry) => [entry.displayPath, entry]));
    for (const displayPath of expanded) {
      const target = byPath.get(displayPath);
      const key = bodyKey(displayPath, ignoreWhitespace);
      if (target === undefined || requestedRef.current.has(key)) continue;
      requestedRef.current.add(key);
      void loadBody(
        producer,
        computationRef.current,
        target,
        ignoreWhitespace,
        controller.signal,
      ).then((body) => {
        if (generationRef.current !== generation || controller.signal.aborted) return;
        setBodies((previous) => new Map(previous).set(key, body));
      });
    }
  }, [computationRef, expanded, ignoreWhitespace, list, sourceKey]);

  useEffect(() => {
    if (reveal === null || handledRevealRef.current === reveal) return;
    if (list.status.kind === "idle" || list.status.kind === "loading") return;
    if (list.key === null || list.key !== sourceKey) return;
    handledRevealRef.current = reveal;
    const target = list.files.find((entry) => entry.relativePath === reveal.relativePath);
    if (target === undefined) return;
    setExpanded((current) => withExpanded(current, target.displayPath));
    setRevealed({ request: reveal, displayPath: target.displayPath });
  }, [list, reveal, sourceKey]);

  const toggleFile = useCallback((displayPath: string) => {
    setExpanded((current) =>
      current.includes(displayPath)
        ? current.filter((path) => path !== displayPath)
        : [...current, displayPath].slice(-MAX_EXPANDED_DIFF_FILES),
    );
  }, []);
  const revealFile = useCallback((displayPath: string) => {
    setExpanded((current) => withExpanded(current, displayPath));
  }, []);
  const collapseAll = useCallback(() => setExpanded([]), []);
  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  const files = useMemo(
    () =>
      list.files.map((entry): AgentDiffFileView => {
        if (!expanded.includes(entry.displayPath))
          return { file: entry, body: { kind: "collapsed" } };
        return {
          file: entry,
          body: bodies.get(bodyKey(entry.displayPath, ignoreWhitespace)) ?? { kind: "loading" },
        };
      }),
    [bodies, expanded, ignoreWhitespace, list.files],
  );

  return {
    status: list.status,
    files,
    revealed,
    reloadError: list.reloadError,
    toggleFile,
    revealFile,
    collapseAll,
    refresh,
  };
}

function withExpanded(current: ReadonlyArray<string>, displayPath: string): ReadonlyArray<string> {
  if (current.includes(displayPath)) return current;
  return [...current, displayPath].slice(-MAX_EXPANDED_DIFF_FILES);
}

function retainBodies(
  bodies: ReadonlyMap<string, AgentDiffFileBody>,
  paths: ReadonlySet<string>,
): ReadonlyMap<string, AgentDiffFileBody> {
  const kept = new Map<string, AgentDiffFileBody>();
  for (const [key, body] of bodies) {
    const parsed: unknown = JSON.parse(key);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && paths.has(parsed[0]))
      kept.set(key, body);
  }
  return kept;
}

async function loadBody(
  source: AgentDiffSource,
  computation: DiffViewComputationGateway,
  file: AgentDiffFile,
  ignoreWhitespace: boolean,
  signal: AbortSignal,
): Promise<AgentDiffFileBody> {
  try {
    const sides = await source.readSides(file);
    if (sides.unavailableReason !== null) {
      return { kind: "unavailable", reason: UNAVAILABLE_REASONS[sides.unavailableReason] };
    }
    if (sides.truncated) return { kind: "unavailable", reason: UNAVAILABLE_REASONS.large };
    const result = await computation.compute(
      { original: sides.original, modified: sides.modified, ignoreWhitespace },
      signal,
    );
    if (result.kind === "tooLarge") return { kind: "unavailable", reason: DIFF_TOO_LARGE_REASON };
    const limited = limitDiffHunks(groupDiffHunks(result.lines), MAX_RENDERED_DIFF_LINES_PER_FILE);
    return {
      kind: "ready",
      hunks: limited.hunks,
      added: result.added,
      deleted: result.deleted,
      hiddenChangedLines: limited.hiddenChangedLines,
    };
  } catch (error) {
    return { kind: "unavailable", reason: errorMessage(error) };
  }
}

function useLatestValue<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

function bodyKey(displayPath: string, ignoreWhitespace: boolean): string {
  return JSON.stringify([displayPath, ignoreWhitespace]);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "The diff could not be loaded.";
}
