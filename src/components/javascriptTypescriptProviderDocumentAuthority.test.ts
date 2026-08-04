import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { defaultLargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import {
  attachStoredJavaScriptTypeScriptDocumentAuthority,
  isJavaScriptTypeScriptDocumentRequestAuthorityActive,
  isLargeJavaScriptTypeScriptProviderDocument,
  isStoredJavaScriptTypeScriptDocumentAuthorityActive,
  javaScriptTypeScriptProviderDocumentRequestAccess,
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
    access: "full",
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

  it("stores a closed non-enumerable request access tier and requires an explicit consumer", () => {
    const largeModel = model({
      getLineCount: vi.fn(() => 20_001),
      getValueLength: vi.fn(() => 200_000),
    });
    const interactiveRequest = {
      ...request(largeModel),
      access: "explicit-interactive" as const,
    };
    const payload = attachStoredJavaScriptTypeScriptDocumentAuthority({}, interactiveRequest);
    const context = authorityContext(largeModel, document("x\n".repeat(20_000)));
    const current = {
      path: interactiveRequest.path,
      rootAndSessionActive: true,
      rootPath: interactiveRequest.rootPath,
    };

    expect(Object.keys(payload)).not.toContain("__documentRequestAccess");
    expect(isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, current)).toBe(
      false,
    );
    expect(
      isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, {
        ...current,
        allowExplicitInteractive: true,
      }),
    ).toBe(true);
    Object.defineProperty(payload, "__documentRequestAccess", {
      configurable: true,
      value: "unknown",
    });
    expect(
      isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, {
        ...current,
        allowExplicitInteractive: true,
      }),
    ).toBe(false);
  });

  it("classifies policy-large metrics without reading content and denies beyond hard sync", () => {
    const getValue = vi.fn(() => {
      throw new Error("provider admission must stay O(1)");
    });
    const interactiveModel = {
      ...model({
        getLineCount: vi.fn(() => 20_001),
        getValueLength: vi.fn(() => 200_000),
      }),
      getValue,
    };
    const editingOnlyModel = model({
      getLineCount: vi.fn(() => 1),
      getValueLength: vi.fn(() => 2 * 1024 * 1024 + 1),
    });

    expect(
      javaScriptTypeScriptProviderDocumentRequestAccess(
        interactiveModel,
        document(),
        defaultLargeSmartDocumentPolicy,
      ),
    ).toBe("explicit-interactive");
    expect(getValue).not.toHaveBeenCalled();
    expect(
      javaScriptTypeScriptProviderDocumentRequestAccess(editingOnlyModel, document(), {
        characterLimit: 10 * 1024 * 1024,
        lineLimit: 200_000,
      }),
    ).toBeNull();
  });

  it("fails closed when exact O(1) model metrics are unavailable or throw", () => {
    const missingMetrics = {
      getVersionId: () => 7,
    } as unknown as Monaco.editor.ITextModel;
    const throwingMetrics = model({
      getLineCount: vi.fn(() => {
        throw new Error("disposed model");
      }),
    });

    expect(
      javaScriptTypeScriptProviderDocumentRequestAccess(
        missingMetrics,
        document(),
        defaultLargeSmartDocumentPolicy,
      ),
    ).toBeNull();
    expect(
      javaScriptTypeScriptProviderDocumentRequestAccess(
        throwingMetrics,
        document(),
        defaultLargeSmartDocumentPolicy,
      ),
    ).toBeNull();
  });
});
