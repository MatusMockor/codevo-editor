import { describe, expect, it, vi } from "vitest";
import type { LanguageServerPlan } from "../domain/languageServer";
import { TauriLanguageServerGateway } from "./tauriLanguageServerGateway";

type GatewayConstructor = ConstructorParameters<typeof TauriLanguageServerGateway>;
type InvokeCommand = NonNullable<GatewayConstructor[0]>;

describe("TauriLanguageServerGateway", () => {
  it("passes PHP language server settings to the plan command", async () => {
    const plan: LanguageServerPlan = {
      command: null,
      initializeRequest: null,
      message: "Intelephense language server support is not available yet.",
      provider: "intelephense",
      status: "unavailable",
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => plan);
    const gateway = new TauriLanguageServerGateway(invokeCommand);

    await expect(
      gateway.planPhpLanguageServer("/workspace", {
        intelephensePath: "/tools/intelephense",
        phpBackend: "intelephense",
        phpactorPath: "/tools/phpactor",
      }),
    ).resolves.toEqual(plan);

    expect(invokeCommand).toHaveBeenCalledWith("plan_php_language_server", {
      intelephensePath: "/tools/intelephense",
      phpBackend: "intelephense",
      phpactorPath: "/tools/phpactor",
      rootPath: "/workspace",
    });
  });
});
