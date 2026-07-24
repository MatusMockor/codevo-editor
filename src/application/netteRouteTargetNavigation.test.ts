import { describe, expect, it } from "vitest";
import type { NetteWorkspacePresentersResult } from "../domain/netteWorkspacePresenters";
import { netteRouteTargetNavigationSource } from "./netteRouteTargetNavigation";

const presenterSource = { path: "/app/HomePresenter.php", lineNumber: 3, column: 7 };
const actionSource = { path: "/app/HomePresenter.php", lineNumber: 8, column: 5 };

describe("netteRouteTargetNavigationSource", () => {
  it("prefers an exact action anchor and otherwise opens the unique presenter", () => {
    const presenters = result();
    expect(
      netteRouteTargetNavigationSource(
        { action: "default", presenter: "Home", raw: "Home:default" },
        presenters,
      ),
    ).toEqual(actionSource);
    expect(
      netteRouteTargetNavigationSource(
        { action: null, presenter: "Home", raw: "Home" },
        presenters,
      ),
    ).toEqual(presenterSource);
  });

  it("fails closed for unavailable or ambiguous presenter matches", () => {
    const presenters = result();
    expect(
      netteRouteTargetNavigationSource(
        { action: null, presenter: "Home", raw: "Home" },
        { message: "closed", status: "unavailable" },
      ),
    ).toBeNull();
    expect(
      netteRouteTargetNavigationSource(
        { action: null, presenter: "Home", raw: "Home" },
        { ...presenters, truncated: true },
      ),
    ).toBeNull();
    expect(
      netteRouteTargetNavigationSource(
        { action: null, presenter: "Home", raw: "Home" },
        { ...presenters, presenters: [...presenters.presenters, presenters.presenters[0]!] },
      ),
    ).toBeNull();
  });

  it("matches the full conventional module identity and rejects a unique wrong module", () => {
    const presenters = result();
    const frontPresenter = {
      ...presenters.presenters[0]!,
      className: "App\\UI\\Front\\HomePresenter",
    };
    const adminPresenter = {
      ...presenters.presenters[0]!,
      className: "App\\AdminModule\\Presenters\\HomePresenter",
    };
    const target = { action: "default", presenter: "Front:Home", raw: "Front:Home:default" };

    expect(
      netteRouteTargetNavigationSource(target, { ...presenters, presenters: [frontPresenter] }),
    ).toEqual(actionSource);
    expect(
      netteRouteTargetNavigationSource(target, { ...presenters, presenters: [adminPresenter] }),
    ).toBeNull();
  });

  it("matches modern presentation module directories without duplicating the presenter name", () => {
    const presenters = result();
    const modernPresenter = {
      ...presenters.presenters[0]!,
      className: "App\\Presentation\\Admin\\Home\\HomePresenter",
    };

    expect(
      netteRouteTargetNavigationSource(
        { action: "default", presenter: "Admin:Home", raw: "Admin:Home:default" },
        { ...presenters, presenters: [modernPresenter] },
      ),
    ).toEqual(actionSource);
  });
});

function result(): Extract<NetteWorkspacePresentersResult, { status: "ok" }> {
  return {
    presenters: [
      {
        actions: [
          {
            actionMethod: { methodName: "actionDefault", source: actionSource },
            key: "action",
            name: "default",
            renderMethod: null,
            templates: [],
            templatesTruncated: false,
          },
        ],
        actionsTruncated: false,
        className: "App\\UI\\HomePresenter",
        key: "home",
        name: "Home",
        signals: [],
        signalsTruncated: false,
        source: presenterSource,
      },
    ],
    status: "ok",
    total: 1,
    truncated: false,
  };
}
