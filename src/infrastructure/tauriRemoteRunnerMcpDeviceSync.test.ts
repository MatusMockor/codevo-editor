import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerMcpDeviceSyncRequest } from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { REMOTE_RUNNER_COMMANDS, TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const request: RemoteRunnerMcpDeviceSyncRequest = {
  serverId: "linux",
  runnerId: "runner-home",
  projectId: "codevo-editor",
  rootPath: "/Users/me/codevo-editor",
  projectKind: "git",
};
const answer = {
  version: 1,
  results: [{ name: "files", transport: "stdio", outcome: "added", hints: [] }],
  omitted: 0,
};
const descriptor = {
  protocolVersion: 1,
  runnerId: "runner-home",
  name: "Home",
  capabilities: { taskExecution: true, eventReplay: true },
};

describe("MCP device sync transport", () => {
  it("invokes the exact Tauri command with the closed request and returns the parsed report", async () => {
    const invoke = vi.fn().mockResolvedValue(answer);
    const report = await new TauriRemoteRunnerGateway(invoke).syncDeviceMcpServers(request);
    expect(report).toEqual(answer);
    expect(REMOTE_RUNNER_COMMANDS.syncDeviceMcpServers).toBe(
      "remote_runner_sync_device_mcp_servers",
    );
    expect(invoke.mock.calls).toEqual([["remote_runner_sync_device_mcp_servers", { request }]]);
    expect(Object.keys(invoke.mock.calls[0]![1].request)).toEqual([
      "serverId",
      "runnerId",
      "projectId",
      "rootPath",
      "projectKind",
    ]);
  });

  it.each([
    ["unknown field", { ...request, env: { TOKEN: "x" } }],
    ["relative root", { ...request, rootPath: "project" }],
    ["traversing root", { ...request, rootPath: "/Users/me/../other" }],
    ["unknown project kind", { ...request, projectKind: "repository" }],
    ["missing project kind", { ...request, projectKind: undefined }],
    ["invalid project id", { ...request, projectId: "../p" }],
  ])("rejects a request with %s before invoking", async (_label, invalid) => {
    const invoke = vi.fn();
    await expect(
      new TauriRemoteRunnerGateway(invoke).syncDeviceMcpServers(
        invalid as RemoteRunnerMcpDeviceSyncRequest,
      ),
    ).rejects.toBeInstanceOf(RemoteRunnerRequestRejectedError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown key", { ...answer, values: {} }],
    ["missing omitted", { version: 1, results: answer.results }],
    ["unknown outcome", { ...answer, results: [{ ...answer.results[0], outcome: "installed" }] }],
  ])("rejects a response with %s", async (_label, invalid) => {
    const invoke = vi.fn().mockResolvedValue(invalid);
    await expect(
      new TauriRemoteRunnerGateway(invoke).syncDeviceMcpServers(request),
    ).rejects.toThrow("Invalid remote runner syncDeviceMcpServers response.");
  });

  it("passes a bounded refusal from the native side through as the error", async () => {
    const invoke = vi.fn().mockRejectedValue("Too many local MCP servers to sync.");
    await expect(new TauriRemoteRunnerGateway(invoke).syncDeviceMcpServers(request)).rejects.toBe(
      "Too many local MCP servers to sync.",
    );
  });

  it.each([true, false, undefined])("accepts the optional mcpDeviceSync capability %s", (flag) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, mcpDeviceSync: flag },
      }),
    ).not.toThrow();
  });

  it.each([null, "true", 1])("rejects a malformed mcpDeviceSync capability %j", (flag) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, mcpDeviceSync: flag },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
});
