import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { defaultLargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import {
  attachStoredJavaScriptTypeScriptDocumentAuthority,
  isJavaScriptTypeScriptDocumentRequestAuthorityActive,
  isLargeJavaScriptTypeScriptProviderDocument,
  isStoredJavaScriptTypeScriptDocumentAuthorityActive,
  type JavaScriptTypeScriptDocumentAuthorityContext,
  type JavaScriptTypeScriptDocumentRequestAuthority,
} from "./javascriptTypescriptProviderDocumentAuthority";

function document(content = "const value = 1;"): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "value.ts",
    path: "/workspace/value.ts",
    savedContent: content,
  };
}

function model(
  overrides: Partial<Pick<Monaco.editor.ITextModel, "getLineCount" | "getValueLength">> = {},
): Monaco.editor.ITextModel {
  return {
    getLineCount: vi.fn(() => 1),
    getValueLength: vi.fn(() => 16),
    getVersionId: vi.fn(() => 7),
    ...overrides,
  } as unknown as Monaco.editor.ITextModel;
}

function authorityContext(
  activeModel: Monaco.editor.ITextModel,
  activeDocument = document(),
  getOwnerEpoch: () => number = () => 1,
): JavaScriptTypeScriptDocumentAuthorityContext {
  return {
    getActiveJavaScriptTypeScriptOwnerEpoch: getOwnerEpoch,
    getActiveDocument: () => activeDocument,
    getActiveModel: () => activeModel,
    getDocumentSyncVersion: () => 11,
    getLargeSmartDocumentPolicy: () => defaultLargeSmartDocumentPolicy,
  };
}

function request(
  activeModel: Monaco.editor.ITextModel,
): JavaScriptTypeScriptDocumentRequestAuthority {
  return {
    model: activeModel,
    modelVersion: 7,
    ownerEpoch: 1,
    path: "/workspace/value.ts",
    registrationLease: { active: true },
    rootPath: "/workspace",
    sessionId: 3,
    syncVersion: 11,
  };
}

describe("JavaScript/TypeScript provider document authority", () => {
  it("uses O(1) Monaco measurements instead of a separately updated document snapshot", () => {
    const activeModel = model();

    expect(
      isLargeJavaScriptTypeScriptProviderDocument(
        activeModel,
        document("x".repeat(defaultLargeSmartDocumentPolicy.characterLimit + 1)),
        defaultLargeSmartDocumentPolicy,
      ),
    ).toBe(false);
    expect(activeModel.getValueLength).toHaveBeenCalledOnce();
    expect(activeModel.getLineCount).toHaveBeenCalledOnce();
  });

  it("does not cache the document-content fallback used by incomplete test doubles", () => {
    const activeModel = {
      getVersionId: () => 7,
    } as unknown as Monaco.editor.ITextModel;

    expect(
      isLargeJavaScriptTypeScriptProviderDocument(
        activeModel,
        document(),
        defaultLargeSmartDocumentPolicy,
      ),
    ).toBe(false);
    expect(
      isLargeJavaScriptTypeScriptProviderDocument(
        activeModel,
        document("x".repeat(defaultLargeSmartDocumentPolicy.characterLimit + 1)),
        defaultLargeSmartDocumentPolicy,
      ),
    ).toBe(true);
  });

  it("keeps an A request stale after an unobserved B transition returns to identical A state", () => {
    const activeModel = model();
    const captured = request(activeModel);
    let ownerEpoch = 1;
    const context = authorityContext(activeModel, document(), () => ownerEpoch);

    expect(isJavaScriptTypeScriptDocumentRequestAuthorityActive(context, captured, true)).toBe(
      true,
    );
    ownerEpoch = 2;
    expect(isJavaScriptTypeScriptDocumentRequestAuthorityActive(context, captured, true)).toBe(
      false,
    );
    ownerEpoch = 3;
    expect(isJavaScriptTypeScriptDocumentRequestAuthorityActive(context, captured, true)).toBe(
      false,
    );
  });

  it("requires active root/session authority for legacy payloads without document metadata", () => {
    expect(
      isStoredJavaScriptTypeScriptDocumentAuthorityActive(
        authorityContext(model()),
        {},
        {
          path: "/workspace/value.ts",
          rootAndSessionActive: false,
          rootPath: "/workspace",
        },
      ),
    ).toBe(false);
  });

  it("propagates the exact owner epoch and registration lease to lazy payloads", () => {
    const activeModel = model();
    const captured = request(activeModel);
    const payload = attachStoredJavaScriptTypeScriptDocumentAuthority({}, captured);
    let ownerEpoch = 1;
    const context = authorityContext(activeModel, document(), () => ownerEpoch);
    const current = {
      path: captured.path,
      rootAndSessionActive: true,
      rootPath: captured.rootPath,
    };

    expect(isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, current)).toBe(
      true,
    );
    ownerEpoch = 2;
    expect(isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, current)).toBe(
      false,
    );
    ownerEpoch = 1;
    captured.registrationLease.active = false;
    expect(isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, current)).toBe(
      false,
    );
  });
});
