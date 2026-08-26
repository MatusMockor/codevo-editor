import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  parseDirectoryListing,
  type DirectoryListing,
  type DirectoryListingGateway,
  type DirectoryListingRequest,
} from "../domain/directoryListing";

export const DIRECTORY_LISTING_UNAVAILABLE = "Browsing directories requires the native runtime.";
export const DIRECTORY_LISTING_FAILED = "Unable to list that directory.";
export const DIRECTORY_LISTING_INVALID = "The directory listing response was not understood.";
export const DIRECTORY_REVEAL_FAILED = "Unable to reveal that directory in the file manager.";

export const MAX_DIRECTORY_BACKEND_MESSAGE_CHARS = 200;

export interface DirectoryRevealRequest {
  readonly path: string;
}

export type DirectoryListingCommandName =
  "list_directory_entries" | "open_directory_in_file_manager";

export type DirectoryListingCommandArgs = {
  readonly request: DirectoryListingRequest | DirectoryRevealRequest;
};

export type DirectoryListingCommand = (
  command: DirectoryListingCommandName,
  args: DirectoryListingCommandArgs,
) => Promise<unknown>;

export type DirectoryListingRuntimeDetector = () => boolean;

const invokeDirectoryListingCommand: DirectoryListingCommand = (command, args) =>
  invoke(command, args);

export class TauriDirectoryListingGateway implements DirectoryListingGateway {
  constructor(
    private readonly invokeCommand: DirectoryListingCommand = invokeDirectoryListingCommand,
    private readonly isRuntimeAvailable: DirectoryListingRuntimeDetector = isTauri,
  ) {}

  async listDirectoryEntries(request: DirectoryListingRequest): Promise<DirectoryListing> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(DIRECTORY_LISTING_UNAVAILABLE);
    }
    const payload = await this.invokeListing(request);
    return parseListing(payload);
  }

  async revealDirectory(path: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(DIRECTORY_LISTING_UNAVAILABLE);
    }
    try {
      await this.invokeCommand("open_directory_in_file_manager", { request: { path } });
    } catch {
      throw new Error(DIRECTORY_REVEAL_FAILED);
    }
  }

  private async invokeListing(request: DirectoryListingRequest): Promise<unknown> {
    try {
      return await this.invokeCommand("list_directory_entries", {
        request: { path: request.path, includeFiles: request.includeFiles },
      });
    } catch (error: unknown) {
      throw new Error(boundedBackendMessage(error));
    }
  }
}

function parseListing(payload: unknown): DirectoryListing {
  try {
    return parseDirectoryListing(payload);
  } catch {
    throw new Error(DIRECTORY_LISTING_INVALID);
  }
}

function boundedBackendMessage(error: unknown): string {
  if (typeof error === "string" && error.length <= MAX_DIRECTORY_BACKEND_MESSAGE_CHARS) {
    return error;
  }
  return DIRECTORY_LISTING_FAILED;
}
