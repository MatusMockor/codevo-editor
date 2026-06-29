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

  it("passes JavaScript and TypeScript plan settings to the plan command", async () => {
    const plan: LanguageServerPlan = {
      command: null,
      initializeRequest: null,
      message: "TypeScript language server is ready to start.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => plan);
    const gateway = new TauriLanguageServerGateway(invokeCommand);

    await expect(
      gateway.planJavaScriptTypeScriptLanguageServer("/workspace", {
        autoImportsEnabled: false,
        automaticTypeAcquisitionEnabled: true,
        codeLensEnabled: true,
        inlayHintsEnabled: false,
        typeScriptVersionPreference: "workspace",
        validationEnabled: false,
      }),
    ).resolves.toEqual(plan);

    expect(invokeCommand).toHaveBeenCalledWith(
      "plan_javascript_typescript_language_server",
      {
        autoImportsEnabled: false,
        automaticTypeAcquisitionEnabled: true,
        codeLensEnabled: true,
        inlayHintsEnabled: false,
        rootPath: "/workspace",
        typeScriptVersionPreference: "workspace",
        validationEnabled: false,
      },
    );
  });
});
