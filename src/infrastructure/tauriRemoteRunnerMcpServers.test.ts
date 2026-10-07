import { describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/agent-mcp-servers-wire.json";
import { parseAgentMcpServers } from "../domain/agentMcpServers";
import type { RemoteRunnerMcpServersRequest } from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { REMOTE_RUNNER_COMMANDS, TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const claudeRequest = wireContract.remoteRequests[0].value as RemoteRunnerMcpServersRequest;
const codexRequest = wireContract.remoteRequests[1].value as RemoteRunnerMcpServersRequest;
const claudeServers = wireContract.responses[0].value;
const codexServers = wireContract.responses[1].value;
const descriptor = {
  protocolVersion: 1,
  runnerId: "runner-home",
  name: "Home",
  capabilities: { taskExecution: true, eventReplay: true },
};

describe("remote runner MCP servers gateway", () => {
  it("names the tunnel command the shared contract declares", () => {
    expect(REMOTE_RUNNER_COMMANDS.getMcpServers).toBe(wireContract.remoteIpcCommand);
    expect(wireContract.remoteIpcCommand).toBe("remote_runner_get_mcp_servers");
  });

  it.each(wireContract.remoteRequests)(
    "accepts and sends exactly the $name request envelope",
    async ({ value }) => {
      const request = value as RemoteRunnerMcpServersRequest;
      const invoke = vi
        .fn()
        .mockResolvedValue(request.provider === "claude" ? claudeServers : codexServers);
      await new TauriRemoteRunnerGateway(invoke).getMcpServers(request);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_get_mcp_servers", {
        request: value,
      });
      expect(Object.keys(invoke.mock.calls[0]?.[1].request)).toEqual([
        "serverId",
        "runnerId",
        "projectId",
        "provider",
      ]);
    },
  );

  it.each(wireContract.rejectedRemoteRequests)(
    "rejects the $name request before any IPC",
    async ({ value }) => {
      const invoke = vi.fn();
      expect(() => validateRemoteRunnerValue("getMcpServers", "request", value)).toThrow(
        "Invalid remote runner getMcpServers request.",
      );
      await expect(
        new TauriRemoteRunnerGateway(invoke).getMcpServers(value as RemoteRunnerMcpServersRequest),
      ).rejects.toThrow(RemoteRunnerRequestRejectedError);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a control character in the runner id", { ...claudeRequest, runnerId: "runner\u0000" }],
    ["an over-long runner id", { ...claudeRequest, runnerId: "r".repeat(129) }],
    ["a server id with a path", { ...claudeRequest, serverId: "a/b" }],
    ["a missing project id", { ...claudeRequest, projectId: undefined }],
  ])("rejects %s", (_name, value) => {
    expect(() => validateRemoteRunnerValue("getMcpServers", "request", value)).toThrow();
  });

  it.each(wireContract.responses)(
    "returns the $name answer parsed into the closed local shape",
    async ({ value }) => {
      const request = value.provider === "claudeCode" ? claudeRequest : codexRequest;
      const invoke = vi.fn().mockResolvedValue(value);
      const servers = await new TauriRemoteRunnerGateway(invoke).getMcpServers(request);
      expect(servers).toEqual(parseAgentMcpServers(value));
      expect(Object.isFrozen(servers)).toBe(true);
      expect(Object.isFrozen(servers.servers)).toBe(true);
    },
  );

  it("rejects a valid answer that is for the other provider", async () => {
    const invoke = vi.fn().mockResolvedValue(codexServers);
    await expect(new TauriRemoteRunnerGateway(invoke).getMcpServers(claudeRequest)).rejects.toThrow(
      TypeError,
    );
    const swapped = vi.fn().mockResolvedValue(claudeServers);
    await expect(new TauriRemoteRunnerGateway(swapped).getMcpServers(codexRequest)).rejects.toThrow(
      TypeError,
    );
  });

  it.each([...wireContract.rejectedResponses, ...wireContract.remoteRunnerResponses.slice(0, 1)])(
    "fails closed for the $name answer",
    async ({ value }) => {
      const invoke = vi.fn().mockResolvedValue(value);
      await expect(
        new TauriRemoteRunnerGateway(invoke).getMcpServers(claudeRequest),
      ).rejects.toThrow("Invalid remote runner getMcpServers response.");
    },
  );

  it.each([null, undefined, "servers", 7, []])(
    "fails closed for the malformed answer %j",
    async (value) => {
      const invoke = vi.fn().mockResolvedValue(value);
      await expect(
        new TauriRemoteRunnerGateway(invoke).getMcpServers(codexRequest),
      ).rejects.toThrow("Invalid remote runner getMcpServers response.");
    },
  );

  it.each([wireContract.errors.unsupportedRunner, wireContract.errors.serverUnavailable])(
    "passes the tunnel refusal %j through",
    async (message) => {
      const invoke = vi.fn().mockRejectedValue(message);
      await expect(new TauriRemoteRunnerGateway(invoke).getMcpServers(claudeRequest)).rejects.toBe(
        message,
      );
    },
  );

  it.each([true, false, undefined])(
    "accepts a runner descriptor with MCP servers capability %s",
    (mcpServers) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: {
            ...descriptor.capabilities,
            ...(mcpServers === undefined ? {} : { mcpServers }),
          },
        }),
      ).not.toThrow();
    },
  );

  it.each([null, "true", 1, {}, []])(
    "rejects the invalid MCP servers capability %j",
    (mcpServers) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, mcpServers },
        }),
      ).toThrow("Invalid remote runner getRunner response.");
    },
  );

  it("keeps rejecting unknown capabilities next to the new one", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, mcpServers: true, mcpServer: true },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });

  it("accepts the full descriptor an updated runner announces", async () => {
    const announced = {
      ...descriptor,
      capabilities: { ...descriptor.capabilities, commandCatalog: true, mcpServers: true },
    };
    const invoke = vi.fn().mockResolvedValue(announced);
    expect(
      await new TauriRemoteRunnerGateway(invoke).getRunner({ serverId: claudeRequest.serverId }),
    ).toEqual(announced);
  });
});
