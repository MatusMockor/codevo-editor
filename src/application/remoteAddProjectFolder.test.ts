import { describe, expect, it } from "vitest";
import { REMOTE_PROJECT_REGISTRATION_REJECTIONS } from "../domain/remoteProjectRegistration";
import {
  INITIAL_REMOTE_ADD_PROJECT_FOLDER,
  reduceRemoteAddProjectFolder,
  remoteAddProjectFolderInput,
  remoteAddProjectFolderNameError,
  type RemoteAddProjectFolderAction,
  type RemoteAddProjectFolderState,
} from "./remoteAddProjectFolder";
import { remoteProjectFolderFailure } from "./useRemoteProjectFolderRegistration";

const PATH = "/srv/repos/billing";

function run(...actions: RemoteAddProjectFolderAction[]): RemoteAddProjectFolderState {
  return actions.reduce(reduceRemoteAddProjectFolder, INITIAL_REMOTE_ADD_PROJECT_FOLDER);
}

function submitting(submission = 1): RemoteAddProjectFolderState {
  return run({ kind: "chooseFolder", path: PATH }, { kind: "submitStarted", submission });
}

describe("server folder reducer", () => {
  it("starts browsing from the listing root", () => {
    expect(INITIAL_REMOTE_ADD_PROJECT_FOLDER).toEqual({ phase: "browsing", path: null });
  });

  it("names the chosen folder after its last segment and is ready to submit", () => {
    const state = run({ kind: "chooseFolder", path: PATH });
    expect(state).toEqual({ phase: "ready", path: PATH, name: "billing" });
    expect(remoteAddProjectFolderInput(state)).toEqual({ path: PATH, name: "billing" });
    expect(remoteAddProjectFolderNameError(state)).toBeNull();
  });

  it("asks for a name when the folder name yields nothing usable", () => {
    const state = run({ kind: "chooseFolder", path: "/srv/repos/..." });
    expect(state).toEqual({ phase: "naming", path: "/srv/repos/...", name: "" });
    expect(remoteAddProjectFolderInput(state)).toBeNull();
    expect(remoteAddProjectFolderNameError(state)).toBe("invalid");
  });

  it.each(["/", "srv/repos", "/srv/repos/", "/srv/../etc", ""])(
    "never leaves browsing for the unusable folder %j",
    (path) => {
      expect(run({ kind: "chooseFolder", path })).toBe(INITIAL_REMOTE_ADD_PROJECT_FOLDER);
    },
  );

  it("validates the name live and bounds it", () => {
    const chosen = run({ kind: "chooseFolder", path: PATH });
    const invalid = reduceRemoteAddProjectFolder(chosen, { kind: "setName", value: "my.project" });
    expect(invalid).toEqual({ phase: "naming", path: PATH, name: "my.project" });
    const valid = reduceRemoteAddProjectFolder(invalid, { kind: "setName", value: "my-project" });
    expect(valid).toEqual({ phase: "ready", path: PATH, name: "my-project" });
    const long = reduceRemoteAddProjectFolder(valid, { kind: "setName", value: "a".repeat(90) });
    expect(long).toEqual({ phase: "ready", path: PATH, name: "a".repeat(64) });
  });

  it("returns to the browser at the chosen folder", () => {
    const state = run({ kind: "chooseFolder", path: PATH }, { kind: "back" });
    expect(state).toEqual({ phase: "browsing", path: PATH });
  });

  it("ignores a submit while the name is invalid or nothing is chosen", () => {
    const browsing = run({ kind: "submitStarted", submission: 1 });
    expect(browsing).toBe(INITIAL_REMOTE_ADD_PROJECT_FOLDER);
    const naming = run({ kind: "chooseFolder", path: PATH }, { kind: "setName", value: "-x" });
    expect(reduceRemoteAddProjectFolder(naming, { kind: "submitStarted", submission: 1 })).toBe(
      naming,
    );
  });

  it("ignores a second submit, edits and Back while one is in flight", () => {
    const first = submitting(1);
    expect(first).toEqual({ phase: "submitting", path: PATH, name: "billing", submission: 1 });
    for (const action of [
      { kind: "submitStarted", submission: 2 },
      { kind: "setName", value: "other" },
      { kind: "back" },
      { kind: "chooseFolder", path: "/srv/repos/other" },
    ] satisfies RemoteAddProjectFolderAction[]) {
      expect(reduceRemoteAddProjectFolder(first, action)).toBe(first);
    }
  });

  it.each(REMOTE_PROJECT_REGISTRATION_REJECTIONS)("keeps the %s rejection", (reason) => {
    const state = reduceRemoteAddProjectFolder(submitting(), {
      kind: "submitRejected",
      submission: 1,
      reason,
    });
    expect(state).toEqual({ phase: "rejected", path: PATH, name: "billing", reason });
  });

  it("puts a taken name on the name field and blocks a resubmit until it changes", () => {
    const taken = reduceRemoteAddProjectFolder(submitting(), {
      kind: "submitRejected",
      submission: 1,
      reason: "name_taken",
    });
    expect(remoteAddProjectFolderNameError(taken)).toBe("taken");
    expect(remoteAddProjectFolderInput(taken)).toBeNull();
    expect(reduceRemoteAddProjectFolder(taken, { kind: "submitStarted", submission: 2 })).toBe(
      taken,
    );
    const renamed = reduceRemoteAddProjectFolder(taken, { kind: "setName", value: "billing-2" });
    expect(renamed).toEqual({ phase: "ready", path: PATH, name: "billing-2" });
  });

  it.each(["not_git_root", "limit_reached", "not_allowed"] as const)(
    "allows a retry after the %s rejection",
    (reason) => {
      const rejected = reduceRemoteAddProjectFolder(submitting(), {
        kind: "submitRejected",
        submission: 1,
        reason,
      });
      expect(remoteAddProjectFolderNameError(rejected)).toBeNull();
      expect(
        reduceRemoteAddProjectFolder(rejected, { kind: "submitStarted", submission: 2 }),
      ).toEqual({ phase: "submitting", path: PATH, name: "billing", submission: 2 });
    },
  );

  it("keeps a failure and allows a retry or another folder", () => {
    const failed = reduceRemoteAddProjectFolder(submitting(), {
      kind: "submitFailed",
      submission: 1,
      failure: { kind: "runnerOutdated" },
    });
    expect(failed).toEqual({
      phase: "failed",
      path: PATH,
      name: "billing",
      failure: { kind: "runnerOutdated" },
    });
    expect(remoteAddProjectFolderInput(failed)).toEqual({ path: PATH, name: "billing" });
    expect(reduceRemoteAddProjectFolder(failed, { kind: "back" })).toEqual({
      phase: "browsing",
      path: PATH,
    });
  });

  it("drops a settlement that belongs to another or no submission", () => {
    const current = submitting(2);
    for (const action of [
      { kind: "submitRejected", submission: 1, reason: "not_allowed" },
      { kind: "submitFailed", submission: 1, failure: { kind: "projectMissing" } },
      { kind: "submitFailed", submission: 3, failure: { kind: "runnerUnreachable" } },
    ] satisfies RemoteAddProjectFolderAction[]) {
      expect(reduceRemoteAddProjectFolder(current, action)).toBe(current);
    }
    const ready = run({ kind: "chooseFolder", path: PATH });
    expect(
      reduceRemoteAddProjectFolder(ready, {
        kind: "submitRejected",
        submission: 1,
        reason: "not_allowed",
      }),
    ).toBe(ready);
  });
});

describe("server folder failures", () => {
  it("recognises a runner that predates the route", () => {
    expect(remoteProjectFolderFailure("Runner request failed (HTTP 404).")).toEqual({
      kind: "runnerOutdated",
    });
    expect(remoteProjectFolderFailure(new Error("Runner request failed (HTTP 404)."))).toEqual({
      kind: "runnerOutdated",
    });
  });

  it.each([
    "Runner request failed (HTTP 503).",
    new Error("Runner request failed (HTTP 400)."),
    `secret\u0000${"x".repeat(500)}`,
    "",
    undefined,
    null,
    { message: "Runner request failed (HTTP 404)." },
  ])("keeps nothing of the unrecognised failure %j", (error) => {
    expect(remoteProjectFolderFailure(error)).toEqual({ kind: "unknown" });
  });
});
