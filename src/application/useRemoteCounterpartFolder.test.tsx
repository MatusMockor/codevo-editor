// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirectoryListing, DirectoryListingGateway } from "../domain/directoryListing";
import {
  useRemoteCounterpartFolder,
  type RemoteCounterpartFolder,
} from "./useRemoteCounterpartFolder";

let host: HTMLDivElement;
let root: Root;
let observed: RemoteCounterpartFolder | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  observed = null;
});

afterEach(() => act(() => root.unmount()));

function Probe({
  gateway,
  name,
}: {
  readonly gateway: DirectoryListingGateway | null;
  readonly name: string | null;
}) {
  observed = useRemoteCounterpartFolder(gateway, name);
  return null;
}

function listing(path: string, names: readonly string[]): DirectoryListing {
  return {
    path,
    parent: null,
    entries: names.map((name) => ({ name, kind: "directory", hidden: false })),
    truncated: false,
  };
}

function deferredGateway() {
  let resolve: (value: DirectoryListing) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const gateway: DirectoryListingGateway = {
    listDirectoryEntries: vi.fn(
      () =>
        new Promise<DirectoryListing>((onResolve, onReject) => {
          resolve = onResolve;
          reject = onReject;
        }),
    ),
    revealDirectory: vi.fn(),
  };
  return {
    gateway,
    resolve: (value: DirectoryListing) => resolve(value),
    reject: (error: Error) => reject(error),
  };
}

it("reports checking until the server root listing settles, then the matching folder", async () => {
  const server = deferredGateway();
  act(() => root.render(<Probe gateway={server.gateway} name="playablemaker" />));
  expect(observed).toEqual({ status: "checking" });
  expect(server.gateway.listDirectoryEntries).toHaveBeenCalledWith({
    path: null,
    includeFiles: false,
  });

  await act(async () => server.resolve(listing("/home/codex/Developer", ["playablemaker"])));

  expect(observed).toEqual({ status: "found", path: "/home/codex/Developer/playablemaker" });
});

it("ignores a late listing from a server that is no longer selected", async () => {
  const first = deferredGateway();
  const second = deferredGateway();
  act(() => root.render(<Probe gateway={first.gateway} name="playablemaker" />));
  act(() => root.render(<Probe gateway={second.gateway} name="playablemaker" />));

  await act(async () => first.resolve(listing("/home/first", ["playablemaker"])));
  expect(observed).toEqual({ status: "checking" });

  await act(async () => second.resolve(listing("/home/second", ["other"])));
  expect(observed).toEqual({ status: "absent" });

  act(() => root.render(<Probe gateway={first.gateway} name="playablemaker" />));
  expect(observed).toEqual({ status: "checking" });
});

it("treats an unreachable server or a missing gateway as no known folder", async () => {
  const server = deferredGateway();
  act(() => root.render(<Probe gateway={server.gateway} name="playablemaker" />));
  await act(async () => server.reject(new Error("offline")));
  expect(observed).toEqual({ status: "absent" });

  act(() => root.render(<Probe gateway={null} name="playablemaker" />));
  expect(observed).toEqual({ status: "absent" });
});

it("checks again instead of reusing an earlier result when a lookup is revisited", async () => {
  const server = deferredGateway();
  act(() => root.render(<Probe gateway={server.gateway} name="app" />));
  await act(async () => server.resolve(listing("/home/codex/Developer", ["app"])));
  expect(observed).toEqual({ status: "found", path: "/home/codex/Developer/app" });

  act(() => root.render(<Probe gateway={server.gateway} name="other" />));
  expect(observed).toEqual({ status: "checking" });

  act(() => root.render(<Probe gateway={server.gateway} name="app" />));
  expect(observed).toEqual({ status: "checking" });
  expect(server.gateway.listDirectoryEntries).toHaveBeenCalledTimes(3);

  await act(async () => server.resolve(listing("/home/codex/Developer", [])));
  expect(observed).toEqual({ status: "absent" });
});
