// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  JsTestExplorerCurrentFileIdentity,
  JsTestExplorerOpenedFilesSnapshot,
} from "../domain/jsTestExplorerFilter";
import { buildJsTestExplorerTree, type JsTestExplorerTestNode } from "../domain/jsTestExplorerTree";
import type { JsTestTaskOutput } from "../domain/jsTestTask";
import type { TestGutterTarget } from "../domain/testGutterTargets";
import { joinWorkspacePath } from "../domain/workspace";
import {
  createWorkspaceRoot,
  DEFAULT_WORKSPACE_PATH_POLICY,
  parseWorkspacePath,
} from "../domain/workspacePath";
import { JsTestExplorerPanel, type JsTestExplorerPanelProps } from "./JsTestExplorerPanel";

describe("JsTestExplorerPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the accessible nested tree and emits exact run scopes", async () => {
    const onRunScope = vi.fn();
    const onDebugNode = vi.fn();
    await render({ onDebugNode, onRunScope });

    expect(host.querySelector('ul[aria-label="JavaScript tests"]')).not.toBeNull();
    expect(host.querySelector('[role="tree"]')).toBeNull();
    expect(treeItems()).toHaveLength(9);
    expect(host.textContent).toContain("checkout");
    expect(host.textContent).toContain("charges card");
    expect(host.querySelector('[aria-label="Status: failed"]')).not.toBeNull();

    await click("Run all JavaScript tests");
    await click("Run workspace /workspace");
    await click("Run tests in payment.test.ts");
    await clickNth("Run tests in payment.test.ts", 1);
    await click("Run suite checkout");
    await click("Run suite checkout card");
    await click("Run test checkout card charges card");
    await click("Run test checkout card handles rows");
    await click("Run test top level works");

    expect(onRunScope.mock.calls.map(([scope]) => scope)).toEqual([
      { kind: "all" },
      { kind: "all" },
      { kind: "file", relativeFilePath: "src/payment.test.ts" },
      { kind: "file", relativeFilePath: "src/payment.test.ts" },
      {
        fullName: "checkout",
        kind: "suite",
        relativeFilePath: "src/payment.test.ts",
      },
      {
        fullName: "checkout card",
        kind: "suite",
        relativeFilePath: "src/payment.test.ts",
      },
      {
        fullName: "checkout card charges card",
        kind: "test",
        relativeFilePath: "src/payment.test.ts",
      },
      {
        fullName: "checkout card handles rows",
        kind: "test",
        nameMatch: "prefix",
        relativeFilePath: "src/payment.test.ts",
      },
      {
        fullName: "top level works",
        kind: "test",
        relativeFilePath: "src/payment.test.ts",
      },
    ]);
    expect(host.querySelector('[aria-label^="Debug workspace"]')).toBeNull();
    expect(button("Debug tests in payment.test.ts").type).toBe("button");
    await click("Debug tests in payment.test.ts");
    await clickNth("Debug tests in payment.test.ts", 1);
    await click("Debug suite checkout card");
    await click("Debug test checkout card charges card");
    await click("Debug test top level works");
    expect(onDebugNode.mock.calls.map(([node]) => [node.kind, node.label])).toEqual([
      ["file", "payment.test.ts"],
      ["suite", "(root)"],
      ["suite", "card"],
      ["test", "charges card"],
      ["test", "top level works"],
    ]);
  });

  it("opens a clicked test node and reports controlled query changes", async () => {
    const onOpenTest = vi.fn();
    const onQueryChange = vi.fn();
    await render({ onOpenTest, onQueryChange });

    await click("Open test checkout card charges card");
    expect(onOpenTest).toHaveBeenCalledOnce();
    expect((onOpenTest.mock.calls[0]?.[0] as JsTestExplorerTestNode).label).toBe("charges card");

    await typeQuery("refund");
    expect(onQueryChange).toHaveBeenCalledWith("refund");
  });

  it("filters the rendered tree using the controlled query", async () => {
    await render({ query: "refund" });

    expect(host.textContent).toContain("refunds card");
    expect(host.textContent).not.toContain("charges card");

    await render({ query: "missing" });
    expect(host.textContent).toContain("No JavaScript tests match the current filter.");
  });

  it("combines exact @failed and text terms only in the rendered tree projection", async () => {
    await render({ query: "@failed" });

    expect(host.textContent).toContain("refunds card");
    expect(host.textContent).not.toContain("charges card");
    expect(host.textContent).not.toContain("handles rows");
    expect(host.textContent).not.toContain("top level works");
    expect(treeItems()).toHaveLength(5);

    await render({
      query: "charges @failed",
    });
    expect(host.textContent).toContain("No JavaScript tests match the current filter.");

    await render({
      query: "charges",
    });
    expect(host.textContent).toContain("charges card");
    expect(host.textContent).not.toContain("refunds card");
  });

  it("projects every exact @executed status, composes with text, and exposes accessible help", async () => {
    const statusTree = buildJsTestExplorerTree(
      "/workspace",
      [
        {
          filePath: "src/status.test.ts",
          status: "running",
          suitePath: ["states"],
          target: target("running case", 2),
        },
        {
          filePath: "src/status.test.ts",
          status: "passed",
          suitePath: ["states"],
          target: target("passed case", 4),
        },
        {
          filePath: "src/status.test.ts",
          status: "failed",
          suitePath: ["states"],
          target: target("failed case", 6),
        },
        {
          filePath: "src/status.test.ts",
          status: "skipped",
          suitePath: ["states"],
          target: target("skipped case", 8),
        },
        {
          filePath: "src/status.test.ts",
          status: "idle",
          suitePath: ["states"],
          target: target("idle case", 10),
        },
      ],
      "workspace-id",
    );
    await render({ query: "@executed", tree: statusTree });

    expect(host.textContent).toContain("running case");
    expect(host.textContent).toContain("passed case");
    expect(host.textContent).toContain("failed case");
    expect(host.textContent).toContain("skipped case");
    expect(host.textContent).not.toContain("idle case");

    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
    const help = input?.getAttribute("aria-describedby");
    expect(input?.placeholder).toContain("@executed");
    expect(input?.getAttribute("aria-invalid")).toBe("false");
    expect(help).not.toBeNull();
    expect(help ? document.getElementById(help)?.textContent : "").toContain("@executed");

    await render({ query: "skipped @executed", tree: statusTree });
    expect(host.textContent).toContain("skipped case");
    expect(host.textContent).not.toContain("running case");
    expect(host.textContent).not.toContain("passed case");
    expect(host.textContent).not.toContain("failed case");
    expect(host.textContent).not.toContain("idle case");
  });

  it("gives exact @failed precedence over @executed without changing canonical run scope", async () => {
    const onRunScope = vi.fn();
    await render({ onRunScope, query: "@executed @failed" });

    expect(host.textContent).toContain("refunds card");
    expect(host.textContent).not.toContain("charges card");
    expect(host.textContent).not.toContain("handles rows");
    expect(host.textContent).not.toContain("top level works");

    await click("Run test checkout card refunds card");
    expect(onRunScope).toHaveBeenCalledExactlyOnceWith({
      fullName: "checkout card refunds card",
      kind: "test",
      relativeFilePath: "src/payment.test.ts",
    });
  });

  it("projects exact @doc with text and @failed over the active workspace file only", async () => {
    const multiFileTree = buildJsTestExplorerTree(
      "/workspace",
      [
        {
          filePath: "src/payment.test.ts",
          status: "failed",
          suitePath: ["payments"],
          target: target("refunds card", 9),
        },
        {
          filePath: "src/user.test.ts",
          status: "failed",
          suitePath: ["users"],
          target: target("refunds user", 4),
        },
      ],
      "workspace-id",
    );
    await render({
      currentFileIdentity: currentFileIdentity("src/payment.test.ts"),
      query: "refund @doc @failed",
      tree: multiFileTree,
    });

    expect(host.textContent).toContain("refunds card");
    expect(host.textContent).not.toContain("refunds user");
  });

  it("reports unavailable @doc context without marking a valid query as invalid", async () => {
    await render({ currentFileIdentity: null, query: "@doc" });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
    const status = Array.from(host.querySelectorAll<HTMLElement>('[role="status"]')).find(
      ({ textContent }) => textContent === "No active workspace file is available for @doc.",
    );
    expect(input?.getAttribute("aria-invalid")).toBe("false");
    expect(input?.getAttribute("aria-errormessage")).toBeNull();
    expect(input?.getAttribute("aria-describedby")?.split(" ")).toContain(status?.id);
    expect(host.textContent).not.toContain("No JavaScript tests match");
  });

  it("projects the exact case-sensitive @openedFiles term over owner-bound editor identities", async () => {
    const multiFileTree = buildJsTestExplorerTree(
      "/workspace",
      [
        {
          filePath: "src/payment.test.ts",
          status: "failed",
          suitePath: ["payments"],
          target: target("refunds card", 9),
        },
        {
          filePath: "src/user.test.ts",
          status: "failed",
          suitePath: ["users"],
          target: target("refunds user", 4),
        },
      ],
      "workspace-id",
    );
    const snapshot = openedFilesSnapshot(["src/payment.test.ts"]);

    await render({
      openedFilesSnapshot: snapshot,
      query: "refund @openedFiles @failed",
      tree: multiFileTree,
    });
    expect(host.textContent).toContain("refunds card");
    expect(host.textContent).not.toContain("refunds user");

    await render({
      openedFilesSnapshot: snapshot,
      query: "@openedfiles",
      tree: multiFileTree,
    });
    expect(host.textContent).toContain("No JavaScript tests match the current filter.");
    expect(host.textContent).not.toContain("No authoritative open-editor snapshot");

    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
    expect(input?.placeholder).toContain("@openedFiles");
    expect(input?.getAttribute("aria-describedby")).not.toBeNull();
  });

  it("preserves upstream whole-tree semantics when no editor exposes a resource", async () => {
    await render({
      openedFilesSnapshot: openedFilesSnapshot([], { hadEditorResources: false }),
      query: "@openedFiles",
    });

    expect(host.textContent).toContain("charges card");
    expect(host.textContent).toContain("refunds card");
    expect(host.textContent).not.toContain("No JavaScript tests match");
  });

  it.each([
    {
      expected: "No authoritative open-editor snapshot is available for @openedFiles.",
      snapshot: null,
    },
    {
      expected: "Too many open editor resources are available for @openedFiles.",
      snapshot: openedFilesSnapshot(["src/payment.test.ts"], { truncated: true }),
    },
    {
      expected: "The open editor resources cannot be used by @openedFiles.",
      snapshot: {
        ...openedFilesSnapshot(["src/payment.test.ts"]),
        identities: [
          {
            ...currentFileIdentity("src/payment.test.ts"),
            relativeFilePath: "src/./payment.test.ts",
          },
        ],
      },
    },
  ])("reports contextual @openedFiles snapshot state", async ({ expected, snapshot }) => {
    await render({ openedFilesSnapshot: snapshot, query: "@openedFiles" });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
    const status = Array.from(host.querySelectorAll<HTMLElement>('[role="status"]')).find(
      ({ textContent }) => textContent === expected,
    );
    expect(status).toBeDefined();
    expect(input?.getAttribute("aria-invalid")).toBe("false");
    expect(input?.getAttribute("aria-errormessage")).toBeNull();
    expect(input?.getAttribute("aria-describedby")?.split(" ")).toContain(status?.id);
    expect(host.textContent).not.toContain("No JavaScript tests match");
  });

  it("moves focus to the stable filter before a live @failed row runs canonical scope", async () => {
    const onRunScope = vi.fn();
    await render({
      currentFileIdentity: currentFileIdentity("src/payment.test.ts"),
      onRunScope,
      query: "@doc @failed",
    });

    const run = button("Run test checkout card refunds card");
    run.focus();
    expect(document.activeElement).toBe(run);
    await click("Run test checkout card refunds card");

    expect(onRunScope).toHaveBeenCalledExactlyOnceWith({
      fullName: "checkout card refunds card",
      kind: "test",
      relativeFilePath: "src/payment.test.ts",
    });
    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]'),
    );
  });

  it("restores stable filter focus when an external failed rerun command starts", async () => {
    await render({ failedRunPhase: "idle", query: "@failed" });
    const run = button("Run test checkout card refunds card");
    run.focus();

    await render({
      canCancelTestRun: true,
      failedRunPhase: "running",
      failedRunTotal: 1,
      query: "@failed",
    });

    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]'),
    );
  });

  it("announces an oversized filter instead of presenting it as an ordinary no-match", async () => {
    await render({ loading: true, query: "x".repeat(4_097) });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    const alert = host.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toBe("JavaScript test filter is limited to 4 KiB.");
    expect(input?.getAttribute("aria-errormessage")).toBe(alert?.id);
    expect(input?.getAttribute("aria-describedby")?.split(" ")).toContain(alert?.id);
    expect(host.textContent).not.toContain("No JavaScript tests match");
  });

  it("places the persistent failed rerun action directly after Run All and runs it once", async () => {
    const onRerunFailedTests = vi.fn();
    await render({
      canRerunFailedTests: true,
      failedRunTotal: 1,
      onRerunFailedTests,
    });

    const toolbarButtons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[aria-label="JavaScript test actions"] > button'),
    );
    expect(toolbarButtons.slice(0, 4).map((item) => item.textContent?.trim())).toEqual([
      "Start Continuous Run",
      "Run All",
      "Rerun Failed",
      "Run Coverage",
    ]);
    expect(button("Rerun failed JavaScript tests").disabled).toBe(false);
    await click("Rerun failed JavaScript tests");
    expect(onRerunFailedTests).toHaveBeenCalledOnce();
  });

  it("keeps one focused Continuous Run toggle across its complete lifecycle", async () => {
    const onStartContinuousRun = vi.fn();
    const onStopContinuousRun = vi.fn();
    await render({ canStartContinuousRun: true, onStartContinuousRun, onStopContinuousRun });
    const toggle = button("Start Continuous Run All");

    toggle.focus();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await click("Start Continuous Run All");
    expect(onStartContinuousRun).toHaveBeenCalledOnce();

    await render({
      canStartContinuousRun: false,
      continuousRunEnabled: true,
      continuousRunPending: true,
      onStartContinuousRun,
      onStopContinuousRun,
    });
    expect(button("Stop Continuous Run All")).toBe(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.disabled).toBe(false);
    expect(document.activeElement).toBe(toggle);
    await click("Stop Continuous Run All");
    expect(onStopContinuousRun).toHaveBeenCalledOnce();

    await render({
      continuousRunStopping: true,
      onStartContinuousRun,
      onStopContinuousRun,
    });
    expect(button("Stop Continuous Run All")).toBe(toggle);
    expect(toggle.disabled).toBe(true);
    expect(document.activeElement).toBe(toggle);

    await render({ canStartContinuousRun: true, onStartContinuousRun, onStopContinuousRun });
    expect(button("Start Continuous Run All")).toBe(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it.each([
    { canStartContinuousRun: false },
    { canStartContinuousRun: true, executionStartBlocked: true },
    { canStartContinuousRun: true, loading: true },
    { canStartContinuousRun: true, running: true },
    { canStartContinuousRun: true, coverageRunning: true },
    { canStartContinuousRun: true, debugging: true },
    {
      canStartContinuousRun: true,
      failedRunPhase: "running" as const,
      failedRunTotal: 1,
    },
  ])(
    "disables Continuous Run start when capability, trust, or busy state blocks it %#",
    async (state) => {
      const onStartContinuousRun = vi.fn();
      await render({ ...state, onStartContinuousRun });

      expect(button("Start Continuous Run All").disabled).toBe(true);
      await click("Start Continuous Run All");
      expect(onStartContinuousRun).not.toHaveBeenCalled();
    },
  );

  it("keeps Stop available while pending or running and announces lifecycle status", async () => {
    const onStopContinuousRun = vi.fn();
    await render({
      continuousRunEnabled: true,
      continuousRunPending: true,
      onStopContinuousRun,
    });

    expect(button("Stop Continuous Run All").disabled).toBe(false);
    expect(continuousRunStatus()).toBe("Continuous Run is queued…");

    await render({
      continuousRunEnabled: true,
      continuousRunRunning: true,
      onStopContinuousRun,
      running: true,
    });
    expect(button("Stop Continuous Run All").disabled).toBe(false);
    expect(continuousRunStatus()).toBe("Continuous Run is running all JavaScript tests…");

    await render({ continuousRunStopping: true, onStopContinuousRun });
    expect(button("Stop Continuous Run All").disabled).toBe(true);
    expect(continuousRunStatus()).toBe("Stopping Continuous Run…");
  });

  it("keeps Show Output present and disabled until a snapshot is available", async () => {
    await render();

    const showOutput = button("Show JavaScript test output");
    expect(showOutput.disabled).toBe(true);
    expect(showOutput.getAttribute("aria-expanded")).toBe("false");
    expect(showOutput.getAttribute("aria-controls")).not.toBeNull();
  });

  it("opens output with focus and restores the tree and Show Output focus on close", async () => {
    await render({ canCopyOutput: true, output: testOutput() });
    const showOutput = button("Show JavaScript test output");

    await click("Show JavaScript test output");

    const outputPanelId = showOutput.getAttribute("aria-controls");
    const log = host.querySelector<HTMLElement>('[role="log"]');
    expect(showOutput.getAttribute("aria-expanded")).toBe("true");
    expect(outputPanelId ? document.getElementById(outputPanelId) : null).not.toBeNull();
    expect(document.activeElement).toBe(log);
    expect(host.querySelector('ul[aria-label="JavaScript tests"]')).toBeNull();

    await click("Close JavaScript test output");

    expect(showOutput.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(showOutput);
    expect(host.querySelector('ul[aria-label="JavaScript tests"]')).not.toBeNull();
  });

  it("closes output on Escape, prevents the key default, and restores Show Output focus", async () => {
    await render({ output: testOutput() });
    await click("Show JavaScript test output");
    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });

    await act(async () => {
      host.querySelector<HTMLElement>('[role="log"]')?.dispatchEvent(escape);
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("Show JavaScript test output"));
    expect(host.querySelector('[role="log"]')).toBeNull();
  });

  it("passively closes a removed output snapshot without stealing focus", async () => {
    await render({ output: testOutput() });
    await click("Show JavaScript test output");
    const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
    filter?.focus();

    await render({ output: null });

    expect(document.activeElement).toBe(filter);
    expect(button("Show JavaScript test output").disabled).toBe(true);
    expect(button("Show JavaScript test output").getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="log"]')).toBeNull();
  });

  it("forwards output copy capability and reports success in the output view", async () => {
    const onCopyOutput = vi.fn(async () => true);
    await render({ canCopyOutput: true, onCopyOutput, output: testOutput() });
    await click("Show JavaScript test output");

    await click("Copy JavaScript test output");

    expect(onCopyOutput).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "JavaScript test output copied.",
    );
  });

  it("keeps failed rerun global to the canonical tree instead of the query projection", async () => {
    const onRerunFailedTests = vi.fn();
    await render({
      canRerunFailedTests: true,
      failedRunTotal: 1,
      onRerunFailedTests,
      query: "charges",
    });

    expect(host.textContent).not.toContain("refunds card");
    expect(button("Rerun failed JavaScript tests").disabled).toBe(false);
    await click("Rerun failed JavaScript tests");
    expect(onRerunFailedTests).toHaveBeenCalledOnce();
  });

  it.each([
    { canRerunFailedTests: false, failedRunTotal: 0 },
    { canRerunFailedTests: true, failedRunTotal: 1, loading: true },
    { canRerunFailedTests: true, failedRunTotal: 1, running: true },
    { canRerunFailedTests: true, coverageRunning: true, failedRunTotal: 1 },
    { canRerunFailedTests: true, debugging: true, failedRunTotal: 1 },
    {
      canRerunFailedTests: true,
      executionStartBlocked: true,
      failedRunTotal: 1,
    },
  ])("disables failed rerun for zero capability and every busy state %#", async (state) => {
    const onRerunFailedTests = vi.fn();
    await render({ ...state, onRerunFailedTests });

    expect(button("Rerun failed JavaScript tests").disabled).toBe(true);
    await click("Rerun failed JavaScript tests");
    expect(onRerunFailedTests).not.toHaveBeenCalled();
  });

  it("replaces run actions with one cancellable action and announces failed-run progress", async () => {
    const onCancelTestRun = vi.fn();
    await render({
      canCancelTestRun: true,
      canRerunFailedTests: true,
      failedRunCompleted: 0,
      failedRunPhase: "running",
      failedRunTotal: 2,
      onCancelTestRun,
    });

    expect(host.querySelector('[aria-label="Run all JavaScript tests"]')).toBeNull();
    expect(host.querySelector('[aria-label="Rerun failed JavaScript tests"]')).toBeNull();
    expect(button("Cancel JavaScript test run").disabled).toBe(false);
    expect(host.textContent).toContain("Rerunning 2 failed JavaScript tests…");
    expect(
      host.querySelector('[aria-label="JavaScript Test Explorer"]')?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(button("Run JavaScript test coverage").disabled).toBe(true);
    expect(button("Refresh JavaScript tests").disabled).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]')?.disabled,
    ).toBe(false);

    button("Cancel JavaScript test run").focus();
    await click("Cancel JavaScript test run");
    expect(onCancelTestRun).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button("Cancel JavaScript test run"));

    await render({
      canCancelTestRun: false,
      failedRunCompleted: 1,
      failedRunPhase: "cancelling",
      failedRunTotal: 2,
      onCancelTestRun,
    });
    expect(button("Cancel JavaScript test run").disabled).toBe(true);
    expect(host.textContent).toContain("Cancelling JavaScript test run…");
    await click("Cancel JavaScript test run");
    expect(onCancelTestRun).toHaveBeenCalledOnce();

    await render({
      canCancelTestRun: true,
      failedRunPhase: "invalidating",
      failedRunTotal: 2,
      onCancelTestRun,
    });
    expect(button("Cancel JavaScript test run").disabled).toBe(true);
    expect(host.textContent).toContain("Invalidating JavaScript test run…");
    await click("Cancel JavaScript test run");
    expect(onCancelTestRun).toHaveBeenCalledOnce();
  });

  it("exposes cancellation for an ordinary owner-bound task run", async () => {
    const onCancelTestRun = vi.fn();
    await render({
      canCancelTestRun: true,
      failedRunPhase: "idle",
      onCancelTestRun,
      running: true,
    });

    expect(host.querySelector('[aria-label="Run all JavaScript tests"]')).toBeNull();
    expect(button("Cancel JavaScript test run").disabled).toBe(false);
    await click("Cancel JavaScript test run");
    expect(onCancelTestRun).toHaveBeenCalledOnce();
  });

  it("announces completed failed-run progress without changing toolbar focus", async () => {
    await render({
      canCancelTestRun: true,
      failedRunCompleted: 1,
      failedRunPhase: "running",
      failedRunTotal: 3,
    });
    const cancel = button("Cancel JavaScript test run");
    cancel.focus();

    await render({
      canCancelTestRun: true,
      failedRunCompleted: 2,
      failedRunPhase: "running",
      failedRunTotal: 3,
    });

    expect(host.textContent).toContain("Rerunning failed JavaScript tests (2/3)…");
    expect(document.activeElement).toBe(button("Cancel JavaScript test run"));
  });

  it("prevents a second run while JavaScript tests are already running", async () => {
    const onRunScope = vi.fn();
    await render({ onRunScope, running: true });

    expect(
      host.querySelector('[aria-label="JavaScript Test Explorer"]')?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(host.textContent).toContain("Running JavaScript tests");
    expect(button("Run all JavaScript tests").disabled).toBe(true);
    expect(button("Run test checkout card charges card").disabled).toBe(true);
    expect(button("Refresh JavaScript tests").disabled).toBe(true);
    expect(button("Run JavaScript test coverage").disabled).toBe(true);
    expect(button("Debug test checkout card charges card").disabled).toBe(true);

    await click("Run all JavaScript tests");
    expect(onRunScope).not.toHaveBeenCalled();
  });

  it("coordinates selected debug busy, blocked, unavailable, and error states", async () => {
    await render({ debugging: true });
    expect(host.textContent).toContain("Starting selected JavaScript test debug");
    expect(button("Run test checkout card charges card").disabled).toBe(true);
    expect(button("Run JavaScript test coverage").disabled).toBe(true);
    expect(button("Debug test checkout card charges card").disabled).toBe(true);

    await render({ debugging: false, debugStartBlocked: true });
    expect(button("Run test checkout card charges card").disabled).toBe(false);
    expect(button("Run JavaScript test coverage").disabled).toBe(false);
    expect(button("Refresh JavaScript tests").disabled).toBe(false);
    expect(button("Debug test checkout card charges card").disabled).toBe(true);

    await render({ debugStartBlocked: false, debugUnavailable: "No selected-test runner" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("No selected-test runner");
    await render({ debugUnavailable: null, debugError: "Selected debug failed" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Selected debug failed");
  });

  it("blocks executable actions in an untrusted workspace but keeps local actions available", async () => {
    await render({
      coverageReport,
      coverageUnavailable: "Trust this workspace to run JavaScript test coverage.",
      debugStartBlocked: true,
      debugUnavailable: "Trust this workspace to debug selected tests.",
      executionStartBlocked: true,
    });
    expect(host.textContent).toContain("Trust this workspace");
    expect(button("Run all JavaScript tests").disabled).toBe(true);
    expect(button("Run test checkout card charges card").disabled).toBe(true);
    expect(button("Run JavaScript test coverage").disabled).toBe(true);
    expect(button("Debug test checkout card charges card").disabled).toBe(true);
    expect(button("Clear JavaScript test coverage").disabled).toBe(false);
    expect(button("Refresh JavaScript tests").disabled).toBe(false);
  });

  it("runs, summarizes, clears, and navigates JavaScript coverage", async () => {
    const onClearCoverage = vi.fn();
    const onOpenCoverageFile = vi.fn();
    const onRunCoverage = vi.fn();
    await render({
      coverageReport,
      onClearCoverage,
      onOpenCoverageFile,
      onRunCoverage,
    });

    expect(host.querySelector('[aria-label="JavaScript test coverage summary"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Covered lines"]')?.textContent).toContain("3/5");
    expect(host.querySelector('[aria-label="Line coverage percentage"]')?.textContent).toBe(
      "60.0%",
    );
    await click("Run JavaScript test coverage");
    await click("Clear JavaScript test coverage");
    await click("Open first uncovered line in src/payment.ts");
    expect(onRunCoverage).toHaveBeenCalledOnce();
    expect(onClearCoverage).toHaveBeenCalledOnce();
    expect(onOpenCoverageFile).toHaveBeenCalledWith(
      expect.objectContaining({ firstUncoveredLine: 7, path: "src/payment.ts" }),
    );
    expect(button("Open first uncovered line in src/covered.ts").disabled).toBe(true);
  });

  it("announces coverage running, unavailable and error states", async () => {
    await render({ coverageRunning: true });
    expect(host.textContent).toContain("Running JavaScript test coverage");
    expect(button("Run all JavaScript tests").disabled).toBe(true);

    await render({ coverageUnavailable: "Coverage runner unavailable" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Coverage runner unavailable",
    );

    await render({ coverageError: "Coverage failed" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Coverage failed");
  });

  it.each([
    { error: "Runner failed", unavailable: null },
    { error: null, unavailable: "Node.js is unavailable" },
  ])("keeps the tree retryable while showing a runtime banner", async (banner) => {
    const onRunScope = vi.fn();
    await render({ ...banner, onRunScope });

    expect(host.querySelector('ul[aria-label="JavaScript tests"]')).not.toBeNull();
    expect(button("Run all JavaScript tests").disabled).toBe(false);
    expect(button("Run test checkout card charges card").disabled).toBe(false);
    await click("Run all JavaScript tests");
    expect(onRunScope).toHaveBeenCalledExactlyOnceWith({ kind: "all" });
  });

  it("renders loading, unavailable, error, empty, and truncated states accessibly", async () => {
    await render({ loading: true, truncated: true });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Loading JavaScript tests",
    );
    expect(button("Run all JavaScript tests").disabled).toBe(true);
    expect(button("Refresh JavaScript tests").disabled).toBe(true);

    await render({ error: "Discovery failed", loading: false });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Discovery failed");

    await render({ error: null, tree: null, unavailable: "Node.js is unavailable" });
    expect(host.textContent).toContain("Node.js is unavailable");

    await render({ tree: buildJsTestExplorerTree("/workspace", []), unavailable: null });
    expect(host.textContent).toContain("No JavaScript tests found.");

    await render({ tree, truncated: true });
    expect(host.textContent).toContain("Results are truncated");
  });

  async function render(overrides: Partial<JsTestExplorerPanelProps> = {}) {
    await act(async () => {
      root.render(
        <JsTestExplorerPanel
          canCancelTestRun={overrides.canCancelTestRun ?? false}
          canCopyOutput={overrides.canCopyOutput ?? false}
          canRerunFailedTests={overrides.canRerunFailedTests ?? false}
          canStartContinuousRun={overrides.canStartContinuousRun ?? false}
          continuousRunEnabled={overrides.continuousRunEnabled ?? false}
          continuousRunPending={overrides.continuousRunPending ?? false}
          continuousRunRunning={overrides.continuousRunRunning ?? false}
          continuousRunStopping={overrides.continuousRunStopping ?? false}
          coverageError={overrides.coverageError ?? null}
          coverageReport={overrides.coverageReport ?? null}
          coverageRunning={overrides.coverageRunning ?? false}
          coverageUnavailable={overrides.coverageUnavailable ?? null}
          currentFileIdentity={overrides.currentFileIdentity ?? null}
          debugError={overrides.debugError ?? null}
          debugging={overrides.debugging ?? false}
          debugStartBlocked={overrides.debugStartBlocked ?? false}
          debugUnavailable={overrides.debugUnavailable ?? null}
          error={overrides.error ?? null}
          executionStartBlocked={overrides.executionStartBlocked ?? false}
          failedRunCompleted={overrides.failedRunCompleted ?? 0}
          failedRunPhase={overrides.failedRunPhase ?? "idle"}
          failedRunTotal={overrides.failedRunTotal ?? 0}
          loading={overrides.loading ?? false}
          openedFilesSnapshot={overrides.openedFilesSnapshot ?? null}
          onCancelTestRun={overrides.onCancelTestRun ?? vi.fn()}
          onClearCoverage={overrides.onClearCoverage ?? vi.fn()}
          onCopyOutput={overrides.onCopyOutput ?? vi.fn(async () => false)}
          onDebugNode={overrides.onDebugNode ?? vi.fn()}
          onOpenCoverageFile={overrides.onOpenCoverageFile ?? vi.fn()}
          onOpenTest={overrides.onOpenTest ?? vi.fn()}
          onQueryChange={overrides.onQueryChange ?? vi.fn()}
          onRefresh={overrides.onRefresh ?? vi.fn()}
          onRerunFailedTests={overrides.onRerunFailedTests ?? vi.fn()}
          onRunScope={overrides.onRunScope ?? vi.fn()}
          onRunCoverage={overrides.onRunCoverage ?? vi.fn()}
          onStartContinuousRun={overrides.onStartContinuousRun ?? vi.fn()}
          onStopContinuousRun={overrides.onStopContinuousRun ?? vi.fn()}
          output={overrides.output ?? null}
          query={overrides.query ?? ""}
          running={overrides.running ?? false}
          tree={overrides.tree === undefined ? tree : overrides.tree}
          truncated={overrides.truncated ?? false}
          unavailable={overrides.unavailable ?? null}
          workspaceId={overrides.workspaceId ?? "workspace-id"}
        />,
      );
    });
  }

  async function click(label: string) {
    await act(async () => {
      button(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function clickNth(label: string, index: number) {
    await act(async () => {
      const elements = host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`);
      const element = elements.item(index);
      if (!element) throw new Error(`Button is missing: ${label} at index ${index}`);
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function typeQuery(value: string) {
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
      if (!input) throw new Error("JavaScript test filter is missing");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!element) throw new Error(`Button is missing: ${label}`);
    return element;
  }

  function treeItems(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('ul[aria-label="JavaScript tests"] li'));
  }

  function continuousRunStatus(): string | null {
    return host.querySelector('[aria-label="Continuous Run status"]')?.textContent ?? null;
  }
});

function target(filter: string, lineNumber: number): TestGutterTarget {
  return {
    filter,
    kind: "method",
    label: `Run ${filter}`,
    match: "description",
    position: { column: 3, lineNumber },
  };
}

function currentFileIdentity(relativeFilePath: string): JsTestExplorerCurrentFileIdentity {
  const root = createWorkspaceRoot("workspace-id", "/workspace", DEFAULT_WORKSPACE_PATH_POLICY);
  if (!root.ok) throw new Error(root.error.message);
  const path = parseWorkspacePath(
    root.value,
    joinWorkspacePath(root.value.nativePath, relativeFilePath),
  );
  if (!path.ok) throw new Error(path.error.message);
  return {
    pathKey: path.value.key,
    relativeFilePath,
    root: root.value,
  };
}

function openedFilesSnapshot(
  relativeFilePaths: readonly string[],
  overrides: Partial<
    Pick<JsTestExplorerOpenedFilesSnapshot, "hadEditorResources" | "truncated">
  > = {},
): JsTestExplorerOpenedFilesSnapshot {
  const identities = relativeFilePaths.map(currentFileIdentity);
  const root = identities[0]?.root ?? currentFileIdentity("src/snapshot-owner.test.ts").root;
  return {
    hadEditorResources: overrides.hadEditorResources ?? true,
    identities,
    root,
    truncated: overrides.truncated ?? false,
  };
}

const tree = buildJsTestExplorerTree(
  "/workspace",
  [
    {
      filePath: "src/payment.test.ts",
      status: "passed",
      suitePath: ["checkout", "card"],
      target: target("charges card", 4),
    },
    {
      filePath: "src/payment.test.ts",
      status: "failed",
      suitePath: ["checkout", "card"],
      target: target("refunds card", 9),
    },
    {
      filePath: "src/payment.test.ts",
      parameterized: true,
      status: "idle",
      suitePath: ["checkout", "card"],
      target: target("handles rows", 12),
    },
    {
      filePath: "src/payment.test.ts",
      status: "idle",
      suitePath: [],
      target: target("top level works", 15),
    },
  ],
  "workspace-id",
);

const coverageReport = {
  files: [
    {
      firstUncoveredLine: 7,
      lines: [
        { hits: 1, lineNumber: 2 },
        { hits: 0, lineNumber: 7 },
      ],
      path: "src/payment.ts",
      summary: { covered: 1, percentage: 50, total: 2 },
    },
    {
      firstUncoveredLine: null,
      lines: [{ hits: 1, lineNumber: 1 }],
      path: "src/covered.ts",
      summary: { covered: 1, percentage: 100, total: 1 },
    },
  ],
  summary: { covered: 3, percentage: 60, total: 5 },
};

function testOutput(): JsTestTaskOutput {
  return {
    stderr: { text: "failure\n", truncated: false },
    stdout: { text: "ready\n", truncated: false },
  };
}
