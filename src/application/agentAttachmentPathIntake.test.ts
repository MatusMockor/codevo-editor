import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentAttachmentCandidateInspection } from "./agentAttachmentPorts";
import { describeAgentAttachmentSource } from "./agentAttachmentPathIntake";

const DIRECTORY: AgentAttachmentCandidateInspection = {
  bytes: 0,
  isRegularFile: false,
  isDirectory: true,
  extensionMime: null,
};

async function inspectPath({ path }: { path: string }) {
  try {
    const metadata = await lstat(path);
    return { ...DIRECTORY, isDirectory: metadata.isDirectory() };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

describe("attachment path intake", () => {
  it("resolves the terminal spelling of an actual Unicode directory without traversing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevo-path-intake-"));
    try {
      const directory = join(root, "codevo s.r.o.", "výdavky", "September");
      await mkdir(directory, { recursive: true });
      const inspect = vi.fn(inspectPath);
      const reportError = vi.fn();
      const result = await describeAgentAttachmentSource(
        { inspectAgentAttachmentCandidate: inspect },
        "workspace",
        { kind: "path", path: directory.replace("codevo ", "codevo\\ ") },
        () => true,
        reportError,
      );
      expect(result).toEqual({
        source: { kind: "path", path: directory },
        candidate: { name: "September", mime: "inode/directory", hasPath: true, bytes: 0 },
        entry: "directory",
      });
      expect(inspect).toHaveBeenCalledTimes(2);
      expect(reportError).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("keeps a real literal backslash path ahead of shell decoding and refuses symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevo-path-intake-"));
    try {
      const literal = join(root, "literal\\ folder.png");
      await mkdir(literal);
      await symlink(literal, join(root, "link"));
      const inspect = vi.fn(inspectPath);
      const gateway = { inspectAgentAttachmentCandidate: inspect };
      const result = await describeAgentAttachmentSource(
        gateway,
        "workspace",
        { kind: "path", path: literal },
        () => true,
        vi.fn(),
      );
      expect(result?.source).toEqual({ kind: "path", path: literal });
      expect(result?.candidate.mime).toBe("inode/directory");
      expect(result?.entry).toBe("directory");
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(
        await describeAgentAttachmentSource(
          gateway,
          "workspace",
          { kind: "path", path: join(root, "link") },
          () => true,
          vi.fn(),
        ),
      ).toBeNull();
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("does not try a decoded path after ownership is revoked during inspection", async () => {
    let current = true;
    const inspect = vi.fn(async () => {
      current = false;
      return null;
    });
    const reportError = vi.fn();
    const result = await describeAgentAttachmentSource(
      { inspectAgentAttachmentCandidate: inspect },
      "workspace",
      { kind: "path", path: "/tmp/codevo\\ folder" },
      () => current,
      reportError,
    );
    expect(result).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not redirect an existing unsupported path to a decoded path", async () => {
    const inspect = vi.fn(async () => ({ ...DIRECTORY, isDirectory: false }));
    const result = await describeAgentAttachmentSource(
      { inspectAgentAttachmentCandidate: inspect },
      "workspace",
      { kind: "path", path: "/tmp/codevo\\ folder" },
      () => true,
      vi.fn(),
    );
    expect(result).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("Permission denied"), new TypeError("Unknown result field")])(
    "does not redirect on an inspection failure: %s",
    async (error) => {
      const inspect = vi.fn(async () => {
        throw error;
      });
      const reportError = vi.fn();
      expect(
        await describeAgentAttachmentSource(
          { inspectAgentAttachmentCandidate: inspect },
          "workspace",
          { kind: "path", path: "/tmp/codevo\\ folder" },
          () => true,
          reportError,
        ),
      ).toBeNull();
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledExactlyOnceWith(error);
    },
  );
});
