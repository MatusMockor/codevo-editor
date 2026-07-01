import { describe, expect, it } from "vitest";
import { isJavaScriptTypeScriptWatchedPath } from "./javascriptTypeScriptWatchedFiles";

describe("javascriptTypeScriptWatchedFiles", () => {
  it("accepts JavaScript, TypeScript and project graph JSON files", () => {
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/src/App.ts")).toBe(true);
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/src/App.tsx")).toBe(true);
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/src/server.mts")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/src/server.cjs")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/package.json")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/tsconfig.json")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/jsconfig.json")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/package-lock.json")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/pnpm-lock.yaml")).toBe(
      true,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/yarn.lock")).toBe(true);
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/bun.lockb")).toBe(true);
  });

  it("rejects files that do not affect the TypeScript project graph", () => {
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/app/Controller.php")).toBe(
      false,
    );
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/README.md")).toBe(false);
    expect(isJavaScriptTypeScriptWatchedPath("/workspace/src/Makefile")).toBe(
      false,
    );
  });
});
