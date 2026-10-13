import { act, createElement, StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, vi } from "vitest";
import type { DirectoryListing, DirectoryListingGateway } from "../domain/directoryListing";
import type {
  RemoteProjectRegistration,
  RemoteProjectRegistrationInput,
} from "../domain/remoteProjectRegistration";
import { remoteAgentProjectKey } from "../application/remoteAgentProjection";
import type { RemoteProjectRegistrationGateway } from "../application/remoteProjectRegistrationGateway";
import type { RemoteAddProjectServerProject } from "../application/useRemoteAddProject";
import {
  useRemoteProjectFolderRegistration,
  type RemoteProjectFolderController,
  type RemoteProjectFolderOwner,
} from "../application/useRemoteProjectFolderRegistration";

export const FOLDER_SERVER = "server-a";
export const FOLDER_RUNNER = "runner";
export const FOLDER_ROOT = "/srv";
export const BILLING_PATH = "/srv/repos/billing";
export const BILLING_KEY = remoteAgentProjectKey(FOLDER_SERVER, FOLDER_RUNNER, "billing");
export const BILLING_ROW: RemoteAddProjectServerProject = { key: BILLING_KEY, label: "billing" };
export const OTHER_ROW: RemoteAddProjectServerProject = {
  key: remoteAgentProjectKey(FOLDER_SERVER, FOLDER_RUNNER, "other"),
  label: "other",
};
export const REGISTERED: Extract<RemoteProjectRegistration, { status: "registered" }> = {
  status: "registered",
  project: { id: "billing", name: "billing" },
  created: true,
};

type FolderListing = Readonly<{
  parent: string | null;
  names: readonly string[];
  truncated?: boolean;
}>;

const LISTINGS: Readonly<Record<string, FolderListing>> = {
  "/srv": { parent: null, names: ["repos", "archive"] },
  "/srv/repos": { parent: "/srv", names: ["billing", "my.project", "---"] },
  "/srv/repos/billing": { parent: "/srv/repos", names: ["src"] },
  "/srv/repos/my.project": { parent: "/srv/repos", names: [] },
  "/srv/repos/---": { parent: "/srv/repos", names: [] },
  "/srv/archive": { parent: "/srv", names: ["2024", "2025"], truncated: true },
};

type Settlement = Readonly<{
  resolve(result: RemoteProjectRegistration): void;
  reject(error: unknown): void;
}>;

export type FolderHarnessOptions = Readonly<{
  directory?: boolean;
  registration?: boolean;
  projects?: readonly RemoteAddProjectServerProject[];
  projectsAfterRefresh?: readonly RemoteAddProjectServerProject[];
  strict?: boolean;
  view?(controller: RemoteProjectFolderController): ReactNode;
}>;

export function folderListing(path: string | null): Promise<DirectoryListing> {
  const resolved = path ?? FOLDER_ROOT;
  const listing = LISTINGS[resolved];
  if (listing === undefined) return Promise.reject(new Error("Unable to list that directory."));
  return Promise.resolve({
    path: resolved,
    parent: listing.parent,
    entries: listing.names.map((name) => ({ name, kind: "directory", hidden: false })),
    truncated: listing.truncated ?? false,
  });
}

export function mountFolderHarness(options: FolderHarnessOptions = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pending: Settlement[] = [];
  const registerProject = vi.fn(
    (_input: RemoteProjectRegistrationInput) =>
      new Promise<RemoteProjectRegistration>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const identifyRunner = vi.fn(() => Promise.resolve(FOLDER_RUNNER));
  const listDirectoryEntries = vi.fn<DirectoryListingGateway["listDirectoryEntries"]>(({ path }) =>
    folderListing(path),
  );
  const directoryGateway: DirectoryListingGateway = {
    listDirectoryEntries,
    revealDirectory: () => Promise.resolve(),
  };
  const registrationGateway: RemoteProjectRegistrationGateway = { identifyRunner, registerProject };
  const selectProject = vi.fn<(key: string) => void>();
  const onClose = vi.fn<() => void>();
  const initialProjects = options.projects ?? [OTHER_ROW];
  const afterRefresh = options.projectsAfterRefresh ?? [...initialProjects, BILLING_ROW];
  const ownerFor = (serverId: string, workspaceOwner: string): RemoteProjectFolderOwner => ({
    serverId,
    workspaceOwner,
    directoryGateway: options.directory === false ? null : directoryGateway,
    registrationGateway: options.registration === false ? null : registrationGateway,
  });
  let assignProjects: (rows: readonly RemoteAddProjectServerProject[]) => void = () => undefined;
  const refreshProjects = vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
    assignProjects(afterRefresh);
  });
  let selectionIdentity: unknown = "selection-1";
  let controller!: RemoteProjectFolderController;
  let assignOwner: (owner: RemoteProjectFolderOwner | null) => void = () => undefined;

  function Harness({ identity }: Readonly<{ identity: unknown }>) {
    const [owner, setOwner] = useState<RemoteProjectFolderOwner | null>(null);
    const [serverProjects, setServerProjects] =
      useState<readonly RemoteAddProjectServerProject[]>(initialProjects);
    assignOwner = setOwner;
    assignProjects = setServerProjects;
    controller = useRemoteProjectFolderRegistration({
      owner,
      serverProjects,
      selectionIdentity: identity,
      refreshProjects,
      selectProject,
      onClose() {
        onClose();
        setOwner(null);
      },
    });
    return options.view?.(controller) ?? null;
  }

  const tree = () => {
    const harness = createElement(Harness, { identity: selectionIdentity });
    if (options.strict !== true) return harness;
    return createElement(StrictMode, null, harness);
  };
  const render = () => act(async () => root.render(tree()));
  const settled = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

  return {
    host,
    registerProject,
    identifyRunner,
    listDirectoryEntries,
    refreshProjects,
    selectProject,
    onClose,
    render,
    settled,
    get controller() {
      return controller;
    },
    get pendingCount() {
      return pending.length;
    },
    async openFor(serverId: string = FOLDER_SERVER, workspaceOwner = "workspace-1") {
      await act(async () => assignOwner(ownerFor(serverId, workspaceOwner)));
      await settled();
    },
    async publish(rows: readonly RemoteAddProjectServerProject[]) {
      await act(async () => assignProjects(rows));
      await settled();
    },
    async select(identity: unknown) {
      selectionIdentity = identity;
      await render();
      await settled();
    },
    async run(action: (current: RemoteProjectFolderController) => void) {
      await act(async () => action(controller));
      await settled();
    },
    async settle(result: RemoteProjectRegistration, index = pending.length - 1) {
      expect(pending[index], `pending registration ${index}`).toBeDefined();
      await act(async () => pending[index]?.resolve(result));
      await settled();
    },
    async fail(error: unknown, index = pending.length - 1) {
      expect(pending[index], `pending registration ${index}`).toBeDefined();
      await act(async () => pending[index]?.reject(error));
      await settled();
    },
    unmount() {
      if (!host.isConnected) return;
      act(() => root.unmount());
      host.remove();
    },
  };
}

export type FolderHarness = ReturnType<typeof mountFolderHarness>;

export async function openFolderNaming(
  harness: FolderHarness,
  path: string = BILLING_PATH,
): Promise<void> {
  await harness.render();
  await harness.openFor();
  await harness.run((controller) => controller.chooseFolder(path));
}
