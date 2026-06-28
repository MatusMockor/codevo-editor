import { describe, expect, it, vi } from "vitest";
import {
  shouldApplyClassEditAfterWrite,
  writeExtractedInterfaceFile,
} from "./phpExtractInterfaceWrite";

const PATH = "/workspace/app/Services/GreeterInterface.php";
const CONTENT = "<?php\n\ninterface GreeterInterface\n{\n}\n";

describe("writeExtractedInterfaceFile", () => {
  it("writes the interface and reports `written` when the target is absent", async () => {
    const writeFile = vi.fn(async () => undefined);
    const result = await writeExtractedInterfaceFile(PATH, CONTENT, {
      fileExists: async () => false,
      writeFile,
    });

    expect(result).toEqual({ status: "written" });
    expect(writeFile).toHaveBeenCalledWith(PATH, CONTENT);
  });

  it("does NOT write and reports `target-exists` when the target already exists", async () => {
    const writeFile = vi.fn(async () => undefined);
    const result = await writeExtractedInterfaceFile(PATH, CONTENT, {
      fileExists: async () => true,
      writeFile,
    });

    expect(result).toEqual({ status: "target-exists" });
    // No partial work: the interface file is never (over)written.
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("reports `write-failed` and preserves the error when the write throws", async () => {
    const failure = new Error("File exists (os error 17)");
    const writeFile = vi.fn(async () => {
      throw failure;
    });
    const result = await writeExtractedInterfaceFile(PATH, CONTENT, {
      fileExists: async () => false,
      writeFile,
    });

    expect(result).toEqual({ error: failure, status: "write-failed" });
  });

  it("reports `write-failed` when the existence probe itself throws", async () => {
    const failure = new Error("EACCES");
    const writeFile = vi.fn(async () => undefined);
    const result = await writeExtractedInterfaceFile(PATH, CONTENT, {
      fileExists: async () => {
        throw failure;
      },
      writeFile,
    });

    expect(result).toEqual({ error: failure, status: "write-failed" });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("checks existence BEFORE writing (no overwrite race)", async () => {
    const calls: string[] = [];
    await writeExtractedInterfaceFile(PATH, CONTENT, {
      fileExists: async () => {
        calls.push("exists");
        return false;
      },
      writeFile: async () => {
        calls.push("write");
      },
    });

    expect(calls).toEqual(["exists", "write"]);
  });
});

describe("shouldApplyClassEditAfterWrite", () => {
  it("applies the class edit ONLY after a successful write", () => {
    expect(shouldApplyClassEditAfterWrite({ status: "written" })).toBe(true);
  });

  it("never applies the class edit when the target already exists", () => {
    expect(shouldApplyClassEditAfterWrite({ status: "target-exists" })).toBe(
      false,
    );
  });

  it("never applies the class edit when the write failed", () => {
    expect(
      shouldApplyClassEditAfterWrite({
        error: new Error("boom"),
        status: "write-failed",
      }),
    ).toBe(false);
  });
});
