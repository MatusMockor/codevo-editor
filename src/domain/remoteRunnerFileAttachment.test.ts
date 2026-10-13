import { describe, expect, it } from "vitest";
import { isAgentImageSourcePath } from "./agentAttachmentIntake";
import {
  isRemoteRunnerFileAttachment,
  isRemoteRunnerFileMediaType,
  MAX_REMOTE_FILE_ATTACHMENT_BYTES,
} from "./remoteRunnerFileAttachment";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";

const id = "12345678-1234-4234-8234-123456789abc";
const sourceId = "87654321-4321-4321-8321-cba987654321";
const file = {
  id,
  runnerId: "runner",
  name: "report.pdf",
  bytes: 2048,
  sha256: "a".repeat(64),
  createdAt: "2026-10-13T00:00:00.000Z",
  kind: "file",
  mediaType: "application/pdf",
};
const image = {
  id,
  runnerId: "runner",
  name: "shot.png",
  bytes: 4,
  sha256: "a".repeat(64),
  createdAt: "2026-10-13T00:00:00.000Z",
  mediaType: "image/png",
  width: 1,
  height: 1,
};
const descriptor = {
  protocolVersion: 1,
  runnerId: "runner",
  name: "Runner",
  capabilities: { taskExecution: true, eventReplay: true },
};
const accepts = (
  operation: Parameters<typeof validateRemoteRunnerValue>[0],
  direction: "request" | "response",
  value: unknown,
) => {
  try {
    validateRemoteRunnerValue(operation, direction, value);
    return true;
  } catch {
    return false;
  }
};

describe("remote file attachment metadata", () => {
  it("accepts the file variant with its exact keys", () => {
    expect(accepts("getAttachment", "response", file)).toBe(true);
    expect(isRemoteRunnerFileAttachment(file)).toBe(true);
  });

  it("accepts a name with a paired surrogate and non-ASCII letters", () => {
    expect(accepts("getAttachment", "response", { ...file, name: "zmluva č.1 😀.pdf" })).toBe(true);
  });

  it.each([1, MAX_REMOTE_FILE_ATTACHMENT_BYTES])("accepts %i bytes", (bytes) => {
    expect(accepts("getAttachment", "response", { ...file, bytes })).toBe(true);
  });

  it.each([
    "image/png",
    "text/plain",
    "application/octet-stream",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-7z-compressed",
    "a/b",
    `${"a".repeat(63)}/${"b".repeat(63)}`,
  ])("accepts the declared media type %s without treating it as an image", (mediaType) => {
    expect(accepts("getAttachment", "response", { ...file, mediaType })).toBe(true);
  });

  it.each([
    ["an unknown key", { ...file, path: "/etc/passwd" }],
    ["a width", { ...file, width: 1 }],
    ["a height", { ...file, height: 1 }],
    ["both dimensions", { ...file, width: 1, height: 1 }],
    ["an unknown kind", { ...file, kind: "folder" }],
    ["an image kind", { ...file, kind: "image" }],
    ["a null kind", { ...file, kind: null }],
    ["zero bytes", { ...file, bytes: 0 }],
    ["more than 50 MiB", { ...file, bytes: MAX_REMOTE_FILE_ATTACHMENT_BYTES + 1 }],
    ["fractional bytes", { ...file, bytes: 1.5 }],
    ["an uppercase media type", { ...file, mediaType: "Application/PDF" }],
    ["media type parameters", { ...file, mediaType: "text/plain; charset=utf-8" }],
    ["a media type without a subtype", { ...file, mediaType: "application" }],
    ["an empty media type", { ...file, mediaType: "" }],
    ["an overlong media type", { ...file, mediaType: `${"a".repeat(64)}/b` }],
    ["a media type with a space", { ...file, mediaType: "application/x pdf" }],
    ["a missing media type", { ...file, mediaType: undefined }],
    ["a path separator in the name", { ...file, name: "a/b.pdf" }],
    ["a backslash in the name", { ...file, name: "a\\b.pdf" }],
    ["a control character in the name", { ...file, name: "a\u0007.pdf" }],
    ["a blank name", { ...file, name: " " }],
    ["a lone high surrogate in the name", { ...file, name: "a\uD800.pdf" }],
    ["a lone low surrogate in the name", { ...file, name: "a\uDC00.pdf" }],
    ["an overlong name", { ...file, name: "x".repeat(256) }],
    ["a bad hash", { ...file, sha256: "A".repeat(64) }],
    ["a bad id", { ...file, id: "../secret" }],
    ["a bad timestamp", { ...file, createdAt: "yesterday" }],
    ["a missing runner", { ...file, runnerId: "" }],
  ])("rejects %s", (_label, value) => {
    expect(accepts("getAttachment", "response", value)).toBe(false);
  });

  it("keeps the legacy variants closed and without a kind", () => {
    expect(accepts("getAttachment", "response", image)).toBe(true);
    expect(accepts("getAttachment", "response", { ...image, kind: "file" })).toBe(false);
    expect(accepts("getAttachment", "response", { ...image, kind: "image" })).toBe(false);
    expect(accepts("getAttachment", "response", { ...image, mediaType: "application/pdf" })).toBe(
      false,
    );
    expect(accepts("getAttachment", "response", { ...file, kind: undefined })).toBe(false);
  });

  it("never accepts a file variant as the result of a legacy base64 upload", () => {
    expect(accepts("uploadAttachment", "response", { attachment: image, created: true })).toBe(
      true,
    );
    expect(accepts("uploadAttachment", "response", { attachment: file, created: true })).toBe(
      false,
    );
  });

  it("matches the contract media type grammar", () => {
    expect(isRemoteRunnerFileMediaType("application/vnd.api+json")).toBe(true);
    expect(isRemoteRunnerFileMediaType("application/x.y-z_1!#$&^")).toBe(true);
    expect(isRemoteRunnerFileMediaType(".a/b")).toBe(false);
    expect(isRemoteRunnerFileMediaType("a/.b")).toBe(false);
    expect(isRemoteRunnerFileMediaType("a/b/c")).toBe(false);
    expect(isRemoteRunnerFileMediaType(null)).toBe(false);
  });
});

describe("remote file attachment capability", () => {
  it("accepts older runners with the capability absent", () => {
    expect(accepts("getRunner", "response", descriptor)).toBe(true);
  });

  it.each([true, false])("accepts explicit fileAttachments %s", (fileAttachments) => {
    expect(
      accepts("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, fileAttachments },
      }),
    ).toBe(true);
  });

  it.each([null, "true", 1, {}, []])("rejects fileAttachments %j", (fileAttachments) => {
    expect(
      accepts("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, fileAttachments },
      }),
    ).toBe(false);
  });
});

describe("remote file attachment commands", () => {
  const upload = { serverId: "linux", attachmentId: id, sourceId, name: "report.pdf" };
  const download = {
    serverId: "linux",
    attachmentId: id,
    name: "report.pdf",
    bytes: 2048,
    sha256: "a".repeat(64),
  };

  it("accepts the exact upload request and the file response", () => {
    expect(accepts("uploadAttachmentFile", "request", upload)).toBe(true);
    expect(accepts("uploadAttachmentFile", "response", { attachment: file, created: false })).toBe(
      true,
    );
  });

  it.each([
    ["a local path", { ...upload, path: "/Users/dev/report.pdf" }],
    ["file content", { ...upload, base64: "YWJj" }],
    ["a media type", { ...upload, mediaType: "application/pdf" }],
    ["a non-uuid source", { ...upload, sourceId: "/Users/dev/report.pdf" }],
    ["a non-uuid attachment", { ...upload, attachmentId: "1" }],
    ["a bad server", { ...upload, serverId: "../linux" }],
    ["a path in the name", { ...upload, name: "../report.pdf" }],
    ["a missing source", { serverId: "linux", attachmentId: id, name: "report.pdf" }],
  ])("rejects an upload request carrying %s", (_label, value) => {
    expect(accepts("uploadAttachmentFile", "request", value)).toBe(false);
  });

  it.each([
    ["a legacy image", { attachment: image, created: true }],
    ["a missing created flag", { attachment: file }],
    ["an extra key", { attachment: file, created: true, path: "/tmp/x" }],
    ["nothing", null],
  ])("rejects an upload response with %s", (_label, value) => {
    expect(accepts("uploadAttachmentFile", "response", value)).toBe(false);
  });

  it("accepts only the exact cancel request and an empty response", () => {
    expect(
      accepts("cancelAttachmentUpload", "request", { serverId: "linux", attachmentId: id }),
    ).toBe(true);
    expect(
      accepts("cancelAttachmentUpload", "request", {
        serverId: "linux",
        attachmentId: id,
        sourceId,
      }),
    ).toBe(false);
    expect(accepts("cancelAttachmentUpload", "response", null)).toBe(true);
    expect(accepts("cancelAttachmentUpload", "response", undefined)).toBe(true);
    expect(accepts("cancelAttachmentUpload", "response", { cancelled: true })).toBe(false);
  });

  it("accepts the exact download request and a closed status", () => {
    expect(accepts("downloadAttachment", "request", download)).toBe(true);
    expect(accepts("downloadAttachment", "response", { status: "saved" })).toBe(true);
    expect(accepts("downloadAttachment", "response", { status: "cancelled" })).toBe(true);
  });

  it.each([
    ["a destination path", { ...download, path: "/Users/dev/Downloads/report.pdf" }],
    ["zero bytes", { ...download, bytes: 0 }],
    ["more than 50 MiB", { ...download, bytes: MAX_REMOTE_FILE_ATTACHMENT_BYTES + 1 }],
    ["a bad hash", { ...download, sha256: "abc" }],
    ["a blank name", { ...download, name: "" }],
    ["a non-uuid attachment", { ...download, attachmentId: "../x" }],
  ])("rejects a download request with %s", (_label, value) => {
    expect(accepts("downloadAttachment", "request", value)).toBe(false);
  });

  it.each([
    { status: "failed" },
    { status: "saved", path: "/Users/dev/Downloads/report.pdf" },
    {},
    null,
    "saved",
  ])("rejects the download response %j", (value) => {
    expect(accepts("downloadAttachment", "response", value)).toBe(false);
  });
});

describe("native image source paths", () => {
  it.each(["/a/shot.png", "/a/SHOT.JPG", "/a/photo.jpeg", "/a/anim.gif", "C:\\pics\\a.WebP"])(
    "keeps %s on the image reader",
    (path) => {
      expect(isAgentImageSourcePath(path)).toBe(true);
    },
  );

  it.each([
    "/a/report.pdf",
    "/a/notes.txt",
    "/a/data.json",
    "/a/archive.zip",
    "/a/photo.heic",
    "/a/Makefile",
    "/a/.png",
    "/a/shot.png.bak",
    "/a/folder.png/",
    "",
  ])("sends %s through the file source", (path) => {
    expect(isAgentImageSourcePath(path)).toBe(false);
  });
});
