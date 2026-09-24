// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentTurnEventUtf8Bytes } from "../domain/agentThread";
import type {
  AgentTurnLogEntry,
  AgentTurnLogPage,
  ReadAgentTurnLogPageRequest,
} from "../domain/agentTurnLog";
import {
  agentTurnActivityWindowOf,
  useAgentTurnEarlierActivity,
  type AgentHistoryActivitySource,
  type AgentTurnEarlierActivity,
} from "./useAgentHistoryActivity";

function tool(seq: number): AgentTurnLogEntry {
  return { seq, event: { kind: "toolCall", toolId: `t${seq}`, name: "Bash", inputSummary: "ls" } };
}

function fakeLog(total: number) {
  return vi.fn(async (request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage> => {
    const { anchor, maxEvents } = request;
    const end = anchor.at === "tail" ? total : anchor.at === "before" ? anchor.seq - 1 : total;
    const start = anchor.at === "after" ? anchor.seq + 1 : Math.max(1, end - maxEvents + 1);
    const last = anchor.at === "after" ? Math.min(total, start + maxEvents - 1) : end;
    const entries = Array.from({ length: Math.max(0, last - start + 1) }, (_, index) =>
      tool(start + index),
    );
    return {
      entries,
      firstSeq: entries[0]?.seq ?? 0,
      lastSeq: entries[entries.length - 1]?.seq ?? 0,
      hasEarlier: start > 1,
      hasLater: last < total,
      loss: { kind: "none" },
      clipped: false,
    };
  });
}

function source(
  readPage: AgentHistoryActivitySource["readPage"],
  turnId = "turn",
): AgentHistoryActivitySource {
  return {
    scope: { rootKey: "/root", ownerId: "owner", threadId: "thread", turnId },
    generation: 1,
    leaseToken: 7,
    readPage,
  };
}

let host: HTMLDivElement;
let root: Root;
let latest: AgentTurnEarlierActivity | null = null;

function Probe({ value }: { readonly value: AgentHistoryActivitySource | null }) {
  latest = useAgentTurnEarlierActivity(value);
  return null;
}

function render(value: AgentHistoryActivitySource | null): void {
  act(() => root.render(<Probe value={value} />));
}

function current(): AgentTurnEarlierActivity {
  expect(latest).not.toBeNull();
  return latest as AgentTurnEarlierActivity;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ENTRY_BYTES = agentTurnEventUtf8Bytes(tool(1).event);

describe("useAgentTurnEarlierActivity", () => {
  it("reads back past the retained window plus one page on first activation", async () => {
    const readPage = fakeLog(1000);
    render(source(readPage));

    await act(() => current().loadEarlier(ENTRY_BYTES * 300));

    const window = agentTurnActivityWindowOf(current().state);
    expect(readPage).toHaveBeenCalledTimes(3);
    expect(readPage.mock.calls.map(([request]) => request.anchor)).toEqual([
      { at: "tail" },
      { at: "before", seq: 801 },
      { at: "before", seq: 601 },
    ]);
    expect(window?.entries[0]?.seq).toBe(401);
    expect(window?.entries[window.entries.length - 1]?.seq).toBe(1000);
    expect(window?.hasEarlier).toBe(true);
  });

  it("prepends one page per request and stays within the window caps", async () => {
    const readPage = fakeLog(5000);
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    for (let step = 0; step < 6; step += 1) {
      await act(() => current().loadEarlier(0));
    }

    const window = agentTurnActivityWindowOf(current().state);
    expect(window?.entries).toHaveLength(1000);
    expect(window?.entries[0]?.seq).toBe(3401);
    expect(window?.hasLater).toBe(true);
  });

  it("ignores a second load while one is in flight", async () => {
    let release: () => void = () => undefined;
    const readPage = vi.fn(
      (request: ReadAgentTurnLogPageRequest) =>
        new Promise<AgentTurnLogPage>((resolve) => {
          release = () => void fakeLog(10)(request).then(resolve);
        }),
    );
    render(source(readPage));

    act(() => {
      void current().loadEarlier(0);
      void current().loadEarlier(0);
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(current().state.kind).toBe("loading");
    await act(async () => release());
  });

  it("keeps the previous window when a page fails and retries the same direction", async () => {
    const log = fakeLog(2000);
    const readPage = vi.fn(log);
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    const before = agentTurnActivityWindowOf(current().state);

    readPage.mockRejectedValueOnce(new Error("busy"));
    await act(() => current().loadEarlier(0));
    expect(current().state).toMatchObject({ kind: "failed", direction: "earlier" });
    expect(agentTurnActivityWindowOf(current().state)).toBe(before);

    await act(() => current().loadEarlier(0));
    expect(agentTurnActivityWindowOf(current().state)?.entries[0]?.seq).toBe(1401);
  });

  it("fails closed on a page that does not advance", async () => {
    const readPage = vi.fn(fakeLog(1000));
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    readPage.mockResolvedValueOnce({
      entries: [tool(900)],
      firstSeq: 900,
      lastSeq: 900,
      hasEarlier: true,
      hasLater: true,
      loss: { kind: "none" },
      clipped: false,
    });

    await act(() => current().loadEarlier(0));
    expect(current().state.kind).toBe("failed");
  });

  it("drops a page that resolves after the source changed", async () => {
    let release: () => void = () => undefined;
    const readPage = vi.fn(
      (request: ReadAgentTurnLogPageRequest) =>
        new Promise<AgentTurnLogPage>((resolve) => {
          release = () => void fakeLog(10)(request).then(resolve);
        }),
    );
    render(source(readPage, "turn-a"));
    act(() => {
      void current().loadEarlier(0);
    });

    render(source(readPage, "turn-b"));
    expect(current().state.kind).toBe("latest");
    await act(async () => release());
    expect(current().state.kind).toBe("latest");
  });

  it("drops a page that resolves after unmount", async () => {
    let release: () => void = () => undefined;
    const readPage = vi.fn(
      (request: ReadAgentTurnLogPageRequest) =>
        new Promise<AgentTurnLogPage>((resolve) => {
          release = () => void fakeLog(10)(request).then(resolve);
        }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(source(readPage));
    act(() => {
      void current().loadEarlier(0);
    });
    act(() => root.unmount());
    await act(async () => release());
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    root = createRoot(host);
  });

  it("slides forward with loadLater and returns to the live window with latest", async () => {
    const readPage = fakeLog(3000);
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    for (let step = 0; step < 5; step += 1) {
      await act(() => current().loadEarlier(0));
    }
    expect(agentTurnActivityWindowOf(current().state)?.hasLater).toBe(true);

    await act(() => current().loadLater());
    const window = agentTurnActivityWindowOf(current().state);
    expect(window?.entries[window.entries.length - 1]?.seq).toBe(2800);

    act(() => current().latest());
    expect(current().state.kind).toBe("latest");
  });
});
