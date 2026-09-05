import { describe, expect, it } from "vitest";
import { createWorkbenchNotice } from "../application/workbenchNotice";
import { appUpdateToastGroupKey } from "../domain/appUpdater";
import {
  agentProviderUpdateToastGroupKey,
  createAgentProviderUpdateToastView,
} from "./agentProviderUpdateToastPresenter";
import { composeToastNotices } from "./updateToastNotices";

const VIEW = createAgentProviderUpdateToastView("codex", "0.153.4")!;

describe("composeToastNotices", () => {
  it("projects provider updates ahead of application updates with stable identities", () => {
    const sources = {
      app: { kind: "readyToInstall", version: "0.2.0" },
      provider: { kind: "available", view: VIEW },
    } as const;
    const notices = composeToastNotices(sources, []);

    expect(notices.map((notice) => notice.id)).toEqual([
      agentProviderUpdateToastGroupKey({ kind: "available", view: VIEW }),
      appUpdateToastGroupKey({ kind: "readyToInstall", version: "0.2.0" }),
    ]);
    expect(notices.map((notice) => notice.groupKey)).toEqual(notices.map((notice) => notice.id));
    expect(notices.map((notice) => notice.message)).toEqual([
      "Update Available: Codex v0.153.4",
      "Update Available: Codevo v0.2.0",
    ]);
    expect(notices.map((notice) => notice.severity)).toEqual(["info", "info"]);
    expect(composeToastNotices(sources, [])).toEqual(notices);
  });

  it("marks failures as errors and returns the workbench notices untouched without updates", () => {
    const crash = createWorkbenchNotice("error", "Language Server", "Crashed", "crash");
    const notices = composeToastNotices(
      {
        app: {
          kind: "failed",
          version: "0.2.0",
          operation: "installAndRestart",
          message: "Failed.",
        },
        provider: {
          kind: "failed",
          provider: "codex",
          reason: "exited",
          outputTail: "",
          installedVersion: null,
          retryVersion: null,
        },
      },
      [],
    );

    expect(notices.map((notice) => notice.severity)).toEqual(["error", "error"]);
    expect(composeToastNotices({ app: null, provider: null }, [crash])).toEqual([crash]);
  });

  it("keeps error and warning workbench notices in front of update toasts", () => {
    const crash = createWorkbenchNotice("error", "Language Server", "Crashed", "crash");
    const capacity = createWorkbenchNotice("warning", "Notices", "Capped", "capped");
    const hint = createWorkbenchNotice("info", "Tasks", "Finished", "tasks");
    const notices = composeToastNotices(
      {
        app: { kind: "downloading", version: "0.2.0" },
        provider: { kind: "available", view: VIEW },
      },
      [hint, crash, capacity],
    );

    expect(notices.map((notice) => notice.id)).toEqual([
      crash.id,
      capacity.id,
      agentProviderUpdateToastGroupKey({ kind: "available", view: VIEW }),
      appUpdateToastGroupKey({ kind: "downloading", version: "0.2.0" }),
      hint.id,
    ]);
  });
});
