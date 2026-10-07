import { beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/agent-mcp-servers-wire.json";
import type { AgentMcpServersRequest } from "../domain/agentMcpServers";
import {
  GET_AGENT_MCP_SERVERS_IPC_COMMAND,
  TauriAgentMcpServersGateway,
} from "./tauriAgentMcpServersGateway";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const claude = wireContract.responses[0].value;
const codex = wireContract.responses[1].value;
const claudeRequest: AgentMcpServersRequest = {
  repositoryRoot: "/Users/dev/project",
  provider: "claudeCode",
};

describe("TauriAgentMcpServersGateway", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("names the IPC command the shared contract declares", () => {
    expect(GET_AGENT_MCP_SERVERS_IPC_COMMAND).toBe(wireContract.ipcCommand);
  });

  it.each(wireContract.requests)("sends exactly the $name request envelope", async ({ value }) => {
    invoke.mockResolvedValue({
      version: 1,
      provider: value.provider,
      truncated: false,
      servers: [],
    });
    await new TauriAgentMcpServersGateway().check(value as AgentMcpServersRequest);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get_agent_mcp_servers", { request: value });
    expect(Object.keys(invoke.mock.calls[0]?.[1].request)).toEqual(["repositoryRoot", "provider"]);
  });

  it("returns the validated servers for the requested provider", async () => {
    invoke.mockResolvedValue(claude);
    const servers = await new TauriAgentMcpServersGateway().check(claudeRequest);
    expect(servers).toEqual(claude);
    expect(Object.isFrozen(servers)).toBe(true);
  });

  it.each(wireContract.rejectedResponses)(
    "fails closed for the $name payload",
    async ({ value }) => {
      invoke.mockResolvedValue(value);
      await expect(new TauriAgentMcpServersGateway().check(claudeRequest)).rejects.toThrow(
        TypeError,
      );
    },
  );

  it.each([null, undefined, "connected", 7, []])(
    "fails closed for the malformed payload %j",
    async (value) => {
      invoke.mockResolvedValue(value);
      await expect(new TauriAgentMcpServersGateway().check(claudeRequest)).rejects.toThrow(
        TypeError,
      );
    },
  );

  it("rejects valid servers that answer for the other provider", async () => {
    invoke.mockResolvedValue(codex);
    await expect(new TauriAgentMcpServersGateway().check(claudeRequest)).rejects.toThrow(TypeError);
  });

  it.each(Object.values(wireContract.errors))(
    "passes the backend refusal %j through unchanged",
    async (refusal) => {
      invoke.mockRejectedValue(refusal);
      await expect(new TauriAgentMcpServersGateway().check(claudeRequest)).rejects.toBe(refusal);
    },
  );

  it.each(wireContract.rejectedRequests)(
    "refuses the $name request before any IPC",
    async ({ value }) => {
      await expect(
        new TauriAgentMcpServersGateway().check(value as AgentMcpServersRequest),
      ).rejects.toThrow(TypeError);
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});
