import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

const taskId = "12345678-1234-4234-8234-123456789abc";
const match = {
  taskId,
  conversationId: taskId,
  projectId: null,
  taskSequence: 12,
  role: "assistant",
  eventSequence: 3,
  snippet: "Historical response",
};
const page = {
  items: [match],
  nextCursor: 12,
  scope: "retained_runner_history",
  incomplete: false,
};

describe("remote persisted history search boundary", () => {
  it("uses the typed command and preserves empty continuing pages", async () => {
    const empty = { ...page, items: [], incomplete: true };
    const invoke = vi.fn().mockResolvedValue(empty);
    const request = { serverId: "linux", query: "old & response", after: 2 };
    expect(await new TauriRemoteRunnerGateway(invoke).searchHistory(request)).toEqual(empty);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_search_history", { request });
  });
  it.each([
    { query: "x" },
    { query: " ", after: 0 },
    { query: "x".repeat(257) },
    { query: "a\nquery" },
    { query: "valid", after: -1 },
    { query: "valid", after: Number.MAX_SAFE_INTEGER + 1 },
    { query: "valid", projectId: "" },
    { query: "valid", token: "untrusted" },
  ])("rejects invalid requests before invoking IPC: %j", async (input) => {
    const invoke = vi.fn();
    await expect(
      new TauriRemoteRunnerGateway(invoke).searchHistory({ serverId: "linux", ...input }),
    ).rejects.toThrow("request");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    { ...page, token: "untrusted" },
    { ...page, scope: "all_history" },
    { ...page, incomplete: undefined },
    { ...page, nextCursor: -1 },
    { ...page, items: Array(21).fill(match) },
    { ...page, items: [{ ...match, taskId: "other" }] },
    { ...page, items: [{ ...match, role: "tool" }] },
    { ...page, items: [{ ...match, snippet: "🙂".repeat(383) }] },
    { ...page, items: [{ ...match, eventSequence: 0 }] },
  ])("rejects unknown, oversized and malformed response fields", (value) => {
    expect(() => validateRemoteRunnerValue("searchHistory", "response", value)).toThrow();
  });
  it("accepts Unicode boundary snippets and null terminal cursors", () => {
    expect(() =>
      validateRemoteRunnerValue("searchHistory", "response", {
        ...page,
        nextCursor: null,
        items: [{ ...match, snippet: "🙂".repeat(382) }],
      }),
    ).not.toThrow();
  });
  it.each([
    { ...page, nextCursor: 2 },
    { ...page, items: [{ ...match, taskSequence: 2 }] },
    { ...page, items: [{ ...match, taskSequence: 13 }] },
    { ...page, items: [match, match] },
    { ...page, items: [{ ...match, role: "user" }] },
    { ...page, items: [{ ...match, eventSequence: null }] },
    {
      ...page,
      items: [
        { ...match, taskSequence: 12 },
        { ...match, taskSequence: 11, role: "user", eventSequence: null },
      ],
    },
  ])("rejects cursor regression, duplicate and inconsistent results", async (value) => {
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(value));
    await expect(
      gateway.searchHistory({ serverId: "linux", query: "old", after: 2 }),
    ).rejects.toThrow("response");
  });
  it("rejects another project's result", async () => {
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(page));
    await expect(
      gateway.searchHistory({ serverId: "linux", query: "old", projectId: "project" }),
    ).rejects.toThrow("response");
  });
});
