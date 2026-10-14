import { describe, expect, it } from "vitest";
import { groupedEnvironmentProjects } from "../components/agentMode/agentEnvironmentProjects";
import { agentProjectGroups } from "../components/agentMode/agentModePresentation";
import { projectFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { repositoryIdentityCandidates } from "./repositoryIdentityCandidates";

const project = (rootKey: string) =>
  projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: rootKey,
    repositories: [
      { repositoryRoot: rootKey, repositoryRelativePath: "", mapping: { rootRelativePath: "" } },
    ],
  });
const LOCAL = "/Users/x/Developer/editor";
const OTHER_LOCAL = "/Users/x/Developer/api";
const LINKED = "remote:linux:runner:codevo-editor";
const UNLINKED = "remote:linux:runner:api";
const projects = [project(LOCAL), project(OTHER_LOCAL), project(LINKED), project(UNLINKED)];
const FOLDER = "remote:linux:runner:notes";
const folderProject = { ...project(FOLDER), remoteProjectKind: "folder" as const };
const keysOf = (candidates: readonly { rootKey: string }[]) =>
  candidates.map((candidate) => candidate.rootKey);

describe("repository identity candidates", () => {
  it("skips a server project that is explicitly connected to an open local project", () => {
    const candidates = repositoryIdentityCandidates(projects, new Map([[LINKED, LOCAL]]));
    expect(keysOf(candidates)).toEqual([LOCAL, OTHER_LOCAL, UNLINKED]);
  });

  it("keeps every project when nothing is connected", () => {
    expect(repositoryIdentityCandidates(projects, new Map())).toEqual(projects);
  });

  it("keeps a server project whose connected local project is not open", () => {
    const candidates = repositoryIdentityCandidates(projects, new Map([[LINKED, "/closed"]]));
    expect(keysOf(candidates)).toEqual(keysOf(projects));
  });

  it("never drops a local project, even when a link is keyed by it", () => {
    const links = new Map([
      [LOCAL, OTHER_LOCAL],
      [LINKED, UNLINKED],
    ]);
    expect(keysOf(repositoryIdentityCandidates(projects, links))).toEqual(keysOf(projects));
  });

  it("never asks for the repository of a server folder project", () => {
    const withFolder = [...projects, folderProject];
    expect(keysOf(repositoryIdentityCandidates(withFolder, new Map()))).toEqual(keysOf(projects));
    expect(keysOf(repositoryIdentityCandidates(withFolder, new Map([[FOLDER, LOCAL]])))).toEqual(
      keysOf(projects),
    );
  });

  it("keeps a repository project whether or not its runner reports a kind", () => {
    const explicit = { ...project(UNLINKED), remoteProjectKind: "repository" as const };
    const candidates = repositoryIdentityCandidates(
      [project(LOCAL), project(LINKED), explicit, folderProject],
      new Map(),
    );
    expect(keysOf(candidates)).toEqual([LOCAL, LINKED, UNLINKED]);
  });

  it("ignores a server project kind on a local project", () => {
    const local = { ...project(LOCAL), remoteProjectKind: "folder" as const };
    expect(repositoryIdentityCandidates([local], new Map())).toEqual([local]);
  });

  it("still groups an explicitly connected folder project with its local project", () => {
    const withFolder = [project(LOCAL), folderProject];
    const links = new Map([[FOLDER, LOCAL]]);
    const groups = agentProjectGroups(withFolder, [], []);
    const candidates = repositoryIdentityCandidates(withFolder, links);
    expect(keysOf(candidates)).toEqual([LOCAL]);
    const identities = new Map([[LOCAL, "github.com/acme/shared"]]);
    const grouped = groupedEnvironmentProjects(groups, withFolder, links, identities);
    expect(grouped).toEqual(
      groupedEnvironmentProjects(
        groups,
        withFolder,
        links,
        new Map([...identities, [FOLDER, "github.com/acme/unrelated"]]),
      ),
    );
    expect(JSON.stringify(grouped)).toContain(FOLDER);
  });

  it("drops only identities that grouping never reads", () => {
    const links = new Map([[LINKED, LOCAL]]);
    const groups = agentProjectGroups(projects, [], []);
    const identities = new Map(projects.map((entry) => [entry.rootKey, "github.com/acme/shared"]));
    const candidateIdentities = new Map(
      repositoryIdentityCandidates(projects, links).map((entry) => [
        entry.rootKey,
        "github.com/acme/shared",
      ]),
    );
    expect(candidateIdentities.has(LINKED)).toBe(false);
    expect(groupedEnvironmentProjects(groups, projects, links, candidateIdentities)).toEqual(
      groupedEnvironmentProjects(groups, projects, links, identities),
    );
  });
});
