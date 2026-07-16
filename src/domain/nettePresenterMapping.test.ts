import { describe, expect, it } from "vitest";
import {
  nettePresenterClassFromName,
  nettePresenterMappingsFromPhpSource,
  nettePresenterNameFromClass,
  normalizeNettePresenterMappings,
} from "./nettePresenterMapping";

describe("nettePresenterMappingsFromPhpSource", () => {
  it("extracts direct setMapping string and tuple masks", () => {
    const source = String.raw`<?php
$presenterFactory = new Nette\Application\PresenterFactory();
$presenterFactory->setMapping([
    '*' => 'App\\*Module\\Presenters\\*Presenter',
    'Legacy' => ['Legacy\\UI', '*Module', '**Presenter'],
]);`;

    expect(nettePresenterMappingsFromPhpSource(source)).toEqual([
      {
        module: "*",
        namespace: "App\\",
        moduleMask: "*Module",
        presenterMask: "Presenters\\*Presenter",
      },
      {
        module: "Legacy",
        namespace: "Legacy\\UI\\",
        moduleMask: "*Module",
        presenterMask: "**Presenter",
      },
    ]);
  });

  it("extracts the exact ebox RempMailer DI setup mapping", () => {
    const source = String.raw`<?php
use Nette\Application\IPresenterFactory;
class RempMailerExtension extends CompilerExtension {
$presenterFactory = $builder->getByType(IPresenterFactory::class);
$serviceDefinition->addSetup('setMapping', [['RempMailer' => 'Crm\\RempMailerModule\\Presenters\\*Presenter']]);`;

    expect(nettePresenterMappingsFromPhpSource(source)).toEqual([
      {
        module: "RempMailer",
        namespace: "Crm\\RempMailerModule\\Presenters\\",
        moduleMask: "*Module",
        presenterMask: "*Presenter",
      },
    ]);
  });

  it("supports old array syntax and comments between static tokens", () => {
    const source = String.raw`<?php
$presenterFactory = new Nette\Application\PresenterFactory();
$presenterFactory->setMapping(array(
    'Crm' /* key */ => array('Crm', '*Module\\Presenters', '*Presenter'),
));`;

    expect(nettePresenterMappingsFromPhpSource(source)).toEqual([
      {
        module: "Crm",
        namespace: "Crm\\",
        moduleMask: "*Module\\Presenters",
        presenterMask: "*Presenter",
      },
    ]);
  });

  it("preserves namespace backslashes in double-quoted PHP masks", () => {
    const source = String.raw`<?php
$presenterFactory = new Nette\Application\PresenterFactory();
$presenterFactory->setMapping(["Admin" => "App\Admin\Presenters\*Presenter"]);`;

    expect(nettePresenterMappingsFromPhpSource(source)[0]).toEqual({
      module: "Admin",
      namespace: "App\\Admin\\Presenters\\",
      moduleMask: "*Module",
      presenterMask: "*Presenter",
    });
  });

  it("keeps the later declaration for the same module", () => {
    const source = String.raw`<?php
$presenterFactory = new Nette\Application\PresenterFactory();
$presenterFactory->setMapping(['Admin' => 'Old\\Presenters\\*Presenter']);
$presenterFactory->setMapping(['Shop' => 'Shop\\Presenters\\*Presenter']);
$presenterFactory->setMapping(['Admin' => 'New\\Presenters\\*Presenter']);`;

    expect(nettePresenterMappingsFromPhpSource(source).map((item) => item.module))
      .toEqual(["Shop", "Admin"]);
    expect(nettePresenterClassFromName(
      "Admin:Dashboard",
      nettePresenterMappingsFromPhpSource(source),
    )).toBe("New\\Presenters\\DashboardPresenter");
  });

  it("ignores calls in comments/strings and malformed or dynamic mappings", () => {
    const source = String.raw`<?php
$presenterFactory = new Nette\Application\PresenterFactory();
// $factory->setMapping(['Comment' => 'Bad\\*Presenter']);
$text = "$factory->setMapping(['String' => 'Bad\\*Presenter'])";
$presenterFactory->setMapping($mapping);
$presenterFactory->setMapping(['Concat' => 'App\\' . '*Presenter']);
$presenterFactory->setMapping(['Interpolated' => "App\\\${namespace}\\*Presenter"]);
$presenterFactory->setMapping(['Broken' => ['App', '*Module']]);
$presenterFactory->addSetup($method, [['Dynamic' => 'Bad\\*Presenter']]);
$presenterFactory->setMapping(['Good' => 'Good\\Presenters\\*Presenter']);`;

    expect(nettePresenterMappingsFromPhpSource(source).map((item) => item.module))
      .toEqual(["Good"]);
  });

  it("does not expose setMapping text after escaped PHP backticks", () => {
    const source =
      "<?php $presenterFactory = new Nette\\Application\\PresenterFactory(); " +
      "$output = `\\`ignored $presenterFactory->setMapping(['Bad' => 'Bad\\\\*Presenter'])\\``; " +
      "$presenterFactory->setMapping(['Good' => 'Good\\\\*Presenter']);";

    expect(nettePresenterMappingsFromPhpSource(source).map((item) => item.module))
      .toEqual(["Good"]);
  });

  it("rejects keyed, extra, missing, and nested-extra call arguments", () => {
    const source = String.raw`<?php
$presenterFactory = new Nette\Application\PresenterFactory();
$presenterFactory->setMapping('mapping' => ['Keyed' => 'Bad\\*Presenter']);
$presenterFactory->setMapping(['Extra' => 'Bad\\*Presenter'], 'unexpected');
$presenterFactory->setMapping();
$presenterFactory->addSetup('method' => 'setMapping', 'args' => [['KeyedSetup' => 'Bad\\*Presenter']]);
$presenterFactory->addSetup('setMapping', [['ExtraSetup' => 'Bad\\*Presenter']], 'unexpected');
$presenterFactory->addSetup('setMapping', [['NestedExtra' => 'Bad\\*Presenter'], 'extra']);
$presenterFactory->addSetup('setMapping', ['mapping' => ['NestedKeyed' => 'Bad\\*Presenter']]);
$presenterFactory->setMapping(['Good' => 'Good\\*Presenter']);`;

    expect(nettePresenterMappingsFromPhpSource(source).map((item) => item.module))
      .toEqual(["Good"]);
  });

  it("bounds deeply nested and oversized calls while continuing its scan", () => {
    const deep = "[".repeat(40) + "'x'" + "]".repeat(40);
    const oversized = " ".repeat(100_001);
    const source = `<?php $presenterFactory = new Nette\\Application\\PresenterFactory();\n` +
      `$presenterFactory->setMapping(${deep});\n` +
      `$presenterFactory->setMapping(${oversized}['Oversized' => 'Bad\\\\*Presenter']);\n` +
      String.raw`$presenterFactory->setMapping(['Good' => 'App\\*Presenter']);`;

    expect(nettePresenterMappingsFromPhpSource(source).map((item) => item.module))
      .toEqual(["Good"]);
  });

  it("enforces aggregate call-character and declaration budgets", () => {
    const paddedCall = (module: string) =>
      `$presenterFactory->setMapping(${' '.repeat(90_000)}['${module}' => 'App\\\\*Presenter']);\n`;
    const aggregateSource = Array.from(
      { length: 6 },
      (_, index) => paddedCall(`Module${index}`),
    ).join("");
    const manyMappings = Array.from(
      { length: 10_100 },
      (_, index) => `'Module${index}' => 'App\\\\*Presenter'`,
    );
    const declarationSource = Array.from({ length: 6 }, (_, batch) => {
      const start = batch * 2_000;
      return `$presenterFactory->setMapping([${
        manyMappings.slice(start, start + 2_000).join(",")
      }]);`;
    }).join("\n");

    const context = "<?php $presenterFactory = new Nette\\Application\\PresenterFactory();\n";
    expect(nettePresenterMappingsFromPhpSource(context + aggregateSource)).toHaveLength(5);
    expect(nettePresenterMappingsFromPhpSource(context + declarationSource))
      .toHaveLength(10_000);
  });

  it("rejects unrelated setMapping and addSetup calls", () => {
    const source = String.raw`<?php
class ReportBuilder {
    public function configure(): void {
        $factory->setMapping(['Report' => 'Reports\\*Presenter']);
        $definition->addSetup('setMapping', [['Other' => 'Other\\*Presenter']]);
    }
}`;

    expect(nettePresenterMappingsFromPhpSource(source)).toEqual([]);
  });
});

describe("normalizeNettePresenterMappings", () => {
  it("normalizes object, Map, tuple and ordered entry data", () => {
    expect(normalizeNettePresenterMappings({
      "*": "App\\*Module\\Presenters\\*Presenter",
      Crm: ["Crm", "*Module\\Presenters", "*Presenter"],
    })).toHaveLength(2);

    expect(normalizeNettePresenterMappings(new Map([
      ["Efabrica", "Efabrica\\Crm\\*Module\\Presenters\\*Presenter"],
    ]))[0]).toMatchObject({ module: "Efabrica", namespace: "Efabrica\\Crm\\" });

    expect(normalizeNettePresenterMappings([
      ["Admin", "Old\\*Presenter"],
      { module: "Admin", mask: "New\\*Presenter" },
    ])).toEqual([
      {
        module: "Admin",
        namespace: "New\\",
        moduleMask: "*Module",
        presenterMask: "*Presenter",
      },
    ]);
  });

  it("drops malformed modules and masks", () => {
    expect(normalizeNettePresenterMappings([
      ["Bad:Module", "App\\*Presenter"],
      ["NoWildcard", "App\\Presenter"],
      ["TwoStars", "App\\***Presenter"],
      ["Dynamic", 42],
      ["Good", "App\\Presenters\\*Presenter"],
    ])).toHaveLength(1);
  });

  it("accepts an empty tuple module mask", () => {
    const [mapping] = normalizeNettePresenterMappings([
      ["Api", ["App\\Api", "", "*Presenter"]],
    ]);

    expect(mapping).toEqual({
      module: "Api",
      moduleMask: "",
      namespace: "App\\Api\\",
      presenterMask: "*Presenter",
    });
    expect(nettePresenterClassFromName("Api:Status", [mapping!]))
      .toBe("App\\Api\\StatusPresenter");
    expect(nettePresenterNameFromClass(
      "App\\Api\\StatusPresenter",
      [mapping!],
    )).toBe("Api:Status");
    expect(nettePresenterClassFromName("Api:Admin:Status", [mapping!]))
      .toBeNull();
    expect(nettePresenterNameFromClass(
      "App\\Api\\Admin\\StatusPresenter",
      [mapping!],
    )).toBeNull();
  });
});

describe("presenter mapping resolution", () => {
  const mappings = normalizeNettePresenterMappings([
    ["*", "App\\*Module\\Presenters\\*Presenter"],
    ["Crm", "Crm\\*Module\\Presenters\\*Presenter"],
    ["Efabrica", ["Efabrica\\Crm", "*Module\\Presenters", "**Presenter"]],
    ["RempMailer", "Crm\\RempMailerModule\\Presenters\\*Presenter"],
  ]);

  it("maps wildcard, nested, Crm, Efabrica and exact ebox names forward", () => {
    expect(nettePresenterClassFromName("Homepage", mappings))
      .toBe("App\\Presenters\\HomepagePresenter");
    expect(nettePresenterClassFromName("Admin:Orders", mappings))
      .toBe("App\\AdminModule\\Presenters\\OrdersPresenter");
    expect(nettePresenterClassFromName("Admin:Sales:Orders", mappings))
      .toBe("App\\AdminModule\\SalesModule\\Presenters\\OrdersPresenter");
    expect(nettePresenterClassFromName("Crm:Sales:Orders", mappings))
      .toBe("Crm\\SalesModule\\Presenters\\OrdersPresenter");
    expect(nettePresenterClassFromName("Efabrica:Sales:Orders", mappings))
      .toBe("Efabrica\\Crm\\SalesModule\\Presenters\\Orders\\OrdersPresenter");
    expect(nettePresenterClassFromName("RempMailer:Dashboard", mappings))
      .toBe("Crm\\RempMailerModule\\Presenters\\DashboardPresenter");
  });

  it("gives an exact module mapping precedence over wildcard", () => {
    expect(nettePresenterClassFromName("Crm:Dashboard", mappings))
      .toBe("Crm\\Presenters\\DashboardPresenter");
  });

  it("maps classes back to canonical presenter names", () => {
    expect(nettePresenterNameFromClass(
      "App\\Presenters\\HomepagePresenter",
      mappings,
    ))
      .toBe("Homepage");
    expect(nettePresenterNameFromClass(
      "App\\AdminModule\\Presenters\\OrdersPresenter",
      mappings,
    )).toBe("Admin:Orders");
    expect(nettePresenterNameFromClass(
      "App\\AdminModule\\SalesModule\\Presenters\\OrdersPresenter",
      mappings,
    )).toBe("Admin:Sales:Orders");
    expect(nettePresenterNameFromClass(
      "Crm\\SalesModule\\Presenters\\OrdersPresenter",
      mappings,
    )).toBe("Crm:Sales:Orders");
    expect(nettePresenterNameFromClass(
      "Efabrica\\Crm\\SalesModule\\Presenters\\Orders\\OrdersPresenter",
      mappings,
    )).toBe("Efabrica:Sales:Orders");
    expect(nettePresenterNameFromClass(
      "Crm\\RempMailerModule\\Presenters\\DashboardPresenter",
      mappings,
    )).toBe("RempMailer:Dashboard");
  });

  it("rejects malformed names, unrelated classes and broken ** symmetry", () => {
    expect(nettePresenterClassFromName("Admin::Orders", mappings)).toBeNull();
    expect(nettePresenterClassFromName("Admin:Order-Items", mappings)).toBeNull();
    expect(nettePresenterNameFromClass("Other\\OrdersPresenter", mappings)).toBeNull();
    expect(nettePresenterNameFromClass(
      "Efabrica\\Crm\\Orders\\DifferentPresenter",
      mappings,
    )).toBeNull();
  });
});
