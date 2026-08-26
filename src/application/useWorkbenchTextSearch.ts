import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { confirmWorkbenchAction, type WorkbenchPrompter } from "./workbenchPrompter";
import type { EditorRevealTarget } from "../domain/languageServerFeatures";
import {
  defaultTextSearchOptions,
  getFileName,
  readWorkspaceTextFileSnapshot,
  workspaceRelativePath,
  type EditorDocument,
  type FileEntry,
  type ReplaceInPathFailure,
  type ReplaceInPathResult,
  type TextSearchGateway,
  type TextSearchOptions,
  type TextSearchResult,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { searchQueryHistorySession } from "../domain/searchQueryHistory";
import {
  DIRTY_TEXT_SEARCH_MAX_AGGREGATE_CODE_UNITS,
  DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS,
  DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS,
  DIRTY_TEXT_SEARCH_MAX_DOCUMENTS,
  dirtyTextSearchAuthorityEqual,
  type DirtyTextSearchComputationGateway,
  type DirtyTextSearchComputationRequest,
  type DirtyTextSearchDocumentSnapshot,
  type DirtyTextSearchLimitation,
} from "./dirtyTextSearchComputation";

const TEXT_SEARCH_PAGE_SIZE = 100;
const TEXT_SEARCH_RESULT_LIMIT = 500;

interface OpenFileOptions {
  pin?: boolean;
  readOnly?: boolean;
  recordNavigation?: boolean;
}

export interface WorkbenchTextSearchDependencies {
  workspaceRoot: string | null;
  workspaceOwnerKey: string | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openFileRef: MutableRefObject<(entry: FileEntry, options?: OpenFileOptions) => Promise<boolean>>;
  prompter: WorkbenchPrompter;
  dirtyTextSearch: DirtyTextSearchComputationGateway;
  textSearch: TextSearchGateway;
  workspaceFiles: WorkspaceFileGateway;
  reportError: (source: string, error: unknown) => void;
  reportChangedDocuments: (paths: readonly string[]) => void;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setEditorRevealTarget: Dispatch<SetStateAction<EditorRevealTarget | null>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export interface WorkbenchTextSearch {
  textSearchOpen: boolean;
  textSearchQuery: string;
  textSearchLoading: boolean;
  textSearchOptions: TextSearchOptions;
  textSearchResults: TextSearchResult[];
  textSearchHasMoreResults: boolean;
  textSearchResultCountLowerBound: number;
  textSearchResultsTruncated: boolean;
  textReplacement: string;
  textReplaceBusy: boolean;
  dismissedTextSearchPaths: ReadonlySet<string>;
  setTextSearchOpen: Dispatch<SetStateAction<boolean>>;
  setTextSearchQuery: Dispatch<SetStateAction<string>>;
  setTextSearchOptions: Dispatch<SetStateAction<TextSearchOptions>>;
  setTextReplacement: Dispatch<SetStateAction<string>>;
  resetTextSearchState: () => void;
  openTextSearchResult: (result: TextSearchResult) => Promise<void>;
  dismissTextSearchFile: (path: string) => void;
  restoreDismissedTextSearchFiles: () => void;
  loadMoreTextSearchResults: () => void;
  replaceAllInPath: () => Promise<void>;
  replaceInFile: (path: string) => Promise<void>;
}

interface TextSearchExclusions {
  workspaceRoot: string | null;
  paths: Set<string>;
}

interface ReplaceOutcome {
  result?: ReplaceInPathResult;
  failure?: ReplaceInPathFailure;
}

interface TextSearchOwner {
  readonly authorityToken: object;
  readonly generation: number;
  readonly dirtySnapshotGeneration: number;
  readonly root: string;
  readonly query: string;
  readonly options: TextSearchOptions;
  readonly workspaceOwnerKey: string;
}

interface CompletedTextSearch {
  readonly dirtyPaths: ReadonlySet<string>;
  readonly owner: TextSearchOwner;
  readonly results: readonly TextSearchResult[];
}

interface TextReplaceFlight {
  readonly authorityToken: object;
  readonly id: number;
  readonly ownerGeneration: number;
}

interface DirtyTextDocument {
  readonly content: string;
  readonly path: string;
  readonly relativePath: string;
}

const EMPTY_TEXT_SEARCH_PATHS: ReadonlySet<string> = new Set();
const EMPTY_TEXT_SEARCH_RESULTS: TextSearchResult[] = [];
const EMPTY_DIRTY_TEXT_DOCUMENT_SNAPSHOT: DirtyTextDocumentSnapshot = {
  documents: [],
  overflow: false,
};

interface DirtyTextDocumentSnapshot {
  readonly documents: readonly DirtyTextDocument[];
  readonly overflow: boolean;
}

function aggregateReplaceOutcomes(outcomes: ReplaceOutcome[]): ReplaceInPathResult {
  const files = outcomes.flatMap((outcome) => outcome.result?.files ?? []);
  const totalReplacements = outcomes.reduce(
    (total, outcome) => total + (outcome.result?.totalReplacements ?? 0),
    0,
  );
  const conflicts = outcomes.flatMap((outcome) => {
    const result = outcome.result;

    if (!result || !("conflicts" in result)) {
      return [];
    }

    return result.conflicts;
  });
  const errors = outcomes.flatMap((outcome) => {
    if (outcome.failure) {
      return [outcome.failure];
    }

    const result = outcome.result;

    if (!result || !("errors" in result)) {
      return [];
    }

    return result.errors;
  });

  if (conflicts.length === 0 && errors.length === 0) {
    return { files, totalReplacements };
  }

  if (files.length === 0 && errors.length === 0) {
    return {
      status: "conflict",
      files,
      totalReplacements,
      conflicts,
      message: `${conflicts.length} file(s) changed concurrently; no conflicting file was overwritten`,
    };
  }

  if (files.length === 0 && conflicts.length === 0) {
    return {
      status: "error",
      files,
      totalReplacements,
      errors,
      message: `replacement failed in ${errors.length} file(s)`,
    };
  }

  return {
    status: "partial",
    files,
    totalReplacements,
    conflicts,
    errors,
    message: `replacement completed partially: ${conflicts.length} conflict(s), ${errors.length} error(s)`,
  };
}

function textSearchOptionsEqual(left: TextSearchOptions, right: TextSearchOptions): boolean {
  return (
    left.caseSensitive === right.caseSensitive &&
    left.fileMask === right.fileMask &&
    left.isRegex === right.isRegex &&
    left.preserveCase === right.preserveCase &&
    left.wholeWord === right.wholeWord
  );
}

function createTextSearchAuthorityToken(..._identity: readonly unknown[]): object {
  // The arguments establish the token's memoized identity but are deliberately
  // not retained: dirty document snapshots may contain large buffer strings.
  return Object.freeze({});
}

export function collectDirtyTextSearchDocuments(
  workspaceRoot: string | null,
  documents: Readonly<Record<string, EditorDocument>>,
): DirtyTextDocumentSnapshot {
  if (!workspaceRoot) {
    return EMPTY_DIRTY_TEXT_DOCUMENT_SNAPSHOT;
  }

  const dirtyDocuments: DirtyTextDocument[] = [];
  let enumeratedDocuments = 0;
  for (const path in documents) {
    if (!Object.prototype.hasOwnProperty.call(documents, path)) {
      continue;
    }
    enumeratedDocuments += 1;
    if (enumeratedDocuments > DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS) {
      return { documents: dirtyDocuments, overflow: true };
    }
    const document = documents[path];
    if (!document) {
      continue;
    }
    if (document.content === document.savedContent) {
      continue;
    }

    const relativePath = workspaceRelativePath(workspaceRoot, document.path);
    if (!relativePath) {
      continue;
    }
    if (dirtyDocuments.length >= DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS) {
      return { documents: dirtyDocuments, overflow: true };
    }
    dirtyDocuments.push({
      content: document.content,
      path: document.path,
      relativePath,
    });
  }
  dirtyDocuments.sort((left, right) => left.path.localeCompare(right.path));
  return { documents: dirtyDocuments, overflow: false };
}

function countDirtyReplacementBlockers(
  workspaceRoot: string,
  documents: Readonly<Record<string, EditorDocument>>,
  targetPaths: ReadonlySet<string> | null,
): number {
  let count = 0;
  for (const document of Object.values(documents)) {
    if (
      document.content !== document.savedContent &&
      workspaceRelativePath(workspaceRoot, document.path) &&
      (targetPaths === null || targetPaths.has(document.path))
    ) {
      count += 1;
    }
  }
  return count;
}

export function prepareDirtyTextSearchRequest(
  authority: DirtyTextSearchComputationRequest["authority"],
  documents: readonly DirtyTextDocument[],
  query: string,
  options: TextSearchOptions,
  limit: number,
): DirtyTextSearchComputationRequest {
  const limitations = new Set<DirtyTextSearchLimitation>();
  const admitted: DirtyTextSearchDocumentSnapshot[] = [];
  let aggregateCodeUnits = 0;

  for (const document of documents) {
    if (admitted.length >= DIRTY_TEXT_SEARCH_MAX_DOCUMENTS) {
      limitations.add("document-limit");
      continue;
    }
    if (document.content.length > DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS) {
      limitations.add("document-too-large");
      continue;
    }
    if (aggregateCodeUnits + document.content.length > DIRTY_TEXT_SEARCH_MAX_AGGREGATE_CODE_UNITS) {
      limitations.add("aggregate-input-limit");
      continue;
    }
    aggregateCodeUnits += document.content.length;
    admitted.push({
      ...document,
      documentRevision: authority.dirtySnapshotGeneration,
    });
  }

  return {
    authority,
    dirtyPaths: documents.map((document) => document.path),
    documents: admitted,
    limit,
    options,
    preflightLimitations: [...limitations],
    query,
  };
}

function overlayDirtyTextSearchResponse(
  backendResults: readonly TextSearchResult[],
  dirtyPaths: readonly string[],
  dirtyResults: readonly TextSearchResult[],
  limit: number,
): {
  readonly dirtyPaths: ReadonlySet<string>;
  readonly results: readonly TextSearchResult[];
  readonly truncated: boolean;
} {
  const authoritativeDirtyPaths = new Set(dirtyPaths);
  const diskResults = backendResults.filter((result) => !authoritativeDirtyPaths.has(result.path));
  const merged = [...diskResults, ...dirtyResults];
  return {
    dirtyPaths: authoritativeDirtyPaths,
    results: merged.slice(0, limit),
    truncated: merged.length > limit,
  };
}

export function useWorkbenchTextSearch(
  dependencies: WorkbenchTextSearchDependencies,
): WorkbenchTextSearch {
  const {
    workspaceRoot,
    workspaceOwnerKey,
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    openFileRef,
    prompter,
    dirtyTextSearch,
    textSearch,
    workspaceFiles,
    reportError,
    reportChangedDocuments,
    setDocuments,
    setEditorRevealTarget,
    setMessage,
  } = dependencies;

  useEffect(() => {
    searchQueryHistorySession.activate(workspaceRoot);
  }, [workspaceRoot]);

  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQueryState] = useState("");
  const [searchRequestLoading, setTextSearchLoading] = useState(false);
  const [textSearchOptions, setTextSearchOptionsState] =
    useState<TextSearchOptions>(defaultTextSearchOptions);
  const [completedTextSearch, setCompletedTextSearch] = useState<CompletedTextSearch | null>(null);
  const [textSearchResultLimit, setTextSearchResultLimit] = useState(TEXT_SEARCH_PAGE_SIZE);
  const [completedSearchHasMoreResults, setTextSearchHasMoreResults] = useState(false);
  const [completedSearchResultCountLowerBound, setTextSearchResultCountLowerBound] = useState(0);
  const [completedSearchResultsTruncated, setTextSearchResultsTruncated] = useState(false);
  const [textReplacement, setTextReplacement] = useState("");
  const [textReplaceFlightState, setTextReplaceFlightState] = useState<TextReplaceFlight | null>(
    null,
  );
  const [textSearchExclusions, setTextSearchExclusions] = useState<TextSearchExclusions>({
    workspaceRoot,
    paths: new Set(),
  });
  // Bumped after every successful replace so the Find-in-Path search effect
  // re-runs and the results list reflects what is now on disk.
  const [textSearchRefreshToken, setTextSearchRefreshToken] = useState(0);
  const documentsSnapshot = documentsRef.current;
  const nextDirtyDocumentSnapshot = useMemo(
    () =>
      textSearchOpen && textSearchQuery.trim()
        ? collectDirtyTextSearchDocuments(workspaceRoot, documentsSnapshot)
        : EMPTY_DIRTY_TEXT_DOCUMENT_SNAPSHOT,
    [documentsSnapshot, textSearchOpen, textSearchQuery, workspaceRoot],
  );
  const nextDirtyDocuments = nextDirtyDocumentSnapshot.documents;
  const nextTextReplaceFlightIdRef = useRef(0);
  const activeTextReplaceFlightRef = useRef<TextReplaceFlight | null>(null);
  const searchOwnerGenerationRef = useRef(0);
  const searchAuthorityToken = useMemo(
    () =>
      createTextSearchAuthorityToken(
        nextDirtyDocuments,
        textSearchOpen,
        textSearchOptions,
        textSearchQuery,
        textSearchRefreshToken,
        textSearchResultLimit,
        workspaceOwnerKey,
        workspaceRoot,
      ),
    [
      nextDirtyDocuments,
      textSearchOpen,
      textSearchOptions,
      textSearchQuery,
      textSearchRefreshToken,
      textSearchResultLimit,
      workspaceOwnerKey,
      workspaceRoot,
    ],
  );

  const activeSearchOwner: TextSearchOwner | null =
    textSearchOpen && workspaceRoot && workspaceOwnerKey && textSearchQuery.trim()
      ? {
          authorityToken: searchAuthorityToken,
          dirtySnapshotGeneration: searchOwnerGenerationRef.current,
          generation: searchOwnerGenerationRef.current,
          root: workspaceRoot,
          query: textSearchQuery.trim(),
          options: { ...textSearchOptions },
          workspaceOwnerKey,
        }
      : null;
  const hasActiveSearchOwner = activeSearchOwner !== null;
  const activeSearchOwnerRef = useRef<TextSearchOwner | null>(null);
  useLayoutEffect(() => {
    if (!hasActiveSearchOwner) {
      activeSearchOwnerRef.current = null;
    }
  }, [hasActiveSearchOwner]);
  const isCompletedSearchCurrent =
    completedTextSearch !== null &&
    activeSearchOwner !== null &&
    completedTextSearch.owner.authorityToken === searchAuthorityToken &&
    completedTextSearch.owner.workspaceOwnerKey === activeSearchOwner.workspaceOwnerKey &&
    workspaceRootKeysEqual(completedTextSearch.owner.root, activeSearchOwner.root);
  const completedSearchAvailable = isCompletedSearchCurrent && !searchRequestLoading;
  const textSearchResults = useMemo(
    () =>
      completedSearchAvailable && completedTextSearch
        ? [...completedTextSearch.results]
        : EMPTY_TEXT_SEARCH_RESULTS,
    [completedSearchAvailable, completedTextSearch],
  );
  const textSearchHasMoreResults = completedSearchAvailable && completedSearchHasMoreResults;
  const textSearchResultCountLowerBound = completedSearchAvailable
    ? completedSearchResultCountLowerBound
    : 0;
  const textSearchResultsTruncated = completedSearchAvailable && completedSearchResultsTruncated;
  const textReplaceBusy =
    textReplaceFlightState !== null &&
    activeTextReplaceFlightRef.current === textReplaceFlightState &&
    activeSearchOwner?.authorityToken === textReplaceFlightState.authorityToken;
  const textSearchLoading =
    textSearchOpen &&
    activeSearchOwner !== null &&
    (searchRequestLoading || !isCompletedSearchCurrent);
  const textSearchQueryRef = useRef(textSearchQuery);
  const textSearchOptionsRef = useRef(textSearchOptions);
  useLayoutEffect(() => {
    textSearchQueryRef.current = textSearchQuery;
    textSearchOptionsRef.current = textSearchOptions;
  }, [textSearchOptions, textSearchQuery]);

  const invalidateSearchOwner = useCallback(() => {
    activeTextReplaceFlightRef.current = null;
    activeSearchOwnerRef.current = null;
  }, []);

  const setTextSearchQuery = useCallback<Dispatch<SetStateAction<string>>>(
    (update) => {
      const current = textSearchQueryRef.current;
      const next = typeof update === "function" ? update(current) : update;
      if (next !== current) {
        invalidateSearchOwner();
        textSearchQueryRef.current = next;
      }
      setTextSearchQueryState(next);
    },
    [invalidateSearchOwner],
  );

  const setTextSearchOptions = useCallback<Dispatch<SetStateAction<TextSearchOptions>>>(
    (update) => {
      const current = textSearchOptionsRef.current;
      const next = typeof update === "function" ? update(current) : update;
      if (!textSearchOptionsEqual(next, current)) {
        invalidateSearchOwner();
        textSearchOptionsRef.current = next;
      }
      setTextSearchOptionsState(next);
    },
    [invalidateSearchOwner],
  );
  const dismissedTextSearchPaths = workspaceRootKeysEqual(
    textSearchExclusions.workspaceRoot,
    workspaceRoot,
  )
    ? textSearchExclusions.paths
    : EMPTY_TEXT_SEARCH_PATHS;

  const resetTextSearchState = useCallback(() => {
    invalidateSearchOwner();
    setTextSearchOpen(false);
    setTextSearchQueryState("");
    setTextSearchLoading(false);
    setCompletedTextSearch(null);
    setTextSearchResultLimit(TEXT_SEARCH_PAGE_SIZE);
    setTextSearchHasMoreResults(false);
    setTextSearchResultCountLowerBound(0);
    setTextSearchResultsTruncated(false);
    setTextSearchOptionsState(defaultTextSearchOptions());
    setTextReplacement("");
    setTextReplaceFlightState(null);
    setTextSearchExclusions({ workspaceRoot: null, paths: new Set() });
  }, [invalidateSearchOwner]);

  const dismissTextSearchFile = useCallback(
    (path: string) => {
      if (!workspaceRoot || !textSearchResults.some((result) => result.path === path)) {
        return;
      }

      setTextSearchExclusions((current) => {
        const paths = workspaceRootKeysEqual(current.workspaceRoot, workspaceRoot)
          ? new Set(current.paths)
          : new Set<string>();
        paths.add(path);
        return { workspaceRoot, paths };
      });
    },
    [textSearchResults, workspaceRoot],
  );

  const restoreDismissedTextSearchFiles = useCallback(() => {
    if (!workspaceRoot) {
      return;
    }

    setTextSearchExclusions((current) => {
      if (!workspaceRootKeysEqual(current.workspaceRoot, workspaceRoot)) {
        return current;
      }

      if (current.paths.size === 0) {
        return current;
      }

      return { workspaceRoot, paths: new Set() };
    });
  }, [workspaceRoot]);

  useEffect(() => {
    setTextSearchExclusions({ workspaceRoot, paths: new Set() });
    setTextSearchResultLimit(TEXT_SEARCH_PAGE_SIZE);
  }, [
    textSearchOptions.caseSensitive,
    textSearchOptions.fileMask,
    textSearchOptions.isRegex,
    textSearchOptions.preserveCase,
    textSearchOptions.wholeWord,
    textSearchQuery,
    textSearchRefreshToken,
    workspaceRoot,
  ]);

  const openTextSearchResult = useCallback(
    async (result: TextSearchResult) => {
      const requestedSearch = completedTextSearch;
      const isRequestedSearchActive = () =>
        requestedSearch !== null &&
        activeSearchOwnerRef.current?.generation === requestedSearch.owner.generation &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedSearch.owner.root);

      if (
        !requestedSearch ||
        !requestedSearch.results.includes(result) ||
        !isRequestedSearchActive()
      ) {
        return;
      }

      const opened = await openFileRef.current({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened || !isRequestedSearchActive()) {
        return;
      }

      if (!isRequestedSearchActive()) {
        return;
      }
      setEditorRevealTarget({
        path: result.path,
        position: {
          column: Math.max(1, Number(result.column)),
          lineNumber: Math.max(1, Number(result.lineNumber)),
        },
      });
      if (!isRequestedSearchActive()) {
        return;
      }
      setMessage(`Opened ${result.relativePath}:${result.lineNumber}:${result.column}`);
    },
    [completedTextSearch, currentWorkspaceRootRef, openFileRef, setEditorRevealTarget, setMessage],
  );

  // Re-reads the given files from disk and refreshes any matching open tabs so
  // the editor shows the post-replace content. Tabs with UNSAVED edits are left
  // untouched (we never clobber the user's in-flight work); the next save will
  // win. `isRequestedRootActive` is re-checked after every await so a stale
  // replace cannot mutate documents that belong to a different workspace tab.
  const refreshOpenDocumentsAfterReplace = useCallback(
    async (changedPaths: string[], isRequestedRootActive: () => boolean): Promise<void> => {
      for (const path of changedPaths) {
        if (!isRequestedRootActive()) {
          return;
        }

        const openDocument = documentsRef.current[path];

        if (!openDocument) {
          continue;
        }

        const hasUnsavedEdits = openDocument.content !== openDocument.savedContent;

        if (hasUnsavedEdits) {
          continue;
        }

        let refreshedSnapshot;

        try {
          refreshedSnapshot = await readWorkspaceTextFileSnapshot(workspaceFiles, path);
        } catch {
          continue;
        }

        if (!isRequestedRootActive()) {
          return;
        }

        const latestDocument = documentsRef.current[path];

        // Re-check after the await: the tab may have been edited, closed, or
        // replaced by an unsaved version while we were reading from disk.
        if (!latestDocument || latestDocument.content !== latestDocument.savedContent) {
          continue;
        }

        const refreshedDocument: EditorDocument = {
          ...latestDocument,
          content: refreshedSnapshot.content,
          savedContent: refreshedSnapshot.content,
          revision: refreshedSnapshot.revision,
        };

        documentsRef.current = {
          ...documentsRef.current,
          [path]: refreshedDocument,
        };
        activeDocumentRef.current =
          activeDocumentRef.current?.path === path ? refreshedDocument : activeDocumentRef.current;
        setDocuments((current) => {
          if (!isRequestedRootActive()) {
            return current;
          }
          const currentDocument = current[path];

          if (!currentDocument || currentDocument.content !== currentDocument.savedContent) {
            return current;
          }

          return {
            ...current,
            [path]: {
              ...currentDocument,
              content: refreshedSnapshot.content,
              savedContent: refreshedSnapshot.content,
              revision: refreshedSnapshot.revision,
            },
          };
        });
        if (!isRequestedRootActive()) {
          return;
        }
        reportChangedDocuments([path]);
      }
    },
    [activeDocumentRef, documentsRef, reportChangedDocuments, setDocuments, workspaceFiles],
  );

  // Shared Replace-in-Path runner. `scopePath === null` means Replace All (every
  // matching file); a non-null path narrows the run to a single file (the
  // backend still confines edits to its exact matches). Destructive (it rewrites
  // files on disk), so it always confirms first and reports the outcome.
  const runReplaceInPath = useCallback(
    async (scopePath: string | null): Promise<void> => {
      const requestedSearch = completedTextSearch;
      const requestedRoot = requestedSearch?.owner.root ?? null;
      let requestedFlight: TextReplaceFlight | null = null;
      const isRequestedRootActive = () =>
        requestedSearch !== null &&
        activeSearchOwnerRef.current?.generation === requestedSearch.owner.generation &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedSearch.owner.root) &&
        (requestedFlight === null || activeTextReplaceFlightRef.current === requestedFlight);

      if (
        !requestedSearch ||
        !requestedRoot ||
        activeTextReplaceFlightRef.current !== null ||
        textSearchLoading ||
        !isRequestedRootActive()
      ) {
        return;
      }
      const query = requestedSearch.owner.query;
      const options = requestedSearch.owner.options;
      const resultsSnapshot = requestedSearch.results;
      const replacement = textReplacement;
      const excludedPaths = new Set(dismissedTextSearchPaths);
      const blockDirtyReplacement = (targetPaths: ReadonlySet<string> | null): boolean => {
        const blockerCount = countDirtyReplacementBlockers(
          requestedRoot,
          documentsRef.current,
          targetPaths,
        );
        if (blockerCount === 0) {
          return false;
        }
        setMessage(
          `Replace blocked: save or revert unsaved changes in ${blockerCount} eligible file${blockerCount === 1 ? "" : "s"} before replacing on disk.`,
        );
        return true;
      };

      // Preview the blast radius BEFORE the destructive write: count the
      // matching files/occurrences (within scope) so the confirmation is honest.
      const previewResults = resultsSnapshot.filter((result) =>
        scopePath === null ? !excludedPaths.has(result.path) : result.path === scopePath,
      );
      const fileCount = new Set(previewResults.map((result) => result.path)).size;
      const matchCount = previewResults.length;
      const usesWholeScope = scopePath !== null || excludedPaths.size === 0;
      const targetPaths =
        scopePath !== null
          ? new Set([scopePath])
          : usesWholeScope
            ? null
            : new Set(previewResults.map((result) => result.path));
      if (blockDirtyReplacement(targetPaths)) {
        return;
      }

      if (matchCount === 0) {
        setMessage("No matches to replace");
        return;
      }

      // The results list is capped at TEXT_SEARCH_RESULT_LIMIT; when it is full
      // the real blast radius may be larger than what we can preview, so the
      // confirmation says "at least N" rather than implying an exact count.
      const isCapped = scopePath === null && textSearchResultsTruncated;
      const hasExclusions = scopePath === null && excludedPaths.size > 0;
      const isCappedWithExclusions = isCapped && hasExclusions;
      const atLeast = isCapped && !hasExclusions ? "at least " : "";
      const scopeLabel = isCappedWithExclusions
        ? `${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${fileCount} listed file${fileCount === 1 ? "" : "s"}`
        : scopePath === null
          ? `${atLeast}${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${atLeast}${fileCount} file${fileCount === 1 ? "" : "s"}`
          : `${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${getFileName(scopePath)}`;
      const cappedExclusionWarning = isCappedWithExclusions
        ? " Only the files currently listed will be replaced. Matches beyond the displayed results will not be modified; refine your search to include them."
        : "";

      requestedFlight = {
        authorityToken: requestedSearch.owner.authorityToken,
        id: nextTextReplaceFlightIdRef.current + 1,
        ownerGeneration: requestedSearch.owner.generation,
      };
      nextTextReplaceFlightIdRef.current = requestedFlight.id;
      activeTextReplaceFlightRef.current = requestedFlight;
      setTextReplaceFlightState(requestedFlight);

      const confirmed = await confirmWorkbenchAction(
        prompter,
        `Replace ${scopeLabel}?${cappedExclusionWarning} This rewrites files on disk and is restorable from Local History.`,
      );
      if (!confirmed || !isRequestedRootActive()) {
        if (activeTextReplaceFlightRef.current === requestedFlight) {
          activeTextReplaceFlightRef.current = null;
          setTextReplaceFlightState((current) => (current === requestedFlight ? null : current));
        }
        return;
      }

      try {
        // Single-file scope is passed out-of-band as an exact path (not as an
        // extra include glob), so an active user file mask can never widen a
        // "Replace in file" run into other files. `scopePath === null` means
        // Replace All.
        let result: ReplaceInPathResult | null = null;

        if (usesWholeScope) {
          if (!isRequestedRootActive() || blockDirtyReplacement(targetPaths)) {
            return;
          }
          result = await textSearch.replaceInPath(
            requestedRoot,
            query,
            replacement,
            options,
            scopePath ?? undefined,
          );
          if (!isRequestedRootActive()) {
            return;
          }
        }

        if (!usesWholeScope) {
          const includedFiles = Array.from(
            new Map(
              previewResults.map((preview) => [
                preview.path,
                { path: preview.path, relativePath: preview.relativePath },
              ]),
            ).values(),
          );
          const outcomes: ReplaceOutcome[] = [];

          for (const file of includedFiles) {
            if (!isRequestedRootActive() || blockDirtyReplacement(new Set([file.path]))) {
              return;
            }

            try {
              outcomes.push({
                result: await textSearch.replaceInPath(
                  requestedRoot,
                  query,
                  replacement,
                  options,
                  file.path,
                ),
              });
              if (!isRequestedRootActive()) {
                return;
              }
            } catch (error) {
              if (!isRequestedRootActive()) {
                return;
              }
              outcomes.push({
                failure: {
                  path: file.path,
                  relativePath: file.relativePath,
                  message: String(error),
                },
              });
            }
          }

          result = aggregateReplaceOutcomes(outcomes);
        }

        if (!result) {
          return;
        }

        if (!isRequestedRootActive()) {
          return;
        }

        await refreshOpenDocumentsAfterReplace(
          result.files.map((file) => file.path),
          isRequestedRootActive,
        );

        if (!isRequestedRootActive()) {
          return;
        }

        setMessage(
          "message" in result
            ? result.message
            : result.totalReplacements === 0
              ? "No replacements made"
              : `Replaced ${result.totalReplacements} occurrence${result.totalReplacements === 1 ? "" : "s"} in ${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
        );
        // Re-run the search so the results list matches what is now on disk.
        if (result.files.length > 0) {
          setTextSearchRefreshToken((token) => token + 1);
        }
      } catch (error) {
        if (!isRequestedRootActive()) {
          return;
        }

        reportError("Replace in Path", error);
      } finally {
        if (activeTextReplaceFlightRef.current === requestedFlight) {
          activeTextReplaceFlightRef.current = null;
          setTextReplaceFlightState((current) => (current === requestedFlight ? null : current));
        }
      }
    },
    [
      currentWorkspaceRootRef,
      prompter,
      refreshOpenDocumentsAfterReplace,
      reportError,
      setMessage,
      textReplacement,
      textSearch,
      textSearchLoading,
      textSearchResultsTruncated,
      dismissedTextSearchPaths,
      completedTextSearch,
      documentsRef,
    ],
  );

  const replaceAllInPath = useCallback(() => runReplaceInPath(null), [runReplaceInPath]);

  const replaceInFile = useCallback((path: string) => runReplaceInPath(path), [runReplaceInPath]);

  const loadMoreTextSearchResults = useCallback(() => {
    const requestedSearch = completedTextSearch;
    if (
      !textSearchHasMoreResults ||
      !requestedSearch ||
      activeSearchOwnerRef.current?.generation !== requestedSearch.owner.generation
    ) {
      return;
    }

    setTextSearchResultLimit((current) => {
      if (activeSearchOwnerRef.current?.generation !== requestedSearch.owner.generation) {
        return current;
      }
      return Math.min(current + TEXT_SEARCH_PAGE_SIZE, TEXT_SEARCH_RESULT_LIMIT);
    });
  }, [completedTextSearch, textSearchHasMoreResults]);

  useEffect(() => {
    if (!workspaceRoot || !workspaceOwnerKey || !textSearchQuery.trim()) {
      setCompletedTextSearch(null);
      setTextSearchLoading(false);
      setTextSearchHasMoreResults(false);
      setTextSearchResultCountLowerBound(0);
      setTextSearchResultsTruncated(false);
      return;
    }

    if (!textSearchOpen) {
      setTextSearchLoading(false);
      return;
    }

    // Capture the requested root + filters up front; the `active` flag (reset by
    // cleanup whenever any of these change, including a workspace tab switch)
    // drops stale results so a slow search from a previous root/filter set can
    // never overwrite the current one.
    const requestedRoot = workspaceRoot;
    const generation = searchOwnerGenerationRef.current + 1;
    searchOwnerGenerationRef.current = generation;
    const requestedOwner: TextSearchOwner = {
      authorityToken: searchAuthorityToken,
      dirtySnapshotGeneration: generation,
      generation,
      options: { ...textSearchOptions },
      query: textSearchQuery.trim(),
      root: requestedRoot,
      workspaceOwnerKey,
    };
    if (
      activeTextReplaceFlightRef.current &&
      activeTextReplaceFlightRef.current.authorityToken !== searchAuthorityToken
    ) {
      activeTextReplaceFlightRef.current = null;
      setTextReplaceFlightState(null);
    }
    activeSearchOwnerRef.current = requestedOwner;
    const requestedDisplayLimit = textSearchResultLimit;
    const requestedDirtyDocuments = nextDirtyDocuments;
    const requestedDirtyDocumentsOverflow = nextDirtyDocumentSnapshot.overflow;
    const requestGeneration = `text-search-${generation}-${generation}`;
    const dirtyAbortController = new AbortController();
    let active = true;
    setTextSearchLoading(true);

    const timeout = window.setTimeout(() => {
      searchQueryHistorySession.push(requestedRoot, textSearchQuery);
      if (requestedDirtyDocumentsOverflow) {
        if (
          active &&
          activeSearchOwnerRef.current?.generation === requestedOwner.generation &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedOwner.root)
        ) {
          setCompletedTextSearch({
            dirtyPaths: new Set(),
            owner: requestedOwner,
            results: [],
          });
          setTextSearchHasMoreResults(false);
          setTextSearchResultCountLowerBound(0);
          setTextSearchResultsTruncated(true);
          setMessage(
            "Dirty-buffer search exceeded the open-file safety limit; results are omitted.",
          );
          setTextSearchLoading(false);
        }
        return;
      }
      const dirtyRequest = prepareDirtyTextSearchRequest(
        {
          dirtySnapshotGeneration: requestedOwner.dirtySnapshotGeneration,
          requestGeneration,
          root: requestedOwner.root,
          searchGeneration: requestedOwner.generation,
          workspaceOwnerKey: requestedOwner.workspaceOwnerKey,
        },
        requestedDirtyDocuments,
        requestedOwner.query,
        requestedOwner.options,
        requestedDisplayLimit,
      );
      const dirtySearchPromise =
        dirtyRequest.dirtyPaths.length > 0
          ? dirtyTextSearch.compute(dirtyRequest, dirtyAbortController.signal)
          : Promise.resolve({
              authority: dirtyRequest.authority,
              dirtyPaths: [],
              limitations: [],
              results: [],
              truncated: false,
            });
      const searchPromise = textSearch.searchTextWithMetadata
        ? textSearch
            .searchTextWithMetadata(
              requestedRoot,
              textSearchQuery,
              requestedDisplayLimit,
              textSearchOptions,
              requestGeneration,
            )
            .then((response) => {
              if (response.requestGeneration !== requestGeneration) {
                throw new Error("Text search returned a mismatched request generation.");
              }
              return {
                requestGeneration: response.requestGeneration,
                results: response.results,
                truncated: response.truncated,
                hasAuthoritativeTruncation: true,
              };
            })
        : textSearch
            .searchText(
              requestedRoot,
              textSearchQuery,
              Math.min(requestedDisplayLimit + 1, TEXT_SEARCH_RESULT_LIMIT),
              textSearchOptions,
            )
            .then((results) => ({
              requestGeneration,
              results,
              truncated: results.length > requestedDisplayLimit,
              hasAuthoritativeTruncation: false,
            }));
      Promise.all([searchPromise, dirtySearchPromise])
        .then(([response, dirtyResponse]) => {
          if (
            !active ||
            !requestedOwner ||
            response.requestGeneration !== requestGeneration ||
            !dirtyTextSearchAuthorityEqual(dirtyResponse.authority, dirtyRequest.authority) ||
            activeSearchOwnerRef.current?.generation !== requestedOwner.generation ||
            activeSearchOwnerRef.current?.dirtySnapshotGeneration !==
              requestedOwner.dirtySnapshotGeneration ||
            activeSearchOwnerRef.current?.workspaceOwnerKey !== requestedOwner.workspaceOwnerKey ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedOwner.root)
          ) {
            return;
          }

          const canRequestMore = requestedDisplayLimit < TEXT_SEARCH_RESULT_LIMIT;
          const overlaid = overlayDirtyTextSearchResponse(
            response.results,
            dirtyResponse.dirtyPaths,
            dirtyResponse.results,
            requestedDisplayLimit,
          );
          const hasSentinel =
            !response.hasAuthoritativeTruncation &&
            canRequestMore &&
            response.results.length > requestedDisplayLimit;
          const isTruncated =
            response.truncated ||
            dirtyResponse.truncated ||
            overlaid.truncated ||
            (!canRequestMore && response.results.length >= TEXT_SEARCH_RESULT_LIMIT);
          setCompletedTextSearch({
            dirtyPaths: overlaid.dirtyPaths,
            owner: requestedOwner,
            results: overlaid.results,
          });
          setTextSearchHasMoreResults(canRequestMore && isTruncated);
          setTextSearchResultsTruncated(isTruncated);
          const hasProvenAdditionalResult =
            overlaid.truncated ||
            dirtyResponse.limitations.includes("result-limit") ||
            dirtyResponse.limitations.includes("response-limit") ||
            (overlaid.dirtyPaths.size === 0 &&
              (response.hasAuthoritativeTruncation || hasSentinel));
          setTextSearchResultCountLowerBound(
            isTruncated && hasProvenAdditionalResult
              ? overlaid.results.length + 1
              : overlaid.results.length,
          );
          setMessage(
            dirtyResponse.limitations.includes("unsupported-query-semantics")
              ? "Dirty-buffer regex and whole-word matches are omitted until they can use the same bounded matcher as disk search; results are truncated."
              : dirtyResponse.limitations.includes("unsupported-file-mask")
                ? "Dirty-buffer matches with file masks are omitted until they can use native file eligibility; results are truncated."
                : dirtyResponse.limitations.length > 0
                  ? "Dirty-buffer search reached a safety limit; results are truncated."
                  : null,
          );
        })
        .catch((error) => {
          if (
            !active ||
            !requestedOwner ||
            activeSearchOwnerRef.current?.generation !== requestedOwner.generation ||
            activeSearchOwnerRef.current?.dirtySnapshotGeneration !==
              requestedOwner.dirtySnapshotGeneration ||
            activeSearchOwnerRef.current?.workspaceOwnerKey !== requestedOwner.workspaceOwnerKey ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedOwner.root)
          ) {
            return;
          }

          setCompletedTextSearch({
            dirtyPaths: new Set(),
            owner: requestedOwner,
            results: [],
          });
          setTextSearchHasMoreResults(false);
          setTextSearchResultCountLowerBound(0);
          setTextSearchResultsTruncated(false);
          reportError("Text Search", error);
        })
        .finally(() => {
          if (
            !active ||
            !requestedOwner ||
            activeSearchOwnerRef.current?.generation !== requestedOwner.generation ||
            activeSearchOwnerRef.current?.dirtySnapshotGeneration !==
              requestedOwner.dirtySnapshotGeneration ||
            activeSearchOwnerRef.current?.workspaceOwnerKey !== requestedOwner.workspaceOwnerKey ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedOwner.root)
          ) {
            return;
          }

          setTextSearchLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      dirtyAbortController.abort();
      if (activeSearchOwnerRef.current?.authorityToken === searchAuthorityToken) {
        activeSearchOwnerRef.current = null;
      }
    };
  }, [
    reportError,
    setMessage,
    textSearchOpen,
    textSearchQuery,
    textSearchOptions,
    textSearchResultLimit,
    textSearchRefreshToken,
    dirtyTextSearch,
    nextDirtyDocuments,
    nextDirtyDocumentSnapshot.overflow,
    searchAuthorityToken,
    textSearch,
    workspaceRoot,
    workspaceOwnerKey,
    currentWorkspaceRootRef,
  ]);

  return {
    textSearchOpen,
    textSearchQuery,
    textSearchLoading,
    textSearchOptions,
    textSearchResults,
    textSearchHasMoreResults,
    textSearchResultCountLowerBound,
    textSearchResultsTruncated,
    textReplacement,
    textReplaceBusy,
    dismissedTextSearchPaths,
    setTextSearchOpen,
    setTextSearchQuery,
    setTextSearchOptions,
    setTextReplacement,
    resetTextSearchState,
    openTextSearchResult,
    dismissTextSearchFile,
    restoreDismissedTextSearchFiles,
    loadMoreTextSearchResults,
    replaceAllInPath,
    replaceInFile,
  };
}
