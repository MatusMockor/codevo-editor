// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemoteAddProjectStep } from "../../../application/useRemoteAddProject";
import { RemoteAddProjectStepBody } from "./RemoteAddProjectStepBody";
import { remoteAddProjectSourceRows } from "./remoteAddProjectPresentation";
import {
  fakeRemoteAddProjectController,
  pendingLookupFixture,
  readyAvailability,
  repositoryInfoFixture,
  type FakeRemoteAddProjectController,
} from "./remoteAddProjectTestSupport";

describe("RemoteAddProjectStepBody", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("routes every step to its own body", () => {
    render({ kind: "sources" });
    expect(host.querySelector('[aria-label="Sources"]')).not.toBeNull();

    render({ kind: "serverProjects" });
    expect(host.querySelector('[aria-label="Server projects"]')).not.toBeNull();

    render({ kind: "urlEntry", entry: "", lookup: pendingLookupFixture() });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Looking up the repository…");

    render({
      kind: "repository",
      provider: "gitlab",
      host: "gitlab.com",
      hosts: [],
      hostsTruncated: false,
      entry: "",
      lookup: { status: "settled", outcome: { status: "notFound" } },
    });
    expect(host.textContent).toContain("The GitLab CLI (glab)");

    render({
      kind: "confirm",
      candidate: { kind: "repository", repository: repositoryInfoFixture({}) },
      name: "editor",
      branch: "",
      protocol: "ssh",
      nameError: null,
      branchError: null,
      existingProjectKey: null,
      submitError: null,
      submitting: false,
    });
    expect(host.querySelector("form")).not.toBeNull();
  });

  function render(
    step: RemoteAddProjectStep,
    controller: FakeRemoteAddProjectController = fakeRemoteAddProjectController({ step }),
  ): void {
    act(() => {
      root.render(
        <RemoteAddProjectStepBody
          activeIndex={0}
          controller={controller}
          hiddenCount={0}
          listboxId="listbox"
          onHighlight={() => undefined}
          optionPrefix="option-"
          primary={() => undefined}
          projects={[{ key: "remote:linux:r:a", label: "alpha" }]}
          sources={remoteAddProjectSourceRows(controller.availability)}
          step={step}
        />,
      );
    });
  }

  it("routes the Use Git URL action to the controller", () => {
    const controller = fakeRemoteAddProjectController({});
    render(
      {
        kind: "repository",
        provider: "github",
        host: "github.com",
        hosts: [],
        hostsTruncated: false,
        entry: "acme/storefront-api",
        lookup: { status: "settled", outcome: { status: "notFound" } },
      },
      controller,
    );

    const action = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Use Git URL",
    );
    act(() => action?.click());

    expect(controller.useGitUrl).toHaveBeenCalledTimes(1);
    expect(controller.chooseSource).not.toHaveBeenCalled();
  });

  it("routes the retry action to the controller", () => {
    const controller = fakeRemoteAddProjectController({
      availability: {
        ...readyAvailability(),
        gitUrl: { status: "unavailable", reason: "probeFailed" },
      },
    });
    render({ kind: "sources" }, controller);

    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    act(() => retry?.click());

    expect(controller.retrySources).toHaveBeenCalledTimes(1);
  });
});
