import { describe, expect, it } from "vitest";
import {
  phpNettePresenterLinkCodeAction,
  phpNettePresenterLinkCodeActions,
} from "./phpNettePresenterLinkCodeActions";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

function actionsAt(
  source: string,
  target: string,
): PhpCodeActionDescriptor[] {
  const start = source.indexOf(target);

  if (start < 0) {
    throw new Error(`Target not found: ${target}`);
  }

  return phpNettePresenterLinkCodeActions(source, {
    end: start + target.length,
    start,
  });
}

function positionOffset(
  source: string,
  lineNumber: number,
  column: number,
): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let index = 0; index < lineNumber - 1; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + column - 1;
}

function applyAction(source: string, action: PhpCodeActionDescriptor): string {
  const edits = action.edits.map((edit) => ({
    end: positionOffset(
      source,
      edit.range.endLineNumber,
      edit.range.endColumn,
    ),
    start: positionOffset(
      source,
      edit.range.startLineNumber,
      edit.range.startColumn,
    ),
    text: edit.text,
  }));

  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

describe("phpNettePresenterLinkCodeActions", () => {
  it("offers action creation for a relative presenter link", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;

    const actions = actionsAt(source, "show");

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
  });

  it("offers signal handler creation for an explicit same-presenter link", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->redirect('Product:delete!');
    }
}
`;

    expect(actionsAt(source, "Product:delete!")).toEqual([
      expect.objectContaining({
        isPreferred: true,
        kind: "quickfix",
        title: "Create handleDelete",
      }),
    ]);
  });

  it("keeps the singular compatibility wrapper on the first action", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;
    const start = source.indexOf("show");
    const firstAction = phpNettePresenterLinkCodeAction(source, {
      end: start + "show".length,
      start,
    });

    expect(firstAction).toMatchObject({
      isPreferred: true,
      kind: "quickfix",
      title: "Create actionShow",
    });
  });

  it.each(["actionShow", "renderShow"])(
    "does not offer an action when %s already exists",
    (methodName) => {
      const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }

    public function ${methodName}(): void
    {
    }
}
`;

      expect(actionsAt(source, "show")).toEqual([]);
    },
  );

  it("ignores explicit links to another presenter", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class OrderPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->redirect('Product:delete!');
    }
}
`;

    expect(actionsAt(source, "Product:delete!")).toEqual([]);
  });

  it.each([":Product:delete!", "Admin:Product:delete!"])(
    "ignores module or absolute links: %s",
    (target) => {
      const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->redirect('${target}');
    }
}
`;

      expect(actionsAt(source, target)).toEqual([]);
    },
  );

  it("ignores dynamic links", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(string $target): void
    {
        $this->link($target);
    }
}
`;

    expect(actionsAt(source, "$target")).toEqual([]);
  });

  it("does not offer an action when a custom parent may provide the method", () => {
    const source = `<?php

class ProductPresenter extends BasePresenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;

    expect(actionsAt(source, "show")).toEqual([]);
  });

  it("does not treat an imported app Presenter as direct Nette inheritance", () => {
    const source = `<?php

use App\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;

    expect(actionsAt(source, "show")).toEqual([]);
  });

  it("allows bare Presenter when it resolves to the Nette presenter import", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;

    expect(actionsAt(source, "show").map((action) => action.title)).toEqual([
      "Create actionShow",
      "Create renderShow",
    ]);
  });

  it("does not offer an action when a trait may provide the method", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    use ProductActions;

    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;

    expect(actionsAt(source, "show")).toEqual([]);
  });

  it("ignores link-like calls on another receiver", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(object $linkGenerator): void
    {
        $linkGenerator->link('show');
    }
}
`;

    expect(actionsAt(source, "show")).toEqual([]);
  });

  it("inserts the missing method into the same presenter class body", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class EarlierPresenter extends Presenter
{
}

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->forward('edit');
    }
}
`;
    const action = actionsAt(source, "edit")[0];

    expect(action).toBeDefined();
    const result = applyAction(source, action!);
    const earlierBody = result.slice(0, result.indexOf("class ProductPresenter"));
    const productBody = result.slice(result.indexOf("class ProductPresenter"));

    expect(earlierBody).not.toContain("function actionEdit()");
    expect(productBody).toContain("public function actionEdit()");
  });
});
