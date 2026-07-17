import { describe, expect, it } from "vitest";
import {
  netteActionParameterPositionInSource,
  netteActionParametersFromSource,
  nettePersistentParameterPositionInSource,
  nettePersistentParametersFromSource,
} from "./nettePersistentParameters";

describe("nettePersistentParametersFromSource", () => {
  it("extracts an attribute-declared persistent parameter with type and default", () => {
    const source = `<?php
namespace App\\Presenters;

use Nette\\Application\\Attributes\\Persistent;

class ProductPresenter
{
    #[Persistent]
    public ?string $lang = null;

    public string $notPersistent = 'x';
}`;

    expect(nettePersistentParametersFromSource(source)).toEqual([
      { defaultValue: "null", name: "lang", type: "?string" },
    ]);
  });

  it("recognises the fully-qualified Persistent attribute", () => {
    const source = `<?php
class ProductPresenter
{
    #[\\Nette\\Application\\Attributes\\Persistent]
    public int $page = 1;
}`;

    expect(nettePersistentParametersFromSource(source)).toEqual([
      { defaultValue: "1", name: "page", type: "int" },
    ]);
  });

  it("recognises Persistent inside a grouped attribute list", () => {
    const source = `<?php
class ProductPresenter
{
    #[Deprecated, Persistent]
    public ?string $backlink = null;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["backlink"]);
  });

  it("recognises Persistent after an argument list containing nested brackets", () => {
    const source = `<?php
class ProductPresenter
{
    #[Choice([1, 2]), Persistent]
    public int $page = 1;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["page"]);
  });

  it("recognises Persistent before an argument list containing nested brackets", () => {
    const source = `<?php
class ProductPresenter
{
    #[Persistent, Choice([1, 2])]
    public int $page = 1;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["page"]);
  });

  it("does not misread bracketed attribute arguments as the Persistent attribute", () => {
    const source = `<?php
class ProductPresenter
{
    #[Choice(['Persistent', 2])]
    public int $page = 1;
}`;

    expect(nettePersistentParametersFromSource(source)).toEqual([]);
  });

  it("recognises an aliased Persistent import", () => {
    const source = `<?php
namespace App\\Presenters;

use Nette\\Application\\Attributes\\Persistent as Persist;

class ProductPresenter
{
    #[Persist]
    public ?string $lang = null;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["lang"]);
  });

  it("keeps a readonly public persistent property persistent", () => {
    const source = `<?php
class ProductPresenter
{
    #[Persistent]
    public readonly ?string $lang;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["lang"]);
  });

  it("extracts a legacy @persistent docblock parameter", () => {
    const source = `<?php
class ProductPresenter
{
    /** @persistent */
    public $lang;
}`;

    expect(nettePersistentParametersFromSource(source)).toEqual([
      { defaultValue: null, name: "lang", type: null },
    ]);
  });

  it("ignores non-public and static properties", () => {
    const source = `<?php
class ProductPresenter
{
    #[Persistent]
    private ?string $secret = null;

    #[Persistent]
    public static ?string $shared = null;

    #[Persistent]
    public ?string $lang = null;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["lang"]);
  });

  it("does not misread an attribute-looking string literal as an attribute", () => {
    const source = `<?php
class ProductPresenter
{
    public string $sample = '#[Persistent]';
    public ?string $lang = null;
}`;

    expect(nettePersistentParametersFromSource(source)).toEqual([]);
  });

  it("extracts persistent parameters declared in a trait", () => {
    const source = `<?php
trait PaginationAware
{
    #[Persistent]
    public int $page = 1;
}`;

    expect(
      nettePersistentParametersFromSource(source).map((parameter) => parameter.name),
    ).toEqual(["page"]);
  });
});

describe("nettePersistentParameterPositionInSource", () => {
  it("locates the persistent property declarator", () => {
    const source = `<?php
class ProductPresenter
{
    #[Persistent]
    public ?string $lang = null;
}`;

    expect(nettePersistentParameterPositionInSource(source, "lang")).toEqual({
      column: 20,
      lineNumber: 5,
    });
  });

  it("returns null for an unknown or non-persistent name", () => {
    const source = `<?php
class ProductPresenter
{
    public ?string $lang = null;
}`;

    expect(nettePersistentParameterPositionInSource(source, "lang")).toBeNull();
    expect(nettePersistentParameterPositionInSource(source, "missing")).toBeNull();
  });
});

describe("netteActionParametersFromSource", () => {
  it("returns parameters of the first matching action method candidate", () => {
    const source = `<?php
class ProductPresenter
{
    public function renderShow(string $slug): void {}

    public function actionShow(string $id, int $page = 1): void {}
}`;

    expect(
      netteActionParametersFromSource(source, ["actionShow", "renderShow"])?.map(
        (parameter) => parameter.name,
      ),
    ).toEqual(["id", "page"]);
  });

  it("returns null when no candidate method exists", () => {
    const source = "<?php class ProductPresenter {}";

    expect(
      netteActionParametersFromSource(source, ["actionShow", "renderShow"]),
    ).toBeNull();
  });
});

describe("netteActionParameterPositionInSource", () => {
  it("locates a parameter inside the matching action method signature", () => {
    const source = `<?php
class ProductPresenter
{
    public function actionShow(string $id, int $page = 1): void {}
}`;

    expect(
      netteActionParameterPositionInSource(source, ["actionShow"], "page"),
    ).toEqual({ column: 48, lineNumber: 4 });
  });

  it("returns null for a parameter missing from the signature", () => {
    const source = `<?php
class ProductPresenter
{
    public function actionShow(string $id): void {}
}`;

    expect(
      netteActionParameterPositionInSource(source, ["actionShow"], "page"),
    ).toBeNull();
  });
});
