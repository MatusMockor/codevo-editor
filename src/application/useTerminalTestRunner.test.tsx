// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useTerminalTestRunner,
  type TerminalTestRunner,
  type TerminalTestRunnerDependencies,
} from "./useTerminalTestRunner";
import type { BottomPanelView } from "../domain/bottomPanel";
import { phpGutterTargetsCoordinator } from "../domain/phpGutterTargetsCoordinator";
import type { PhpTestGutterTarget } from "../domain/phpTestGutterTargets";
import type { TerminalGateway } from "../domain/terminal";
import type {
  EditorDocument,
  PhpProjectDescriptor,
  WorkspaceDescriptor,
} from "../domain/workspace";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";

const ROOT = "/workspace";

function document(path: string, content: string): EditorDocument {
  return {
    content,
    language: "php",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: content,
  };
}

function phpProjectDescriptor(overrides: Partial<PhpProjectDescriptor> = {}): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
    packages: [],
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [
      { dev: false, namespace: "App\\", paths: ["app/"] },
      { dev: true, namespace: "Tests\\", paths: ["tests/"] },
    ],
    ...overrides,
  };
}

function phpWorkspaceDescriptor(
  phpOverrides: Partial<PhpProjectDescriptor> = {},
): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: phpProjectDescriptor(phpOverrides),
    rootPath: ROOT,
  };
}

function createFakeTerminalGateway(overrides: Partial<TerminalGateway> = {}): TerminalGateway {
  const base: TerminalGateway = {
    acknowledgeStart: vi.fn(async () => undefined),
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({ kind: "stopped" as const, sessionId: 1 })),
    stop: vi.fn(async (sessionId: number) => ({
      kind: "stopped" as const,
      sessionId,
    })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Harness {
  runner: () => TerminalTestRunner;
  rootRef: { current: string | null };
  activeDocumentRef: { current: EditorDocument | null };
  activeEditorPositionRef: {
    current: { column: number; lineNumber: number } | null;
  };
  reportErrorForActiveWorkspaceRoot: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  setOwner: (owner: WorkspaceRuntimeOwner | null) => void;
  bottomPanelView: () => string;
  bottomPanelVisible: () => boolean;
  unmount: () => void;
}

function renderTerminalTestRunner(
  overrides: Partial<TerminalTestRunnerDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { runner: TerminalTestRunner | null } = { runner: null };
  const panelState: { view: string; visible: boolean } = {
    view: "problems",
    visible: false,
  };

  const rootRef: { current: string | null } = { current: ROOT };
  const activeDocumentRef: { current: EditorDocument | null } = {
    current: null,
  };
  const activeEditorPositionRef: {
    current: { column: number; lineNumber: number } | null;
  } = { current: null };
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  const setMessage = vi.fn();
  const readTestFileIfExists = overrides.readTestFileIfExists ?? (async () => null);
  let currentOwner =
    overrides.workspaceRuntimeOwner === undefined
      ? createWorkspaceRuntimeOwner("workspace-a", ROOT)
      : overrides.workspaceRuntimeOwner;
  const runtimeOwnerRef: { current: WorkspaceRuntimeOwner | null } = {
    current: currentOwner ?? createLegacyWorkspaceRuntimeOwner(ROOT),
  };

  function Harness() {
    const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>(
      panelState.view as BottomPanelView,
    );
    const [bottomPanelVisible, setBottomPanelVisible] = useState(panelState.visible);
    panelState.view = bottomPanelView;
    panelState.visible = bottomPanelVisible;

    const deps: TerminalTestRunnerDependencies = {
      activeDocumentRef,
      activeEditorPositionRef,
      currentWorkspaceRootRef: rootRef,
      workspaceRuntimeOwnerRef: runtimeOwnerRef,
      readTestFileIfExists,
      reportErrorForActiveWorkspaceRoot,
      setBottomPanelView,
      setBottomPanelVisible,
      setMessage,
      terminalGateway: createFakeTerminalGateway(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceRoot: ROOT,
      ...overrides,
      workspaceRuntimeOwner: currentOwner,
    };
    captured.runner = useTerminalTestRunner(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    activeDocumentRef,
    activeEditorPositionRef,
    bottomPanelView: () => panelState.view,
    bottomPanelVisible: () => panelState.visible,
    reportErrorForActiveWorkspaceRoot,
    rootRef,
    runner: () => {
      if (!captured.runner) {
        throw new Error("runner not mounted");
      }
      return captured.runner;
    },
    setMessage,
    setOwner: (owner) => {
      currentOwner = owner;
      runtimeOwnerRef.current = owner ?? createLegacyWorkspaceRuntimeOwner(rootRef.current ?? ROOT);
      act(() => root.render(<Harness />));
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function target(overrides: Partial<PhpTestGutterTarget> = {}): PhpTestGutterTarget {
  return {
    filter: "testCalculate",
    kind: "method",
    label: "Run testCalculate",
    match: "identifier",
    position: { column: 21, lineNumber: 9 },
    ...overrides,
  };
}

function jsWorkspaceDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: {
      frameworks: [],
      hasJsconfig: false,
      hasPackageJson: true,
      hasTsconfig: true,
      packageManager: "npm",
      packageName: "app",
      typeScriptDependencyVersion: "^5.0.0",
      usesTypeScript: true,
      workspaceTypeScriptVersion: "5.0.0",
    },
    php: null,
    rootPath: ROOT,
  };
}

function jsDocument(path: string, content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: content,
  };
}

function jsTarget(overrides: Partial<PhpTestGutterTarget> = {}): PhpTestGutterTarget {
  return {
    filter: "adds numbers",
    kind: "method",
    label: "Run adds numbers",
    match: "description",
    position: { column: 3, lineNumber: 2 },
    ...overrides,
  };
}

const JS_TEST_SOURCE = `describe("sum", () => {
  it("adds numbers", () => {});

  it("subtracts numbers", () => {});
});
`;

function vitestWorkspaceReader(): (path: string) => Promise<string | null> {
  return vi.fn(async (path: string) =>
    path === `${ROOT}/vitest.config.ts` ? "export default {};" : null,
  );
}

describe("useTerminalTestRunner", () => {
  describe("bottom panel visibility", () => {
    it("showBottomPanelView sets the view and reveals the panel", () => {
      const harness = renderTerminalTestRunner();

      act(() => {
        harness.runner().showBottomPanelView("terminal");
      });

      expect(harness.bottomPanelView()).toBe("terminal");
      expect(harness.bottomPanelVisible()).toBe(true);
      harness.unmount();
    });

    it("hideBottomPanel hides the panel without changing the view", () => {
      const harness = renderTerminalTestRunner();

      act(() => {
        harness.runner().showBottomPanelView("terminal");
      });
      act(() => {
        harness.runner().hideBottomPanel();
      });

      expect(harness.bottomPanelView()).toBe("terminal");
      expect(harness.bottomPanelVisible()).toBe(false);
      harness.unmount();
    });

    it("toggleBottomPanel flips visibility", () => {
      const harness = renderTerminalTestRunner();

      act(() => {
        harness.runner().toggleBottomPanel();
      });
      expect(harness.bottomPanelVisible()).toBe(true);

      act(() => {
        harness.runner().toggleBottomPanel();
      });
      expect(harness.bottomPanelVisible()).toBe(false);
      harness.unmount();
    });
  });

  describe("registerActiveTerminalSession / runTestAt", () => {
    it("delivers the matching active terminal session without writing shell input", () => {
      const writeInput = vi.fn(async () => undefined);
      const consume = vi.fn();
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      act(() => harness.runner().registerActiveTerminalSession(6));
      act(() => harness.runner().requestActiveTerminalSession(consume));

      expect(consume).toHaveBeenCalledWith(6);
      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.bottomPanelView()).toBe("terminal");
      harness.unmount();
    });

    it("stages a typed terminal consumer and fulfills it exactly once", () => {
      const consume = vi.fn();
      const harness = renderTerminalTestRunner();
      act(() => harness.runner().requestActiveTerminalSession(consume));
      expect(consume).not.toHaveBeenCalled();

      act(() => harness.runner().registerActiveTerminalSession(8));
      act(() => harness.runner().registerActiveTerminalSession(9));
      expect(consume).toHaveBeenCalledExactlyOnceWith(8);
      harness.unmount();
    });

    it("fulfills every queued current-root terminal consumer in FIFO order", () => {
      const calls: string[] = [];
      const harness = renderTerminalTestRunner();
      act(() => {
        harness
          .runner()
          .requestActiveTerminalSession((sessionId) => calls.push(`first:${sessionId}`));
        harness
          .runner()
          .requestActiveTerminalSession((sessionId) => calls.push(`second:${sessionId}`));
      });

      act(() => harness.runner().registerActiveTerminalSession(8));

      expect(calls).toEqual(["first:8", "second:8"]);
      harness.unmount();
    });

    it("fulfills 32 typed terminal consumers in FIFO order and rejects the 33rd immediately", () => {
      const calls: string[] = [];
      const harness = renderTerminalTestRunner();
      act(() => {
        for (let index = 0; index < 32; index += 1) {
          harness
            .runner()
            .requestActiveTerminalSession((sessionId) => calls.push(`${index}:${sessionId}`));
        }
        harness
          .runner()
          .requestActiveTerminalSession((sessionId) => calls.push(`overflow:${sessionId}`));
      });

      expect(calls).toEqual(["overflow:null"]);
      expect(harness.setMessage).toHaveBeenCalledExactlyOnceWith(
        "Terminal request queue is full. Wait for the terminal to start and try again.",
      );

      act(() => harness.runner().registerActiveTerminalSession(8));

      expect(calls).toEqual([
        "overflow:null",
        ...Array.from({ length: 32 }, (_, index) => `${index}:8`),
      ]);
      harness.unmount();
    });

    it("cancels a staged typed terminal consumer when the terminal tears down", () => {
      const consume = vi.fn();
      const harness = renderTerminalTestRunner();
      act(() => harness.runner().requestActiveTerminalSession(consume));
      act(() => harness.runner().registerActiveTerminalSession(null));
      expect(consume).toHaveBeenCalledExactlyOnceWith(null);
      harness.unmount();
    });

    it("cancels every queued consumer exactly once during cleanup", async () => {
      const first = vi.fn();
      const second = vi.fn();
      const harness = renderTerminalTestRunner();
      act(() => {
        harness.runner().requestActiveTerminalSession(first);
        harness.runner().requestActiveTerminalSession(second);
      });

      harness.unmount();
      await Promise.resolve();

      expect(first).toHaveBeenCalledExactlyOnceWith(null);
      expect(second).toHaveBeenCalledExactlyOnceWith(null);
    });

    it("drops same-root owner A queues instead of flushing them into owner B", async () => {
      const consume = vi.fn();
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      act(() => {
        harness.runner().requestActiveTerminalSession(consume);
        harness.runner().runInActiveTerminal("owner-a-command");
      });

      harness.setOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT));
      await act(async () => Promise.resolve());
      act(() => harness.runner().registerActiveTerminalSession(22));

      expect(consume).toHaveBeenCalledExactlyOnceWith(null);
      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("fences stale A callbacks across same-root A-B-A owner epochs", () => {
      const harness = renderTerminalTestRunner();
      const registerFirstA = harness.runner().registerActiveTerminalSession;
      act(() => registerFirstA(11));

      harness.setOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT));
      const registerB = harness.runner().registerActiveTerminalSession;
      act(() => registerB(22));
      act(() => registerFirstA(null));
      const consumeB = vi.fn();
      act(() => harness.runner().requestActiveTerminalSession(consumeB));
      expect(consumeB).toHaveBeenCalledExactlyOnceWith(22);

      harness.setOwner(createWorkspaceRuntimeOwner("workspace-a", ROOT));
      const registerSecondA = harness.runner().registerActiveTerminalSession;
      const consumeSecondA = vi.fn();
      act(() => harness.runner().requestActiveTerminalSession(consumeSecondA));
      act(() => {
        registerFirstA(33);
        registerFirstA(null);
      });
      expect(consumeSecondA).not.toHaveBeenCalled();
      act(() => registerSecondA(44));
      expect(consumeSecondA).toHaveBeenCalledExactlyOnceWith(44);
      harness.unmount();
    });

    it("fails closed for typed terminal session requests without an admitted owner", () => {
      const consume = vi.fn();
      const harness = renderTerminalTestRunner({
        workspaceRuntimeOwner: null,
      });
      act(() => {
        harness.runner().requestActiveTerminalSession(consume);
      });

      expect(consume).toHaveBeenCalledExactlyOnceWith(null);
      expect(harness.bottomPanelView()).toBe("terminal");
      harness.unmount();
    });

    it("runs a gutter test target with the artisan runner and reveals the terminal panel", async () => {
      const writeInput = vi.fn(async () => undefined);
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vi.fn(async (path: string) =>
          path === `${ROOT}/artisan` ? "#!/usr/bin/env php\n" : null,
        ),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      act(() => {
        harness.runner().registerActiveTerminalSession(7);
      });

      await act(async () => {
        await harness.runner().runTestAt(target());
      });

      expect(harness.bottomPanelView()).toBe("terminal");
      expect(harness.bottomPanelVisible()).toBe(true);
      expect(writeInput).toHaveBeenCalledWith(7, "php artisan test --filter testCalculate\r");
      expect(invalidateJsTestCoverageAndResults).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("falls back to vendor/bin/phpunit when there is no artisan binary", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      act(() => {
        harness.runner().registerActiveTerminalSession(3);
      });

      await act(async () => {
        await harness.runner().runTestAt(target({ filter: "SampleTest", kind: "class" }));
      });

      expect(writeInput).toHaveBeenCalledWith(3, "vendor/bin/phpunit --filter SampleTest\r");
      harness.unmount();
    });

    it("stages the command and flushes it once a matching-root terminal session registers", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      await act(async () => {
        await harness.runner().runTestAt(target());
      });

      expect(writeInput).not.toHaveBeenCalled();

      act(() => {
        harness.runner().registerActiveTerminalSession(42);
      });

      expect(writeInput).toHaveBeenCalledWith(42, "vendor/bin/phpunit --filter testCalculate\r");
      harness.unmount();
    });

    it("flushes queued terminal commands in FIFO order without silently replacing one", () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      act(() => {
        harness.runner().runInActiveTerminal("first");
        harness.runner().runInActiveTerminal("second");
        harness.runner().registerActiveTerminalSession(42);
      });

      expect(writeInput.mock.calls).toEqual([
        [42, "first\r"],
        [42, "second\r"],
      ]);
      harness.unmount();
    });

    it("flushes 32 queued terminal commands in FIFO order and rejects the 33rd", () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      const commands = Array.from({ length: 32 }, (_, index) => `command-${index}`);
      act(() => {
        for (const command of commands) harness.runner().runInActiveTerminal(command);
        harness.runner().runInActiveTerminal("overflow");
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledExactlyOnceWith(
        "Terminal command queue is full. Wait for the terminal to start and try again.",
      );

      act(() => harness.runner().registerActiveTerminalSession(42));

      expect(writeInput.mock.calls).toEqual(commands.map((command) => [42, `${command}\r`]));
      harness.unmount();
    });

    it("drops a staged command when the session that registers belongs to a different root", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      await act(async () => {
        await harness.runner().runTestAt(target());
      });

      harness.rootRef.current = "/other-workspace";
      act(() => {
        harness.runner().registerActiveTerminalSession(42);
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("drops a gutter test run after a workspace switch before the write", async () => {
      const deferred = createDeferred<string | null>();
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(() => deferred.promise),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      act(() => {
        harness.runner().registerActiveTerminalSession(9);
      });

      let run: Promise<void> | null = null;
      act(() => {
        run = harness.runner().runTestAt(target());
      });

      harness.rootRef.current = "/other-workspace";

      await act(async () => {
        deferred.resolve(null);
        await run;
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("drops a PHP runner probe after a same-root owner switch", async () => {
      const deferred = createDeferred<string | null>();
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(() => deferred.promise),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      act(() => harness.runner().registerActiveTerminalSession(9));
      let run: Promise<void> | null = null;
      act(() => {
        run = harness.runner().runTestAt(target());
      });

      harness.setOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT));
      act(() => harness.runner().registerActiveTerminalSession(10));
      await act(async () => {
        deferred.resolve(null);
        await run;
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("never writes a command for a maliciously named filter and shows a rejection message", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      await act(async () => {
        await harness.runner().runTestAt(target({ filter: "foo; rm -rf /" }));
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        'Run test: "foo; rm -rf /" can only run by name (letters, digits, underscore).',
      );
      harness.unmount();
    });

    it("never writes a command for a Pest description with a line break and shows a rejection message", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      await act(async () => {
        await harness
          .runner()
          .runTestAt(target({ filter: "evil\nrm -rf /", match: "description" }));
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        'Run test: "evil\nrm -rf /" contains a line break or control character and cannot be run safely.',
      );
      harness.unmount();
    });

    it("safely single-quotes a Pest description filter", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async (path: string) =>
          path === `${ROOT}/artisan` ? "#!/usr/bin/env php\n" : null,
        ),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      act(() => {
        harness.runner().registerActiveTerminalSession(11);
      });

      await act(async () => {
        await harness
          .runner()
          .runTestAt(target({ filter: "adds two numbers", match: "description" }));
      });

      expect(writeInput).toHaveBeenCalledWith(11, "php artisan test --filter 'adds two numbers'\r");
      harness.unmount();
    });

    it("does nothing when there is no active workspace root", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceRoot: null,
      });
      harness.rootRef.current = null;

      await act(async () => {
        await harness.runner().runTestAt(target());
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does nothing when the workspace has no PHP descriptor", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: {
          javaScriptTypeScript: null,
          php: null,
          rootPath: ROOT,
        },
      });

      await act(async () => {
        await harness.runner().runTestAt(target());
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });
  });

  describe("runTestForActiveDocument", () => {
    const testSource = `<?php

namespace Tests\\Unit;

use Tests\\TestCase;

class InvoiceServiceTest extends TestCase
{
    public function testCalculate(): void
    {
    }
}
`;

    it("selects the nearest test target at or above the cursor and runs it", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      harness.activeDocumentRef.current = document(
        `${ROOT}/tests/Unit/InvoiceServiceTest.php`,
        testSource,
      );
      harness.activeEditorPositionRef.current = { column: 21, lineNumber: 9 };

      act(() => {
        harness.runner().registerActiveTerminalSession(21);
      });

      await act(async () => {
        await harness.runner().runTestForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(21, "vendor/bin/phpunit --filter testCalculate\r");
      harness.unmount();
    });

    it("uses captured edited content after old test targets were warmed", async () => {
      const path = `${ROOT}/tests/Unit/EditedInvoiceServiceTest.php`;
      const oldSource = testSource.replace("testCalculate", "testOldName");
      const editedSource = testSource.replace("testCalculate", "testEditedName");
      phpGutterTargetsCoordinator.resolveTest(ROOT, path, oldSource);

      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      harness.activeDocumentRef.current = document(path, editedSource);
      harness.activeEditorPositionRef.current = { column: 21, lineNumber: 9 };

      act(() => {
        harness.runner().registerActiveTerminalSession(22);
      });

      await act(async () => {
        await harness.runner().runTestForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(22, "vendor/bin/phpunit --filter testEditedName\r");
      harness.unmount();
    });

    it("shows a message when no test target owns the cursor line", async () => {
      const harness = renderTerminalTestRunner();
      harness.activeDocumentRef.current = document(
        `${ROOT}/tests/Unit/InvoiceServiceTest.php`,
        "<?php\n\n// no test class here\n",
      );
      harness.activeEditorPositionRef.current = { column: 1, lineNumber: 1 };

      await act(async () => {
        await harness.runner().runTestForActiveDocument();
      });

      expect(harness.setMessage).toHaveBeenCalledWith("Run test: no test found at the cursor.");
      harness.unmount();
    });

    it("does nothing for a non-PHP document", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      harness.activeDocumentRef.current = {
        ...document(`${ROOT}/tests/Unit/InvoiceServiceTest.php`, testSource),
        language: "typescript",
      };

      await act(async () => {
        await harness.runner().runTestForActiveDocument();
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does nothing when there is no active document", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      await act(async () => {
        await harness.runner().runTestForActiveDocument();
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });
  });

  describe("runAllTestsForActiveDocument", () => {
    it("runs the whole class via --filter <ClassName> for a pure PHPUnit file", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async (path: string) =>
          path === `${ROOT}/artisan` ? "#!/usr/bin/env php\n" : null,
        ),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      harness.activeDocumentRef.current = document(
        `${ROOT}/tests/Unit/InvoiceServiceTest.php`,
        `<?php

class InvoiceServiceTest extends TestCase
{
    public function testCalculate(): void
    {
    }

    public function testRefund(): void
    {
    }
}
`,
      );

      act(() => {
        harness.runner().registerActiveTerminalSession(21);
      });

      await act(async () => {
        await harness.runner().runAllTestsForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(21, "php artisan test --filter InvoiceServiceTest\r");
      harness.unmount();
    });

    it("runs the whole suite with no --filter for a Pest file with no test class", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async (path: string) =>
          path === `${ROOT}/artisan` ? "#!/usr/bin/env php\n" : null,
        ),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });
      harness.activeDocumentRef.current = document(
        `${ROOT}/tests/Feature/CalculatorTest.php`,
        `<?php

it('adds two numbers', function () {
});

it('subtracts two numbers', function () {
});
`,
      );

      act(() => {
        harness.runner().registerActiveTerminalSession(23);
      });

      await act(async () => {
        await harness.runner().runAllTestsForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(23, "php artisan test\r");
      harness.unmount();
    });
  });

  describe("JavaScript test runs", () => {
    it("runTestAt routes a JS gutter target to vitest with the file path and -t filter", async () => {
      const writeInput = vi.fn(async () => undefined);
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      act(() => {
        harness.runner().registerActiveTerminalSession(31);
      });

      await act(async () => {
        await harness.runner().runTestAt(jsTarget());
      });

      expect(harness.bottomPanelView()).toBe("terminal");
      expect(writeInput).toHaveBeenCalledWith(
        31,
        "node_modules/.bin/vitest run 'src/sum.test.ts' -t 'adds numbers'\r",
      );
      expect(invalidateJsTestCoverageAndResults).toHaveBeenCalledOnce();
      harness.unmount();
    });

    it("runTestAt uses jest when the workspace is configured for jest", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async (path: string) =>
          path === `${ROOT}/jest.config.js` ? "module.exports = {};" : null,
        ),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      act(() => {
        harness.runner().registerActiveTerminalSession(32);
      });

      await act(async () => {
        await harness.runner().runTestAt(jsTarget());
      });

      expect(writeInput).toHaveBeenCalledWith(
        32,
        "node_modules/.bin/jest 'src/sum.test.ts' -t 'adds numbers'\r",
      );
      harness.unmount();
    });

    it("runJsTestForActiveDocument runs the test that owns the cursor line", async () => {
      const writeInput = vi.fn(async () => undefined);
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);
      harness.activeEditorPositionRef.current = { column: 3, lineNumber: 4 };

      act(() => {
        harness.runner().registerActiveTerminalSession(33);
      });

      await act(async () => {
        await harness.runner().runJsTestForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(
        33,
        "node_modules/.bin/vitest run 'src/sum.test.ts' -t 'subtracts numbers'\r",
      );
      expect(invalidateJsTestCoverageAndResults).toHaveBeenCalledOnce();
      harness.unmount();
    });

    it("runAllJsTestsForActiveDocument runs the whole file with no filter", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      act(() => {
        harness.runner().registerActiveTerminalSession(34);
      });

      await act(async () => {
        await harness.runner().runAllJsTestsForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(
        34,
        "node_modules/.bin/vitest run 'src/sum.test.ts'\r",
      );
      harness.unmount();
    });

    it("runs a nested package test with that package runner and working directory", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async (path: string) =>
          path === `${ROOT}/packages/a/vitest.config.ts`
            ? "export default {};"
            : path === `${ROOT}/packages/b/jest.config.js`
              ? "module.exports = {};"
              : null,
        ),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/packages/a/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

      act(() => {
        harness.runner().registerActiveTerminalSession(340);
      });
      await act(async () => {
        await harness.runner().runAllJsTestsForActiveDocument();
      });

      expect(writeInput).toHaveBeenCalledWith(
        340,
        "cd 'packages/a' && node_modules/.bin/vitest run 'src/sum.test.ts'\r",
      );
      harness.unmount();
    });

    it("shows a message and writes nothing when no JS runner is detected", async () => {
      const writeInput = vi.fn(async () => undefined);
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      act(() => {
        harness.runner().registerActiveTerminalSession(35);
      });

      await act(async () => {
        await harness.runner().runTestAt(jsTarget());
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        "Run test: no vitest or jest setup detected in this workspace.",
      );
      expect(invalidateJsTestCoverageAndResults).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("rejects a JS filter carrying a control character and shows a message", async () => {
      const writeInput = vi.fn(async () => undefined);
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      act(() => {
        harness.runner().registerActiveTerminalSession(36);
      });

      await act(async () => {
        await harness.runner().runTestAt(jsTarget({ filter: "evil\nrm -rf /" }));
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        'Run test: "evil\nrm -rf /" contains a line break or control character and cannot be run safely.',
      );
      expect(invalidateJsTestCoverageAndResults).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does not invalidate when an otherwise valid JS run cannot enter the terminal queue", async () => {
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vitestWorkspaceReader(),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      act(() => {
        for (let index = 0; index < 32; index += 1) {
          harness.runner().runInActiveTerminal(`pending-${index}`);
        }
      });

      let outcome: Awaited<ReturnType<TerminalTestRunner["runJsTestCommand"]>> | null = null;
      await act(async () => {
        outcome = await harness.runner().runJsTestCommand({
          filePath: "src/sum.test.ts",
        });
      });

      expect(outcome).toBe("dropped");
      expect(invalidateJsTestCoverageAndResults).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("drops a JS run after a workspace switch before the write", async () => {
      const deferred = createDeferred<string | null>();
      const writeInput = vi.fn(async () => undefined);
      const invalidateJsTestCoverageAndResults = vi.fn();
      const harness = renderTerminalTestRunner({
        invalidateJsTestCoverageAndResults,
        readTestFileIfExists: vi.fn(() => deferred.promise),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      act(() => {
        harness.runner().registerActiveTerminalSession(37);
      });

      let run: Promise<void> | null = null;
      act(() => {
        run = harness.runner().runTestAt(jsTarget());
      });

      harness.rootRef.current = "/other-workspace";

      await act(async () => {
        deferred.resolve("export default {};");
        await run;
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(invalidateJsTestCoverageAndResults).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("drops a JS runner probe after a same-root owner switch", async () => {
      const deferred = createDeferred<string | null>();
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(() => deferred.promise),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);
      act(() => harness.runner().registerActiveTerminalSession(37));
      let run: Promise<void> | null = null;
      act(() => {
        run = harness.runner().runTestAt(jsTarget());
      });

      harness.setOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT));
      act(() => harness.runner().registerActiveTerminalSession(38));
      await act(async () => {
        deferred.resolve("export default {};");
        await run;
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does not treat a non-test JS document as a JS test run", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.ts`,
        "export const sum = (a: number, b: number) => a + b;\n",
      );

      await act(async () => {
        await harness.runner().runJsTestForActiveDocument();
        await harness.runner().runAllJsTestsForActiveDocument();
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does nothing when the workspace has no JavaScript descriptor", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(`${ROOT}/src/sum.test.ts`, JS_TEST_SOURCE);

      await act(async () => {
        await harness.runner().runJsTestForActiveDocument();
        await harness.runner().runAllJsTestsForActiveDocument();
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });
  });
});
