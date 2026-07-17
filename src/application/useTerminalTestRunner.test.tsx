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

function phpProjectDescriptor(
  overrides: Partial<PhpProjectDescriptor> = {},
): PhpProjectDescriptor {
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

function createFakeTerminalGateway(
  overrides: Partial<TerminalGateway> = {},
): TerminalGateway {
  const base: TerminalGateway = {
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
  const readTestFileIfExists =
    overrides.readTestFileIfExists ?? (async () => null);

  function Harness() {
    const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>(
      panelState.view as BottomPanelView,
    );
    const [bottomPanelVisible, setBottomPanelVisible] = useState(
      panelState.visible,
    );
    panelState.view = bottomPanelView;
    panelState.visible = bottomPanelVisible;

    const deps: TerminalTestRunnerDependencies = {
      activeDocumentRef,
      activeEditorPositionRef,
      currentWorkspaceRootRef: rootRef,
      readTestFileIfExists,
      reportErrorForActiveWorkspaceRoot,
      setBottomPanelView,
      setBottomPanelVisible,
      setMessage,
      terminalGateway: createFakeTerminalGateway(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceRoot: ROOT,
      ...overrides,
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
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function target(
  overrides: Partial<PhpTestGutterTarget> = {},
): PhpTestGutterTarget {
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

function jsTarget(
  overrides: Partial<PhpTestGutterTarget> = {},
): PhpTestGutterTarget {
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
    it("runs a gutter test target with the artisan runner and reveals the terminal panel", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
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
      expect(writeInput).toHaveBeenCalledWith(
        7,
        "php artisan test --filter testCalculate\r",
      );
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
        await harness.runner().runTestAt(
          target({ filter: "SampleTest", kind: "class" }),
        );
      });

      expect(writeInput).toHaveBeenCalledWith(
        3,
        "vendor/bin/phpunit --filter SampleTest\r",
      );
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

      expect(writeInput).toHaveBeenCalledWith(
        42,
        "vendor/bin/phpunit --filter testCalculate\r",
      );
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

    it("never writes a command for a maliciously named filter and shows a rejection message", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
      });

      await act(async () => {
        await harness.runner().runTestAt(
          target({ filter: "foo; rm -rf /" }),
        );
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
        await harness.runner().runTestAt(
          target({ filter: "evil\nrm -rf /", match: "description" }),
        );
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
        await harness.runner().runTestAt(
          target({ filter: "adds two numbers", match: "description" }),
        );
      });

      expect(writeInput).toHaveBeenCalledWith(
        11,
        "php artisan test --filter 'adds two numbers'\r",
      );
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

      expect(writeInput).toHaveBeenCalledWith(
        21,
        "vendor/bin/phpunit --filter testCalculate\r",
      );
      harness.unmount();
    });

    it("uses captured edited content after old test targets were warmed", async () => {
      const path = `${ROOT}/tests/Unit/EditedInvoiceServiceTest.php`;
      const oldSource = testSource.replace("testCalculate", "testOldName");
      const editedSource = testSource.replace(
        "testCalculate",
        "testEditedName",
      );
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

      expect(writeInput).toHaveBeenCalledWith(
        22,
        "vendor/bin/phpunit --filter testEditedName\r",
      );
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

      expect(harness.setMessage).toHaveBeenCalledWith(
        "Run test: no test found at the cursor.",
      );
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

      expect(writeInput).toHaveBeenCalledWith(
        21,
        "php artisan test --filter InvoiceServiceTest\r",
      );
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
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

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
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

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
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );
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
      harness.unmount();
    });

    it("runAllJsTestsForActiveDocument runs the whole file with no filter", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

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

    it("shows a message and writes nothing when no JS runner is detected", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(async () => null),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

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
      harness.unmount();
    });

    it("rejects a JS filter carrying a control character and shows a message", async () => {
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vitestWorkspaceReader(),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

      act(() => {
        harness.runner().registerActiveTerminalSession(36);
      });

      await act(async () => {
        await harness.runner().runTestAt(
          jsTarget({ filter: "evil\nrm -rf /" }),
        );
      });

      expect(writeInput).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        'Run test: "evil\nrm -rf /" contains a line break or control character and cannot be run safely.',
      );
      harness.unmount();
    });

    it("drops a JS run after a workspace switch before the write", async () => {
      const deferred = createDeferred<string | null>();
      const writeInput = vi.fn(async () => undefined);
      const harness = renderTerminalTestRunner({
        readTestFileIfExists: vi.fn(() => deferred.promise),
        terminalGateway: createFakeTerminalGateway({ writeInput }),
        workspaceDescriptor: jsWorkspaceDescriptor(),
      });
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

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
      harness.activeDocumentRef.current = jsDocument(
        `${ROOT}/src/sum.test.ts`,
        JS_TEST_SOURCE,
      );

      await act(async () => {
        await harness.runner().runJsTestForActiveDocument();
        await harness.runner().runAllJsTestsForActiveDocument();
      });

      expect(writeInput).not.toHaveBeenCalled();
      harness.unmount();
    });
  });
});
