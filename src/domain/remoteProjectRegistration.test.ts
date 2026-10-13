import { describe, expect, it } from "vitest";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";
import {
  isRemoteProjectName,
  isRemoteProjectRegistration,
  isRemoteProjectRegistrationInput,
  isRemoteProjectRegistrationPath,
  REMOTE_PROJECT_REGISTRATION_REJECTIONS,
  remoteProjectNameFromPath,
} from "./remoteProjectRegistration";

const registered = { status: "registered", project: { id: "billing", name: "billing" } };

describe("remote project registration result", () => {
  it.each([true, false])("accepts a registered project with created=%s", (created) => {
    expect(isRemoteProjectRegistration({ ...registered, created })).toBe(true);
  });

  it.each(REMOTE_PROJECT_REGISTRATION_REJECTIONS)("accepts the %s rejection", (reason) => {
    expect(isRemoteProjectRegistration({ status: "rejected", reason })).toBe(true);
  });

  it.each([
    null,
    "registered",
    [],
    {},
    { status: "pending" },
    { status: "rejected" },
    { status: "rejected", reason: "busy" },
    { status: "rejected", reason: "name_taken", path: "/srv/billing" },
    { status: "registered", project: { id: "billing", name: "billing" } },
    { ...registered, created: "true" },
    { ...registered, created: true, path: "/srv/billing" },
    { ...registered, created: true, reason: "name_taken" },
    { status: "registered", project: null, created: true },
    { status: "registered", project: { id: "billing" }, created: true },
    { status: "registered", project: { id: "billing", name: "billing", path: "/" }, created: true },
    { status: "registered", project: { id: "-billing", name: "billing" }, created: true },
    { status: "registered", project: { id: "bill ing", name: "billing" }, created: true },
    { status: "registered", project: { id: "b".repeat(65), name: "billing" }, created: true },
    { status: "registered", project: { id: 7, name: "billing" }, created: true },
    { status: "registered", project: { id: "billing", name: "" }, created: true },
    { status: "registered", project: { id: "billing", name: "   " }, created: true },
    { status: "registered", project: { id: "billing", name: "bill\0ing" }, created: true },
    { status: "registered", project: { id: "billing", name: "n".repeat(257) }, created: true },
    { status: "registered", project: { id: "billing", name: 7 }, created: true },
  ])("rejects the malformed result %j", (value) => {
    expect(isRemoteProjectRegistration(value)).toBe(false);
  });
});

describe("remote project display name", () => {
  const accepted = [
    "a",
    "a".repeat(100),
    "a".repeat(101),
    "a".repeat(256),
    "\u00e9".repeat(128),
    "\ud83d\ude80".repeat(64),
    "bell\u0007name",
    "two\nlines",
    "  padded  ",
    "\u0085",
  ];
  const refused = [
    "",
    " ",
    "   ",
    "\t\n\r",
    "\u00a0\u2003\u3000\ufeff",
    "a".repeat(257),
    "\u00e9".repeat(129),
    "\ud83d\ude80".repeat(65),
    "nul\u0000name",
  ];
  const response = (name: string) => ({
    status: "registered",
    project: { id: "billing", name },
    created: true,
  });
  const listed = (name: string): boolean => {
    try {
      validateRemoteRunnerValue("listProjects", "response", { items: [{ id: "billing", name }] });
      return true;
    } catch {
      return false;
    }
  };

  it.each(accepted)("accepts %j exactly as the project list does", (name) => {
    expect(isRemoteProjectRegistration(response(name))).toBe(true);
    expect(listed(name)).toBe(true);
  });

  it.each(refused)("refuses %j exactly as the project list does", (name) => {
    expect(isRemoteProjectRegistration(response(name))).toBe(false);
    expect(listed(name)).toBe(false);
  });
});

describe("remote project registration input", () => {
  it("accepts an absolute folder and an identifier name", () => {
    expect(isRemoteProjectRegistrationInput({ path: "/srv/repos/billing", name: "billing" })).toBe(
      true,
    );
  });

  it.each([
    { path: "/", name: "billing" },
    { path: "srv/billing", name: "billing" },
    { path: "/srv/billing/", name: "billing" },
    { path: "/srv//billing", name: "billing" },
    { path: "/srv/../etc", name: "billing" },
    { path: "/srv/billing", name: "" },
    { path: "/srv/billing", name: "my.project" },
    { path: "/srv/billing", name: "billing\n" },
    { path: "/srv/billing", name: "billing", branch: "main" },
    { path: "/srv/billing" },
  ])("rejects the malformed input %j", (value) => {
    expect(isRemoteProjectRegistrationInput(value)).toBe(false);
  });

  it("never treats the server root as a project folder", () => {
    expect(isRemoteProjectRegistrationPath("/")).toBe(false);
    expect(isRemoteProjectRegistrationPath("/srv")).toBe(true);
  });
});

describe("remote project name", () => {
  it.each(["a", "A9", "my_project-2", "9lives", "a".repeat(64)])("accepts %s", (name) => {
    expect(isRemoteProjectName(name)).toBe(true);
  });

  it.each(["", "-x", "_x", "my.project", "my project", "a".repeat(65), "x\n", "priečinok"])(
    "rejects %j",
    (name) => {
      expect(isRemoteProjectName(name)).toBe(false);
    },
  );

  it.each([
    ["/srv/repos/billing", "billing"],
    ["/srv/repos/my.project", "my-project"],
    ["/srv/repos/-x", "x"],
    ["/srv/repos/_-9lives", "9lives"],
    ["/srv/repos/my  odd..name", "my-odd-name"],
    ["/srv/repos/a.-b", "a-b"],
    ["/srv/repos/a--b", "a-b"],
    ["/srv/repos/keep_under-score", "keep_under-score"],
    ["/srv/repos/priečinok", "prie-inok"],
    ["/srv/repos/日本語", ""],
    ["/srv/repos/🚀rocket", "rocket"],
    ["/srv/repos/...", ""],
    ["/srv/repos/---", ""],
    ["/", ""],
    ["", ""],
    ["billing", "billing"],
  ])("derives the default name of %j as %j", (path, expected) => {
    expect(remoteProjectNameFromPath(path)).toBe(expected);
  });

  it("caps a long folder name at 64 characters", () => {
    const derived = remoteProjectNameFromPath(`/srv/repos/${"a".repeat(80)}`);
    expect(derived).toBe("a".repeat(64));
    expect(isRemoteProjectName(derived)).toBe(true);
  });

  it("derives only names the runner accepts or nothing", () => {
    for (const folder of ["my.project", "-x", "...", "日本", "x".repeat(80), "a b c"]) {
      const derived = remoteProjectNameFromPath(`/srv/${folder}`);
      expect(derived === "" || isRemoteProjectName(derived)).toBe(true);
    }
  });
});
