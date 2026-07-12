import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpGutterTargetsCoordinator } from "../domain/phpGutterTargetsCoordinator";
import {
  runAllTestsTarget,
  type PhpTestGutterTarget,
} from "../domain/phpTestGutterTargets";
import {
  phpTestRunCommand,
  type PhpTestRunCommandInput,
  type PhpTestRunner,
} from "../domain/phpTestCommand";
import { isPhpTestRelativePath } from "../domain/phpTestNavigation";
import type { TerminalGateway } from "../domain/terminal";
import {
  joinWorkspacePath,
  workspaceRelativePath,
  type EditorDocument,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Collaborators the terminal / PHP test runner needs from the workbench
 * shell. The bottom panel view/visible state is shell-owned: several other
 * flows outside this hook (workspace-state caching, workspace-session
 * restore, workspace-tab-close reset) read and write it directly, so this
 * hook only consumes the setters rather than owning the state
 * (mirrors how `useBookmarks` consumes `bookmarks`/`setBookmarks`
 * instead of owning that state). Everything used exclusively by "run in
 * terminal" / "run PHP test" - the active terminal session tracking, the
 * staged command, the runner auto-detection - is owned by this hook.
 */
export interface TerminalTestRunnerDependencies {
  terminalGateway: TerminalGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  // Returns the test file's content when it already exists, otherwise `null`.
  // Shared with "Create Test" (shell-owned), so this hook only consumes it.
  readTestFileIfExists: (path: string) => Promise<string | null>;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  setMessage: (message: string | null) => void;
  setBottomPanelView: (view: BottomPanelView) => void;
  setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
}

// Result of a single isolated "run test in terminal" attempt: `ran` wrote the
// command, `dropped` short-circuited on a workspace guard (no root / stale root
// after the runner probe), `rejected` means the sanitizer refused the filter.
export type PhpTestRunOutcome = "ran" | "dropped" | "rejected";

export interface TerminalTestRunner {
  showBottomPanelView: (view: BottomPanelView) => void;
  hideBottomPanel: () => void;
  toggleBottomPanel: () => void;
  runInActiveTerminal: (command: string) => void;
  registerActiveTerminalSession: (sessionId: number | null) => void;
  runPhpTestCommand: (
    input: Omit<PhpTestRunCommandInput, "runner">,
  ) => Promise<PhpTestRunOutcome>;
  runTestAt: (target: PhpTestGutterTarget) => Promise<void>;
  runTestForActiveDocument: () => Promise<void>;
  runAllTestsForActiveDocument: () => Promise<void>;
}

// Notice shown when a parsed test target cannot be turned into a safe command.
// PHPUnit identifiers are rejected only when they fall outside the word-character
// allow-list; Pest descriptions are rejected only when they carry a newline or
// other control character (the one input we refuse to quote into the terminal).
function runTestRejectionNotice(target: PhpTestGutterTarget): string {
  if (target.match === "description") {
    return `Run test: "${target.filter}" contains a line break or control character and cannot be run safely.`;
  }

  return `Run test: "${target.filter}" can only run by name (letters, digits, underscore).`;
}

// Chooses the gutter test target that owns a cursor line: the nearest target at
// or above the caret. Method targets are preferred so a caret inside a test
// method body runs that method; with the caret above the first method (e.g. on
// the class line) the class target is selected. Returns `null` when there are no
// targets at or above the caret.
function testTargetForCursorLine(
  targets: readonly PhpTestGutterTarget[],
  cursorLine: number,
): PhpTestGutterTarget | null {
  let chosen: PhpTestGutterTarget | null = null;

  for (const target of targets) {
    if (target.position.lineNumber > cursorLine) {
      continue;
    }

    if (!chosen || target.position.lineNumber >= chosen.position.lineNumber) {
      chosen = target;
    }
  }

  return chosen;
}

/**
 * Bottom panel reveal/hide/toggle, "write into the active project terminal",
 * and PHP test-runner (PhpStorm-style "Run Test" from the gutter / keymap)
 * for the workbench. Per-workspace isolation: the requested root is captured
 * up front on every async entry point and re-checked after each `await`
 * before any terminal write, so a mid-flight workspace switch drops the
 * (now stale) run instead of writing into the wrong project's terminal.
 */
export function useTerminalTestRunner(
  dependencies: TerminalTestRunnerDependencies,
): TerminalTestRunner {
  const {
    terminalGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    workspaceDescriptor,
    activeDocumentRef,
    activeEditorPositionRef,
    readTestFileIfExists,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    setBottomPanelView,
    setBottomPanelVisible,
  } = dependencies;

  // The backend session id of the project terminal currently mounted in the
  // bottom panel, tagged with the workspace root it belongs to. The terminal
  // panel reports this; "run test from gutter" writes into it. Tagging by root
  // keeps the per-tab isolation invariant: a session reported for one project
  // can never be addressed while a different project tab is active.
  const activeTerminalSessionRef = useRef<{
    rootPath: string;
    sessionId: number;
  } | null>(null);
  // A test-run command staged while the terminal session for the active root is
  // not yet ready (e.g. the panel was just revealed). It is flushed exactly once
  // when a matching-root session registers, then cleared. A workspace switch
  // before the session arrives discards it (root mismatch on flush).
  const pendingTerminalCommandRef = useRef<{
    command: string;
    rootPath: string;
  } | null>(null);

  const showBottomPanelView = useCallback(
    (view: BottomPanelView) => {
      setBottomPanelView(view);
      setBottomPanelVisible(true);
    },
    [setBottomPanelView, setBottomPanelVisible],
  );

  const hideBottomPanel = useCallback(() => {
    setBottomPanelVisible(false);
  }, [setBottomPanelVisible]);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelVisible((visible) => !visible);
  }, [setBottomPanelVisible]);

  // Picks the test runner for a workspace: Laravel `php artisan test` when an
  // `artisan` console binary exists at the project root, otherwise the generic
  // `vendor/bin/phpunit`. Probing the file (rather than guessing from the
  // descriptor) keeps non-Laravel PHP projects working.
  const detectPhpTestRunner = useCallback(
    async (rootPath: string): Promise<PhpTestRunner> => {
      const artisanPath = joinWorkspacePath(rootPath, "artisan");
      const artisan = await readTestFileIfExists(artisanPath);

      return artisan === null ? "phpunit" : "artisan";
    },
    [readTestFileIfExists],
  );

  // Writes a single command line into the active project terminal. The command
  // string is built by the caller from a STATIC prefix + sanitized filter, so
  // nothing here can introduce shell metacharacters. Isolation: the requested
  // root is captured up front; the write only happens when a terminal session
  // for that exact root is active. When no session is ready yet, the command is
  // staged and flushed by `registerActiveTerminalSession` once a matching-root
  // session arrives (a tab switch in between discards it on root mismatch).
  const runInActiveTerminal = useCallback(
    (command: string) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return;
      }

      // Reveal the terminal so the panel mounts (and reports its session id) and
      // the user sees the run.
      showBottomPanelView("terminal");

      const active = activeTerminalSessionRef.current;

      if (active && workspaceRootKeysEqual(active.rootPath, requestedRoot)) {
        void terminalGateway
          .writeInput(active.sessionId, `${command}\r`)
          .catch((error) =>
            reportErrorForActiveWorkspaceRoot(requestedRoot, "Run Test", error),
          );
        return;
      }

      pendingTerminalCommandRef.current = { command, rootPath: requestedRoot };
    },
    [reportErrorForActiveWorkspaceRoot, showBottomPanelView, terminalGateway],
  );

  // Receives the backend session id of the terminal panel for the active
  // workspace (or `null` when it tears down). Tags it with the current root so
  // later writes can re-check isolation, and flushes a pending test-run command
  // when the session belongs to the same root the command was requested for.
  const registerActiveTerminalSession = useCallback(
    (sessionId: number | null) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (sessionId === null || !rootPath) {
        activeTerminalSessionRef.current = null;
        return;
      }

      activeTerminalSessionRef.current = { rootPath, sessionId };

      const pending = pendingTerminalCommandRef.current;

      if (!pending) {
        return;
      }

      pendingTerminalCommandRef.current = null;

      if (!workspaceRootKeysEqual(pending.rootPath, rootPath)) {
        return;
      }

      void terminalGateway
        .writeInput(sessionId, `${pending.command}\r`)
        .catch((error) =>
          reportErrorForActiveWorkspaceRoot(rootPath, "Run Test", error),
        );
    },
    [reportErrorForActiveWorkspaceRoot, terminalGateway],
  );

  // PhpStorm-style "Run test from gutter": builds and writes the test command
  // for a parsed gutter target into the active project terminal. The runner is
  // auto-detected (Laravel `php artisan test` when an `artisan` binary exists,
  // otherwise `vendor/bin/phpunit`). Per-workspace isolation: the requested root
  // is captured up front and re-checked after the artisan probe await before any
  // terminal write. The command's filter is strictly sanitized in
  // `phpTestRunCommand`; a name that is not a safe identifier yields no command
  // (no write), so no file content can ever inject shell input.
  // Shared per-workspace-isolated core for every "run test in terminal" action.
  // It captures the requested root up front, probes the runner, re-checks the
  // active root AFTER the await before any terminal write (so a mid-flight
  // workspace switch drops the run), and builds the command via the strictly
  // sanitizing `phpTestRunCommand`. A `null` filter runs the whole suite/class
  // with no `--filter`. Returning the runner-built command unchanged means no
  // value derived from file content can introduce shell metacharacters.
  const runPhpTestCommand = useCallback(
    async (
      input: Omit<PhpTestRunCommandInput, "runner">,
    ): Promise<PhpTestRunOutcome> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return "dropped";
      }

      const runner = await detectPhpTestRunner(requestedRoot);

      if (!isRequestedRootActive()) {
        return "dropped";
      }

      const command = phpTestRunCommand({ ...input, runner });

      if (!command) {
        return "rejected";
      }

      runInActiveTerminal(command);
      return "ran";
    },
    [
      detectPhpTestRunner,
      runInActiveTerminal,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const runTestAt = useCallback(
    async (target: PhpTestGutterTarget) => {
      const outcome = await runPhpTestCommand({
        filter: target.filter,
        match: target.match,
      });

      if (outcome !== "rejected") {
        return;
      }

      setMessage(runTestRejectionNotice(target));
    },
    [runPhpTestCommand, setMessage],
  );

  // Keymap entry point for "Run Test Under Cursor": parses the active PHP test
  // file, selects the test that owns the cursor line (the nearest test target at
  // or above the caret, falling back to the class target), and runs it. Gated to
  // PHP test files so it is a no-op on production code or non-PHP documents.
  const runTestForActiveDocument = useCallback(async () => {
    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const requestedDocument = activeDocumentRef.current;

    if (!requestedRoot || !requestedDescriptor?.php || !requestedDocument) {
      return;
    }

    if (requestedDocument.language !== "php") {
      return;
    }

    const relativePath = workspaceRelativePath(
      requestedRoot,
      requestedDocument.path,
    );

    if (
      !relativePath ||
      !isPhpTestRelativePath(relativePath, requestedDescriptor.php.psr4Roots)
    ) {
      return;
    }

    const targets = phpGutterTargetsCoordinator.resolveTest(
      requestedRoot,
      requestedDocument.path,
      requestedDocument.content,
    );
    const cursorLine = activeEditorPositionRef.current?.lineNumber ?? 1;
    const target = testTargetForCursorLine(targets, cursorLine);

    if (!target) {
      setMessage("Run test: no test found at the cursor.");
      return;
    }

    await runTestAt(target);
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    runTestAt,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  // Keymap / palette entry point for "Run All Tests in File": runs the whole
  // active test file rather than a single test. For a pure PHPUnit file we run
  // the class target (its `--filter <ClassName>` runs every method in the
  // class). For a Pest file - or a mixed file that declares a concrete `*Test`
  // class AND Pest `it()` / `test()` calls - we fall back to running the whole
  // suite with no `--filter`: a `--filter <ClassName>` would skip the Pest
  // tests, and a file-path argument cannot pass the identifier allow-list (and
  // quoting an arbitrary path into the terminal is a needless injection
  // surface), so the conservative whole-suite run is preferred. The selection is
  // owned by `runAllTestsTarget`. Gated to PHP test files; per-workspace
  // isolation is inherited from `runTestAt` / `runPhpTestCommand` (requested
  // root captured up front, re-checked after the runner probe before any
  // terminal write).
  const runAllTestsForActiveDocument = useCallback(async () => {
    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const requestedDocument = activeDocumentRef.current;

    if (!requestedRoot || !requestedDescriptor?.php || !requestedDocument) {
      return;
    }

    if (requestedDocument.language !== "php") {
      return;
    }

    const relativePath = workspaceRelativePath(
      requestedRoot,
      requestedDocument.path,
    );

    if (
      !relativePath ||
      !isPhpTestRelativePath(relativePath, requestedDescriptor.php.psr4Roots)
    ) {
      return;
    }

    const targets = phpGutterTargetsCoordinator.resolveTest(
      requestedRoot,
      requestedDocument.path,
      requestedDocument.content,
    );
    const target = runAllTestsTarget(targets);

    if (target) {
      await runTestAt(target);
      return;
    }

    await runPhpTestCommand({ filter: null });
  }, [
    activeDocumentRef,
    runPhpTestCommand,
    runTestAt,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  return {
    hideBottomPanel,
    registerActiveTerminalSession,
    runAllTestsForActiveDocument,
    runInActiveTerminal,
    runPhpTestCommand,
    runTestAt,
    runTestForActiveDocument,
    showBottomPanelView,
    toggleBottomPanel,
  };
}
