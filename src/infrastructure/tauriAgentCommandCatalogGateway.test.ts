import { beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/agent-command-catalog-wire.json";
import type { AgentCommandCatalogRequest } from "../domain/agentCommandCatalog";
import {
  GET_AGENT_COMMAND_CATALOG_IPC_COMMAND,
  TauriAgentCommandCatalogGateway,
} from "./tauriAgentCommandCatalogGateway";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const claude = wireContract.catalogs[0].value;
const codex = wireContract.catalogs[1].value;
const claudeRequest: AgentCommandCatalogRequest = {
  repositoryRoot: "/Users/dev/project",
  provider: "claudeCode",
};

describe("TauriAgentCommandCatalogGateway", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("names the IPC command the shared contract declares", () => {
    expect(GET_AGENT_COMMAND_CATALOG_IPC_COMMAND).toBe(wireContract.ipcCommand);
  });

  it.each(wireContract.requests)("sends exactly the $name request envelope", async ({ value }) => {
    invoke.mockResolvedValue({
      version: 1,
      provider: value.provider,
      truncated: false,
      entries: [],
    });
    await new TauriAgentCommandCatalogGateway().read(value as AgentCommandCatalogRequest);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get_agent_command_catalog", {
      request: value,
    });
    expect(Object.keys(invoke.mock.calls[0]?.[1].request)).toEqual(["repositoryRoot", "provider"]);
  });

  it("returns the validated catalog for the requested provider", async () => {
    invoke.mockResolvedValue(claude);
    const catalog = await new TauriAgentCommandCatalogGateway().read(claudeRequest);
    expect(catalog).toEqual(claude);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it.each(wireContract.rejectedCatalogs)(
    "fails closed for the $name payload",
    async ({ value }) => {
      invoke.mockResolvedValue(value);
      await expect(new TauriAgentCommandCatalogGateway().read(claudeRequest)).rejects.toThrow(
        TypeError,
      );
    },
  );

  it("rejects a valid catalog that answers for the other provider", async () => {
    invoke.mockResolvedValue(codex);
    await expect(new TauriAgentCommandCatalogGateway().read(claudeRequest)).rejects.toThrow(
      TypeError,
    );
  });

  it("passes a backend refusal through", async () => {
    invoke.mockRejectedValue("workspace is not trusted");
    await expect(new TauriAgentCommandCatalogGateway().read(claudeRequest)).rejects.toBe(
      "workspace is not trusted",
    );
  });

  it.each(wireContract.rejectedRequests)(
    "refuses the $name request before any IPC",
    async ({ value }) => {
      await expect(
        new TauriAgentCommandCatalogGateway().read(value as AgentCommandCatalogRequest),
      ).rejects.toThrow(TypeError);
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});
