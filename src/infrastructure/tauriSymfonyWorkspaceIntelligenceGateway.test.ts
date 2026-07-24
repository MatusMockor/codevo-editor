import { describe, expect, it, vi } from "vitest";
import { TauriSymfonyWorkspaceIntelligenceGateway } from "./tauriSymfonyWorkspaceIntelligenceGateway";

describe("TauriSymfonyWorkspaceIntelligenceGateway", () => {
  it("routes all application operations through the typed contract", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command.includes("console")) {
        return { status: "ok", commands: [], total: 0, truncated: false };
      }
      if (command.includes("routes")) {
        return { status: "unavailable", message: "router unavailable" };
      }
      return { status: "ok", services: [], total: 0, truncated: false };
    });
    const gateway = new TauriSymfonyWorkspaceIntelligenceGateway(invoke);

    await expect(gateway.listSymfonyConsoleCommands("workspace-1")).resolves.toMatchObject({
      status: "ok",
    });
    await expect(gateway.listSymfonyRoutes("workspace-1")).resolves.toEqual({
      status: "unavailable",
      message: "router unavailable",
    });
    await expect(gateway.listSymfonyServices("workspace-1")).resolves.toMatchObject({
      status: "ok",
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "list_symfony_console_commands",
      "list_symfony_routes",
      "list_symfony_services",
    ]);
  });
});
