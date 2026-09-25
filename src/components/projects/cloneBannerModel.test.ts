import { describe, expect, it } from "vitest";
import { cloneBannerModel, clonePlaceholder } from "./cloneBannerModel";

const source = { host: "github.com", path: "acme/web-dashboard" };
const base = {
  status: "running",
  name: "web-dashboard",
  error: null,
  environment: "local" as const,
  projectReady: false,
  canRetry: true,
  detail: {
    progress: {
      phase: "receiving" as const,
      percent: 50,
      receivedBytes: null,
      bytesPerSecond: null,
    },
    failure: null,
    source,
  },
};

describe("cloneBannerModel", () => {
  it("shows running progress with the repository path", () => {
    const model = cloneBannerModel(base);
    expect(model).toEqual({
      kind: "running",
      title: "Cloning acme/web-dashboard",
      summary: "Receiving objects · 50%",
      percent: 45,
    });
    expect(clonePlaceholder(model)).toBe(
      "Write your first message. Sending unlocks when the clone finishes.",
    );
  });

  it("shows a starting summary without a track before Git reports progress", () => {
    expect(cloneBannerModel({ ...base, detail: { ...base.detail, progress: null } })).toEqual({
      kind: "running",
      title: "Cloning acme/web-dashboard",
      summary: "Starting",
      percent: null,
    });
  });

  it("uses typed failure copy and keeps the message", () => {
    const model = cloneBannerModel({
      ...base,
      status: "failed",
      error: "Cloning failed.",
      detail: { progress: null, failure: "authentication", source },
    });
    expect(model).toEqual({
      kind: "failed",
      title: "Could not clone acme/web-dashboard",
      detail: {
        text: "Repository not found or access denied on github.com. If it is private, run",
        command: "gh auth login",
        tail: "in a terminal, or use an SSH URL.",
      },
      retryable: true,
    });
    expect(clonePlaceholder(model)).toBe("Your message is kept. Retry to finish cloning.");
  });

  it("words a missing repository as not found or access denied", () => {
    expect(
      cloneBannerModel({
        ...base,
        status: "failed",
        detail: { progress: null, failure: "notFound", source },
      }),
    ).toMatchObject({
      kind: "failed",
      detail: {
        text: "Repository not found or access denied on github.com. Check the URL and your access.",
        command: null,
      },
    });
  });

  it("falls back to the bounded job error when a local failure has no kind", () => {
    expect(
      cloneBannerModel({
        ...base,
        status: "failed",
        error: "Cloning failed.",
        canRetry: false,
        detail: { progress: null, failure: null, source },
      }),
    ).toEqual({
      kind: "failed",
      title: "Could not clone acme/web-dashboard",
      detail: { text: "Cloning failed.", command: null, tail: "" },
      retryable: false,
    });
  });

  it("covers cancelled, preparing, ready and server clones", () => {
    expect(
      cloneBannerModel({
        ...base,
        status: "cancelled",
        detail: { ...base.detail, progress: null },
      }),
    ).toMatchObject({
      kind: "cancelled",
      title: "Cancelled cloning acme/web-dashboard",
      detail: { text: "Retry to bring in the repository.", command: null, tail: "" },
    });
    expect(cloneBannerModel({ ...base, status: "succeeded" })).toEqual({
      kind: "preparing",
      title: "Preparing web-dashboard",
    });
    expect(cloneBannerModel({ ...base, status: "succeeded", projectReady: true })).toEqual({
      kind: "none",
    });
    expect(
      cloneBannerModel({ ...base, environment: "remote", status: "queued", detail: null }),
    ).toEqual({
      kind: "running",
      title: "Cloning web-dashboard",
      summary: "Working on the server",
      percent: null,
    });
    expect(
      cloneBannerModel({
        ...base,
        environment: "remote",
        status: "failed",
        error: "x".repeat(400),
        detail: null,
      }),
    ).toMatchObject({ kind: "failed", detail: { text: "x".repeat(300) } });
    expect(clonePlaceholder({ kind: "none" })).toBeUndefined();
  });
});
