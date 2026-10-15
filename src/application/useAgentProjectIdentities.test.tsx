// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  fixtureRepository,
  projectFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import { waitForReact } from "../test/reactTestLifecycle";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";
import { useAgentProjectIdentities } from "./useAgentProjectIdentities";

const LOCAL_ROOT = "/work/app";
const REMOTE_KEY = "remote:linux:runner:app";
const NO_LINKS: ReadonlyMap<string, string> = new Map();

let host: HTMLDivElement;
let root: Root;
let observed: ReadonlyMap<string, string> = new Map();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  observed = new Map();
});

afterEach(() => act(() => root.unmount()));

function Probe({
  projects,
  gateway,
}: {
  readonly projects: readonly AgentProjectDescriptor[];
  readonly gateway: RepositoryIdentityGateway;
}) {
  observed = useAgentProjectIdentities(projects, NO_LINKS, gateway, null);
  return null;
}

function inventory(discovery: "pending" | "settled"): readonly AgentProjectDescriptor[] {
  return [
    projectFixture({
      rootKey: LOCAL_ROOT,
      rootPath: LOCAL_ROOT,
      ownerId: "agent-root:app",
      label: "app",
      repositories: discovery === "pending" ? [] : [fixtureRepository(LOCAL_ROOT, "")],
      repositoryDiscovery: discovery,
    }),
    projectFixture({
      rootKey: REMOTE_KEY,
      rootPath: REMOTE_KEY,
      ownerId: REMOTE_KEY,
      label: "app",
      repositories: [fixtureRepository(REMOTE_KEY, "")],
      remoteProjectKind: "folder",
    }),
  ];
}

it("never pairs a local checkout with a server folder while its discovery is pending", async () => {
  let settle: (identity: string | null) => void = () => undefined;
  const gateway: RepositoryIdentityGateway = {
    discover: () =>
      new Promise<string | null>((resolve) => {
        settle = resolve;
      }),
  };
  const pending = inventory("pending");
  act(() => root.render(<Probe gateway={gateway} projects={pending} />));
  expect(observed.get(LOCAL_ROOT)).toBeUndefined();
  expect(observed.get(REMOTE_KEY)).toBeUndefined();

  await act(async () => settle(null));
  expect(observed.get(REMOTE_KEY)).toBeUndefined();

  const discovered = inventory("settled");
  act(() => root.render(<Probe gateway={gateway} projects={discovered} />));
  await act(async () => settle(null));
  expect(observed.get(LOCAL_ROOT)).toBeUndefined();
  expect(observed.get(REMOTE_KEY)).toBeUndefined();
});

it("pairs a non-Git folder only after its repositories and identity lookup settle", async () => {
  let settle: (identity: string | null) => void = () => undefined;
  const gateway: RepositoryIdentityGateway = {
    discover: () =>
      new Promise<string | null>((resolve) => {
        settle = resolve;
      }),
  };
  const folder = inventory("settled").map((project) =>
    project.rootKey === LOCAL_ROOT
      ? { ...project, repositories: [fixtureRepository(`${LOCAL_ROOT}/api`, "api")] }
      : project,
  );
  act(() => root.render(<Probe gateway={gateway} projects={folder} />));
  expect(observed.get(REMOTE_KEY)).toBeUndefined();

  await act(async () => settle(null));

  await waitForReact(() => expect(observed.get(REMOTE_KEY)).toBe("folder:app"));
  expect(observed.get(LOCAL_ROOT)).toBe("folder:app");
});
