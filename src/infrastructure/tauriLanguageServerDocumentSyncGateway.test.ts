import { describe, expect, it, vi } from "vitest";
import { TauriLanguageServerDocumentSyncGateway } from "./tauriLanguageServerDocumentSyncGateway";
import type { LanguageServerTextDocument } from "../domain/languageServerDocumentSync";

type SyncGatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerDocumentSyncGateway
>;
type InvokeCommand = NonNullable<SyncGatewayConstructor[0]>;

describe("TauriLanguageServerDocumentSyncGateway", () => {
  it("does not invoke commands outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriLanguageServerDocumentSyncGateway(
      invokeCommand,
      () => false,
    );

    await gateway.didOpen("/project", document());
    await gateway.didChange("/project", document());
    await gateway.didSave("/project", document());
    await gateway.didClose("/project", "/project/src/User.php");

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates document sync commands inside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new TauriLanguageServerDocumentSyncGateway(
      invokeCommand,
      () => true,
    );
    const syncedDocument = document();

    await gateway.didOpen("/project", syncedDocument);
    await gateway.didChange("/project", syncedDocument);
    await gateway.didSave("/project", syncedDocument);
    await gateway.didClose("/project", syncedDocument.path);

    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_open", {
      document: syncedDocument,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_change", {
      document: syncedDocument,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_save", {
      document: syncedDocument,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_close", {
      document: { path: "/project/src/User.php" },
      rootPath: "/project",
    });
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
