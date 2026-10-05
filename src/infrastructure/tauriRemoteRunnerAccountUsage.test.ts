import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

const request = { serverId: "server-a", runnerId: "runner-a", provider: "codex" as const };
const snapshot = {
  provider: "codex",
  fetchedAtEpochMs: 123,
  windows: [
    {
      id: "codex-primary",
      label: "5-hour limit",
      usedPercent: 12,
      windowDurationMinutes: 300,
      resetsAtEpochMs: 456,
      resetsLabel: null,
    },
  ],
};

describe("remote runner account usage gateway", () => {
  it("uses the exact selected server and runner", async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot);
    expect(await new TauriRemoteRunnerGateway(invoke).getAccountUsage(request)).toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("remote_runner_get_account_usage", { request });
  });
  it.each([
    { ...request, provider: "openai" },
    { ...request, runnerId: "" },
    { ...request, command: "id" },
  ])("rejects invalid or executable request before IPC", async (invalid) => {
    const invoke = vi.fn();
    await expect(
      new TauriRemoteRunnerGateway(invoke).getAccountUsage(invalid as typeof request),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects another provider's usage snapshot", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...snapshot, provider: "claudeCode" });
    await expect(new TauriRemoteRunnerGateway(invoke).getAccountUsage(request)).rejects.toThrow();
  });
  it("rejects extra snapshot fields", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...snapshot, credentials: "private" });
    await expect(new TauriRemoteRunnerGateway(invoke).getAccountUsage(request)).rejects.toThrow();
  });
  it.each([true, false, undefined])(
    "accepts optional account usage capability %s",
    (accountUsage) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          protocolVersion: 1,
          runnerId: "runner-a",
          name: "Server",
          capabilities: {
            taskExecution: true,
            eventReplay: true,
            ...(accountUsage === undefined ? {} : { accountUsage }),
          },
        }),
      ).not.toThrow();
    },
  );
  it.each([null, "true", 1])("rejects invalid account usage capability %j", (accountUsage) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        protocolVersion: 1,
        runnerId: "runner-a",
        name: "Server",
        capabilities: { taskExecution: true, eventReplay: true, accountUsage },
      }),
    ).toThrow();
  });
});
