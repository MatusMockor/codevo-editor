import { describe, expect, it } from "vitest";
import {
  projectNetteWorkspacePresenters,
  type NetteWorkspacePresentersResult,
} from "./netteWorkspacePresenters";

const ROOT = "/workspace";

function ok(result: NetteWorkspacePresentersResult) {
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error(result.message);
  return result;
}

describe("projectNetteWorkspacePresenters", () => {
  it("indexes a presenter class, merged action/render methods, signals and existing templates", () => {
    const path = `${ROOT}/app/UI/Home/HomePresenter.php`;
    const source = [
      "<?php",
      "namespace App\\UI\\Home;",
      "class HomePresenter",
      "{",
      "    public function actionDetail(): void {}",
      "    protected function renderDetail(): void {}",
      "    public function renderDefault(): void {}",
      "    public function handleRefresh(): void {}",
      "    private function handleHidden(): void {}",
      "}",
    ].join("\n");
    const result = ok(
      projectNetteWorkspacePresenters(
        ROOT,
        [{ path, source }],
        [
          "app/UI/Home/detail.latte",
          "app/UI/Home/default.latte",
          "app/UI/Home/missing-owner.latte",
        ],
      ),
    );
    const presenter = result.presenters[0]!;

    expect(presenter).toEqual(
      expect.objectContaining({
        name: "Home",
        className: "App\\UI\\Home\\HomePresenter",
        source: { path, lineNumber: 3, column: 7 },
        actionsTruncated: false,
        signalsTruncated: false,
      }),
    );
    expect(
      presenter.actions.map((action) => ({
        name: action.name,
        action: action.actionMethod?.methodName ?? null,
        render: action.renderMethod?.methodName ?? null,
        templates: action.templates.map((template) => template.path),
      })),
    ).toEqual([
      {
        name: "detail",
        action: "actionDetail",
        render: "renderDetail",
        templates: [`${ROOT}/app/UI/Home/detail.latte`],
      },
      {
        name: "default",
        action: null,
        render: "renderDefault",
        templates: [`${ROOT}/app/UI/Home/default.latte`],
      },
    ]);
    expect(presenter.signals).toEqual([
      expect.objectContaining({
        name: "refresh",
        method: expect.objectContaining({
          methodName: "handleRefresh",
          source: { path, lineNumber: 8, column: 21 },
        }),
      }),
    ]);
    expect(
      new Set([
        presenter.key,
        ...presenter.actions.map((action) => action.key),
        ...presenter.signals.map((signal) => signal.key),
      ]).size,
    ).toBe(4);
  });

  it("supports classic template candidates conservatively", () => {
    const path = `${ROOT}/app/Presenters/OrderPresenter.php`;
    const result = ok(
      projectNetteWorkspacePresenters(
        ROOT,
        [
          {
            path,
            source: "<?php class OrderPresenter { public function renderShow(): void {} }",
          },
        ],
        [
          "app/Presenters/templates/Order/show.latte",
          "app/Presenters/templates/Order.show.latte",
          "app/Presenters/templates/Other/show.latte",
        ],
      ),
    );

    expect(result.presenters[0]?.actions[0]?.templates.map((entry) => entry.path)).toEqual([
      `${ROOT}/app/Presenters/templates/Order/show.latte`,
      `${ROOT}/app/Presenters/templates/Order.show.latte`,
    ]);
  });

  it("uses a dirty presenter overlay and preserves its source path", () => {
    const path = `${ROOT}/app/UI/Home/HomePresenter.php`;
    const result = ok(
      projectNetteWorkspacePresenters(
        ROOT,
        [{ path, source: "<?php class HomePresenter {}" }],
        [],
        [
          {
            path,
            source: "<?php class HomePresenter { public function handleDirty(): void {} }",
          },
        ],
      ),
    );

    expect(result.presenters[0]?.signals).toEqual([expect.objectContaining({ name: "dirty" })]);
    expect(result.presenters[0]?.source.path).toBe(path);
  });

  it("rejects outside and dot-segment source paths", () => {
    const source = "<?php class EscapePresenter { public function renderDefault(): void {} }";
    const result = ok(
      projectNetteWorkspacePresenters(
        ROOT,
        [
          { path: "/outside/EscapePresenter.php", source },
          { path: `${ROOT}/app/../outside/EscapePresenter.php`, source },
          { path: `${ROOT}/app/ValidPresenter.php`, source },
        ],
        [],
      ),
    );

    expect(result.presenters.map((presenter) => presenter.name)).toEqual(["Valid"]);
  });

  it("bounds presenters, actions, signals and templates with explicit flags", () => {
    const methods = [
      "public function renderFirst(): void {}",
      "public function renderSecond(): void {}",
      "public function handleOne(): void {}",
      "public function handleTwo(): void {}",
    ].join(" ");
    const result = ok(
      projectNetteWorkspacePresenters(
        ROOT,
        [
          {
            path: `${ROOT}/app/A/AlphaPresenter.php`,
            source: `<?php class AlphaPresenter { ${methods} }`,
          },
          { path: `${ROOT}/app/B/BetaPresenter.php`, source: "<?php class BetaPresenter {}" },
        ],
        ["app/A/first.latte", "app/A/templates/Alpha/first.latte"],
        [],
        {
          maxPresenters: 1,
          maxActionsPerPresenter: 1,
          maxSignalsPerPresenter: 1,
          maxTemplatesPerAction: 1,
        },
      ),
    );

    expect(result).toEqual(expect.objectContaining({ total: 2, truncated: true }));
    expect(result.presenters[0]).toEqual(
      expect.objectContaining({
        actionsTruncated: true,
        signalsTruncated: true,
        actions: [expect.objectContaining({ templatesTruncated: true })],
      }),
    );
  });

  it("does not treat class-like text in comments as the presenter declaration", () => {
    const result = ok(
      projectNetteWorkspacePresenters(
        ROOT,
        [
          {
            path: `${ROOT}/app/RealPresenter.php`,
            source: "<?php /* class FakePresenter {} */ namespace App; class RealPresenter {}",
          },
        ],
        [],
      ),
    );

    expect(result.presenters[0]?.className).toBe("App\\RealPresenter");
  });
});
