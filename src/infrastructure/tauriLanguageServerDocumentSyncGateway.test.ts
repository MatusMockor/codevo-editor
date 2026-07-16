import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  TauriLanguageServerDocumentSyncGateway,
  TauriSessionBoundLanguageServerDocumentSyncGateway,
} from "./tauriLanguageServerDocumentSyncGateway";
import {
  sessionBoundLanguageServerDocumentSyncGateway,
  type LanguageServerTextDocument,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";

type SyncGatewayConstructor = ConstructorParameters<
  typeof TauriSessionBoundLanguageServerDocumentSyncGateway
>;
type InvokeCommand = NonNullable<SyncGatewayConstructor[0]>;

describe("TauriSessionBoundLanguageServerDocumentSyncGateway", () => {
  it("does not invoke commands outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriSessionBoundLanguageServerDocumentSyncGateway(
      invokeCommand,
      () => false,
    );

    await gateway.didOpen("/project", document(), 7);
    await gateway.didChange("/project", document(), 7);
    await gateway.didSave("/project", document(), 7);
    await gateway.didClose("/project", "/project/src/User.php", 7);

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates document sync commands inside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new TauriSessionBoundLanguageServerDocumentSyncGateway(
      invokeCommand,
      () => true,
    );
    const syncedDocument = document();

    await gateway.didOpen("/project", syncedDocument, 7);
    await gateway.didChange("/project", syncedDocument, 7);
    await gateway.didSave("/project", syncedDocument, 7);
    await gateway.didClose("/project", syncedDocument.path, 7);

    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_open", {
      document: syncedDocument,
      expectedSessionId: 7,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_change", {
      document: syncedDocument,
      expectedSessionId: 7,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_save", {
      document: syncedDocument,
      expectedSessionId: 7,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_close", {
      document: { path: "/project/src/User.php" },
      expectedSessionId: 7,
      rootPath: "/project",
    });
    expect(gateway[sessionBoundLanguageServerDocumentSyncGateway]).toBe(true);
    expectTypeOf(gateway).toMatchTypeOf<SessionBoundLanguageServerDocumentSyncGateway>();
  });

  it("requires a session identity in the PHP method contract", () => {
    const gateway = new TauriSessionBoundLanguageServerDocumentSyncGateway();

    expectTypeOf(gateway.didOpen).parameters.toEqualTypeOf<
      [string, LanguageServerTextDocument, number]
    >();
    if (false) {
      // @ts-expect-error PHP document sync must always carry a session identity.
      void gateway.didOpen("/project", document());
    }
  });
});

describe("TauriLanguageServerDocumentSyncGateway", () => {
  it("delegates JavaScript and TypeScript document sync with the requested workspace root", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new TauriLanguageServerDocumentSyncGateway(
      invokeCommand,
      () => true,
    );
    const syncedDocument: LanguageServerTextDocument = {
      languageId: "typescript",
      path: "/workspace-a/src/App.ts",
      text: "export const app = true;\n",
      version: 3,
    };

    await gateway.didOpen("/workspace-a", syncedDocument);
    await gateway.didChange("/workspace-a", syncedDocument);
    await gateway.didSave("/workspace-a", syncedDocument);
    await gateway.didClose("/workspace-a", syncedDocument.path);

    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_document_did_open",
      {
        document: syncedDocument,
        rootPath: "/workspace-a",
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_document_did_change",
      {
        document: syncedDocument,
        rootPath: "/workspace-a",
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_document_did_save",
      {
        document: syncedDocument,
        rootPath: "/workspace-a",
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_document_did_close",
      {
        document: { path: "/workspace-a/src/App.ts" },
        rootPath: "/workspace-a",
      },
    );
  });

  it("does not expose legacy command selection", () => {
    if (false) {
      // @ts-expect-error Legacy sync cannot be configured with PHP commands.
      void new TauriLanguageServerDocumentSyncGateway(undefined, undefined, {
        didChange: "text_document_did_change",
        didClose: "text_document_did_close",
        didOpen: "text_document_did_open",
        didSave: "text_document_did_save",
      });
    }
  });

  it("cannot be redirected to PHP commands by a subclass", async () => {
    class AdversarialGateway extends TauriLanguageServerDocumentSyncGateway {
      redirectAtCompileTime(): void {
        // @ts-expect-error Concrete gateways expose no mutable command storage.
        this.commands.didOpen = "text_document_did_open";
      }
    }

    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new AdversarialGateway(invokeCommand, () => true);
    Object.assign(gateway, {
      commands: { didOpen: "text_document_did_open" },
    });

    await gateway.didOpen("/workspace-a", document());

    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_document_did_open",
      {
        document: document(),
        rootPath: "/workspace-a",
      },
    );
    expect(invokeCommand).not.toHaveBeenCalledWith(
      "text_document_did_open",
      expect.anything(),
    );
  });
});

function document(): LanguageServerTextDocument {
  return {
    languageId: "php",
    path: "/project/src/User.php",
    text: "<?php echo 1;",
    version: 2,
  };
}
