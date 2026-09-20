// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnLogPage } from "../domain/agentTurnLog";
import {
  useAgentHistoryActivity,
  type AgentHistoryActivitySource,
} from "./useAgentHistoryActivity";

const page = (firstSeq: number): AgentTurnLogPage => ({
  entries: [{ seq: firstSeq, event: { kind: "assistantText", text: `event-${firstSeq}` } }],
  firstSeq,
  lastSeq: firstSeq,
  hasEarlier: firstSeq > 1,
  hasLater: firstSeq < 500,
  loss: { kind: "none" },
  clipped: false,
});
let root: Root;
let host: HTMLDivElement;
let value: ReturnType<typeof useAgentHistoryActivity>;
function setup() {
  host = document.createElement("div");
  root = createRoot(host);
  const readPage = vi.fn<AgentHistoryActivitySource["readPage"]>().mockResolvedValue(page(500));
  const source: AgentHistoryActivitySource = {
    scope: { rootKey: "/workspace", ownerId: "owner", threadId: "thread", turnId: "turn" },
    generation: 1,
    leaseToken: 1,
    readPage,
  };
  function Harness({ source }: { source: AgentHistoryActivitySource | null }) {
    value = useAgentHistoryActivity(source);
    return null;
  }
  const render = (source: AgentHistoryActivitySource | null) =>
    act(() => root.render(<Harness source={source} />));
  render(source);
  return { source, readPage, render };
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
describe("saved activity page ownership", () => {
  it("replaces bounded pages using stable sequence cursors", async () => {
    const { readPage } = setup();
    await act(() => value.read({ at: "tail" }));
    readPage.mockResolvedValue(page(299));
    await act(() => value.read({ at: "before", seq: 500 }));
    expect(value.state).toEqual({ kind: "ready", page: page(299) });
    expect(readPage.mock.calls[1]?.[0]).toMatchObject({
      anchor: { at: "before", seq: 500 },
      maxEvents: 200,
      maxBytes: 524288,
    });
    act(() => value.latest());
    expect(value.state.kind).toBe("latest");
  });
  it("rejects delayed A to B to A responses and cancellation", async () => {
    const { source, readPage, render } = setup();
    let resolve!: (value: AgentTurnLogPage) => void;
    readPage.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = value.read({ at: "tail" });
    });
    render({ ...source, generation: 2 });
    render(source);
    await act(async () => {
      resolve(page(500));
      await pending;
    });
    expect(value.state.kind).toBe("latest");
    act(() => {
      pending = value.read({ at: "tail" });
      value.latest();
    });
    await act(async () => {
      await pending;
    });
    expect(value.state.kind).toBe("latest");
  });
  it("retains a recoverable page on failure and rejects nonadvancing results", async () => {
    const { readPage } = setup();
    await act(() => value.read({ at: "tail" }));
    await act(() => value.read({ at: "before", seq: 500 }));
    expect(value.state).toMatchObject({
      kind: "failed",
      page: page(500),
      anchor: { at: "before", seq: 500 },
    });
    readPage.mockResolvedValue(page(100));
    await act(() => value.read({ at: "before", seq: 500 }));
    expect(value.state).toEqual({ kind: "ready", page: page(100) });
  });
  it("coalesces duplicate reads and ignores settlement after unmount", async () => {
    const { readPage } = setup();
    let resolve!: (value: AgentTurnLogPage) => void;
    readPage.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = value.read({ at: "tail" });
      void value.read({ at: "tail" });
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    await act(async () => {
      resolve(page(500));
      await pending;
    });
    root = createRoot(host);
  });
});
