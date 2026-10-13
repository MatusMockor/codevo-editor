// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_PROJECT_REGISTRATION_REJECTIONS } from "../domain/remoteProjectRegistration";
import {
  BILLING_KEY,
  BILLING_PATH,
  BILLING_ROW,
  FOLDER_RUNNER,
  mountFolderHarness,
  openFolderNaming,
  OTHER_ROW,
  REGISTERED,
  type FolderHarness,
  type FolderHarnessOptions,
} from "../test/remoteProjectFolderTestSupport";
import {
  INITIAL_REMOTE_ADD_PROJECT_FOLDER,
  type RemoteRunnerFolderProjectSupport,
} from "./remoteAddProjectFolder";
import type { RemoteProjectRegistrationRunner } from "./remoteProjectRegistrationGateway";
import { REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS } from "./useRemoteProjectFolderRegistration";

const OTHER_PATH = "/srv/repos/my.project";
const OLDER = { folderProjects: "unsupported" } as const;
const OPENED = { ...OLDER, phase: "browsing", path: null } as const;

describe("useRemoteProjectFolderRegistration", () => {
  let harness: FolderHarness;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    harness.unmount();
    vi.useRealTimers();
  });

  function mount(options: FolderHarnessOptions = {}): FolderHarness {
    harness = mountFolderHarness(options);
    return harness;
  }

  async function submit(options: FolderHarnessOptions = {}): Promise<FolderHarness> {
    const mounted = mount(options);
    await openFolderNaming(mounted);
    await mounted.run((controller) => controller.submit());
    return mounted;
  }

  it("is closed until it is opened for a server and starts in the browser", async () => {
    mount();
    await harness.render();
    expect(harness.controller.open).toBe(false);
    expect(harness.controller.directoryGateway).toBeNull();
    await harness.run((controller) => controller.chooseFolder(BILLING_PATH));
    expect(harness.controller.folder).toEqual(INITIAL_REMOTE_ADD_PROJECT_FOLDER);
    expect(harness.identifyRunner).not.toHaveBeenCalled();

    await harness.openFor();
    expect(harness.controller.open).toBe(true);
    expect(harness.controller.directoryGateway).not.toBeNull();
    expect(harness.controller.folder).toEqual(OPENED);
  });

  it("prefills the name from the chosen folder and steps back to the browser", async () => {
    mount();
    await openFolderNaming(harness, OTHER_PATH);
    expect(harness.controller.folder).toEqual({
      ...OLDER,
      phase: "ready",
      path: OTHER_PATH,
      name: "my-project",
    });
    await harness.run((controller) => controller.back());
    expect(harness.controller.folder).toEqual({ ...OLDER, phase: "browsing", path: OTHER_PATH });
  });

  it("identifies the runner, registers, refreshes, selects the new project and closes", async () => {
    await submit();
    expect(harness.controller.folder).toMatchObject({
      phase: "submitting",
      path: BILLING_PATH,
      name: "billing",
    });
    expect(harness.identifyRunner).toHaveBeenCalledTimes(2);
    expect(harness.registerProject).toHaveBeenCalledExactlyOnceWith({
      path: BILLING_PATH,
      name: "billing",
    });
    expect(harness.identifyRunner.mock.invocationCallOrder[1]).toBeLessThan(
      harness.registerProject.mock.invocationCallOrder[0] ?? 0,
    );
    expect(harness.refreshProjects).not.toHaveBeenCalled();

    await harness.settle(REGISTERED);

    expect(harness.refreshProjects).toHaveBeenCalledTimes(1);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    expect(harness.controller.open).toBe(false);
  });

  it("registers, selects once and closes under StrictMode", async () => {
    await submit({ strict: true });
    expect(harness.identifyRunner).toHaveBeenCalledTimes(2);
    expect(harness.registerProject).toHaveBeenCalledTimes(1);
    await harness.settle(REGISTERED);
    expect(harness.refreshProjects).toHaveBeenCalledTimes(1);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    expect(harness.controller.open).toBe(false);
  });

  it("drops a result after close and submits a fresh opening under StrictMode", async () => {
    await submit({ strict: true });
    await harness.run((controller) => controller.close());
    await harness.openFor();
    await harness.run((controller) => controller.chooseFolder(OTHER_PATH));
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);
    await harness.settle(REGISTERED, 0);
    expect(harness.selectProject).not.toHaveBeenCalled();
    await harness.settle(REGISTERED, 1);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
  });

  it("selects the project when it appears although the refresh never resolves", async () => {
    harness = mountFolderHarness();
    harness.refreshProjects.mockImplementation(() => new Promise<void>(() => undefined));
    await openFolderNaming(harness);
    await harness.run((controller) => controller.submit());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(harness.refreshProjects).toHaveBeenCalledTimes(1);
    expect(harness.controller.folder).toMatchObject({ phase: "submitting" });
    expect(vi.getTimerCount()).toBe(1);

    await harness.publish([OTHER_ROW, BILLING_ROW]);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.controller.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports the missing project after the grace period although the refresh never resolves", async () => {
    harness = mountFolderHarness();
    harness.refreshProjects.mockImplementation(() => new Promise<void>(() => undefined));
    await openFolderNaming(harness);
    await harness.run((controller) => controller.submit());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS);
    });
    expect(harness.controller.folder).toMatchObject({
      phase: "failed",
      failure: { kind: "projectMissing" },
    });
    expect(harness.selectProject).not.toHaveBeenCalled();

    await harness.run((controller) => controller.setName("billing-2"));
    expect(harness.controller.folder).toMatchObject({ phase: "ready", name: "billing-2" });
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);
    await harness.settle({ status: "rejected", reason: "name_taken" });
    expect(harness.controller.folder).toMatchObject({ phase: "rejected", reason: "name_taken" });
  });

  it("keeps a rejected refresh harmless", async () => {
    harness = mountFolderHarness();
    harness.refreshProjects.mockImplementation(() => Promise.reject(new Error("offline")));
    await openFolderNaming(harness);
    await harness.run((controller) => controller.submit());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(harness.controller.folder).toMatchObject({ phase: "submitting" });
    expect(harness.selectProject).not.toHaveBeenCalled();

    await harness.publish([BILLING_ROW]);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.controller.open).toBe(false);
  });

  it("reports the missing project after a rejected refresh", async () => {
    harness = mountFolderHarness();
    harness.refreshProjects.mockImplementation(() => Promise.reject(new Error("offline")));
    await openFolderNaming(harness);
    await harness.run((controller) => controller.submit());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS);
    });
    expect(harness.controller.folder).toMatchObject({ failure: { kind: "projectMissing" } });
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("treats a folder that was already a project as success", async () => {
    await submit();
    await harness.settle({ ...REGISTERED, created: false });
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.controller.open).toBe(false);
  });

  it("selects by the returned project id, not the requested name", async () => {
    mount();
    await openFolderNaming(harness);
    await harness.run((controller) => controller.setName("renamed"));
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledExactlyOnceWith({
      path: BILLING_PATH,
      name: "renamed",
    });
    await harness.settle({ ...REGISTERED, created: false });
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
  });

  it("selects on the runner that answered, never on another runner's project", async () => {
    harness = mountFolderHarness();
    await openFolderNaming(harness);
    harness.identifyRunner.mockResolvedValueOnce({ ...OLDER, runnerId: "runner-b" });
    await harness.run((controller) => controller.submit());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(BILLING_KEY).toContain(FOLDER_RUNNER);
    expect(harness.selectProject).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS);
    });
    expect(harness.controller.folder).toMatchObject({ failure: { kind: "projectMissing" } });
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("ignores a second submit while one is in flight", async () => {
    mount();
    await openFolderNaming(harness);
    await harness.run((controller) => {
      controller.submit();
      controller.submit();
    });
    await harness.run((controller) => controller.submit());
    expect(harness.identifyRunner).toHaveBeenCalledTimes(2);
    expect(harness.registerProject).toHaveBeenCalledTimes(1);
    await harness.settle(REGISTERED);
    expect(harness.selectProject).toHaveBeenCalledTimes(1);
  });

  it("never submits an invalid name", async () => {
    mount();
    await openFolderNaming(harness, "/srv/repos/---");
    expect(harness.controller.folder).toMatchObject({ phase: "naming", name: "" });
    await harness.run((controller) => controller.submit());
    expect(harness.identifyRunner).toHaveBeenCalledTimes(1);
    expect(harness.registerProject).not.toHaveBeenCalled();
  });

  it.each(REMOTE_PROJECT_REGISTRATION_REJECTIONS)(
    "keeps the dialog open on the %s rejection",
    async (reason) => {
      await submit();
      await harness.settle({ status: "rejected", reason });
      expect(harness.controller.folder).toEqual({
        ...OLDER,
        phase: "rejected",
        path: BILLING_PATH,
        name: "billing",
        reason,
      });
      expect(harness.refreshProjects).not.toHaveBeenCalled();
      expect(harness.selectProject).not.toHaveBeenCalled();
      expect(harness.controller.open).toBe(true);
    },
  );

  it("reports a runner that predates the route", async () => {
    await submit();
    await harness.fail("Runner request failed (HTTP 404).");
    expect(harness.controller.folder).toMatchObject({
      phase: "failed",
      failure: { kind: "runnerOutdated" },
    });
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("keeps no backend text for any other transport failure and allows a retry", async () => {
    await submit();
    await harness.fail(new Error(`Runner request failed (HTTP 503).${"!".repeat(400)}`));
    expect(harness.controller.folder).toEqual({
      ...OLDER,
      phase: "failed",
      path: BILLING_PATH,
      name: "billing",
      failure: { kind: "unknown" },
    });

    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);
    await harness.settle(REGISTERED);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
  });

  it("does not register when the runner cannot be identified", async () => {
    harness = mountFolderHarness();
    await openFolderNaming(harness);
    harness.identifyRunner.mockRejectedValueOnce(new Error("Runner request failed (HTTP 404)."));
    await harness.run((controller) => controller.submit());
    expect(harness.controller.folder).toMatchObject({
      phase: "failed",
      failure: { kind: "runnerUnreachable" },
    });
    expect(harness.registerProject).not.toHaveBeenCalled();

    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(1);
  });

  it("fails closed without a registration port", async () => {
    await submit({ registration: false });
    expect(harness.controller.folder).toMatchObject({
      phase: "failed",
      failure: { kind: "runnerUnreachable" },
    });
    expect(harness.identifyRunner).not.toHaveBeenCalled();
    expect(harness.registerProject).not.toHaveBeenCalled();
  });

  it("does not register once authority was lost while identifying the runner", async () => {
    harness = mountFolderHarness();
    const identify: { release: ((runner: RemoteProjectRegistrationRunner) => void) | null } = {
      release: null,
    };
    await openFolderNaming(harness);
    harness.identifyRunner.mockImplementationOnce(
      () =>
        new Promise<RemoteProjectRegistrationRunner>((resolve) => {
          identify.release = resolve;
        }),
    );
    await harness.run((controller) => controller.submit());
    await harness.run((controller) => controller.close());
    await act(async () => identify.release?.({ ...OLDER, runnerId: FOLDER_RUNNER }));
    await harness.settled();
    expect(harness.registerProject).not.toHaveBeenCalled();
    expect(harness.controller.open).toBe(false);
  });

  it("drops a result that arrives after the server or workspace owner was replaced", async () => {
    await submit();
    await harness.openFor("server-b");
    expect(harness.controller.folder).toEqual(OPENED);
    await harness.settle(REGISTERED);
    expect(harness.refreshProjects).not.toHaveBeenCalled();
    expect(harness.selectProject).not.toHaveBeenCalled();
    expect(harness.controller.open).toBe(true);
    expect(harness.controller.folder).toEqual(OPENED);

    await harness.run((controller) => controller.chooseFolder(BILLING_PATH));
    await harness.run((controller) => controller.submit());
    await harness.openFor("server-b", "workspace-2");
    await harness.fail("Runner request failed (HTTP 404).");
    expect(harness.controller.folder).toEqual(OPENED);
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("selects nothing when the selection moved on, and closes", async () => {
    await submit();
    await harness.select("selection-2");
    await harness.settle(REGISTERED);
    expect(harness.refreshProjects).toHaveBeenCalledTimes(1);
    expect(harness.selectProject).not.toHaveBeenCalled();
    expect(harness.controller.open).toBe(false);
  });

  it("drops a result that arrives after the dialog closed", async () => {
    await submit();
    await harness.run((controller) => controller.close());
    expect(harness.controller.open).toBe(false);
    await harness.settle(REGISTERED);
    expect(harness.refreshProjects).not.toHaveBeenCalled();
    expect(harness.selectProject).not.toHaveBeenCalled();
    expect(harness.controller.open).toBe(false);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  it("submits another folder at once after closing a pending one, and drops the old result", async () => {
    await submit();
    await harness.run((controller) => controller.close());
    await harness.openFor();
    await harness.run((controller) => controller.chooseFolder(OTHER_PATH));
    expect(harness.controller.folder).toEqual({
      ...OLDER,
      phase: "ready",
      path: OTHER_PATH,
      name: "my-project",
    });

    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);
    expect(harness.registerProject).toHaveBeenLastCalledWith({
      path: OTHER_PATH,
      name: "my-project",
    });

    await harness.settle(REGISTERED, 0);
    expect(harness.refreshProjects).not.toHaveBeenCalled();
    expect(harness.selectProject).not.toHaveBeenCalled();
    expect(harness.controller.folder).toMatchObject({ phase: "submitting", path: OTHER_PATH });
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);

    await harness.settle({ status: "rejected", reason: "not_allowed" }, 1);
    expect(harness.controller.folder).toEqual({
      ...OLDER,
      phase: "rejected",
      path: OTHER_PATH,
      name: "my-project",
      reason: "not_allowed",
    });
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(3);
    await harness.settle({ ...REGISTERED, created: false }, 2);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.controller.open).toBe(false);
  });

  it("submits at once for a replacement server while the old request is pending", async () => {
    await submit();
    await harness.openFor("server-b");
    await harness.run((controller) => controller.chooseFolder(OTHER_PATH));
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);

    await harness.fail("Runner request failed (HTTP 404).", 0);
    expect(harness.controller.folder).toMatchObject({ phase: "submitting", path: OTHER_PATH });
    await harness.run((controller) => controller.submit());
    expect(harness.registerProject).toHaveBeenCalledTimes(2);
    await harness.settle({ status: "rejected", reason: "limit_reached" }, 1);
    expect(harness.controller.folder).toMatchObject({ phase: "rejected", reason: "limit_reached" });
  });

  it("reports a project that never appears instead of selecting another", async () => {
    await submit({ projectsAfterRefresh: [OTHER_ROW] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(harness.controller.folder).toMatchObject({ phase: "submitting" });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS - 1);
    });
    expect(harness.controller.folder).toMatchObject({ phase: "submitting" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(harness.controller.folder).toMatchObject({
      phase: "failed",
      failure: { kind: "projectMissing" },
    });
    expect(harness.selectProject).not.toHaveBeenCalled();
    expect(harness.controller.open).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops waiting for the project the moment the dialog closes", async () => {
    await submit({ projectsAfterRefresh: [OTHER_ROW] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(vi.getTimerCount()).toBe(1);

    await harness.run((controller) => controller.close());
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.controller.open).toBe(false);

    await harness.openFor();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.controller.folder).toEqual(OPENED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS * 2);
    });
    expect(harness.controller.folder).toEqual(OPENED);
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("stops waiting for the project when the owner is replaced", async () => {
    await submit({ projectsAfterRefresh: [OTHER_ROW] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(vi.getTimerCount()).toBe(1);
    await harness.openFor("server-b");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles nothing after unmount", async () => {
    await submit();
    harness.unmount();
    await harness.settle(REGISTERED);
    expect(harness.refreshProjects).not.toHaveBeenCalled();
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  describe("folder project support", () => {
    function deferRunnerReads() {
      const answers: Array<(runner: RemoteProjectRegistrationRunner) => void> = [];
      harness.identifyRunner.mockImplementation(
        () =>
          new Promise<RemoteProjectRegistrationRunner>((resolve) => {
            answers.push(resolve);
          }),
      );
      return async (index: number, folderProjects: RemoteRunnerFolderProjectSupport) => {
        expect(answers[index], `runner read ${index}`).toBeDefined();
        await act(async () => answers[index]?.({ runnerId: FOLDER_RUNNER, folderProjects }));
        await harness.settled();
      };
    }

    it("reads it once when the dialog opens for a runner that has it", async () => {
      mount({ folderProjects: "supported" });
      await harness.render();
      expect(harness.identifyRunner).not.toHaveBeenCalled();
      await harness.openFor();
      expect(harness.identifyRunner).toHaveBeenCalledTimes(1);
      expect(harness.controller.folder).toEqual({
        phase: "browsing",
        path: null,
        folderProjects: "supported",
      });
      await harness.run((controller) => controller.chooseFolder(BILLING_PATH));
      expect(harness.controller.folder).toEqual({
        phase: "ready",
        path: BILLING_PATH,
        name: "billing",
        folderProjects: "supported",
      });
      await harness.run((controller) => controller.back());
      expect(harness.identifyRunner).toHaveBeenCalledTimes(1);
      expect(harness.registerProject).not.toHaveBeenCalled();
    });

    it("stays unknown while the runner has not answered", async () => {
      mount();
      const answer = deferRunnerReads();
      await openFolderNaming(harness);
      expect(harness.controller.folder).toEqual({
        phase: "ready",
        path: BILLING_PATH,
        name: "billing",
        folderProjects: "unknown",
      });
      await answer(0, "supported");
      expect(harness.controller.folder).toMatchObject({
        phase: "ready",
        folderProjects: "supported",
      });
    });

    it("stays unknown without reporting a failure when the opening read fails", async () => {
      mount({ folderProjects: "supported" });
      harness.identifyRunner.mockRejectedValueOnce(new Error("Runner request failed (HTTP 404)."));
      await openFolderNaming(harness);
      expect(harness.controller.folder).toEqual({
        phase: "ready",
        path: BILLING_PATH,
        name: "billing",
        folderProjects: "unknown",
      });

      await harness.run((controller) => controller.submit());
      expect(harness.identifyRunner).toHaveBeenCalledTimes(2);
      expect(harness.controller.folder).toMatchObject({
        phase: "submitting",
        folderProjects: "supported",
      });
      await harness.settle({ status: "rejected", reason: "not_git_root" });
      expect(harness.controller.folder).toEqual({
        phase: "rejected",
        path: BILLING_PATH,
        name: "billing",
        reason: "not_git_root",
        folderProjects: "supported",
      });
    });

    it("does not read it without a registration port", async () => {
      mount({ registration: false, folderProjects: "supported" });
      await openFolderNaming(harness);
      expect(harness.identifyRunner).not.toHaveBeenCalled();
      expect(harness.controller.folder).toMatchObject({
        phase: "ready",
        folderProjects: "unknown",
      });
    });

    it("takes the answer of the submission over the one read at opening", async () => {
      mount();
      await openFolderNaming(harness);
      expect(harness.controller.folder).toMatchObject({ folderProjects: "unsupported" });
      harness.identifyRunner.mockResolvedValueOnce({
        runnerId: FOLDER_RUNNER,
        folderProjects: "supported",
      });
      await harness.run((controller) => controller.submit());
      await harness.settle({ status: "rejected", reason: "not_git_root" });
      expect(harness.controller.folder).toMatchObject({
        phase: "rejected",
        folderProjects: "supported",
      });
    });

    it("drops an older read that settles after a newer one", async () => {
      mount();
      const answer = deferRunnerReads();
      await openFolderNaming(harness);
      await harness.run((controller) => controller.submit());
      expect(harness.identifyRunner).toHaveBeenCalledTimes(2);
      await answer(1, "supported");
      expect(harness.controller.folder).toMatchObject({
        phase: "submitting",
        folderProjects: "supported",
      });
      await answer(0, "unsupported");
      expect(harness.controller.folder).toMatchObject({
        phase: "submitting",
        folderProjects: "supported",
      });
      expect(harness.registerProject).toHaveBeenCalledTimes(1);
    });

    it("never carries one server's answer to another server or a later opening", async () => {
      mount();
      const answer = deferRunnerReads();
      await harness.render();
      await harness.openFor("server-a");
      await harness.openFor("server-b");
      expect(harness.identifyRunner).toHaveBeenCalledTimes(2);
      await answer(0, "supported");
      expect(harness.controller.folder).toEqual(INITIAL_REMOTE_ADD_PROJECT_FOLDER);

      await harness.openFor("server-a");
      await answer(1, "supported");
      expect(harness.controller.folder).toEqual(INITIAL_REMOTE_ADD_PROJECT_FOLDER);

      await harness.openFor("server-b");
      await harness.openFor("server-a");
      expect(harness.identifyRunner).toHaveBeenCalledTimes(5);
      await answer(2, "supported");
      expect(harness.controller.folder).toEqual(INITIAL_REMOTE_ADD_PROJECT_FOLDER);
      await answer(4, "unsupported");
      expect(harness.controller.folder).toEqual(OPENED);
      await answer(3, "supported");
      expect(harness.controller.folder).toEqual(OPENED);
    });

    it("drops an answer that arrives after the dialog closed or the workspace changed", async () => {
      mount();
      const answer = deferRunnerReads();
      await harness.render();
      await harness.openFor();
      await harness.run((controller) => controller.close());
      await answer(0, "supported");
      expect(harness.controller.open).toBe(false);
      expect(harness.controller.folder).toEqual(INITIAL_REMOTE_ADD_PROJECT_FOLDER);

      await harness.openFor("server-a", "workspace-1");
      await harness.openFor("server-a", "workspace-2");
      await answer(1, "supported");
      expect(harness.controller.folder).toEqual(INITIAL_REMOTE_ADD_PROJECT_FOLDER);
    });

    it("publishes nothing after unmount", async () => {
      mount();
      const answer = deferRunnerReads();
      await harness.render();
      await harness.openFor();
      const before = harness.controller.folder;
      harness.unmount();
      await answer(0, "supported");
      expect(harness.controller.folder).toBe(before);
    });
  });
});
