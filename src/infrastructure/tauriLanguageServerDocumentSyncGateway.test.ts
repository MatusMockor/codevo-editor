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

    await gateway.didOpen(document());
    await gateway.didChange(document());
    await gateway.didSave(document());
    await gateway.didClose("/project/src/User.php");

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates document sync commands inside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new TauriLanguageServerDocumentSyncGateway(
      invokeCommand,
      () => true,
    );
    const syncedDocument = document();

    await gateway.didOpen(syncedDocument);
    await gateway.didChange(syncedDocument);
    await gateway.didSave(syncedDocument);
    await gateway.didClose(syncedDocument.path);

    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_open", {
      document: syncedDocument,
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_change", {
      document: syncedDocument,
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_save", {
      document: syncedDocument,
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_did_close", {
      document: { path: "/project/src/User.php" },
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
