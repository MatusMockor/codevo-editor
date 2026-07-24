import { describe, expect, it, vi } from "vitest";
import {
  invokeSymfonyWorkspaceIntelligenceIpc,
  SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS,
} from "./tauriSymfonyWorkspaceIntelligenceIpcContract";

describe("Symfony workspace intelligence IPC contract", () => {
  it("validates args and strictly decodes every result family", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands) {
        return {
          status: "ok",
          commands: [{ name: "cache:clear", description: "Clear cache", aliases: ["cc"] }],
          total: 1,
          truncated: false,
        };
      }
      if (command === SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.routes) {
        return {
          status: "ok",
          routes: [
            {
              name: "app_home",
              path: "/",
              methods: ["get"],
              controller: "App\\Controller\\HomeController::index",
            },
          ],
          total: 1,
          truncated: false,
        };
      }
      return {
        status: "ok",
        services: [{ id: "App\\Clock", className: "App\\Clock", alias: null, public: false }],
        total: 1,
        truncated: false,
      };
    });

    const commands = await invokeSymfonyWorkspaceIntelligenceIpc(
      invoke,
      SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands,
      { workspaceId: "workspace-1" },
    );
    const routes = await invokeSymfonyWorkspaceIntelligenceIpc(
      invoke,
      SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.routes,
      { workspaceId: "workspace-1" },
    );
    const services = await invokeSymfonyWorkspaceIntelligenceIpc(
      invoke,
      SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.services,
      { workspaceId: "workspace-1" },
    );

    expect(commands).toMatchObject({ status: "ok", total: 1, commands: [{ name: "cache:clear" }] });
    expect(routes).toMatchObject({ status: "ok", routes: [{ methods: ["GET"] }] });
    expect(services).toMatchObject({ status: "ok", services: [{ id: "App\\Clock" }] });
    expect(invoke).toHaveBeenNthCalledWith(1, "list_symfony_console_commands", {
      workspaceId: "workspace-1",
    });
  });

  it.each(["", " ", "bad\0id", "é".repeat(513)])(
    "rejects an invalid workspace id before invoking: %j",
    async (workspaceId) => {
      const invoke = vi.fn();
      await expect(
        invokeSymfonyWorkspaceIntelligenceIpc(
          invoke,
          SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands,
          { workspaceId },
        ),
      ).rejects.toThrow("Invalid Symfony workspace intelligence IPC value at args.workspaceId");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown, oversized, and cross-result response shapes", async () => {
    await expect(
      invokeSymfonyWorkspaceIntelligenceIpc(
        async () => ({ status: "ok", commands: [], total: 0, truncated: false, extra: true }),
        SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands,
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow();
    await expect(
      invokeSymfonyWorkspaceIntelligenceIpc(
        async () => ({ status: "ok", routes: [], total: 0, truncated: false }),
        SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands,
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow();
    await expect(
      invokeSymfonyWorkspaceIntelligenceIpc(
        async () => ({ status: "error", message: "x".repeat(4_097) }),
        SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.services,
        { workspaceId: "workspace-1" },
      ),
    ).rejects.toThrow();
  });
});
