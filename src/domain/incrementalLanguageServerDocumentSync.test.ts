import { describe, expect, it } from "vitest";
import {
  boundedDocumentSyncAuthority,
  boundedDocumentSyncIdentityAuthority,
  type BoundedLanguageServerDocumentAuthority,
} from "./incrementalLanguageServerDocumentSync";

describe("bounded document-sync authority", () => {
  const lease = {
    documentIncarnation: "document-a",
    modelIncarnation: "model-incarnation-a",
    ownerGeneration: 4,
    ownerIncarnation: "owner-a",
    ownerKey: "workspace-a",
    path: "/workspace/a.ts",
  };

  it("projects the closed identity used only for didOpen", () => {
    const authority = boundedDocumentSyncIdentityAuthority(lease, 9);

    expect(authority).toEqual({
      documentIncarnation: "document-a",
      modelIncarnation: "model-incarnation-a",
      ownerGeneration: 4,
      ownerIncarnation: "owner-a",
      ownerKey: "workspace-a",
      syncGeneration: 9,
    });
    expect(Object.keys(authority)).toEqual([
      "documentIncarnation",
      "modelIncarnation",
      "ownerGeneration",
      "ownerIncarnation",
      "ownerKey",
      "syncGeneration",
    ]);
    expect(authority).not.toHaveProperty("modelId");
    expect(authority).not.toHaveProperty("lifecycleToken");
    expect(authority).not.toHaveProperty("path");
    expect(Object.isFrozen(authority)).toBe(true);
  });

  it("adds the server-issued lifecycle token only after a successful open", () => {
    const authority = boundedDocumentSyncAuthority(lease, 9, "server-token-a");

    expect(authority).toEqual({
      documentIncarnation: "document-a",
      lifecycleToken: "server-token-a",
      modelIncarnation: "model-incarnation-a",
      ownerGeneration: 4,
      ownerIncarnation: "owner-a",
      ownerKey: "workspace-a",
      syncGeneration: 9,
    } satisfies BoundedLanguageServerDocumentAuthority);
    expect(Object.isFrozen(authority)).toBe(true);
  });
});
