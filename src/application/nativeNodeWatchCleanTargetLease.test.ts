import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createNativeNodeWatchCleanTargetLease } from "./nativeNodeWatchCleanTargetLease";

const PATH = "/workspace/server.js";

function document(path = PATH, content = "saved", savedContent = content): EditorDocument {
  return {
    path,
    name: "server.js",
    content,
    savedContent,
    language: "javascript",
    revision: {
      device: "1",
      inode: "2",
      size: savedContent.length,
      modifiedSeconds: 3,
      modifiedNanoseconds: 0,
      contentHash: "sha256:saved",
    },
  };
}

describe("native Node watch clean target lease", () => {
  it("admits an exact clean snapshot and rejects a dirty target", () => {
    const clean = document();
    expect(createNativeNodeWatchCleanTargetLease(PATH, clean, [clean])).not.toBeNull();
    expect(createNativeNodeWatchCleanTargetLease(PATH, document(PATH, "edited", "saved"), [])).toBe(
      null,
    );
  });

  it("invalidates when the target is edited while backend start is pending", () => {
    const clean = document();
    const lease = createNativeNodeWatchCleanTargetLease(PATH, clean, [clean]);
    expect(lease).not.toBeNull();

    const dirty = document(PATH, "edited", "saved");
    expect(lease?.isCurrent(dirty, [dirty])).toBe(false);
  });

  it("invalidates when the saved target revision changes during admission", () => {
    const clean = document();
    const lease = createNativeNodeWatchCleanTargetLease(PATH, clean, [clean]);
    const replaced = {
      ...clean,
      content: "replacement",
      savedContent: "replacement",
      revision: { ...clean.revision!, modifiedNanoseconds: 4, size: 11 },
    };

    expect(lease?.isCurrent(replaced, [replaced])).toBe(false);
  });

  it("fails closed for case and filesystem-identity aliases of the target", () => {
    const clean = document();
    const caseAlias = document("/workspace/Server.js");
    expect(createNativeNodeWatchCleanTargetLease(PATH, clean, [clean, caseAlias])).toBeNull();

    const symlinkAlias = document("/workspace/linked-server.js");
    expect(createNativeNodeWatchCleanTargetLease(PATH, clean, [clean, symlinkAlias])).toBeNull();
  });

  it("fails closed when only a filesystem alias of the target is open", () => {
    const alias = document("/workspace/linked-server.js");

    expect(createNativeNodeWatchCleanTargetLease(PATH, alias, [alias])).toBeNull();
  });

  it("keeps an exact lease stale after the target is saved during admission", () => {
    const clean = document();
    const lease = createNativeNodeWatchCleanTargetLease(PATH, clean, [clean]);
    const savedDuringAdmission = {
      ...clean,
      content: "saved during admission",
      savedContent: "saved during admission",
      revision: {
        ...clean.revision!,
        size: "saved during admission".length,
        modifiedNanoseconds: 1,
        contentHash: "sha256:saved-during-admission",
      },
    };

    expect(lease?.isCurrent(savedDuringAdmission, [savedDuringAdmission])).toBe(false);
  });
});
