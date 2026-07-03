import { describe, expect, it } from "vitest";
import {
  isNetteComponentAccess,
  isNetteSmartObjectMagicProperty,
  isNetteTemplateMagicMember,
} from "./netteMagicDiagnostics";

const presenterSource = `<?php

class ProductPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $this->template->product = $this->product;
    }
}
`;

const plainSource = `<?php

class ProductService
{
    public function run(): void
    {
        $this->template->product = 1;
    }
}
`;

describe("isNetteTemplateMagicMember", () => {
  it("classifies any member on $this->template inside a presenter/control", () => {
    expect(
      isNetteTemplateMagicMember(presenterSource, {
        memberName: "product",
        receiverExpression: "$this->template",
      }),
    ).toBe(true);
  });

  it("classifies members when the receiver is a Nette Template class", () => {
    expect(
      isNetteTemplateMagicMember(plainSource, {
        memberName: "product",
        receiverClassName: "Nette\\Bridges\\ApplicationLatte\\Template",
        receiverExpression: "$template",
      }),
    ).toBe(true);
  });

  it("does not classify $this->template outside a presenter/control context", () => {
    expect(
      isNetteTemplateMagicMember(plainSource, {
        memberName: "product",
        receiverExpression: "$this->template",
      }),
    ).toBe(false);
  });

  it("does not classify unrelated receivers", () => {
    expect(
      isNetteTemplateMagicMember(presenterSource, {
        memberName: "product",
        receiverExpression: "$this->repository",
      }),
    ).toBe(false);
  });

  it("does not classify a domain entity merely because its name ends with Template", () => {
    const source = `<?php

class EmailTemplate
{
    public string $subject;
}

class ReportGenerator
{
    public function build(EmailTemplate $emailTemplate): void
    {
        echo $emailTemplate->bodyy;
    }
}
`;

    expect(
      isNetteTemplateMagicMember(source, {
        memberName: "bodyy",
        receiverClassName: "EmailTemplate",
        receiverExpression: "$emailTemplate",
      }),
    ).toBe(false);
  });

  it("does not classify a Template-suffixed domain entity even when the file also declares a presenter", () => {
    const source = `<?php

class PdfTemplate
{
    public string $title;
}

class ReportPresenter extends BasePresenter
{
    public function renderShow(PdfTemplate $pdfTemplate): void
    {
        echo $pdfTemplate->titlee;
    }
}
`;

    expect(
      isNetteTemplateMagicMember(source, {
        memberName: "titlee",
        receiverClassName: "PdfTemplate",
        receiverExpression: "$pdfTemplate",
      }),
    ).toBe(false);
  });

  it("classifies a custom Template subclass declared alongside a presenter/control", () => {
    const source = `<?php

class ProductTemplate extends Nette\\Bridges\\ApplicationLatte\\Template
{
    public Product $product;
}

class ProductPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $this->template->product = 1;
    }
}
`;

    expect(
      isNetteTemplateMagicMember(source, {
        memberName: "product",
        receiverClassName: "ProductTemplate",
        receiverExpression: "$template",
      }),
    ).toBe(true);
  });

  it("classifies the exact Nette Template short name regardless of context", () => {
    expect(
      isNetteTemplateMagicMember(plainSource, {
        memberName: "product",
        receiverClassName: "DefaultTemplate",
        receiverExpression: "$template",
      }),
    ).toBe(true);
  });
});

describe("isNetteSmartObjectMagicProperty", () => {
  const smartObjectSource = `<?php

use Nette\\SmartObject;

/**
 * @property-read string $fullName
 */
class Person
{
    use SmartObject;
}
`;

  it("classifies @property members on a SmartObject class", () => {
    expect(
      isNetteSmartObjectMagicProperty(smartObjectSource, {
        memberName: "fullName",
        receiverExpression: "$person",
      }),
    ).toBe(true);
  });

  it("does not classify members without a matching @property annotation", () => {
    expect(
      isNetteSmartObjectMagicProperty(smartObjectSource, {
        memberName: "unknown",
        receiverExpression: "$person",
      }),
    ).toBe(false);
  });

  it("does not classify when the class does not use SmartObject", () => {
    const source = `<?php

/**
 * @property-read string $fullName
 */
class Person
{
}
`;

    expect(
      isNetteSmartObjectMagicProperty(source, {
        memberName: "fullName",
        receiverExpression: "$person",
      }),
    ).toBe(false);
  });

  it("does not classify a class that merely imports SmartObject without using the trait", () => {
    const source = `<?php

use Nette\\SmartObject;

/**
 * @property-read string $fullName
 */
class ReportService
{
    public function fullName(): string
    {
        return "x";
    }
}
`;

    expect(
      isNetteSmartObjectMagicProperty(source, {
        memberName: "fullName",
        receiverExpression: "$service",
      }),
    ).toBe(false);
  });
});

describe("isNetteComponentAccess", () => {
  it("classifies $this->getComponent(...) calls in a component context", () => {
    expect(
      isNetteComponentAccess(presenterSource, {
        methodName: "getComponent",
        receiverExpression: "$this",
      }),
    ).toBe(true);
  });

  it("classifies members accessed on $this['name'] array access", () => {
    expect(
      isNetteComponentAccess(presenterSource, {
        methodName: "render",
        receiverExpression: "$this['grid']",
      }),
    ).toBe(true);
  });

  it("classifies members chained off $this->getComponent(...)", () => {
    expect(
      isNetteComponentAccess(presenterSource, {
        methodName: "render",
        receiverExpression: "$this->getComponent('grid')",
      }),
    ).toBe(true);
  });

  it("does not classify ordinary $this method calls", () => {
    expect(
      isNetteComponentAccess(presenterSource, {
        methodName: "render",
        receiverExpression: "$this",
      }),
    ).toBe(false);
  });

  it("does not classify component access outside a component context", () => {
    expect(
      isNetteComponentAccess(plainSource, {
        methodName: "getComponent",
        receiverExpression: "$this",
      }),
    ).toBe(false);
  });

  it("does not classify component access from a class that merely imports a Nette UI namespace", () => {
    const source = `<?php

use Nette\\Application\\UI\\Form;

class ReportService
{
    public function build(): void
    {
        $this->missing = 1;
    }
}
`;

    expect(
      isNetteComponentAccess(source, {
        receiverExpression: "$this['missing']",
      }),
    ).toBe(false);
  });

  it("still classifies $this['name'] access from a real presenter", () => {
    expect(
      isNetteComponentAccess(presenterSource, {
        receiverExpression: "$this['missing']",
      }),
    ).toBe(true);
  });
});
