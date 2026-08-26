import { describe, expect, it, vi } from "vitest";
import {
  DIRECTORY_LISTING_FAILED,
  DIRECTORY_LISTING_INVALID,
  DIRECTORY_LISTING_UNAVAILABLE,
  DIRECTORY_REVEAL_FAILED,
  MAX_DIRECTORY_BACKEND_MESSAGE_CHARS,
  TauriDirectoryListingGateway,
  type DirectoryListingCommand,
  type DirectoryListingRuntimeDetector,
} from "./tauriDirectoryListingGateway";

const available: DirectoryListingRuntimeDetector = () => true;
const unavailable: DirectoryListingRuntimeDetector = () => false;

const listingPayload = {
  path: "/Users/dev",
  parent: "/Users",
  entries: [{ name: "projects", kind: "directory", hidden: false }],
  truncated: false,
};

describe("TauriDirectoryListingGateway", () => {
  it("sends the exact listing arguments and parses the response", async () => {
    const invokeCommand = vi.fn<DirectoryListingCommand>().mockResolvedValue(listingPayload);
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(gateway.listDirectoryEntries({ path: null, includeFiles: true })).resolves.toEqual(
      {
        path: "/Users/dev",
        parent: "/Users",
        entries: [{ name: "projects", kind: "directory", hidden: false }],
        truncated: false,
      },
    );

    expect(invokeCommand.mock.calls).toEqual([
      ["list_directory_entries", { request: { path: null, includeFiles: true } }],
    ]);
  });

  it("sends the exact reveal arguments", async () => {
    const invokeCommand = vi.fn<DirectoryListingCommand>().mockResolvedValue(null);
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(gateway.revealDirectory("/Users/dev/projects")).resolves.toBeUndefined();

    expect(invokeCommand.mock.calls).toEqual([
      ["open_directory_in_file_manager", { request: { path: "/Users/dev/projects" } }],
    ]);
  });

  it("does not forward unknown request fields to the transport", async () => {
    const invokeCommand = vi.fn<DirectoryListingCommand>().mockResolvedValue(listingPayload);
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);
    const request = { path: "/Users/dev", includeFiles: false, depth: 3 };

    await gateway.listDirectoryEntries(request);

    expect(invokeCommand.mock.calls).toEqual([
      ["list_directory_entries", { request: { path: "/Users/dev", includeFiles: false } }],
    ]);
  });

  it("throws for both operations without the native runtime", async () => {
    const invokeCommand = vi.fn<DirectoryListingCommand>();
    const gateway = new TauriDirectoryListingGateway(invokeCommand, unavailable);

    await expect(gateway.listDirectoryEntries({ path: null, includeFiles: false })).rejects.toThrow(
      DIRECTORY_LISTING_UNAVAILABLE,
    );
    await expect(gateway.revealDirectory("/Users/dev")).rejects.toThrow(
      DIRECTORY_LISTING_UNAVAILABLE,
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with a bounded message", async () => {
    const invokeCommand = vi
      .fn<DirectoryListingCommand>()
      .mockResolvedValue({ ...listingPayload, cursor: "abc" });
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(gateway.listDirectoryEntries({ path: null, includeFiles: false })).rejects.toThrow(
      DIRECTORY_LISTING_INVALID,
    );
  });

  it("rejects a payload with an unsupported entry kind", async () => {
    const invokeCommand = vi.fn<DirectoryListingCommand>().mockResolvedValue({
      ...listingPayload,
      entries: [{ name: "sock", kind: "socket", hidden: false }],
    });
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(gateway.listDirectoryEntries({ path: null, includeFiles: false })).rejects.toThrow(
      DIRECTORY_LISTING_INVALID,
    );
  });

  it("surfaces a short backend string error", async () => {
    const invokeCommand = vi
      .fn<DirectoryListingCommand>()
      .mockRejectedValue("Directory does not exist.");
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(
      gateway.listDirectoryEntries({ path: "/missing", includeFiles: false }),
    ).rejects.toThrow("Directory does not exist.");
  });

  it("surfaces a backend string error of exactly the bounded length", async () => {
    const message = "e".repeat(MAX_DIRECTORY_BACKEND_MESSAGE_CHARS);
    const invokeCommand = vi.fn<DirectoryListingCommand>().mockRejectedValue(message);
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(
      gateway.listDirectoryEntries({ path: "/missing", includeFiles: false }),
    ).rejects.toThrow(message);
  });

  it("replaces an over-long backend string error", async () => {
    const invokeCommand = vi
      .fn<DirectoryListingCommand>()
      .mockRejectedValue("e".repeat(MAX_DIRECTORY_BACKEND_MESSAGE_CHARS + 1));
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(
      gateway.listDirectoryEntries({ path: "/missing", includeFiles: false }),
    ).rejects.toThrow(DIRECTORY_LISTING_FAILED);
  });

  it("replaces a non-string backend error", async () => {
    const invokeCommand = vi
      .fn<DirectoryListingCommand>()
      .mockRejectedValue({ code: "EACCES", detail: { path: "/root" } });
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(
      gateway.listDirectoryEntries({ path: "/root", includeFiles: false }),
    ).rejects.toThrow(DIRECTORY_LISTING_FAILED);
  });

  it("replaces a reveal failure with a bounded message", async () => {
    const invokeCommand = vi
      .fn<DirectoryListingCommand>()
      .mockRejectedValue("open failed with a leaked absolute path /Users/dev/private");
    const gateway = new TauriDirectoryListingGateway(invokeCommand, available);

    await expect(gateway.revealDirectory("/Users/dev")).rejects.toThrow(DIRECTORY_REVEAL_FAILED);
  });
});
