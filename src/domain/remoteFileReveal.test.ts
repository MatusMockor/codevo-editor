import { describe, expect, it } from "vitest";
import {
  remoteFileContentOutcome,
  remoteFileParentPath,
  remoteFileReadFailureOutcome,
} from "./remoteFileReveal";
import {
  RemoteSurfaceNotFoundError,
  RemoteSurfaceNotRegularFileError,
} from "./remoteRunnerSurfaces";

describe("remote file reveal policy", () => {
  it.each([
    ["src/app.ts", "src"],
    ["a/b/c.ts", "a/b"],
    ["README.md", ""],
  ])("lists the parent of %s", (path, parent) => {
    expect(remoteFileParentPath(path)).toBe(parent);
  });

  it("treats binary and large server files as unreadable text", () => {
    const file = { path: "a.png", text: "", version: null };
    expect(remoteFileContentOutcome({ ...file, unavailableReason: "binary" })).toBe("unreadable");
    expect(remoteFileContentOutcome({ ...file, unavailableReason: "large" })).toBe("unreadable");
    expect(
      remoteFileContentOutcome({
        ...file,
        text: "x",
        version: "a".repeat(64),
        unavailableReason: null,
      }),
    ).toBe("opened");
  });

  it("classifies only typed not-found reads as missing files", () => {
    expect(remoteFileReadFailureOutcome(new RemoteSurfaceNotFoundError("gone"))).toBe("notFound");
    expect(remoteFileReadFailureOutcome(new RemoteSurfaceNotRegularFileError("dir"))).toBe(
      "notRegularFile",
    );
    expect(remoteFileReadFailureOutcome(new Error("Runner request failed (HTTP 404)."))).toBe(
      "failed",
    );
    expect(remoteFileReadFailureOutcome("boom")).toBe("failed");
  });
});
