import { describe, expect, it } from "vitest";
import { netteTemplateOwnershipsFromPhpFactorySource } from "./netteTemplateOwnership";

describe("netteTemplateOwnershipsFromPhpFactorySource", () => {
  it("extracts the real NotificationsGridFactory construction flow", () => {
    const source = String.raw`<?php
namespace App\Presentation\Notifications;

use Ublaboo\DataGrid\DataGrid as UblabooDatagrid;

final class NotificationsGridFactory
{
    public function create(): UblabooDatagrid
    {
        $grid = new UblabooDatagrid();
        $grid->setTemplateFile(__DIR__ . '/datagrid.latte');
        return $grid;
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([
      {
        ownerClassName: "Ublaboo\\DataGrid\\DataGrid",
        receiverLocal: "grid",
        template: { kind: "factoryDirectory", path: "/datagrid.latte" },
      },
    ]);
  });

  it("supports real-shaped Adyen and subscription migration factories", () => {
    const adyen = String.raw`<?php
namespace App\Payments\Adyen;

final class AdyenFactory
{
    public function create()
    {
        $control = new \App\Payments\Adyen\AdyenControl($this->client);
        $control->setTemplateFile('app/Payments/Adyen/adyen.latte');
        return $control;
    }
}`;
    const subscription = String.raw`<?php
namespace App\Subscription\Migration;

use App\Subscription\Controls\{SubscriptionMigrationGrid as MigrationGrid};

final class SubscriptionMigrationFactory
{
    public function build(): MigrationGrid
    {
        $migration = new MigrationGrid($this->repository);
        $migration->setTemplateFile(__DIR__.'/templates/subscriptionMigration.latte');
        return $migration;
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(adyen)).toEqual([
      expect.objectContaining({
        ownerClassName: "App\\Payments\\Adyen\\AdyenControl",
        template: {
          kind: "literal",
          path: "app/Payments/Adyen/adyen.latte",
        },
      }),
    ]);
    expect(netteTemplateOwnershipsFromPhpFactorySource(subscription)).toEqual([
      expect.objectContaining({
        ownerClassName:
          "App\\Subscription\\Controls\\SubscriptionMigrationGrid",
        template: {
          kind: "factoryDirectory",
          path: "/templates/subscriptionMigration.latte",
        },
      }),
    ]);
  });

  it.each([
    ["dynamic path", "$grid->setTemplateFile($templatePath);"],
    [
      "interpolated path",
      '$grid->setTemplateFile("templates/{$name}.latte");',
    ],
    [
      "concatenated variable",
      "$grid->setTemplateFile(__DIR__ . '/' . $name . '.latte');",
    ],
  ])("rejects a %s", (_label, setTemplate) => {
    expect(
      netteTemplateOwnershipsFromPhpFactorySource(String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        ${setTemplate}
        return $grid;
    }
}`),
    ).toEqual([]);
  });

  it("rejects reassignment and a different returned local", () => {
    const reassigned = String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        $grid->setTemplateFile(__DIR__ . '/grid.latte');
        $grid = decorate($grid);
        return $grid;
    }
}`;
    const wrongReturn = String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        $other = new Grid();
        $grid->setTemplateFile(__DIR__ . '/grid.latte');
        return $other;
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(reassigned)).toEqual([]);
    expect(netteTemplateOwnershipsFromPhpFactorySource(wrongReturn)).toEqual([]);
  });

  it.each([
    ["foreach value binding", "foreach ($items as $grid) {}"],
    ["foreach key binding", "foreach ($items as $grid => $value) {}"],
    ["foreach short destructuring", "foreach ($items as [$grid]) {}"],
    ["foreach list destructuring", "foreach ($items as list($grid)) {}"],
    ["short destructuring", "[$grid] = $items;"],
    ["list destructuring", "list($grid) = $items;"],
    ["unset", "unset($grid);"],
    ["catch binding", "try {} catch (\\Throwable $grid) {}"],
    ["global binding", "global $grid;"],
    ["static binding", "static $grid;"],
    ["by-reference capture", "$callback = function () use (&$grid) {};"],
    ["dynamic symbol extraction", "extract($values);"],
    ["prefix mutation", "++$grid;"],
    [
      "a mutable reference alias",
      "$alias =& $grid; $alias = replacement();",
    ],
    [
      "an aggregate reference capture",
      "$refs = [&$grid]; $refs[0] = replacement();",
    ],
    ["a literal dynamic write", "${'grid'} = replacement();"],
    [
      "an expression dynamic write",
      "$name = 'grid'; ${$name} = replacement();",
    ],
  ])("rejects receiver invalidation through %s", (_label, invalidation) => {
    const source = String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        $grid->setTemplateFile(__DIR__ . '/grid.latte');
        ${invalidation}
        return $grid;
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([]);
  });

  it("rejects arbitrary direct returns and ignores imports hidden in comments", () => {
    const arbitraryReturn = String.raw`<?php
namespace App;
// use Wrong\Package\Grid;
use Right\Package\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        $grid->setTemplateFile('grid.latte');
        return decorate($grid);
    }
}`;
    const commentedImport = arbitraryReturn.replace(
      "return decorate($grid);",
      "return $grid;",
    );

    expect(
      netteTemplateOwnershipsFromPhpFactorySource(arbitraryReturn),
    ).toEqual([]);
    expect(
      netteTemplateOwnershipsFromPhpFactorySource(commentedImport)[0]
        ?.ownerClassName,
    ).toBe("Right\\Package\\Grid");
  });

  it("ignores assignments and calls in nested unrelated scopes", () => {
    const source = String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        return function () {
            $grid = new Grid();
            $grid->setTemplateFile(__DIR__ . '/grid.latte');
            return $grid;
        };
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([]);
  });

  it.each([
    ["no return", ""],
    ["only a conditional return", "if ($ready) { return $grid; }"],
    ["only a brace-less conditional return", "if ($ready) return $grid;"],
    [
      "only a brace-less loop return",
      "for ($index = 0; $index < 1; $index++) return $grid;",
    ],
    [
      "only a nested closure return",
      "$callback = function () use ($grid) { return $grid; };",
    ],
  ])("requires a compatible direct return: %s", (_label, returnStatement) => {
    const source = String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        $grid->setTemplateFile(__DIR__ . '/grid.latte');
        ${returnStatement}
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([]);
  });

  it("rejects a nested incompatible return before a direct return", () => {
    const source = String.raw`<?php
use App\Grid;
class Factory {
    public function create() {
        $grid = new Grid();
        $other = new Grid();
        $grid->setTemplateFile(__DIR__ . '/grid.latte');
        if ($failed) { return $other; }
        return $grid;
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([]);
  });

  it.each(["static", "parent", "self", "class", "readonly", "namespace\\Grid"])(
    "rejects the unsound new %s target",
    (constructedClass) => {
      const source = String.raw`<?php
class Factory {
    public function create() {
        $grid = new ${constructedClass}();
        $grid->setTemplateFile(__DIR__ . '/grid.latte');
        return $grid;
    }
}`;

      expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([]);
    },
  );

  it("rejects multiple distinct owners for the same template", () => {
    const source = String.raw`<?php
use App\FirstGrid;
use App\SecondGrid;
class Factory {
    public function first() {
        $grid = new FirstGrid();
        $grid->setTemplateFile('shared.latte');
        return $grid;
    }
    public function second() {
        $grid = new SecondGrid();
        $grid->setTemplateFile('shared.latte');
        return $grid;
    }
}`;

    expect(netteTemplateOwnershipsFromPhpFactorySource(source)).toEqual([]);
  });
});
