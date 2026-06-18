import { describe, expect, it, vi } from "vitest";
import { TauriLanguageServerRuntimeGateway } from "./tauriLanguageServerRuntimeGateway";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS } from "./tauriLanguageServerRuntimeGateway";

type RuntimeGatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerRuntimeGateway
>;
type InvokeCommand = NonNullable<RuntimeGatewayConstructor[0]>;
type ListenToEvent = NonNullable<RuntimeGatewayConstructor[1]>;

describe("TauriLanguageServerRuntimeGateway", () => {
  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriLanguageServerRuntimeGateway(
      invokeCommand,
      listenToEvent,
      () => false,
    );

    await expect(gateway.getStatus("/workspace")).resolves.toEqual({
      kind: "stopped",
    });
    await expect(gateway.stop("/workspace")).resolves.toEqual({ kind: "stopped" });
    await expect(gateway.openLog("/workspace")).resolves.toBeNull();
    await expect(gateway.start("/workspace")).resolves.toEqual({
      kind: "crashed",
      message: "Language server requires the Tauri desktop runtime.",
    });

    const unsubscribe = await gateway.subscribeStatus(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates commands and status events inside Tauri", async () => {
    const running: LanguageServerRuntimeStatus = {
      kind: "running",
      sessionId: 1,
      capabilities: {
      callHierarchy: true,
        codeAction: true,
        codeLens: true,
        completion: true,
        definition: true,
        documentHighlight: true,
        documentLink: true,
        documentSymbol: true,
        foldingRange: true,
        formatting: true,
        hover: true,
        implementation: true,
        inlayHint: true,
        linkedEditingRange: true,
        onTypeFormatting: true,
        prepareRename: true,
        rangeFormatting: true,
        references: true,
        rename: true,
        selectionRange: true,
        semanticTokens: true,
        signatureHelp: true,
        typeDefinition: true,
        typeHierarchy: true,
        willRenameFiles: true,
        workspaceSymbol: true,
      },
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => running);
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({ payload: running });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriLanguageServerRuntimeGateway(
      invokeCommand,
      listenToEvent,
      () => true,
    );

    await expect(gateway.getStatus("/workspace")).resolves.toEqual(running);
    await expect(gateway.start("/workspace")).resolves.toEqual(running);
    await expect(gateway.stop("/workspace")).resolves.toEqual(running);
    await gateway.subscribeStatus(listener);

    expect(invokeCommand).toHaveBeenCalledWith("get_php_language_server_status", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_php_language_server", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("stop_php_language_server", {
      rootPath: "/workspace",
    });
    expect(listenToEvent).toHaveBeenCalledWith(
      "language-server://status",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(running);
  });

  it("passes TypeScript version preference to JavaScript and TypeScript start command", async () => {
    const running: LanguageServerRuntimeStatus = {
      capabilities: {
      callHierarchy: true,
        codeAction: false,
        codeLens: true,
        completion: true,
        definition: true,
        documentHighlight: true,
        documentLink: true,
        documentSymbol: true,
        foldingRange: true,
        formatting: false,
        hover: true,
        implementation: true,
        inlayHint: true,
        linkedEditingRange: true,
        onTypeFormatting: true,
        prepareRename: true,
        rangeFormatting: true,
        references: true,
        rename: true,
        selectionRange: true,
        semanticTokens: true,
        signatureHelp: true,
        typeDefinition: true,
        typeHierarchy: true,
        willRenameFiles: true,
        workspaceSymbol: true,
      },
      kind: "running",
      sessionId: 4,
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => running);
    const gateway = new TauriLanguageServerRuntimeGateway(
      invokeCommand,
      vi.fn<ListenToEvent>(),
      () => true,
      JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
    );

    await expect(
      gateway.start("/workspace", {
        autoImportsEnabled: false,
        codeLensEnabled: true,
        inlayHintsEnabled: false,
        typeScriptVersionPreference: "workspace",
        validationEnabled: false,
      }),
    ).resolves.toEqual(running);

    expect(invokeCommand).toHaveBeenCalledWith(
      "start_javascript_typescript_language_server",
      {
        autoImportsEnabled: false,
        codeLensEnabled: true,
        inlayHintsEnabled: false,
        rootPath: "/workspace",
        typeScriptVersionPreference: "workspace",
        validationEnabled: false,
      },
    );
  });

  it("opens JavaScript and TypeScript runtime log through its configured command", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command === "open_javascript_typescript_language_server_log") {
        return "/tmp/js-ts.log";
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const gateway = new TauriLanguageServerRuntimeGateway(
      invokeCommand,
      vi.fn<ListenToEvent>(),
      () => true,
      JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
    );

    await expect(gateway.openLog("/workspace")).resolves.toBe("/tmp/js-ts.log");

    expect(invokeCommand).toHaveBeenCalledWith(
      "open_javascript_typescript_language_server_log",
      {
        rootPath: "/workspace",
      },
    );
  });
});
