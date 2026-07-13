import { describe, expect, it } from "vitest";
import { canProveNettePresenterMethodAbsenceLocally } from "./nettePresenterMethodAbsence";

describe("canProveNettePresenterMethodAbsenceLocally", () => {
  it("allows a presenter with no parent", () => {
    const source = "<?php\nclass ProductPresenter {\n}\n";

    expect(canProveNettePresenterMethodAbsenceLocally(source)).toBe(true);
  });

  it("allows direct fully-qualified Nette presenter inheritance", () => {
    const source =
      "<?php\nclass ProductPresenter extends \\Nette\\Application\\UI\\Presenter {\n}\n";

    expect(canProveNettePresenterMethodAbsenceLocally(source)).toBe(true);
  });

  it("rejects custom parent classes", () => {
    const source = "<?php\nclass ProductPresenter extends BasePresenter {\n}\n";

    expect(canProveNettePresenterMethodAbsenceLocally(source)).toBe(false);
  });

  it("keeps the diagnostics-compatible bare Presenter accept policy", () => {
    const source = `<?php

use App\\UI\\Presenter;

class ProductPresenter extends Presenter
{
}
`;

    expect(
      canProveNettePresenterMethodAbsenceLocally(source, undefined, {
        barePresenterParentPolicy: "accept",
      }),
    ).toBe(true);
  });

  it("rejects a bare Presenter that resolves to an app import when requested", () => {
    const source = `<?php

use App\\UI\\Presenter;

class ProductPresenter extends Presenter
{
}
`;

    expect(
      canProveNettePresenterMethodAbsenceLocally(source, undefined, {
        barePresenterParentPolicy: "resolve-import",
      }),
    ).toBe(false);
  });

  it("allows a bare Presenter that resolves to the Nette import", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
}
`;

    expect(
      canProveNettePresenterMethodAbsenceLocally(source, undefined, {
        barePresenterParentPolicy: "resolve-import",
      }),
    ).toBe(true);
  });

  it("rejects trait use anywhere inside the class body", () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
    }

    use ProductActions;
}
`;

    expect(canProveNettePresenterMethodAbsenceLocally(source)).toBe(false);
  });

  it("can inspect a later class without reading an earlier class", () => {
    const source = `<?php

class EarlierPresenter extends BasePresenter
{
}

class ProductPresenter extends \\Nette\\Application\\UI\\Presenter
{
}
`;
    const bodyStartOffset = source.indexOf("{", source.indexOf("ProductPresenter"));
    const bodyEndOffset = source.indexOf("}", bodyStartOffset);

    expect(
      canProveNettePresenterMethodAbsenceLocally(source, {
        bodyEndOffset,
        bodyStartOffset,
        name: "ProductPresenter",
      }),
    ).toBe(true);
  });
});
