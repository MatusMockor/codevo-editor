// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { parseAllStyleSheets, selectorParts } from "../cssContractTestSupport";
import { AgentThreadSession } from "./AgentThreadSession";

const STYLES = parseAllStyleSheets();

const COMMIT_COMMAND =
  'git add -A src CHANGELOG.md && git commit -q -m "feat(agents): attach images to question answers and show answers compactly"';
const TAG_COMMAND =
  'git tag -l v0.2.0-beta.73 && git ls-remote --tags origin v0.2.0-beta.73 && git tag -a v0.2.0-beta.73 -m "v0.2.0-beta.73" && git push origin v0.2.0-beta.73';
const COMMIT_TITLE = "Commit the question image attachments and the compact answer layout";
const TAG_TITLE = "Create and push the v0.2.0-beta.73 release tag to the origin remote";

function command(
  id: string,
  inputSummary: string,
  outcome: { readonly output: string; readonly isError: boolean },
  description?: string,
): ReadonlyArray<AgentTurnEvent> {
  return [
    {
      kind: "toolCall",
      toolId: id,
      name: "Bash",
      inputSummary,
      ...(description === undefined ? {} : { description }),
    },
    { kind: "toolResult", toolId: id, outputSummary: outcome.output, isError: outcome.isError },
  ];
}

const OK = { output: "done", isError: false } as const;

const SCREENSHOT_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "reasoning", text: "Check the release state first." },
  ...command("c1", "git status --short", OK),
  ...command("c2", "git log --oneline -5", OK),
  ...command(
    "c3",
    COMMIT_COMMAND,
    { output: "error: pathspec 'CHANGELOG.md' did not match any files", isError: true },
    COMMIT_TITLE,
  ),
  { kind: "reasoning", text: "The changelog lives under docs." },
  ...command("c4", "git add -A src docs/CHANGELOG.md && git commit -q -m release", OK),
  ...command(
    "c5",
    TAG_COMMAND,
    { output: "fatal: tag 'v0.2.0-beta.73' already exists", isError: true },
    TAG_TITLE,
  ),
  ...command("c6", "git tag -l 'v0.2.0-beta.*'", OK),
  ...command("c7", "git ls-remote --tags origin", OK),
];

describe("t3code-like work log", () => {
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

  it("merges consecutive commands with failures into one group that counts the failures", () => {
    render(SCREENSHOT_EVENTS);

    const groups = [...host.querySelectorAll(".agent-activity-group")];
    expect(groups).toHaveLength(1);
    const toggle = groups[0]?.querySelector<HTMLButtonElement>(".agent-activity-group__toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.querySelector(".agent-activity-group__label")?.textContent).toBe(
      "Ran 7 commands",
    );
    expect(
      toggle?.querySelector(".cv-work-status--failed .cv-work-status__text")?.textContent,
    ).toBe("2 failed");
    expect(toggle?.textContent).toContain("Ran 7 commands, 2 failed, 5 completed");
    expect(toggle?.querySelector(".cv-work-status--failed svg")).not.toBeNull();
    expect(host.querySelectorAll(".agent-work__events > button.agent-tool-row")).toHaveLength(0);
    expectNotTruncated(toggle?.querySelector(".agent-activity-group__label"));

    act(() => toggle?.click());

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(groups[0]?.querySelectorAll("button.agent-tool-row")).toHaveLength(7);
  });

  it("keeps a failed row title whole, tags it failed and ellipsizes only the command", () => {
    render(SCREENSHOT_EVENTS);
    act(() => host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle")?.click());

    const failed = [...host.querySelectorAll<HTMLButtonElement>("button.agent-tool-row--failed")];
    expect(failed).toHaveLength(2);
    expect(failed.map((row) => row.querySelector(".agent-tool-row__label")?.textContent)).toEqual([
      COMMIT_TITLE,
      TAG_TITLE,
    ]);
    for (const row of failed) {
      const title = row.querySelector(".agent-tool-row__label");
      const status = row.querySelector(".cv-work-status--failed");
      const detail = row.querySelector(".agent-tool-row__argument");
      expect(status?.textContent).toBe(", failed, ");
      expect(row.textContent).toContain(`failed, ${detail?.textContent ?? ""}`);
      expect(status?.querySelector("svg")).not.toBeNull();
      expectNotTruncated(title);
      expectTruncated(detail);
      expect(row.textContent).not.toMatch(/^Failed/);
    }
    expect(failed[1]?.querySelector(".agent-tool-row__argument")?.getAttribute("title")).toBe(
      TAG_COMMAND,
    );

    act(() => failed[1]?.click());

    expect(failed[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".agent-tool-row__command")?.textContent).toBe(`$ ${TAG_COMMAND}`);
    expect(host.querySelector(".agent-tool-row__output")?.textContent).toContain("already exists");
  });

  it("keeps a lone failed command as a single tagged row", () => {
    render([
      ...command("c1", "npm test", { output: "exit 1", isError: true }),
      { kind: "assistantText", text: "Tests fail." },
    ]);

    const row = host.querySelector<HTMLButtonElement>("button.agent-tool-row--failed");
    expect(host.querySelector(".agent-activity-group")).toBeNull();
    expect(row?.querySelector(".agent-tool-row__label")?.textContent).toBe("Ran npm test");
    expect(row?.querySelector(".cv-work-status__text")?.textContent).toBe("failed");
  });

  function expectNotTruncated(element: Element | null | undefined) {
    expect(element).not.toBeNull();
    for (const className of element?.classList ?? []) {
      expect(declarations(`.${className}`, "text-overflow"), className).toEqual([]);
    }
  }

  function expectTruncated(element: Element | null | undefined) {
    expect(element).not.toBeNull();
    const values = [...(element?.classList ?? [])].flatMap((className) =>
      declarations(`.${className}`, "text-overflow"),
    );
    expect(values).toContain("ellipsis");
  }

  function declarations(selector: string, property: string): ReadonlyArray<string> {
    return STYLES.rules
      .filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      )
      .flatMap((rule) =>
        rule.declarations
          .filter((entry) => entry.property === property)
          .map((entry) => entry.value.trim()),
      );
  }

  function render(events: ReadonlyArray<AgentTurnEvent>) {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "Release beta.73",
      status: { kind: "running" },
      events,
      startedAtEpochMs: Date.now() - 52_000,
      endedAtEpochMs: null,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Release",
        pinned: false,
        archived: false,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        turns: [turn],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: null,
        externalOrigin: null,
      },
      ship: { kind: "idle", status: null, loadingStatus: false },
      editorAvailability: { kind: "available" },
      attention: "running",
      unread: false,
      lifecycle: "running",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    act(() =>
      root.render(
        <AgentThreadSession
          thread={view}
          composerRepositoryLabel="app"
          onReviewInDiff={() => {}}
        />,
      ),
    );
  }
});
