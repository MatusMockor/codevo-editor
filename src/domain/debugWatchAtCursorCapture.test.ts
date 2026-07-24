import { describe, expect, it } from "vitest";
import {
  debugWatchAtCursorCapturesEqual,
  isDebugWatchAtCursorDocumentPath,
  type DebugWatchAtCursorCapture,
} from "./debugWatchAtCursorCapture";

const capture: DebugWatchAtCursorCapture = {
  content: "user.profile.name",
  documentPath: "/workspace/src/app.ts",
  modelIdentity: "model-1",
  modelVersion: 7,
  position: { column: 14, lineNumber: 1 },
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

describe("debug watch at cursor capture", () => {
  it("matches only an exact immutable editor snapshot", () => {
    expect(debugWatchAtCursorCapturesEqual(capture, { ...capture })).toBe(true);

    for (const changed of [
      { ...capture, content: `${capture.content} ` },
      { ...capture, documentPath: "/workspace/src/other.ts" },
      { ...capture, modelIdentity: "model-2" },
      { ...capture, modelVersion: 8 },
      { ...capture, position: { ...capture.position, column: 15 } },
      { ...capture, workspaceOwnerKey: "owner-b" },
      { ...capture, workspaceRoot: "/workspace-b" },
    ]) {
      expect(debugWatchAtCursorCapturesEqual(capture, changed)).toBe(false);
    }
  });

  it.each(["app.js", "view.jsx", "worker.mjs", "tool.cjs", "app.ts", "view.tsx", "types.d.ts"])(
    "accepts the JavaScript/TypeScript source path %s",
    (path) => expect(isDebugWatchAtCursorDocumentPath(`/workspace/src/${path}`)).toBe(true),
  );

  it.each(["Controller.php", "package.json", "script.py", "app.ts.txt"])(
    "rejects the non-JavaScript/TypeScript path %s",
    (path) => expect(isDebugWatchAtCursorDocumentPath(`/workspace/src/${path}`)).toBe(false),
  );
});
