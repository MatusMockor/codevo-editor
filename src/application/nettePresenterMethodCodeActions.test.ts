import { describe, expect, it } from "vitest";
import { nettePresenterMethodCodeActionsFromDiagnosticData } from "./nettePresenterMethodCodeActions";

const presenterPath = "/project/app/Presenters/ProductPresenter.php";

function presenterSource(body = ""): string {
  return `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
${body}}
`;
}

describe("nettePresenterMethodCodeActionsFromDiagnosticData", () => {
  it("creates actions for two candidate presenter methods", () => {
    const actions = nettePresenterMethodCodeActionsFromDiagnosticData({
      candidateMethodNames: ["actionShow", "renderShow"],
      presenterPath,
      presenterSource: presenterSource(),
    });

    expect(actions.map((action) => action.title)).toEqual([
      "Create actionShow",
      "Create renderShow",
    ]);
    expect(actions[0]).toMatchObject({
      isPreferred: true,
      kind: "quickfix",
    });
    expect(actions[1]).toMatchObject({
      kind: "quickfix",
    });
    expect(actions[1]?.isPreferred).toBeUndefined();
    expect(actions.flatMap((action) => action.edits).map((edit) => edit.path))
      .toEqual([presenterPath, presenterPath]);
    expect(actions[0]?.edits[0]?.text).toContain(
      "public function actionShow()",
    );
    expect(actions[1]?.edits[0]?.text).toContain(
      "public function renderShow()",
    );
  });

  it("creates an action for one signal candidate", () => {
    const actions = nettePresenterMethodCodeActionsFromDiagnosticData({
      candidateMethodNames: ["handleDelete"],
      presenterPath,
      presenterSource: presenterSource(),
    });

    expect(actions).toEqual([
      expect.objectContaining({
        isPreferred: true,
        kind: "quickfix",
        title: "Create handleDelete",
      }),
    ]);
    expect(actions[0]?.edits[0]).toEqual(
      expect.objectContaining({
        path: presenterPath,
        text: expect.stringContaining("public function handleDelete()"),
      }),
    );
  });

  it("returns no actions when any candidate method already exists", () => {
    const actions = nettePresenterMethodCodeActionsFromDiagnosticData({
      candidateMethodNames: ["actionShow", "renderShow"],
      presenterPath,
      presenterSource: presenterSource(`    public function renderShow(): void
    {
    }
`),
    });

    expect(actions).toEqual([]);
  });

  it("targets the presenter class named by the presenter file", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class Helper
{
}

class ProductPresenter extends Presenter
{
}
`;
    const actions = nettePresenterMethodCodeActionsFromDiagnosticData({
      candidateMethodNames: ["renderShow"],
      presenterPath,
      presenterSource: source,
    });

    expect(actions[0]?.edits[0]?.text).toContain(
      "public function renderShow()",
    );
    expect(actions[0]?.edits[0]?.range.startLineNumber).toBeGreaterThan(8);
  });

  it("returns no actions when the presenter file does not contain the expected class", () => {
    const actions = nettePresenterMethodCodeActionsFromDiagnosticData({
      candidateMethodNames: ["renderShow"],
      presenterPath,
      presenterSource: `<?php

use Nette\\Application\\UI\\Presenter;

class OtherPresenter extends Presenter
{
}
`,
    });

    expect(actions).toEqual([]);
  });

  it("returns no actions when a bare Presenter parent is imported from a project base class", () => {
    const source = `<?php

use App\\UI\\Presenter;

final class ProductPresenter extends Presenter
{
}
`;

    expect(
      nettePresenterMethodCodeActionsFromDiagnosticData({
        candidateMethodNames: ["actionShow", "renderShow"],
        presenterPath,
        presenterSource: source,
      }),
    ).toEqual([]);
  });

  it("returns no actions for an unsafe presenter", () => {
    const source = `<?php

class ProductPresenter extends BasePresenter
{
}
`;

    expect(
      nettePresenterMethodCodeActionsFromDiagnosticData({
        candidateMethodNames: ["actionShow"],
        presenterPath,
        presenterSource: source,
      }),
    ).toEqual([]);
  });
});
