import { invoke } from "@tauri-apps/api/core";
import type {
  CreatePullRequestRequest,
  PullRequestContext,
  PullRequestContextRequest,
  PullRequestGateway,
  PullRequestReceipt,
} from "../domain/pullRequest";
import {
  invokeCreatePullRequestIpc,
  invokeGetPullRequestContextIpc,
  type InvokePullRequestCommand,
} from "./tauriPullRequestIpcContract";

const invokeCommand: InvokePullRequestCommand = (command, args) => invoke<unknown>(command, args);
const FORGE_HOSTS: ReadonlySet<string> = new Set(["github.com", "gitlab.com"]);
const MAX_FORGE_URL_BYTES = 2_048;

export interface ForgeUrlOpener {
  openExternal(url: string): Promise<void>;
}

export class TauriForgeUrlOpener implements ForgeUrlOpener {
  constructor(private readonly openUrl: (url: string) => Promise<void> = openWithTauri) {}

  async openExternal(url: string): Promise<void> {
    if (!isForgeUrl(url)) {
      throw new Error("Only github.com and gitlab.com addresses can be opened here.");
    }
    await this.openUrl(url);
  }
}

function isForgeUrl(url: string): boolean {
  if (new TextEncoder().encode(url).length > MAX_FORGE_URL_BYTES || !URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return (
    parsed.protocol === "https:" &&
    FORGE_HOSTS.has(parsed.hostname) &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

async function openWithTauri(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export class TauriPullRequestGateway implements PullRequestGateway {
  constructor(private readonly invokePullRequest: InvokePullRequestCommand = invokeCommand) {}

  getContext(request: PullRequestContextRequest): Promise<PullRequestContext> {
    return invokeGetPullRequestContextIpc(this.invokePullRequest, request);
  }

  create(request: CreatePullRequestRequest): Promise<PullRequestReceipt> {
    return invokeCreatePullRequestIpc(this.invokePullRequest, request);
  }
}
