import { describe, expect, it } from "vitest";
import {
  phpDeclaredFactoryMethod,
  phpDeclaresExactFactoryClass,
  phpDirectlyDeclaresFactoryMethod,
} from "./phpDeclaredFactoryMethod";

describe("phpDeclaredFactoryMethod", () => {
  it("extracts RouterFactory::createRouter returning an imported RouteList", () => {
    const source = `<?php
namespace App\\Routing;

use Nette\\Application\\Routers\\RouteList;

final class RouterFactory
{
    public function createRouter(): RouteList
    {
        return new RouteList();
    }
}
`;

    expect(
      phpDeclaredFactoryMethod(
        source,
        "App\\Routing\\RouterFactory",
        "createRouter",
      ),
    ).toEqual({
      declaringClassName: "App\\Routing\\RouterFactory",
      declaringSource: source,
      isStatic: false,
      nativeReturnType: "RouteList",
      resolvedReturnClassName: "Nette\\Application\\Routers\\RouteList",
      visibility: "public",
    });
  });

  it("extracts static declarations and resolves the static return type", () => {
    const source = `<?php
namespace App\\Factory;

class WidgetFactory
{
    protected static function make(): static
    {
        return new static();
    }
}`;

    expect(
      phpDeclaredFactoryMethod(source, "App\\Factory\\WidgetFactory", "make"),
    ).toMatchObject({
      isStatic: true,
      nativeReturnType: "static",
      resolvedReturnClassName: "App\\Factory\\WidgetFactory",
      visibility: "protected",
    });
  });

  it("handles attributes, comments and multiline signatures structurally", () => {
    const source = `<?php
namespace App;
use Vendor\\Package\\Result as FactoryResult;

class Factory
{
    /** @method Wrong documented() */
    #[FactoryAttribute(['function fake(): Other {}'])]
    public static function
        build(
            string $value = '): Fake {'
        )
        : ?FactoryResult
    {
        return null;
    }
}`;

    expect(
      phpDeclaredFactoryMethod(source, "App\\Factory", "build"),
    ).toMatchObject({
      isStatic: true,
      nativeReturnType: "?FactoryResult",
      resolvedReturnClassName: "Vendor\\Package\\Result",
      visibility: "public",
    });
    expect(phpDeclaresExactFactoryClass(source, "App\\Factory")).toBe(true);
    expect(phpDeclaresExactFactoryClass(source, "App\\Wrong")).toBe(false);
  });

  it("honors quoted strings and comments while balancing attributes", () => {
    const source = `<?php
namespace App;

#[Marker("] class Decoy { public function make(): Wrong {}", "[", /* ] */ true,
    // ] class AlsoDecoy {}
    true)]
class Factory
{
    #[Marker("[", "] function fake(): Wrong {}", /* [ ] */ true)]
    public function make(): Result {}
}`;

    expect(
      phpDeclaredFactoryMethod(source, "App\\Factory", "make"),
    ).toMatchObject({
      nativeReturnType: "Result",
      resolvedReturnClassName: "App\\Result",
      visibility: "public",
    });
  });

  it("resolves comma-separated imports and aliases structurally", () => {
    const source = `<?php
namespace App;
use Vendor\\Ignored as Other, Nette\\Application\\Routers\\RouteList as Routes;

class RouterFactory
{
    public function createRouter(): Routes {}
}`;

    expect(
      phpDeclaredFactoryMethod(
        source,
        "App\\RouterFactory",
        "createRouter",
      ),
    ).toMatchObject({
      nativeReturnType: "Routes",
      resolvedReturnClassName: "Nette\\Application\\Routers\\RouteList",
    });
  });

  it("matches an inline namespace after the PHP opening tag", () => {
    const source = `<?php namespace App\\Routing;
use Nette\\Application\\Routers\\RouteList;
final class RouterFactory {
    public function createRouter(): RouteList {}
}`;

    expect(
      phpDeclaredFactoryMethod(
        source,
        "App\\Routing\\RouterFactory",
        "createRouter",
      ),
    ).toMatchObject({
      declaringClassName: "App\\Routing\\RouterFactory",
      resolvedReturnClassName: "Nette\\Application\\Routers\\RouteList",
    });
    expect(
      phpDeclaredFactoryMethod(source, "RouterFactory", "createRouter"),
    ).toBeNull();
  });

  it.each([
    ["int", "int"],
    ["Result|null", "Result|null"],
    ["Left&Right", "Left&Right"],
  ])(
    "preserves the native %s return without inventing one class",
    (type, expected) => {
      const source = `<?php
namespace App;
class Factory { public function make(): ${type} {} }
`;

      expect(
        phpDeclaredFactoryMethod(source, "App\\Factory", "make"),
      ).toMatchObject({
        nativeReturnType: expected,
        resolvedReturnClassName: null,
      });
    },
  );

  it("resolves fully-qualified single class-like returns", () => {
    const source = `<?php
namespace App;
class Factory
{
    public function make(): \\Vendor\\Package\\Result {}
}`;

    expect(
      phpDeclaredFactoryMethod(source, "App\\Factory", "make"),
    ).toMatchObject({
      nativeReturnType: "\\Vendor\\Package\\Result",
      resolvedReturnClassName: "Vendor\\Package\\Result",
    });
  });

  it("rejects private, missing and PHPDoc-only methods", () => {
    const source = `<?php
namespace App;
/** @method Result magicFactory() */
class Factory
{
    private function hidden(): Result {}
}`;

    expect(phpDeclaredFactoryMethod(source, "App\\Factory", "hidden")).toBeNull();
    expect(
      phpDirectlyDeclaresFactoryMethod(source, "App\\Factory", "hidden"),
    ).toBe(true);
    expect(phpDeclaredFactoryMethod(source, "App\\Factory", "missing")).toBeNull();
    expect(
      phpDeclaredFactoryMethod(source, "App\\Factory", "magicFactory"),
    ).toBeNull();
  });

  it("requires the exact target FQCN", () => {
    const source = `<?php
namespace App;
class Factory { public function make(): object {} }
`;

    expect(phpDeclaredFactoryMethod(source, "Other\\Factory", "make")).toBeNull();
    expect(phpDeclaredFactoryMethod(source, "App\\OtherFactory", "make")).toBeNull();
  });

  it("rejects files with multiple named types", () => {
    const source = `<?php
namespace App;
class Factory { public function make(): object {} }
class Other { public function make(): object {} }
`;

    expect(phpDeclaredFactoryMethod(source, "App\\Factory", "make")).toBeNull();
  });

  it("rejects duplicate method declarations as ambiguous", () => {
    const source = `<?php
namespace App;
class Factory
{
    public function make(): object {}
    public function MAKE(): object {}
}`;

    expect(phpDeclaredFactoryMethod(source, "App\\Factory", "make")).toBeNull();
  });

  it("does not accept an interface, trait or enum as the target class", () => {
    expect(
      phpDeclaredFactoryMethod(
        "<?php namespace App; interface Factory { public function make(): object; }",
        "App\\Factory",
        "make",
      ),
    ).toBeNull();
    expect(
      phpDeclaredFactoryMethod(
        "<?php namespace App; trait Factory { public function make(): object {} }",
        "App\\Factory",
        "make",
      ),
    ).toBeNull();
    expect(
      phpDeclaredFactoryMethod(
        "<?php namespace App; enum Factory { public function make(): object {} }",
        "App\\Factory",
        "make",
      ),
    ).toBeNull();
  });
});
