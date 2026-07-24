import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { BottomPanelView } from "../domain/bottomPanel";
import { jsGutterTargetsCoordinator } from "../domain/jsGutterTargetsCoordinator";
import { jsTestRunCommand, type JsTestRunCommandInput } from "../domain/jsTestCommand";
import { isJsTestRelativePath } from "../domain/jsTestFilePatterns";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpGutterTargetsCoordinator } from "../domain/phpGutterTargetsCoordinator";
import { runAllTestsTarget, type PhpTestGutterTarget } from "../domain/phpTestGutterTargets";
import {
  phpTestRunCommand,
  type PhpTestRunCommandInput,
  type PhpTestRunner,
} from "../domain/phpTestCommand";
import { isPhpTestRelativePath } from "../domain/phpTestNavigation";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  joinWorkspacePath,
  workspaceRelativePath,
  type EditorDocument,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { detectJsTestRunnerContext } from "./jsTestRunnerDetection";

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
  workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
  workspaceRoot: string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRuntimeOwner: WorkspaceRuntimeOwner | null;
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
  invalidateJsTestCoverageAndResults?: () => void;
  setMessage: (message: string | null) => void;
  setBottomPanelView: (view: BottomPanelView) => void;
  setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
}

// Result of a single isolated "run test in terminal" attempt: `ran` wrote the
// command, `dropped` short-circuited on a workspace guard (no root / stale root
// after the runner probe), `rejected` means the sanitizer refused the filter.
export type PhpTestRunOutcome = "ran" | "dropped" | "rejected";

const MAX_PENDING_TERMINAL_REQUESTS = 32;

interface TerminalOwnerBinding {
  readonly epoch: number;
  readonly owner: WorkspaceRuntimeOwner;
}

function sameTerminalOwner(
  first: TerminalOwnerBinding | null | undefined,
  second: TerminalOwnerBinding | null | undefined,
): boolean {
  return (
    !!first &&
    !!second &&
    first.epoch === second.epoch &&
    first.owner.ownerKey === second.owner.ownerKey &&
    workspaceRootKeysEqual(first.owner.executionRoot, second.owner.executionRoot)
  );
}

function takeTerminalOwnerRequests<T extends { readonly owner: TerminalOwnerBinding }>(
  requests: T[],
  owner: TerminalOwnerBinding,
): T[] {
  const matches: T[] = [];
  let writeIndex = 0;
  for (const request of requests) {
    if (sameTerminalOwner(request.owner, owner)) matches.push(request);
    else requests[writeIndex++] = request;
  }
  requests.length = writeIndex;
  return matches;
}

export interface TerminalTestRunner {
  showBottomPanelView: (view: BottomPanelView) => void;
  hideBottomPanel: () => void;
  toggleBottomPanel: () => void;
  runInActiveTerminal: (command: string) => void;
  registerActiveTerminalSession: (sessionId: number | null) => void;
  requestActiveTerminalSession: (consumer: (sessionId: number | null) => void) => void;
  runPhpTestCommand: (input: Omit<PhpTestRunCommandInput, "runner">) => Promise<PhpTestRunOutcome>;
  runJsTestCommand: (input: Omit<JsTestRunCommandInput, "runner">) => Promise<PhpTestRunOutcome>;
  runTestAt: (target: PhpTestGutterTarget) => Promise<void>;
  runTestForActiveDocument: () => Promise<void>;
  runAllTestsForActiveDocument: () => Promise<void>;
  runJsTestForActiveDocument: () => Promise<void>;
  runAllJsTestsForActiveDocument: () => Promise<void>;
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
    workspaceRuntimeOwnerRef,
    workspaceRoot,
    workspaceDescriptor,
    workspaceRuntimeOwner,
    activeDocumentRef,
    activeEditorPositionRef,
    readTestFileIfExists,
    reportErrorForActiveWorkspaceRoot,
    invalidateJsTestCoverageAndResults,
    setMessage,
    setBottomPanelView,
    setBottomPanelVisible,
  } = dependencies;
  const terminalOwnerEpochRef = useRef(0);
  const terminalOwnerSourceRef = useRef<WorkspaceRuntimeOwner | null | undefined>(undefined);
  const terminalOwnerBindingRef = useRef<TerminalOwnerBinding | null>(null);
  const effectiveTerminalOwner = workspaceRuntimeOwner ?? workspaceRuntimeOwnerRef.current;
  const previousTerminalOwner = terminalOwnerSourceRef.current;
  const terminalOwnerChanged =
    previousTerminalOwner === undefined ||
    (previousTerminalOwner === null) !== (effectiveTerminalOwner === null) ||
    (!!previousTerminalOwner &&
      !!effectiveTerminalOwner &&
      (previousTerminalOwner.ownerKey !== effectiveTerminalOwner.ownerKey ||
        !workspaceRootKeysEqual(
          previousTerminalOwner.executionRoot,
          effectiveTerminalOwner.executionRoot,
        )));
  if (terminalOwnerChanged) {
    terminalOwnerEpochRef.current += 1;
    terminalOwnerSourceRef.current = effectiveTerminalOwner;
    terminalOwnerBindingRef.current = effectiveTerminalOwner
      ? { epoch: terminalOwnerEpochRef.current, owner: effectiveTerminalOwner }
      : null;
  }
  const terminalOwnerBinding = terminalOwnerBindingRef.current;

  // The backend session id of the project terminal currently mounted in the
  // bottom panel, tagged with the workspace root it belongs to. The terminal
  // panel reports this; "run test from gutter" writes into it. Tagging by root
  // keeps the per-tab isolation invariant: a session reported for one project
  // can never be addressed while a different project tab is active.
  const activeTerminalSessionRef = useRef<{
    owner: TerminalOwnerBinding;
    sessionId: number;
  } | null>(null);
  // A test-run command staged while the terminal session for the active root is
  // not yet ready (e.g. the panel was just revealed). It is flushed exactly once
  // when a matching-root session registers, then cleared. A workspace switch
  // before the session arrives discards it (root mismatch on flush).
  const pendingTerminalCommandsRef = useRef<
    Array<{
      command: string;
      owner: TerminalOwnerBinding;
    }>
  >([]);
  const pendingTerminalSessionConsumersRef = useRef<
    Array<{
      consume(sessionId: number | null): void;
      owner: TerminalOwnerBinding;
    }>
  >([]);

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
  const runInTerminalForOwner = useCallback(
    (command: string, requestedOwner: TerminalOwnerBinding): boolean => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (
        !requestedRoot ||
        !sameTerminalOwner(terminalOwnerBindingRef.current, requestedOwner) ||
        !workspaceRootKeysEqual(requestedOwner.owner.executionRoot, requestedRoot)
      ) {
        return false;
      }

      // Reveal the terminal so the panel mounts (and reports its session id) and
      // the user sees the run.
      showBottomPanelView("terminal");

      const active = activeTerminalSessionRef.current;

      if (active && sameTerminalOwner(active.owner, requestedOwner)) {
        void terminalGateway.writeInput(active.sessionId, `${command}\r`).catch((error) => {
          if (sameTerminalOwner(terminalOwnerBindingRef.current, requestedOwner)) {
            reportErrorForActiveWorkspaceRoot(requestedRoot, "Run Test", error);
          }
        });
        return true;
      }

      if (pendingTerminalCommandsRef.current.length >= MAX_PENDING_TERMINAL_REQUESTS) {
        setMessage("Terminal command queue is full. Wait for the terminal to start and try again.");
        return false;
      }
      pendingTerminalCommandsRef.current.push({ command, owner: requestedOwner });
      return true;
    },
    [
      currentWorkspaceRootRef,
      reportErrorForActiveWorkspaceRoot,
      setMessage,
      showBottomPanelView,
      terminalGateway,
    ],
  );
  const runInActiveTerminal = useCallback(
    (command: string) => {
      const requestedOwner = terminalOwnerBindingRef.current;
      if (!requestedOwner) return;
      runInTerminalForOwner(command, requestedOwner);
    },
    [runInTerminalForOwner],
  );

  // Receives the backend session id of the terminal panel for the active
  // workspace (or `null` when it tears down). Tags it with the current root so
  // later writes can re-check isolation, and flushes a pending test-run command
  // when the session belongs to the same root the command was requested for.
  const registerActiveTerminalSession = useCallback(
    (sessionId: number | null) => {
      const registrationOwner = terminalOwnerBinding;
      if (
        !registrationOwner ||
        !sameTerminalOwner(terminalOwnerBindingRef.current, registrationOwner) ||
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          registrationOwner.owner.executionRoot,
        )
      ) {
        return;
      }

      if (sessionId === null) {
        if (sameTerminalOwner(activeTerminalSessionRef.current?.owner, registrationOwner)) {
          activeTerminalSessionRef.current = null;
        }
        const consumers = takeTerminalOwnerRequests(
          pendingTerminalSessionConsumersRef.current,
          registrationOwner,
        );
        for (const pending of consumers) pending.consume(null);
        return;
      }

      activeTerminalSessionRef.current = { owner: registrationOwner, sessionId };

      const sessionConsumers = takeTerminalOwnerRequests(
        pendingTerminalSessionConsumersRef.current,
        registrationOwner,
      );
      for (const pending of sessionConsumers) {
        pending.consume(sessionId);
      }

      const commands = takeTerminalOwnerRequests(
        pendingTerminalCommandsRef.current,
        registrationOwner,
      );
      for (const pending of commands) {
        if (
          !sameTerminalOwner(terminalOwnerBindingRef.current, registrationOwner) ||
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            registrationOwner.owner.executionRoot,
          )
        ) {
          return;
        }
        void terminalGateway.writeInput(sessionId, `${pending.command}\r`).catch((error) => {
          if (sameTerminalOwner(terminalOwnerBindingRef.current, registrationOwner)) {
            reportErrorForActiveWorkspaceRoot(
              registrationOwner.owner.executionRoot,
              "Run Test",
              error,
            );
          }
        });
      }
    },
    [
      currentWorkspaceRootRef,
      reportErrorForActiveWorkspaceRoot,
      terminalGateway,
      terminalOwnerBinding,
    ],
  );

  const requestActiveTerminalSession = useCallback(
    (consumer: (sessionId: number | null) => void) => {
      const requestedRoot = currentWorkspaceRootRef.current;
      if (!requestedRoot) {
        consumer(null);
        return;
      }
      showBottomPanelView("terminal");
      const requestedOwner = terminalOwnerBindingRef.current;
      if (
        !workspaceRuntimeOwner ||
        !requestedOwner ||
        requestedOwner.owner.ownerKey !== workspaceRuntimeOwner.ownerKey ||
        !workspaceRootKeysEqual(
          requestedOwner.owner.executionRoot,
          workspaceRuntimeOwner.executionRoot,
        ) ||
        !workspaceRootKeysEqual(requestedOwner.owner.executionRoot, requestedRoot)
      ) {
        consumer(null);
        return;
      }
      const active = activeTerminalSessionRef.current;
      if (active && sameTerminalOwner(active.owner, requestedOwner)) {
        consumer(active.sessionId);
        return;
      }
      if (pendingTerminalSessionConsumersRef.current.length >= MAX_PENDING_TERMINAL_REQUESTS) {
        consumer(null);
        setMessage("Terminal request queue is full. Wait for the terminal to start and try again.");
        return;
      }
      pendingTerminalSessionConsumersRef.current.push({
        consume: consumer,
        owner: requestedOwner,
      });
    },
    [currentWorkspaceRootRef, setMessage, showBottomPanelView, workspaceRuntimeOwner],
  );

  useEffect(() => {
    const sessionConsumers = pendingTerminalSessionConsumersRef.current;
    const commands = pendingTerminalCommandsRef.current;
    const effectOwner = terminalOwnerBinding;
    if (!effectOwner || !sameTerminalOwner(activeTerminalSessionRef.current?.owner, effectOwner)) {
      activeTerminalSessionRef.current = null;
    }
    return () => {
      if (!effectOwner) return;
      if (sameTerminalOwner(activeTerminalSessionRef.current?.owner, effectOwner)) {
        activeTerminalSessionRef.current = null;
      }
      takeTerminalOwnerRequests(commands, effectOwner);
      const pending = takeTerminalOwnerRequests(sessionConsumers, effectOwner);
      if (pending.length > 0) {
        queueMicrotask(() => {
          for (const request of pending) request.consume(null);
        });
      }
    };
  }, [terminalOwnerBinding]);

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
    async (input: Omit<PhpTestRunCommandInput, "runner">): Promise<PhpTestRunOutcome> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const requestedOwner = terminalOwnerBinding;
      const isRequestedOwnerActive = () =>
        sameTerminalOwner(terminalOwnerBindingRef.current, requestedOwner) &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !requestedOwner ||
        !workspaceRootKeysEqual(requestedOwner.owner.executionRoot, requestedRoot) ||
        !requestedDescriptor?.php
      ) {
        return "dropped";
      }

      const runner = await detectPhpTestRunner(requestedRoot);

      if (!isRequestedOwnerActive()) {
        return "dropped";
      }

      const command = phpTestRunCommand({ ...input, runner });

      if (!command) {
        return "rejected";
      }

      runInTerminalForOwner(command, requestedOwner);
      return "ran";
    },
    [
      currentWorkspaceRootRef,
      detectPhpTestRunner,
      runInTerminalForOwner,
      terminalOwnerBinding,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const activeJsTestRelativePath = useCallback((): string | null => {
    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const requestedDocument = activeDocumentRef.current;

    if (!requestedRoot || !requestedDescriptor?.javaScriptTypeScript || !requestedDocument) {
      return null;
    }

    const relativePath = workspaceRelativePath(requestedRoot, requestedDocument.path);

    if (!relativePath || !isJsTestRelativePath(relativePath)) {
      return null;
    }

    return relativePath;
  }, [activeDocumentRef, workspaceDescriptor, workspaceRoot]);

  const runJsTestCommand = useCallback(
    async (input: Omit<JsTestRunCommandInput, "runner">): Promise<PhpTestRunOutcome> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const requestedOwner = terminalOwnerBinding;
      const isRequestedOwnerActive = () =>
        sameTerminalOwner(terminalOwnerBindingRef.current, requestedOwner) &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !requestedOwner ||
        !workspaceRootKeysEqual(requestedOwner.owner.executionRoot, requestedRoot) ||
        !requestedDescriptor?.javaScriptTypeScript
      ) {
        return "dropped";
      }

      const targetPath = input.filePath ? joinWorkspacePath(requestedRoot, input.filePath) : null;
      const runnerContext = await detectJsTestRunnerContext(
        requestedRoot,
        readTestFileIfExists,
        targetPath,
      );

      if (!isRequestedOwnerActive()) {
        return "dropped";
      }

      if (!runnerContext) {
        setMessage("Run test: no vitest or jest setup detected in this workspace.");
        return "dropped";
      }

      const workingDirectory = workspaceRelativePath(requestedRoot, runnerContext.rootPath) ?? null;
      const command = jsTestRunCommand({
        ...input,
        filePath: input.filePath ? runnerContext.targetRelativePath : input.filePath,
        executablePath: runnerContext.executablePath,
        runner: runnerContext.runner,
        workingDirectory,
      });

      if (!command) {
        return "rejected";
      }

      const admitted = runInTerminalForOwner(command, requestedOwner);
      if (!admitted) {
        return "dropped";
      }
      invalidateJsTestCoverageAndResults?.();
      return "ran";
    },
    [
      currentWorkspaceRootRef,
      invalidateJsTestCoverageAndResults,
      readTestFileIfExists,
      runInTerminalForOwner,
      setMessage,
      terminalOwnerBinding,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const runJsTestAt = useCallback(
    async (target: PhpTestGutterTarget, relativePath: string) => {
      const outcome = await runJsTestCommand({
        filePath: relativePath,
        filter: target.filter,
      });

      if (outcome !== "rejected") {
        return;
      }

      setMessage(runTestRejectionNotice(target));
    },
    [runJsTestCommand, setMessage],
  );

  const runTestAt = useCallback(
    async (target: PhpTestGutterTarget) => {
      const jsTestRelativePath = activeJsTestRelativePath();

      if (jsTestRelativePath !== null) {
        await runJsTestAt(target, jsTestRelativePath);
        return;
      }

      const outcome = await runPhpTestCommand({
        filter: target.filter,
        match: target.match,
      });

      if (outcome !== "rejected") {
        return;
      }

      setMessage(runTestRejectionNotice(target));
    },
    [activeJsTestRelativePath, runJsTestAt, runPhpTestCommand, setMessage],
  );

  const runJsTestForActiveDocument = useCallback(async () => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const relativePath = activeJsTestRelativePath();

    if (!requestedRoot || !requestedDocument || relativePath === null) {
      return;
    }

    const targets = jsGutterTargetsCoordinator.resolveTest(
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

    await runJsTestAt(target, relativePath);
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    activeJsTestRelativePath,
    runJsTestAt,
    setMessage,
    workspaceRoot,
  ]);

  const runAllJsTestsForActiveDocument = useCallback(async () => {
    const relativePath = activeJsTestRelativePath();

    if (relativePath === null) {
      return;
    }

    await runJsTestCommand({ filePath: relativePath });
  }, [activeJsTestRelativePath, runJsTestCommand]);

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

    const relativePath = workspaceRelativePath(requestedRoot, requestedDocument.path);

    if (!relativePath || !isPhpTestRelativePath(relativePath, requestedDescriptor.php.psr4Roots)) {
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

    const relativePath = workspaceRelativePath(requestedRoot, requestedDocument.path);

    if (!relativePath || !isPhpTestRelativePath(relativePath, requestedDescriptor.php.psr4Roots)) {
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
  }, [activeDocumentRef, runPhpTestCommand, runTestAt, workspaceDescriptor, workspaceRoot]);

  return {
    hideBottomPanel,
    registerActiveTerminalSession,
    requestActiveTerminalSession,
    runAllJsTestsForActiveDocument,
    runAllTestsForActiveDocument,
    runInActiveTerminal,
    runJsTestCommand,
    runJsTestForActiveDocument,
    runPhpTestCommand,
    runTestAt,
    runTestForActiveDocument,
    showBottomPanelView,
    toggleBottomPanel,
  };
}
