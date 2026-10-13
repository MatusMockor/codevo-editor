// @vitest-environment jsdom
import { Profiler, StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wire from "../../../contracts/agent-runtime-request-wire.json";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentAttachmentPromptLine } from "../../domain/agentAttachmentIntake";
import {
  agentReferencePromptLine,
  agentReferencesAreFiles,
} from "../../domain/agentReferenceEntry";
import {
  parseAgentRuntimeRequest,
  type AgentRuntimeRequest,
} from "../../domain/agentRuntimeRequest";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import {
  isClosedAgentRuntimeRequest,
  type ClosedAgentRuntimeRequest,
} from "../../domain/agentTurnRequestRows";
import { waitForReact } from "../../test/reactTestLifecycle";
import type { AgentProseContext } from "./AgentAssistantText";
import {
  AgentRuntimeRequestRow,
  AgentRuntimeRequestsProvider,
  AgentTurnRuntimeRequests,
  AgentTurnUnanchoredRequests,
} from "./AgentRuntimeRequestRow";
import {
  AgentRuntimeRequestsContext,
  INERT_AGENT_RUNTIME_REQUESTS,
  createAgentRuntimeRequestsStore,
  type AgentRuntimeRequestsByTurn,
  type AgentRuntimeRequestsSource,
} from "./AgentRuntimeRequestsContext";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentToolRow } from "./AgentToolRow";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import { AgentTurnItemView } from "./AgentTurnItemView";
import { createTurnErrorContext } from "./agentTurnErrorPresentation";
import type { AgentTurnItem } from "./agentTurnProjection";

type Patch = Readonly<Record<string, unknown>>;
type ToolItem = Extract<AgentTurnItem, { readonly kind: "tool" }>;

const IMAGE_ID = "0123456789abcdef0123456789abcdef";
const TURN = "turn";
const ASK_TOOL = "toolu_question";
const BASH_TOOL = "toolu_bash";
const INPUT = JSON.stringify({
  questions: [{ question: "Which layout is broken?", header: "Layout", options: [] }],
});
const PROVIDER_ANSWER =
  'Your questions have been answered: "Which layout is broken?"="Sidebar". You can now continue with these answers in mind.';
const EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Let me ask first." },
  { kind: "toolCall", toolId: ASK_TOOL, name: "AskUserQuestion", inputSummary: INPUT },
  { kind: "toolResult", toolId: ASK_TOOL, outputSummary: PROVIDER_ANSWER, isError: false },
  { kind: "toolCall", toolId: BASH_TOOL, name: "Bash", inputSummary: "npm test" },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok", isError: false },
  { kind: "assistantText", text: "Fixing the sidebar now." },
];
const LINT_TOOL = "toolu_lint";
const TWO_COMMAND_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: BASH_TOOL, name: "Bash", inputSummary: "npm test" },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok", isError: false },
  { kind: "toolCall", toolId: LINT_TOOL, name: "Bash", inputSummary: "npm run lint" },
  { kind: "toolResult", toolId: LINT_TOOL, outputSummary: "ok", isError: false },
  { kind: "assistantText", text: "All green." },
];
const REPEATED_RESULT_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: BASH_TOOL, name: "Bash", inputSummary: "npm test" },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok", isError: false },
  { kind: "userMessage", text: "Also run it again." },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok again", isError: false },
];
const QUESTION_AFTER_WORK_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: BASH_TOOL, name: "Bash", inputSummary: "npm test" },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok", isError: false },
  { kind: "toolCall", toolId: ASK_TOOL, name: "AskUserQuestion", inputSummary: INPUT },
  { kind: "toolResult", toolId: ASK_TOOL, outputSummary: PROVIDER_ANSWER, isError: false },
  { kind: "assistantText", text: "Fixing the sidebar now." },
];
const REPEATED_QUESTION_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: ASK_TOOL, name: "AskUserQuestion", inputSummary: INPUT },
  { kind: "toolResult", toolId: ASK_TOOL, outputSummary: PROVIDER_ANSWER, isError: false },
  { kind: "toolResult", toolId: ASK_TOOL, outputSummary: PROVIDER_ANSWER, isError: false },
  { kind: "assistantText", text: "Fixing the sidebar now." },
];
const WORK_EVENTS: ReadonlyArray<AgentTurnEvent> = [
  { kind: "toolCall", toolId: BASH_TOOL, name: "Bash", inputSummary: "npm test" },
  { kind: "toolResult", toolId: BASH_TOOL, outputSummary: "ok", isError: false },
  { kind: "assistantText", text: "All green." },
];

function wireValue(name: string): Patch {
  const found = wire.requests.valid.find((candidate) => candidate.name === name);
  expect(found, name).toBeDefined();
  return found?.value ?? {};
}

function wireRequest(name: string, patch: Patch = {}): AgentRuntimeRequest {
  return parseAgentRuntimeRequest({ ...wireValue(name), turnId: TURN, ...patch });
}

function closedRequest(name: string, patch: Patch = {}): ClosedAgentRuntimeRequest {
  const request = wireRequest(name, patch);
  expect(isClosedAgentRuntimeRequest(request), name).toBe(true);
  return request as ClosedAgentRuntimeRequest;
}

function options(count: number): readonly Patch[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `o${index}`,
    label: `Option ${index}`,
    description: "",
  }));
}

function byTurn(...requests: readonly AgentRuntimeRequest[]): AgentRuntimeRequestsByTurn {
  const grouped = new Map<string, AgentRuntimeRequest[]>();
  for (const request of requests) {
    grouped.set(request.turnId, [...(grouped.get(request.turnId) ?? []), request]);
  }
  return grouped;
}

function turnOf(
  turnId: string,
  events: ReadonlyArray<AgentTurnEvent>,
  patch: Partial<AgentTurn> = {},
): AgentTurn {
  return {
    turnId,
    prompt: "Run the loop",
    status: { kind: "exited", exitCode: 0 },
    events,
    startedAtEpochMs: 1_000,
    endedAtEpochMs: 33_000,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    ...patch,
  };
}

function threadView(turns: ReadonlyArray<AgentTurn>): AgentThreadView {
  return {
    thread: {
      threadId: "thread",
      owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: "session" },
      title: "Loop",
      pinned: false,
      archived: false,
      createdAtEpochMs: 0,
      updatedAtEpochMs: 0,
      turns,
      turnsTruncated: false,
      integration: null,
      viewedAtEpochMs: null,
      externalOrigin: null,
    },
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: "settled",
    unread: false,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

describe("AgentRuntimeRequestRow", () => {
  let host: HTMLDivElement;
  let root: Root;
  let images: AgentTurnAttachmentImageViewer;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    images = {
      stateOf: () => ({ kind: "ready", url: "blob:thumb" }),
      ensure: vi.fn(),
      reveal: vi.fn(),
      open: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(request: ClosedAgentRuntimeRequest, before: ReactNode = null) {
    act(() =>
      root.render(
        <>
          {before}
          <AgentRuntimeRequestRow attachmentImages={images} request={request} />
        </>,
      ),
    );
  }

  function toggle() {
    return host.querySelector<HTMLButtonElement>("button.agent-request-row__toggle")!;
  }

  function detail() {
    return document.getElementById(toggle().getAttribute("aria-controls") ?? "")!;
  }

  it("renders a compact answered row and expands to every question and answer", () => {
    render(closedRequest("resolvedQuestion"));

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("Answered");
    expect(toggle().textContent).toContain("Which packages should be updated?");
    expect(host.querySelector(".agent-request-row__summary")?.textContent).toBe(
      "API, Web, Also the docs.",
    );
    expect(detail().hidden).toBe(true);
    expect(detail().childElementCount).toBe(0);
    expect(host.querySelector(".agent-request-row__ending")).toBeNull();

    act(() => toggle().click());

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(detail().hidden).toBe(false);
    expect([...detail().querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "Which packages should be updated?",
      "Anything else to consider?",
    ]);
    const selected = detail().querySelector('ul[aria-label="Selected"]');
    expect([...(selected?.querySelectorAll("li") ?? [])].map((node) => node.textContent)).toEqual([
      "API",
      "Web",
    ]);
    expect(detail().textContent).toContain("Also the docs.");
    expect(detail().textContent).toContain("Keep the public API stable.");
    expect(detail().textContent).toContain("This question was answered.");
  });

  it("shows why a request orphaned by a restart closed without expanding it", () => {
    render(closedRequest("expiredAppRestarted"));

    const ending = host.querySelector<HTMLElement>(".agent-request-row__ending");
    expect(ending?.textContent).toBe("Codevo quit before this was decided.");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-describedby")).toBe(ending?.id);
    expect(toggle().textContent).toContain("Approval");
    expect(toggle().textContent).toContain("Share the repository name");
    expect(host.textContent).not.toContain("notResumable");
    expect(host.textContent).not.toContain("appRestarted");
  });

  it("renders an approval with its detail, facts and decision", () => {
    render(closedRequest("resolvedApproval"));

    expect(toggle().textContent).toContain("Approved");
    expect(toggle().textContent).toContain("Call the search tool");
    expect(host.querySelector(".agent-request-row__summary")?.textContent).toBe("Allowed once");

    act(() => toggle().click());

    expect(detail().querySelector("pre")?.textContent).toBe("query: express router");
    expect(
      [...detail().querySelectorAll(".agent-request-row__fact")].map((node) => [
        node.querySelector("dt")?.textContent,
        node.querySelector("dd")?.textContent,
      ]),
    ).toEqual([
      ["Tool", "search"],
      ["Server", "docs"],
    ]);
    expect(detail().textContent).toContain("This was allowed once.");
  });

  it("renders twelve options of a multi-select question", () => {
    const base = wireValue("resolvedQuestion");
    render(
      closedRequest("resolvedQuestion", {
        body: {
          kind: "question",
          questions: [
            {
              id: "q",
              header: "",
              prompt: "Which targets?",
              options: options(12),
              multiple: true,
              allowCustom: false,
            },
          ],
        },
        resolution: {
          kind: "answers",
          answers: [{ questionId: "q", optionIds: ["o0", "o5", "o11"], text: "" }],
        },
        anchorToolId: base.anchorToolId,
      }),
    );
    act(() => toggle().click());

    const selected = detail().querySelector('ul[aria-label="Selected"]');
    expect([...(selected?.querySelectorAll("li") ?? [])].map((node) => node.textContent)).toEqual([
      "Option 0",
      "Option 5",
      "Option 11",
    ]);
    const others = detail().querySelector(".agent-request-row__others")?.textContent ?? "";
    expect(others).toContain("Not chosen");
    for (const index of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
      expect(others, `Option ${index}`).toContain(`Option ${index}`);
    }
  });

  it("clamps long text behind an explicit control and keeps focus on it", () => {
    const base = wireValue("timedOutApproval");
    const long = `${"x".repeat(4_000)}THE-END`;
    render(closedRequest("timedOutApproval", { body: { ...(base.body as Patch), detail: long } }));
    act(() => toggle().click());

    const code = detail().querySelector("pre")!;
    const more = detail().querySelector<HTMLButtonElement>("button.agent-request-row__more")!;
    expect(code.textContent?.length).toBeLessThan(1_300);
    expect(code.textContent?.endsWith("…")).toBe(true);
    expect(code.textContent).not.toContain("THE-END");
    expect(more.textContent).toBe("Show more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(code.id);

    more.focus();
    act(() => more.click());

    expect(code.textContent).toBe(long);
    expect(more.isConnected).toBe(true);
    expect(more.textContent).toBe("Show less");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(more);
  });

  it("does not move focus or change the row itself when it expands", () => {
    render(closedRequest("resolvedQuestion"), <input aria-label="elsewhere" />);
    const elsewhere = host.querySelector<HTMLInputElement>("input")!;
    const row = host.querySelector(".agent-request-row")!;
    const before = toggle().outerHTML.replace('aria-expanded="false"', "");
    const children = [...row.children];

    elsewhere.focus();
    act(() => toggle().click());

    expect(document.activeElement).toBe(elsewhere);
    expect(toggle().outerHTML.replace('aria-expanded="true"', "")).toBe(before);
    expect([...row.children]).toEqual(children);

    toggle().focus();
    act(() => toggle().click());
    act(() => toggle().click());

    expect(document.activeElement).toBe(toggle());
    expect(detail().contains(document.activeElement)).toBe(false);
  });

  it("never lets an attachment path reach the DOM, collapsed or expanded", () => {
    const stored = `/data/agent-attachments/threads/t/${IMAGE_ID}.png`;
    const lines: Readonly<Record<string, string>> = {
      image: agentAttachmentPromptLine(
        {
          kind: "image",
          attachmentId: IMAGE_ID,
          name: "screen.png",
          mime: "image/png",
          bytes: 10,
          width: 4,
          height: 4,
          storedPath: stored,
        },
        agentReferencesAreFiles,
      ),
      file: agentAttachmentPromptLine(
        {
          kind: "file",
          attachmentId: IMAGE_ID,
          name: "notes.txt",
          bytes: 10,
          storedPath: "/data/agent-attachments/threads/t/notes.txt",
        },
        agentReferencesAreFiles,
      ),
      reference: agentReferencePromptLine(
        { name: "payroll.csv", path: "/Users/alice/private/payroll.csv" },
        "file",
      ),
      folder: agentReferencePromptLine(
        { name: "src", path: "/Users/alice/project/src" },
        "directory",
      ),
    };
    const leaks = ["/data/", "/Users/", "alice", "private", "threads", "saved at", "is at:"];
    const cases = Object.entries(lines).flatMap(([name, line]) =>
      ["\n", "\r\n", "\r"].flatMap((breakText) => [
        { name, visible: "Sidebar", text: `Sidebar${breakText}${breakText}${line}${breakText}` },
        { name, visible: null, text: `${breakText}${breakText}${line}` },
      ]),
    );
    const names: Readonly<Record<string, string>> = {
      image: "screen.png",
      file: "notes.txt",
      reference: "payroll.csv",
      folder: "src",
    };

    for (const [index, entry] of cases.entries()) {
      render(
        closedRequest("expiredAnswerUnconfirmedWithAnswers", {
          id: `req-${index}`,
          resolution: {
            kind: "answers",
            answers: [{ questionId: "notes", optionIds: [], text: entry.text }],
          },
        }),
      );
      const label = `${entry.name} ${JSON.stringify(entry.text)}`;
      const summary = host.querySelector(".agent-request-row__summary")?.textContent;
      expect(summary, label).toBe(entry.visible ?? "1 attachment");
      for (const leak of leaks) expect(host.innerHTML, `${label} ${leak}`).not.toContain(leak);

      act(() => toggle().click());

      expect(toggle().getAttribute("aria-expanded"), label).toBe("true");
      expect(detail().querySelector(".agent-attachments"), label).not.toBeNull();
      expect(detail().querySelector(".agent-attachments")?.innerHTML, label).toContain(
        names[entry.name],
      );
      for (const leak of leaks) expect(host.innerHTML, `${label} ${leak}`).not.toContain(leak);

      act(() => toggle().click());
    }
    expect(cases.length).toBe(24);
  });

  it("shows an attached image as a thumbnail instead of its saved path", async () => {
    const text = `Sidebar\n\n[Attached image "screen.png" is saved at: /data/agent-attachments/threads/t/${IMAGE_ID}.png]`;
    render(
      closedRequest("expiredAnswerUnconfirmedWithAnswers", {
        resolution: {
          kind: "answers",
          answers: [{ questionId: "notes", optionIds: [], text }],
        },
      }),
    );
    act(() => toggle().click());

    await waitForReact(() =>
      expect(detail().querySelector("img")?.getAttribute("src")).toBe("blob:thumb"),
    );
    expect(images.ensure).toHaveBeenCalledWith(IMAGE_ID, "image/png");
    expect(host.textContent).toContain("Sidebar");
    expect(host.textContent).not.toContain("saved at");
    expect(host.innerHTML).not.toContain("/data/");
    expect(host.querySelector(".agent-request-row__ending")?.textContent).toBe(
      "Your answer was sent, but Codevo could not confirm the agent received it.",
    );
  });
});

describe("runtime request history in a turn", () => {
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

  function session(turns: ReadonlyArray<AgentTurn>) {
    return (
      <AgentThreadSession
        thread={threadView(turns)}
        composerRepositoryLabel="app"
        onReviewInDiff={() => {}}
      />
    );
  }

  function render(turns: ReadonlyArray<AgentTurn>, requests?: AgentRuntimeRequestsByTurn) {
    act(() =>
      root.render(
        requests === undefined ? (
          session(turns)
        ) : (
          <AgentRuntimeRequestsProvider requests={requests}>
            {session(turns)}
          </AgentRuntimeRequestsProvider>
        ),
      ),
    );
  }

  function turnText(): string {
    return host.querySelector(".agent-turn")?.textContent ?? "";
  }

  function requestIds(within: Element = host): ReadonlyArray<string | undefined> {
    return [...within.querySelectorAll<HTMLElement>(".agent-request-row")].map(
      (row) => row.dataset.agentRequest,
    );
  }

  function requestRow(id: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`.agent-request-row[data-agent-request="${id}"]`);
  }

  function markup(): string {
    return host.innerHTML.replace(/_r_[0-9a-z]+_/g, "_id_");
  }

  function leaf(text: string): Element | undefined {
    return [...host.querySelectorAll(".agent-turn *")].find(
      (node) => node.childElementCount === 0 && node.textContent === text,
    );
  }

  function follows(first: Element, second: Element): boolean {
    return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  it("renders a turn without records exactly as it does with no provider at all", () => {
    render([turnOf(TURN, EVENTS)]);
    const plain = markup();
    expect(host.querySelector(".agent-question-row")).not.toBeNull();
    expect(host.querySelector(".agent-question-row__answer")?.textContent).toBe("Sidebar");
    expect(host.querySelector(".agent-request-row")).toBeNull();

    render([turnOf(TURN, EVENTS)], new Map());
    expect(markup()).toBe(plain);

    render(
      [turnOf(TURN, EVENTS)],
      byTurn(wireRequest("resolvedQuestion", { turnId: "another-turn", anchorToolId: ASK_TOOL })),
    );
    expect(markup()).toBe(plain);
  });

  it("renders the record instead of the provider-derived question row for the same request", () => {
    render(
      [turnOf(TURN, EVENTS)],
      byTurn(wireRequest("resolvedQuestion", { anchorToolId: ASK_TOOL })),
    );

    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(host.querySelectorAll(".agent-request-row").length).toBe(1);
    expect(turnText()).toContain("Which packages should be updated?");
    expect(turnText()).not.toContain("Which layout is broken?");
    expect(turnText()).not.toContain("Sidebar");
    expect(turnText().indexOf("Let me ask first.")).toBeLessThan(turnText().indexOf("Answered"));
    expect(turnText().indexOf("Answered")).toBeLessThan(
      turnText().indexOf("Fixing the sidebar now."),
    );
  });

  it("leaves a pending request to the composer and still hides the provider-derived row", () => {
    render(
      [turnOf(TURN, EVENTS)],
      byTurn(wireRequest("pendingQuestion", { anchorToolId: ASK_TOOL })),
    );

    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(host.querySelector(".agent-request-row")).toBeNull();
    expect(turnText()).toContain("Fixing the sidebar now.");
  });

  it("keeps the provider-derived row for a question the records do not cover", () => {
    render(
      [turnOf(TURN, EVENTS)],
      byTurn(wireRequest("expiredAnswerUnconfirmedWithDecision", { anchorToolId: BASH_TOOL })),
    );

    expect(host.querySelectorAll(".agent-question-row").length).toBe(1);
    expect(host.querySelectorAll(".agent-request-row").length).toBe(1);
    const row = host.querySelector(".agent-request-row")!;
    const tool = [...host.querySelectorAll(".agent-tool-row")].find((node) =>
      node.textContent?.includes("npm test"),
    );
    expect(tool).toBeDefined();
    expect(follows(tool!, row)).toBe(true);
    expect(row.textContent).toContain(
      "Your decision was sent, but Codevo could not confirm the agent received it.",
    );
  });

  it("puts a resolved record without a tool at the end of the work list and an abnormal one outside the fold", () => {
    render(
      [turnOf(TURN, WORK_EVENTS)],
      byTurn(
        wireRequest("timedOutApproval", { id: "req-late", order: 7 }),
        wireRequest("resolvedApproval", { id: "req-early", order: 2 }),
        wireRequest("pendingApproval", { id: "req-open", order: 3 }),
      ),
    );

    const fold = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    const tool = fold.querySelector(".agent-tool-row")!;
    expect(fold.open).toBe(false);
    expect(requestIds()).toEqual(["req-early", "req-late"]);
    expect(requestIds(fold)).toEqual(["req-early"]);
    expect(follows(tool, requestRow("req-early")!)).toBe(true);
    expect(follows(leaf("All green.")!, requestRow("req-late")!)).toBe(true);
    expect(requestRow("req-late")?.textContent).toContain(
      "This closed because no decision arrived in time.",
    );
  });

  it("lists records after the turn's items when the turn has no work fold", () => {
    render(
      [turnOf(TURN, EVENTS.slice(0, 5))],
      byTurn(
        wireRequest("expiredRunnerStopped", { id: "req-orphan", order: 1 }),
        wireRequest("resolvedApproval", { id: "req-done", order: 2 }),
      ),
    );

    const tool = [...host.querySelectorAll(".agent-tool-row")].find((node) =>
      node.textContent?.includes("npm test"),
    );
    expect(host.querySelector(".agent-work")).toBeNull();
    expect(host.querySelectorAll(".agent-question-row").length).toBe(1);
    expect(requestIds()).toEqual(["req-orphan", "req-done"]);
    expect(tool).toBeDefined();
    expect(follows(tool!, requestRow("req-orphan")!)).toBe(true);
    expect(requestRow("req-orphan")?.textContent).toContain(
      "The runner stopped before this was decided.",
    );
  });

  it("shows both rows instead of guessing when the turn's events are incomplete", () => {
    render(
      [turnOf(TURN, EVENTS, { eventsTruncated: true })],
      byTurn(wireRequest("expiredDeliveryFailed")),
    );

    expect(host.querySelectorAll(".agent-question-row").length).toBe(1);
    expect(host.querySelector(".agent-question-row__answer")?.textContent).toBe("Sidebar");
    expect(requestIds()).toEqual(["req-0013"]);
  });

  it("keeps ten resolved approvals of grouped commands inside the fold of a settled turn", () => {
    const commands = Array.from({ length: 10 }, (_, index) => `toolu_cmd_${index}`);
    const events: ReadonlyArray<AgentTurnEvent> = [
      ...commands.flatMap((toolId, index): AgentTurnEvent[] => [
        { kind: "toolCall", toolId, name: "Bash", inputSummary: `npm run step-${index}` },
        { kind: "toolResult", toolId, outputSummary: "ok", isError: false },
      ]),
      { kind: "assistantText", text: "All green." },
    ];
    const approvals = commands.map((toolId, index) =>
      wireRequest("resolvedApproval", {
        id: `req-${String(index).padStart(2, "0")}`,
        order: index,
        anchorToolId: toolId,
      }),
    );
    render([turnOf(TURN, events)], byTurn(...approvals));
    const fold = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    const group = fold.querySelector<HTMLButtonElement>(".agent-activity-group__toggle")!;
    const expected = approvals.map((request) => request.id);

    expect(fold.open).toBe(false);
    expect(fold.querySelector(".agent-tool-row")).toBeNull();
    expect(requestIds(fold)).toEqual(expected);
    expect(requestIds()).toEqual(expected);
    expect(follows(group, requestRow("req-00")!)).toBe(true);
    for (const row of fold.querySelectorAll(".agent-request-row")) {
      expect(row.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
      expect(row.querySelector(".agent-request-row__ending")).toBeNull();
    }
  });

  it("keeps an abnormal record of a folded command visible with the fold closed", () => {
    render(
      [turnOf(TURN, TWO_COMMAND_EVENTS)],
      byTurn(
        wireRequest("resolvedApproval", { id: "req-ok", order: 0, anchorToolId: BASH_TOOL }),
        wireRequest("expiredAppRestarted", { id: "req-orphan", order: 1, anchorToolId: LINT_TOOL }),
      ),
    );
    const fold = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    const rows = [requestRow("req-ok"), requestRow("req-orphan")];

    expect(fold.open).toBe(false);
    expect(requestIds(fold)).toEqual(["req-ok"]);
    expect(requestIds()).toEqual(["req-ok", "req-orphan"]);
    expect(fold.contains(rows[1]!)).toBe(false);
    expect(follows(leaf("All green.")!, rows[1]!)).toBe(true);
    expect(rows[1]?.textContent).toContain("Codevo quit before this was decided.");

    act(() => fold.querySelector<HTMLButtonElement>(".agent-activity-group__toggle")!.click());

    expect(fold.querySelectorAll(".agent-tool-row").length).toBe(2);
    expect([requestRow("req-ok"), requestRow("req-orphan")]).toEqual(rows);
  });

  it("shows closed records in order inside the live work list while the turn runs", () => {
    const running = turnOf(TURN, QUESTION_AFTER_WORK_EVENTS.slice(0, 4), {
      status: { kind: "running" },
      endedAtEpochMs: null,
    });
    render(
      [running],
      byTurn(
        wireRequest("resolvedApproval", { id: "req-a", order: 0, anchorToolId: BASH_TOOL }),
        wireRequest("resolvedQuestion", { id: "req-b", order: 1, anchorToolId: ASK_TOOL }),
        wireRequest("resolvedApproval", { id: "req-c", order: 2 }),
        wireRequest("expiredTurnEnded", { id: "req-d", order: 3 }),
      ),
    );
    const fold = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    const tool = fold.querySelector(".agent-tool-row")!;

    expect(fold.open).toBe(true);
    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(requestIds(fold)).toEqual(["req-a", "req-b", "req-c"]);
    expect(requestIds()).toEqual(["req-a", "req-b", "req-c", "req-d"]);
    expect(follows(tool, requestRow("req-a")!)).toBe(true);
    expect(fold.contains(requestRow("req-d")!)).toBe(false);
    expect(follows(fold, requestRow("req-d")!)).toBe(true);
  });

  it("renders a record once when the same tool id produced two top-level tool rows", () => {
    render(
      [turnOf(TURN, REPEATED_RESULT_EVENTS)],
      byTurn(wireRequest("resolvedApproval", { id: "req-ok", anchorToolId: BASH_TOOL })),
    );

    const tools = [...host.querySelectorAll(".agent-turn .agent-tool-row")];
    expect(host.querySelector(".agent-work")).toBeNull();
    expect(tools.length).toBe(2);
    expect(requestIds()).toEqual(["req-ok"]);
    expect(follows(tools[0]!, requestRow("req-ok")!)).toBe(true);
    expect(follows(requestRow("req-ok")!, tools[1]!)).toBe(true);
  });

  it("keeps an expanded record expanded when it moves beside its tool as the turn settles", () => {
    const long = `${"Why? ".repeat(400)}THE-END`;
    const requests = byTurn(
      wireRequest("cancelledByProvider", {
        id: "req-moving",
        anchorToolId: ASK_TOOL,
        body: {
          kind: "question",
          questions: [
            {
              id: "q",
              header: "",
              prompt: long,
              options: [],
              multiple: false,
              allowCustom: true,
            },
          ],
        },
      }),
    );
    render([turnOf(TURN, QUESTION_AFTER_WORK_EVENTS, { status: { kind: "running" } })], requests);
    const fold = host.querySelector(".agent-work")!;
    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(follows(fold, requestRow("req-moving")!)).toBe(true);
    expect(fold.contains(requestRow("req-moving")!)).toBe(false);

    act(() => requestRow("req-moving")!.querySelector<HTMLButtonElement>("button")!.click());
    act(() =>
      requestRow("req-moving")!
        .querySelector<HTMLButtonElement>(".agent-request-row__more")!
        .click(),
    );
    expect(requestRow("req-moving")?.textContent).toContain("THE-END");

    render([turnOf(TURN, QUESTION_AFTER_WORK_EVENTS)], requests);

    const moved = requestRow("req-moving")!;
    expect(requestIds()).toEqual(["req-moving"]);
    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(follows(moved, leaf("Fixing the sidebar now.")!)).toBe(true);
    expect(moved.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(moved.querySelector(".agent-request-row__more")?.textContent).toBe("Show less");
    expect(moved.textContent).toContain("THE-END");
  });

  it("does not move a record while focus is inside it", () => {
    const requests = byTurn(
      wireRequest("cancelledByProvider", { id: "req-moving", anchorToolId: ASK_TOOL }),
    );
    render([turnOf(TURN, QUESTION_AFTER_WORK_EVENTS, { status: { kind: "running" } })], requests);
    const held = requestRow("req-moving")!;
    const toggle = held.querySelector<HTMLButtonElement>("button")!;
    const outside = document.createElement("button");
    document.body.append(outside);

    act(() => toggle.focus());
    render([turnOf(TURN, QUESTION_AFTER_WORK_EVENTS)], requests);

    expect(requestRow("req-moving")).toBe(held);
    expect(document.activeElement).toBe(toggle);
    expect(follows(leaf("Fixing the sidebar now.")!, held)).toBe(true);
    expect(host.querySelector(".agent-question-row")).toBeNull();

    act(() => outside.focus());

    const moved = requestRow("req-moving")!;
    expect(moved).not.toBe(held);
    expect(requestIds()).toEqual(["req-moving"]);
    expect(follows(moved, leaf("Fixing the sidebar now.")!)).toBe(true);
    outside.remove();
  });

  it("keeps the fold instance and its focused record when the turn settles, then resets it", () => {
    const requests = byTurn(
      wireRequest("resolvedApproval", { id: "req-held", anchorToolId: BASH_TOOL }),
    );
    const outside = document.createElement("button");
    document.body.append(outside);
    render([turnOf(TURN, WORK_EVENTS, { status: { kind: "running" } })], requests);
    const fold = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    const row = requestRow("req-held")!;
    const toggle = row.querySelector<HTMLButtonElement>("button")!;
    expect(fold.open).toBe(true);
    expect(fold.contains(row)).toBe(true);

    act(() => toggle.focus());
    render([turnOf(TURN, WORK_EVENTS)], requests);

    expect(host.querySelector(".agent-work")).toBe(fold);
    expect(fold.open).toBe(true);
    expect(requestRow("req-held")).toBe(row);
    expect(document.activeElement).toBe(toggle);
    expect(leaf("All green.")).toBeDefined();
    expect(fold.contains(leaf("All green.")!)).toBe(false);

    act(() => outside.focus());

    const settled = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    expect(settled).not.toBe(fold);
    expect(settled.open).toBe(false);
    expect(requestIds(settled)).toEqual(["req-held"]);
    expect(requestIds()).toEqual(["req-held"]);
    outside.remove();
  });

  it("resets the fold at once when nothing in it is focused, with or without records", () => {
    const requests = byTurn(
      wireRequest("resolvedApproval", { id: "req-held", anchorToolId: BASH_TOOL }),
    );
    for (const provided of [requests, undefined]) {
      render([turnOf(TURN, WORK_EVENTS, { status: { kind: "running" } })], provided);
      const fold = host.querySelector<HTMLDetailsElement>(".agent-work")!;
      expect(fold.open).toBe(true);

      render([turnOf(TURN, WORK_EVENTS)], provided);

      const settled = host.querySelector<HTMLDetailsElement>(".agent-work")!;
      expect(settled).not.toBe(fold);
      expect(settled.open).toBe(false);
    }
  });

  it("hides the provider-derived question on every row of a repeated question tool id", () => {
    render([turnOf(TURN, REPEATED_QUESTION_EVENTS)]);
    expect(host.querySelectorAll(".agent-question-row").length).toBe(2);

    render(
      [turnOf(TURN, REPEATED_QUESTION_EVENTS)],
      byTurn(wireRequest("resolvedQuestion", { anchorToolId: ASK_TOOL })),
    );

    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(requestIds()).toEqual(["req-0005"]);
    expect(turnText()).not.toContain("Sidebar");
  });

  it("pairs a lone unanchored question with the turn's only question tool", () => {
    render([turnOf(TURN, EVENTS)], byTurn(wireRequest("expiredDeliveryFailed")));

    expect(host.querySelector(".agent-question-row")).toBeNull();
    expect(host.querySelectorAll(".agent-request-row").length).toBe(1);
    expect(turnText().indexOf("Let me ask first.")).toBeLessThan(turnText().indexOf("Question"));
    expect(turnText().indexOf("Question")).toBeLessThan(
      turnText().indexOf("Fixing the sidebar now."),
    );
    expect(turnText()).toContain("Your answer could not be delivered to the agent.");
  });
});

describe("runtime request subscriptions", () => {
  const OTHER_TURN = "other-turn";
  const EDIT_TOOL = "toolu_edit";
  const NO_EVENTS: ReadonlyArray<AgentTurnEvent> = [];
  const prose: AgentProseContext = {
    markdown: { kind: "unavailable" },
    openExternalLink: async () => undefined,
    localFiles: null,
    viewport: null,
    onParsed: () => undefined,
  };
  const errorContext = createTurnErrorContext(
    "claudeCode",
    null,
    "local",
    { status: { kind: "exited", exitCode: 0 } },
    [],
  );
  let host: HTMLDivElement;
  let root: Root;
  let commits: Map<string, number>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    commits = new Map();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function toolItem(toolId: string, label: string): ToolItem {
    return {
      kind: "tool",
      key: `item-${toolId}`,
      toolId,
      name: "Bash",
      inputSummary: label,
      outcome: { outputSummary: "ok", isError: false },
      rowKind: "command",
      status: "ok",
      label: `Ran ${label}`,
      argument: null,
      command: label,
      output: "ok",
    };
  }

  function separated(tools: ReadonlyArray<ToolItem>): ReadonlyArray<AgentTurnItem> {
    return tools.flatMap((tool, index) => [
      tool,
      { kind: "assistantText", key: `text-${index}`, text: "Next.", paragraphs: ["Next."] },
    ]);
  }

  function counted(id: string, children: ReactNode) {
    return (
      <Profiler id={id} onRender={() => commits.set(id, (commits.get(id) ?? 0) + 1)}>
        {children}
      </Profiler>
    );
  }

  function toolRow(item: ToolItem) {
    return (
      <AgentTurnItemView
        attachmentImages={null}
        errorContext={errorContext}
        highlight={null}
        item={item}
        key={item.key}
        prose={prose}
        settlement="settled"
        stream="settled"
        textClipboard={null}
      />
    );
  }

  function turn(turnId: string, visibleItems: ReadonlyArray<AgentTurnItem>, children: ReactNode) {
    return (
      <AgentTurnRuntimeRequests
        events={NO_EVENTS}
        eventsTruncated={false}
        turnId={turnId}
        visibleItems={visibleItems}
        workItems={null}
      >
        {children}
      </AgentTurnRuntimeRequests>
    );
  }

  function counting(source: AgentRuntimeRequestsSource) {
    const calls = { reads: 0, subscribed: [] as string[], live: new Map<string, number>() };
    const counted: AgentRuntimeRequestsSource = {
      inert: source.inert,
      requestsOf(turnId) {
        calls.reads += 1;
        return source.requestsOf(turnId);
      },
      subscribe(turnId, listener) {
        calls.subscribed.push(turnId);
        calls.live.set(turnId, (calls.live.get(turnId) ?? 0) + 1);
        const stop = source.subscribe(turnId, listener);
        return () => {
          calls.live.set(turnId, (calls.live.get(turnId) ?? 0) - 1);
          stop();
        };
      },
    };
    return { calls, source: counted };
  }

  function snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(commits);
  }

  function rowIds(): ReadonlyArray<string | undefined> {
    return [...host.querySelectorAll<HTMLElement>(".agent-request-row")].map(
      (row) => row.dataset.agentRequest,
    );
  }

  function normalized(markup: string): string {
    return markup.replace(/_r_[0-9a-z]+_/g, "_id_");
  }

  it("re-renders only the tool row whose history changed, not its turn or any other turn", () => {
    const store = createAgentRuntimeRequestsStore();
    const bash = toolItem(BASH_TOOL, "npm test");
    const edit = toolItem(EDIT_TOOL, "npm run lint");
    const other = toolItem("toolu_other", "ls");
    const mine = separated([bash, edit]);
    const theirs = separated([other]);
    const first = wireRequest("resolvedApproval", { id: "req-bash", anchorToolId: BASH_TOOL });
    const second = wireRequest("resolvedApproval", { id: "req-edit", anchorToolId: EDIT_TOOL });
    const foreign = wireRequest("resolvedApproval", {
      id: "req-other",
      turnId: OTHER_TURN,
      anchorToolId: "toolu_other",
    });
    const loose = wireRequest("timedOutApproval", { id: "req-loose", order: 9 });
    const tree = (
      <AgentRuntimeRequestsContext.Provider value={store}>
        {counted(
          "turn-wrapper",
          turn(
            TURN,
            mine,
            <>
              {counted("bash", toolRow(bash))}
              {counted("edit", toolRow(edit))}
              {counted("unanchored", <AgentTurnUnanchoredRequests attachmentImages={null} />)}
            </>,
          ),
        )}
        {counted("other-wrapper", turn(OTHER_TURN, theirs, counted("other-tool", toolRow(other))))}
      </AgentRuntimeRequestsContext.Provider>
    );

    act(() =>
      store.publish(
        new Map([
          [TURN, [first]],
          [OTHER_TURN, [foreign]],
        ]),
      ),
    );
    act(() => root.render(tree));
    const mounted = snapshot();
    expect(rowIds()).toEqual(["req-bash", "req-other"]);
    expect(mounted).toEqual({
      bash: 1,
      edit: 1,
      unanchored: 1,
      "turn-wrapper": 1,
      "other-tool": 1,
      "other-wrapper": 1,
    });

    const moreForeign = wireRequest("resolvedApproval", {
      id: "req-other-2",
      order: 5,
      turnId: OTHER_TURN,
      anchorToolId: "toolu_other",
    });
    act(() =>
      store.publish(
        new Map([
          [TURN, [first]],
          [OTHER_TURN, [foreign, moreForeign]],
        ]),
      ),
    );
    const afterOtherTurn = snapshot();
    expect(rowIds()).toEqual(["req-bash", "req-other", "req-other-2"]);
    expect(afterOtherTurn).toEqual({ ...mounted, "other-tool": 2, "other-wrapper": 2 });

    act(() =>
      store.publish(
        new Map([
          [TURN, [first, second]],
          [OTHER_TURN, [foreign, moreForeign]],
        ]),
      ),
    );
    const afterOtherTool = snapshot();
    expect(rowIds()).toEqual(["req-bash", "req-edit", "req-other", "req-other-2"]);
    expect(afterOtherTool).toEqual({ ...afterOtherTurn, edit: 2, "turn-wrapper": 2 });

    act(() =>
      store.publish(
        new Map([
          [TURN, [first, second, loose]],
          [OTHER_TURN, [foreign, moreForeign]],
        ]),
      ),
    );
    const afterUnanchored = snapshot();
    expect(rowIds()).toEqual(["req-bash", "req-edit", "req-loose", "req-other", "req-other-2"]);
    expect(afterUnanchored).toEqual({ ...afterOtherTool, unanchored: 2, "turn-wrapper": 3 });

    act(() =>
      store.publish(
        new Map([
          [TURN, [first, second, loose]],
          [OTHER_TURN, [foreign, moreForeign]],
        ]),
      ),
    );
    expect(snapshot()).toEqual(afterUnanchored);
  });

  it("does no request work for a long transcript when no source provides records", () => {
    const tools = Array.from({ length: 2_000 }, (_, index) =>
      toolItem(`toolu_${index}`, `step ${index}`),
    );
    const items = separated(tools);
    const rows = tools.map(toolRow);
    const inert = counting(INERT_AGENT_RUNTIME_REQUESTS);
    const empty = counting(createAgentRuntimeRequestsStore());

    act(() => root.render(counted("plain", <>{tools.map((item) => plainRow(item))}</>)));
    const plain = normalized(host.innerHTML);
    expect(host.querySelectorAll(".agent-tool-row").length).toBe(2_000);

    act(() => root.render(counted("default", turn(TURN, items, rows))));
    expect(normalized(host.innerHTML)).toBe(plain);

    act(() =>
      root.render(
        <AgentRuntimeRequestsContext.Provider value={inert.source}>
          {counted("inert", turn(TURN, items, rows))}
        </AgentRuntimeRequestsContext.Provider>,
      ),
    );
    expect(normalized(host.innerHTML)).toBe(plain);
    expect(inert.calls).toEqual({ reads: 0, subscribed: [], live: new Map() });

    act(() =>
      root.render(
        <AgentRuntimeRequestsContext.Provider value={empty.source}>
          {counted("empty", turn(TURN, items, rows))}
        </AgentRuntimeRequestsContext.Provider>,
      ),
    );
    expect(normalized(host.innerHTML)).toBe(plain);
    expect(empty.calls.subscribed).toEqual([TURN]);
    expect(empty.calls.reads).toBeLessThan(10);
    expect(snapshot()).toEqual({ plain: 1, default: 1, inert: 1, empty: 1 });
  });

  function plainRow(item: ToolItem) {
    return <AgentToolRow item={item} key={item.key} />;
  }

  it("subscribes only the rows that can show a record once a turn has records", () => {
    const tools = Array.from({ length: 200 }, (_, index) =>
      toolItem(`toolu_${index}`, `step ${index}`),
    );
    const anchored = toolItem(BASH_TOOL, "npm test");
    const items: ReadonlyArray<AgentTurnItem> = [
      ...tools,
      { kind: "assistantText", key: "text-before", text: "Then.", paragraphs: ["Then."] },
      ...separated([anchored]),
    ];
    const real = createAgentRuntimeRequestsStore(
      new Map([[TURN, [wireRequest("resolvedApproval", { anchorToolId: BASH_TOOL })]]]),
    );
    const source = counting(real);

    act(() =>
      root.render(
        <AgentRuntimeRequestsContext.Provider value={source.source}>
          {turn(
            TURN,
            items,
            <>
              {tools.map(toolRow)}
              {toolRow(anchored)}
              <AgentTurnUnanchoredRequests attachmentImages={null} />
            </>,
          )}
        </AgentRuntimeRequestsContext.Provider>,
      ),
    );

    expect(host.querySelectorAll(".agent-tool-row").length).toBe(201);
    expect(rowIds()).toEqual(["req-0006"]);
    expect(
      requestRow("req-0006")?.previousElementSibling?.previousElementSibling?.textContent,
    ).toBe("Ran npm test");
    expect(source.calls.subscribed.length).toBe(3);
    expect(source.calls.live.get(TURN)).toBe(3);

    act(() => root.render(null));
    expect(source.calls.live.get(TURN)).toBe(0);
  });

  it("keeps placement and subscriptions correct under StrictMode", () => {
    const store = createAgentRuntimeRequestsStore();
    const source = counting(store);
    const bash = toolItem(BASH_TOOL, "npm test");
    const items = separated([bash]);
    const anchored = wireRequest("resolvedApproval", { id: "req-bash", anchorToolId: BASH_TOOL });
    const loose = wireRequest("timedOutApproval", { id: "req-loose", order: 9 });
    const tree = (
      <StrictMode>
        <AgentRuntimeRequestsContext.Provider value={source.source}>
          {turn(
            TURN,
            items,
            <>
              {toolRow(bash)}
              <AgentTurnUnanchoredRequests attachmentImages={null} />
            </>,
          )}
        </AgentRuntimeRequestsContext.Provider>
      </StrictMode>
    );

    act(() => root.render(tree));
    expect(rowIds()).toEqual([]);

    act(() => store.publish(new Map([[TURN, [anchored, loose]]])));
    expect(rowIds()).toEqual(["req-bash", "req-loose"]);
    expect(follows(host.querySelector(".agent-tool-row")!, requestRow("req-bash")!)).toBe(true);

    act(() => store.publish(new Map([[TURN, [loose]]])));
    expect(rowIds()).toEqual(["req-loose"]);

    act(() => store.publish(new Map()));
    expect(rowIds()).toEqual([]);
    expect(source.calls.live.get(TURN)).toBe(1);

    act(() => root.render(null));
    expect(source.calls.live.get(TURN)).toBe(0);
  });

  it("follows a turn id change on a reused wrapper and drops the old turn's subscriptions", () => {
    const store = createAgentRuntimeRequestsStore();
    const source = counting(store);
    const bash = toolItem(BASH_TOOL, "npm test");
    const items = separated([bash]);
    const mine = wireRequest("resolvedApproval", { id: "req-mine", anchorToolId: BASH_TOOL });
    const theirs = wireRequest("resolvedApproval", {
      id: "req-theirs",
      turnId: OTHER_TURN,
      anchorToolId: BASH_TOOL,
    });
    function show(turnId: string) {
      act(() =>
        root.render(
          <AgentRuntimeRequestsContext.Provider value={source.source}>
            {turn(
              turnId,
              items,
              <>
                {toolRow(bash)}
                <AgentTurnUnanchoredRequests attachmentImages={null} />
              </>,
            )}
          </AgentRuntimeRequestsContext.Provider>,
        ),
      );
    }

    act(() =>
      store.publish(
        new Map([
          [TURN, [mine]],
          [OTHER_TURN, [theirs]],
        ]),
      ),
    );
    show(TURN);
    expect(rowIds()).toEqual(["req-mine"]);

    show(OTHER_TURN);
    expect(rowIds()).toEqual(["req-theirs"]);
    expect(source.calls.live.get(TURN)).toBe(0);
    expect(source.calls.live.get(OTHER_TURN)).toBeGreaterThan(0);

    act(() => store.publish(new Map([[OTHER_TURN, [theirs]]])));
    expect(rowIds()).toEqual(["req-theirs"]);

    act(() => store.publish(new Map([[TURN, [mine]]])));
    expect(rowIds()).toEqual([]);

    show(TURN);
    expect(rowIds()).toEqual(["req-mine"]);
    expect(source.calls.live.get(OTHER_TURN)).toBe(0);
  });

  function requestRow(id: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`.agent-request-row[data-agent-request="${id}"]`);
  }

  function follows(first: Element, second: Element): boolean {
    return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }
});
