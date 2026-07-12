import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { EditorRevealTarget } from "../domain/languageServerFeatures";
import {
  defaultTextSearchOptions,
  getFileName,
  readWorkspaceTextFileSnapshot,
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

const TEXT_SEARCH_RESULT_LIMIT = 100;

interface OpenFileOptions {
  pin?: boolean;
  readOnly?: boolean;
  recordNavigation?: boolean;
}

export interface WorkbenchTextSearchDependencies {
  workspaceRoot: string | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openFileRef: MutableRefObject<
    (entry: FileEntry, options?: OpenFileOptions) => Promise<boolean>
  >;
  prompter: WorkbenchPrompter;
  textSearch: TextSearchGateway;
  workspaceFiles: WorkspaceFileGateway;
  reportError: (source: string, error: unknown) => void;
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

const EMPTY_TEXT_SEARCH_PATHS: ReadonlySet<string> = new Set();

function aggregateReplaceOutcomes(
  outcomes: ReplaceOutcome[],
): ReplaceInPathResult {
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

export function useWorkbenchTextSearch(
  dependencies: WorkbenchTextSearchDependencies,
): WorkbenchTextSearch {
  const {
    workspaceRoot,
    activeDocumentRef,
    currentWorkspaceRootRef,
    documentsRef,
    openFileRef,
    prompter,
    textSearch,
    workspaceFiles,
    reportError,
    setDocuments,
    setEditorRevealTarget,
    setMessage,
  } = dependencies;

  searchQueryHistorySession.activate(workspaceRoot);

  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [textSearchOptions, setTextSearchOptions] = useState<TextSearchOptions>(
    defaultTextSearchOptions,
  );
  const [textSearchResults, setTextSearchResults] = useState<TextSearchResult[]>(
    [],
  );
  const [textReplacement, setTextReplacement] = useState("");
  const [textReplaceBusy, setTextReplaceBusy] = useState(false);
  const [textSearchExclusions, setTextSearchExclusions] =
    useState<TextSearchExclusions>({ workspaceRoot, paths: new Set() });
  // Bumped after every successful replace so the Find-in-Path search effect
  // re-runs and the results list reflects what is now on disk.
  const [textSearchRefreshToken, setTextSearchRefreshToken] = useState(0);
  const dismissedTextSearchPaths = workspaceRootKeysEqual(
    textSearchExclusions.workspaceRoot,
    workspaceRoot,
  )
    ? textSearchExclusions.paths
    : EMPTY_TEXT_SEARCH_PATHS;

  const resetTextSearchState = useCallback(() => {
    setTextSearchOpen(false);
    setTextSearchQuery("");
    setTextSearchLoading(false);
    setTextSearchResults([]);
    setTextSearchOptions(defaultTextSearchOptions);
    setTextReplacement("");
    setTextReplaceBusy(false);
    setTextSearchExclusions({ workspaceRoot: null, paths: new Set() });
  }, []);

  const dismissTextSearchFile = useCallback(
    (path: string) => {
      if (
        !workspaceRoot ||
        !textSearchResults.some((result) => result.path === path)
      ) {
        return;
      }

      setTextSearchExclusions((current) => {
        const paths = workspaceRootKeysEqual(
          current.workspaceRoot,
          workspaceRoot,
        )
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
      const opened = await openFileRef.current({
        kind: "file",
        name: getFileName(result.path),
        path: result.path,
      });

      if (!opened) {
        return;
      }

      setTextSearchOpen(false);
      setEditorRevealTarget({
        path: result.path,
        position: {
          column: Math.max(1, Number(result.column)),
          lineNumber: Math.max(1, Number(result.lineNumber)),
        },
      });
      setMessage(
        `Opened ${result.relativePath}:${result.lineNumber}:${result.column}`,
      );
    },
    [openFileRef, setEditorRevealTarget, setMessage],
  );

  // Re-reads the given files from disk and refreshes any matching open tabs so
  // the editor shows the post-replace content. Tabs with UNSAVED edits are left
  // untouched (we never clobber the user's in-flight work); the next save will
  // win. `isRequestedRootActive` is re-checked after every await so a stale
  // replace cannot mutate documents that belong to a different workspace tab.
  const refreshOpenDocumentsAfterReplace = useCallback(
    async (
      changedPaths: string[],
      isRequestedRootActive: () => boolean,
    ): Promise<void> => {
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
          refreshedSnapshot = await readWorkspaceTextFileSnapshot(
            workspaceFiles,
            path,
          );
        } catch {
          continue;
        }

        if (!isRequestedRootActive()) {
          return;
        }

        const latestDocument = documentsRef.current[path];

        // Re-check after the await: the tab may have been edited, closed, or
        // replaced by an unsaved version while we were reading from disk.
        if (
          !latestDocument ||
          latestDocument.content !== latestDocument.savedContent
        ) {
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
          activeDocumentRef.current?.path === path
            ? refreshedDocument
            : activeDocumentRef.current;
        setDocuments((current) => {
          const currentDocument = current[path];

          if (
            !currentDocument ||
            currentDocument.content !== currentDocument.savedContent
          ) {
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
      }
    },
    [activeDocumentRef, documentsRef, setDocuments, workspaceFiles],
  );

  // Shared Replace-in-Path runner. `scopePath === null` means Replace All (every
  // matching file); a non-null path narrows the run to a single file (the
  // backend still confines edits to its exact matches). Destructive (it rewrites
  // files on disk), so it always confirms first and reports the outcome.
  const runReplaceInPath = useCallback(
    async (scopePath: string | null): Promise<void> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      const query = textSearchQuery.trim();

      if (!requestedRoot || !query || textReplaceBusy) {
        return;
      }

      // Preview the blast radius BEFORE the destructive write: count the
      // matching files/occurrences (within scope) so the confirmation is honest.
      const previewResults = textSearchResults.filter(
        (result) =>
          scopePath === null
            ? !dismissedTextSearchPaths.has(result.path)
            : result.path === scopePath,
      );
      const fileCount = new Set(previewResults.map((result) => result.path))
        .size;
      const matchCount = previewResults.length;

      if (matchCount === 0) {
        setMessage("No matches to replace");
        return;
      }

      // The results list is capped at TEXT_SEARCH_RESULT_LIMIT; when it is full
      // the real blast radius may be larger than what we can preview, so the
      // confirmation says "at least N" rather than implying an exact count.
      const isCapped =
        scopePath === null &&
        textSearchResults.length >= TEXT_SEARCH_RESULT_LIMIT;
      const hasExclusions =
        scopePath === null && dismissedTextSearchPaths.size > 0;
      const isCappedWithExclusions = isCapped && hasExclusions;
      const atLeast = isCapped && !hasExclusions ? "at least " : "";
      const scopeLabel =
        isCappedWithExclusions
          ? `${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${fileCount} listed file${fileCount === 1 ? "" : "s"}`
          : scopePath === null
          ? `${atLeast}${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${atLeast}${fileCount} file${fileCount === 1 ? "" : "s"}`
          : `${matchCount} occurrence${matchCount === 1 ? "" : "s"} in ${getFileName(scopePath)}`;
      const cappedExclusionWarning = isCappedWithExclusions
        ? " Only the files currently listed will be replaced. Matches beyond the displayed results will not be modified; refine your search to include them."
        : "";

      if (
        !prompter.confirm(
          `Replace ${scopeLabel}?${cappedExclusionWarning} This rewrites files on disk and is restorable from Local History.`,
        )
      ) {
        return;
      }

      if (!isRequestedRootActive()) {
        return;
      }

      setTextReplaceBusy(true);

      try {
        // Single-file scope is passed out-of-band as an exact path (not as an
        // extra include glob), so an active user file mask can never widen a
        // "Replace in file" run into other files. `scopePath === null` means
        // Replace All.
        let result: ReplaceInPathResult | null = null;

        const usesWholeScope =
          scopePath !== null || dismissedTextSearchPaths.size === 0;

        if (usesWholeScope) {
          result = await textSearch.replaceInPath(
            requestedRoot,
            query,
            textReplacement,
            textSearchOptions,
            scopePath ?? undefined,
          );
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
            if (!isRequestedRootActive()) {
              return;
            }

            try {
              outcomes.push({
                result: await textSearch.replaceInPath(
                  requestedRoot,
                  query,
                  textReplacement,
                  textSearchOptions,
                  file.path,
                ),
              });
            } catch (error) {
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
        if (isRequestedRootActive()) {
          setTextReplaceBusy(false);
        }
      }
    },
    [
      currentWorkspaceRootRef,
      prompter,
      refreshOpenDocumentsAfterReplace,
      reportError,
      setMessage,
      textReplaceBusy,
      textReplacement,
      textSearch,
      textSearchOptions,
      textSearchQuery,
      textSearchResults,
      dismissedTextSearchPaths,
      workspaceRoot,
    ],
  );

  const replaceAllInPath = useCallback(
    () => runReplaceInPath(null),
    [runReplaceInPath],
  );

  const replaceInFile = useCallback(
    (path: string) => runReplaceInPath(path),
    [runReplaceInPath],
  );

  useEffect(() => {
    if (!textSearchOpen || !workspaceRoot || !textSearchQuery.trim()) {
      setTextSearchResults([]);
      setTextSearchLoading(false);
      return;
    }

    // Capture the requested root + filters up front; the `active` flag (reset by
    // cleanup whenever any of these change, including a workspace tab switch)
    // drops stale results so a slow search from a previous root/filter set can
    // never overwrite the current one.
    const requestedRoot = workspaceRoot;
    let active = true;
    setTextSearchLoading(true);

    const timeout = window.setTimeout(() => {
      searchQueryHistorySession.push(requestedRoot, textSearchQuery);
      textSearch
        .searchText(
          requestedRoot,
          textSearchQuery,
          TEXT_SEARCH_RESULT_LIMIT,
          textSearchOptions,
        )
        .then((results) => {
          if (!active) {
            return;
          }

          setTextSearchResults(results);
          setTextSearchExclusions({
            workspaceRoot: requestedRoot,
            paths: new Set(),
          });
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setTextSearchResults([]);
          reportError("Text Search", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setTextSearchLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    reportError,
    setMessage,
    textSearchOpen,
    textSearchQuery,
    textSearchOptions,
    textSearchRefreshToken,
    textSearch,
    workspaceRoot,
  ]);

  return {
    textSearchOpen,
    textSearchQuery,
    textSearchLoading,
    textSearchOptions,
    textSearchResults,
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
    replaceAllInPath,
    replaceInFile,
  };
}
