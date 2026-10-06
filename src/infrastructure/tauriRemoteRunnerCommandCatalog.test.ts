import { describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/agent-command-catalog-wire.json";
import type { RemoteRunnerCommandCatalogRequest } from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { REMOTE_RUNNER_COMMANDS, TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const claudeRequest = wireContract.remoteRequests[0].value as RemoteRunnerCommandCatalogRequest;
const codexRequest = wireContract.remoteRequests[1].value as RemoteRunnerCommandCatalogRequest;
const claudeCatalog = wireContract.catalogs[0].value;
const codexCatalog = wireContract.catalogs[1].value;
const descriptor = {
  protocolVersion: 1,
  runnerId: "runner-home",
  name: "Home",
  capabilities: { taskExecution: true, eventReplay: true },
};

describe("remote runner command catalog gateway", () => {
  it("names the tunnel command and capability the shared contract declares", () => {
    expect(REMOTE_RUNNER_COMMANDS.getCommandCatalog).toBe(wireContract.remoteIpcCommand);
    expect(wireContract.remoteRunnerCapability).toBe("commandCatalog");
  });

  it.each(wireContract.remoteRequests)(
    "accepts and sends exactly the $name request envelope",
    async ({ value }) => {
      const request = value as RemoteRunnerCommandCatalogRequest;
      const invoke = vi
        .fn()
        .mockResolvedValue(request.provider === "claude" ? claudeCatalog : codexCatalog);
      expect(() => validateRemoteRunnerValue("getCommandCatalog", "request", value)).not.toThrow();
      await new TauriRemoteRunnerGateway(invoke).getCommandCatalog(request);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_get_command_catalog", {
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
      expect(() => validateRemoteRunnerValue("getCommandCatalog", "request", value)).toThrow(
        "Invalid remote runner getCommandCatalog request.",
      );
      await expect(
        new TauriRemoteRunnerGateway(invoke).getCommandCatalog(
          value as RemoteRunnerCommandCatalogRequest,
        ),
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
    expect(() => validateRemoteRunnerValue("getCommandCatalog", "request", value)).toThrow();
  });

  it("returns the runner's catalog in the local wire shape", async () => {
    const invoke = vi.fn().mockResolvedValue(codexCatalog);
    expect(await new TauriRemoteRunnerGateway(invoke).getCommandCatalog(codexRequest)).toEqual(
      codexCatalog,
    );
  });

  it("rejects a valid catalog that answers for the other provider", async () => {
    const invoke = vi.fn().mockResolvedValue(codexCatalog);
    await expect(
      new TauriRemoteRunnerGateway(invoke).getCommandCatalog(claudeRequest),
    ).rejects.toThrow(TypeError);
    const swapped = vi.fn().mockResolvedValue(claudeCatalog);
    await expect(
      new TauriRemoteRunnerGateway(swapped).getCommandCatalog(codexRequest),
    ).rejects.toThrow(TypeError);
  });

  it.each(wireContract.rejectedCatalogs)(
    "fails closed for the $name runner body",
    async ({ value }) => {
      const invoke = vi.fn().mockResolvedValue(value);
      await expect(
        new TauriRemoteRunnerGateway(invoke).getCommandCatalog(claudeRequest),
      ).rejects.toThrow("Invalid remote runner getCommandCatalog response.");
    },
  );

  it.each([
    "The server runner does not support command catalogs. Update the runner on the server.",
    "Server connection changed during request",
    "Invalid runner command catalog",
    "Invalid runner identity",
  ])("passes the tunnel refusal %j through", async (message) => {
    const invoke = vi.fn().mockRejectedValue(message);
    await expect(
      new TauriRemoteRunnerGateway(invoke).getCommandCatalog(claudeRequest),
    ).rejects.toBe(message);
  });

  it.each([true, false, undefined])(
    "accepts a runner descriptor with command catalog capability %s",
    (commandCatalog) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: {
            ...descriptor.capabilities,
            ...(commandCatalog === undefined ? {} : { commandCatalog }),
          },
        }),
      ).not.toThrow();
    },
  );

  it.each([null, "true", 1, {}, []])(
    "rejects the invalid command catalog capability %j",
    (commandCatalog) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, commandCatalog },
        }),
      ).toThrow("Invalid remote runner getRunner response.");
    },
  );

  it("keeps rejecting unknown capabilities next to the new one", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, commandCatalog: true, commandCatalogs: true },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });

  it("accepts the full descriptor an updated runner announces", async () => {
    const announced = {
      ...descriptor,
      capabilities: { ...descriptor.capabilities, accountUsage: true, commandCatalog: true },
    };
    const invoke = vi.fn().mockResolvedValue(announced);
    expect(
      await new TauriRemoteRunnerGateway(invoke).getRunner({ serverId: claudeRequest.serverId }),
    ).toEqual(announced);
  });
});
