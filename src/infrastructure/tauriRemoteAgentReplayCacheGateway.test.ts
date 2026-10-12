import { describe, expect, it, vi } from "vitest";
import {
  MAX_REMOTE_REPLAY_CACHE_IDENTIFIER_BYTES,
  MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES,
  MAX_REMOTE_REPLAY_CACHE_TASKS,
  type RemoteAgentReplayCacheKey,
} from "../application/remoteAgentReplayCachePorts";
import {
  REMOTE_AGENT_REPLAY_CACHE_COMMANDS,
  TauriRemoteAgentReplayCacheGateway,
  type InvokeRemoteAgentReplayCacheCommand,
} from "./tauriRemoteAgentReplayCacheGateway";

const key: RemoteAgentReplayCacheKey = {
  serverId: "server",
  endpoint: '["server","host","user",22]',
  runnerId: "runner",
  threadKey: "thread",
};
const hit = { kind: "hit", records: [{ taskId: "task", record: "{}" }] } as const;
const LOAD_FIXTURE =
  '{"key":{"serverId":"server","endpoint":"[\\"server\\",\\"host\\",\\"user\\",22]","runnerId":"runner","threadKey":"thread"}}';
const PUT_FIXTURE =
  '{"key":{"serverId":"server","endpoint":"[\\"server\\",\\"host\\",\\"user\\",22]","runnerId":"runner","threadKey":"thread"},"taskId":"task","record":"{}"}';
const REMOVE_THREAD_FIXTURE =
  '{"key":{"serverId":"server","endpoint":"[\\"server\\",\\"host\\",\\"user\\",22]","runnerId":"runner","threadKey":"thread"}}';
const REMOVE_SERVER_FIXTURE = '{"serverId":"server"}';
const CLEAR_FIXTURE = "{}";
const HIT_FIXTURE = '{"kind":"hit","records":[{"taskId":"task","record":"{}"}]}';
const MISS_FIXTURE = '{"kind":"miss"}';
const STORED_FIXTURE = '{"kind":"stored"}';
const UNAVAILABLE_FIXTURE = '{"kind":"unavailable"}';
const REMOVED_FIXTURE = '{"kind":"removed"}';
const REJECTED_FIXTURES = [
  '{"kind":"rejected","reason":"invalidIdentifier"}',
  '{"kind":"rejected","reason":"recordTooLarge"}',
  '{"kind":"rejected","reason":"invalidRecord"}',
  '{"kind":"rejected","reason":"threadTooLarge"}',
  '{"kind":"rejected","reason":"tooManyTasks"}',
] as const;

function gatewayFor(response: unknown) {
  const invokeCommand = vi.fn<InvokeRemoteAgentReplayCacheCommand>().mockResolvedValue(response);
  return { invokeCommand, gateway: new TauriRemoteAgentReplayCacheGateway(invokeCommand) };
}

function recordWithBytes(bytes: number): string {
  return JSON.stringify({ text: "x".repeat(bytes - 11) });
}

describe("TauriRemoteAgentReplayCacheGateway", () => {
  it("pins every literal Rust command request fixture", async () => {
    expect(REMOTE_AGENT_REPLAY_CACHE_COMMANDS).toEqual({
      loadThread: "remote_replay_cache_load_thread",
      putTask: "remote_replay_cache_put_task",
      removeThread: "remote_replay_cache_remove_thread",
      removeServer: "remote_replay_cache_remove_server",
      clear: "remote_replay_cache_clear",
    });
    const { invokeCommand, gateway } = gatewayFor(JSON.parse(REMOVED_FIXTURE));
    invokeCommand
      .mockResolvedValueOnce(JSON.parse(HIT_FIXTURE))
      .mockResolvedValueOnce(JSON.parse(STORED_FIXTURE));
    await gateway.loadThread(key);
    await gateway.putTask(key, "task", "{}");
    await gateway.removeThread(key);
    await gateway.removeServer("server");
    await gateway.clear();
    const fixtures = [
      ["remote_replay_cache_load_thread", LOAD_FIXTURE],
      ["remote_replay_cache_put_task", PUT_FIXTURE],
      ["remote_replay_cache_remove_thread", REMOVE_THREAD_FIXTURE],
      ["remote_replay_cache_remove_server", REMOVE_SERVER_FIXTURE],
      ["remote_replay_cache_clear", CLEAR_FIXTURE],
    ] as const;
    expect(invokeCommand.mock.calls).toEqual(
      fixtures.map(([command, fixture]) => [command, { request: JSON.parse(fixture) }]),
    );
    expect(invokeCommand.mock.calls.map(([, args]) => JSON.stringify(args.request))).toEqual(
      fixtures.map(([, fixture]) => fixture),
    );
  });

  it.each([HIT_FIXTURE, MISS_FIXTURE])(
    "accepts literal Rust load response fixture: %s",
    async (fixture) => {
      const response: unknown = JSON.parse(fixture);
      const { gateway } = gatewayFor(response);
      await expect(gateway.loadThread(key)).resolves.toEqual(response);
    },
  );

  it.each([STORED_FIXTURE, ...REJECTED_FIXTURES, UNAVAILABLE_FIXTURE])(
    "accepts literal Rust put response fixture: %s",
    async (fixture) => {
      const response: unknown = JSON.parse(fixture);
      const { gateway } = gatewayFor(response);
      await expect(gateway.putTask(key, "task", "{}")).resolves.toEqual(response);
    },
  );

  it.each([REMOVED_FIXTURE, UNAVAILABLE_FIXTURE])(
    "accepts literal Rust removal response fixture for every command: %s",
    async (fixture) => {
      const response: unknown = JSON.parse(fixture);
      const { gateway } = gatewayFor(response);
      await expect(gateway.removeThread(key)).resolves.toEqual(response);
      await expect(gateway.removeServer("server")).resolves.toEqual(response);
      await expect(gateway.clear()).resolves.toEqual(response);
    },
  );

  it.each([
    null,
    [],
    {},
    { kind: "future" },
    { kind: "miss", extra: true },
    { kind: "hit" },
    { ...hit, extra: true },
    { kind: "hit", records: null },
    { kind: "hit", records: [{ taskId: "task" }] },
    { kind: "hit", records: [{ taskId: "task", record: "{}", extra: true }] },
    { kind: "hit", records: [{ taskId: "", record: "{}" }] },
    { kind: "hit", records: [{ taskId: "task\u0000", record: "{}" }] },
    { kind: "hit", records: [{ taskId: "task", record: 1 }] },
    { kind: "hit", records: [{ taskId: "task", record: "[]" }] },
    { kind: "hit", records: [{ taskId: "task", record: "{" }] },
    { kind: "hit", records: [hit.records[0], hit.records[0]] },
  ])("maps a malformed load response to a complete miss: %j", async (response) => {
    const { gateway } = gatewayFor(response);
    await expect(gateway.loadThread(key)).resolves.toEqual({ kind: "miss" });
  });

  it("rejects oversized load collections, identifiers, records and thread totals", async () => {
    const { invokeCommand, gateway } = gatewayFor({ kind: "miss" });
    for (const records of [
      Array.from({ length: MAX_REMOTE_REPLAY_CACHE_TASKS + 1 }, (_, index) => ({
        taskId: `${index}`,
        record: "{}",
      })),
      [{ taskId: "é".repeat(MAX_REMOTE_REPLAY_CACHE_IDENTIFIER_BYTES), record: "{}" }],
      [{ taskId: "task", record: recordWithBytes(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES + 1) }],
      [
        { taskId: "a", record: recordWithBytes(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES) },
        { taskId: "b", record: recordWithBytes(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES) },
        { taskId: "c", record: "{}" },
      ],
    ]) {
      invokeCommand.mockResolvedValueOnce({ kind: "hit", records });
      await expect(gateway.loadThread(key)).resolves.toEqual({ kind: "miss" });
    }
  });

  it.each([
    null,
    {},
    [],
    { kind: "future" },
    { kind: "stored", extra: true },
    { kind: "unavailable", extra: true },
    { kind: "rejected" },
    { kind: "rejected", reason: "future" },
    { kind: "rejected", reason: "invalidRecord", extra: true },
  ])("maps malformed put responses to unavailable: %j", async (response) => {
    const { gateway } = gatewayFor(response);
    await expect(gateway.putTask(key, "task", "{}")).resolves.toEqual({ kind: "unavailable" });
  });

  it.each([null, {}, [], { kind: "future" }, { kind: "removed", extra: true }])(
    "maps malformed deletion responses to unavailable: %j",
    async (response) => {
      const { gateway } = gatewayFor(response);
      await expect(gateway.removeThread(key)).resolves.toEqual({ kind: "unavailable" });
      await expect(gateway.removeServer("server")).resolves.toEqual({ kind: "unavailable" });
      await expect(gateway.clear()).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it.each(["busy", "locked", new Error("IPC closed"), null])(
    "absorbs invoke failures for every operation: %j",
    async (error) => {
      const invokeCommand = vi.fn<InvokeRemoteAgentReplayCacheCommand>().mockRejectedValue(error);
      const gateway = new TauriRemoteAgentReplayCacheGateway(invokeCommand);
      await expect(gateway.loadThread(key)).resolves.toEqual({ kind: "miss" });
      await expect(gateway.putTask(key, "task", "{}")).resolves.toEqual({ kind: "unavailable" });
      await expect(gateway.removeThread(key)).resolves.toEqual({ kind: "unavailable" });
      await expect(gateway.removeServer("server")).resolves.toEqual({ kind: "unavailable" });
      await expect(gateway.clear()).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it("rejects unknown key fields and invalid identifiers before IPC", async () => {
    const { invokeCommand, gateway } = gatewayFor(null);
    const invalidKeys = [
      { ...key, extra: true },
      { serverId: "server", endpoint: "endpoint", runnerId: "runner" },
      ...["", "x\u0000", "x".repeat(513), "é".repeat(257)].flatMap((value) =>
        Object.keys(key).map((field) => ({ ...key, [field]: value })),
      ),
    ];
    for (const invalidKey of invalidKeys) {
      const invalid = invalidKey as RemoteAgentReplayCacheKey;
      await expect(gateway.loadThread(invalid)).resolves.toEqual({ kind: "miss" });
      await expect(gateway.putTask(invalid, "task", "{}")).resolves.toEqual({
        kind: "rejected",
        reason: "invalidIdentifier",
      });
      await expect(gateway.removeThread(invalid)).resolves.toEqual({ kind: "unavailable" });
    }
    for (const value of ["", "x\u0000", "x".repeat(513), "é".repeat(257)]) {
      await expect(gateway.putTask(key, value, "{}")).resolves.toEqual({
        kind: "rejected",
        reason: "invalidIdentifier",
      });
      await expect(gateway.removeServer(value)).resolves.toEqual({ kind: "unavailable" });
    }
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects invalid and oversized record strings before IPC", async () => {
    const { invokeCommand, gateway } = gatewayFor(null);
    for (const record of ["{", "[]", "null", "1", '"text"']) {
      await expect(gateway.putTask(key, "task", record)).resolves.toEqual({
        kind: "rejected",
        reason: "invalidRecord",
      });
    }
    for (const record of [
      recordWithBytes(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES + 1),
      JSON.stringify({ text: "é".repeat(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES / 2) }),
    ]) {
      await expect(gateway.putTask(key, "task", record)).resolves.toEqual({
        kind: "rejected",
        reason: "recordTooLarge",
      });
    }
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("accepts exact byte boundaries and unicode without changing records", async () => {
    const unicodeKey = { ...key, serverId: "é".repeat(256) };
    const record = recordWithBytes(MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES);
    const { invokeCommand, gateway } = gatewayFor({ kind: "stored" });
    await expect(gateway.putTask(unicodeKey, "task", record)).resolves.toEqual({ kind: "stored" });
    const records = [
      { taskId: "a", record },
      { taskId: "b", record },
    ];
    invokeCommand.mockResolvedValueOnce({ kind: "hit", records });
    await expect(gateway.loadThread(unicodeKey)).resolves.toEqual({ kind: "hit", records });
    const unicode = JSON.stringify({ text: "Žluťoučký kůň 🐴", empty: null });
    await expect(gateway.putTask(key, "task", unicode)).resolves.toEqual({ kind: "stored" });
    expect(invokeCommand.mock.calls[2]?.[1]).toEqual({
      request: { key, taskId: "task", record: unicode },
    });
  });
});
