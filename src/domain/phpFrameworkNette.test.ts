import { phpNetteFrameworkProvider } from "./phpFrameworkNetteProvider";
import { describe, expect, it } from "vitest";
import {
  neonServiceAliasesFromSource,
  neonServicesFromSource,
} from "./netteDiContainer";
import {
  isPhpFrameworkContainerBindingCandidatePath,
  phpFrameworkContainerBindingsFromSource,
  phpFrameworkContainerConcreteClassNameFromSource,
  phpFrameworkContainerExpressionClassName,
} from "./phpFrameworkProviders";
import {
  isNetteContainerBindingCandidatePath,
  phpNetteContainerAutowiredCandidatesFromSources,
  phpNetteContainerBindingsFromSource,
  phpNetteContainerConcreteClassNamesFromSource,
  phpNetteContainerExpressionClassName,
} from "./phpFrameworkNette";

describe("phpFrameworkNette", () => {
  it("extracts getByType ::class container expressions", () => {
    expect(
      phpNetteContainerExpressionClassName(
        "$this->container->getByType(App\\Contracts\\Mailer::class)",
      ),
    ).toBe("App\\Contracts\\Mailer");
    expect(
      phpNetteContainerExpressionClassName(
        "$container?->getByType(\\App\\Contracts\\Mailer::class)",
      ),
    ).toBe("App\\Contracts\\Mailer");
  });

  it("keeps nested getByType calls out of expression type inference", () => {
    expect(
      phpNetteContainerExpressionClassName(
        "$this->container->getByType(App\\Contracts\\Mailer::class)->send()",
      ),
    ).toBeNull();
    expect(
      phpNetteContainerExpressionClassName(
        "$this->container->getService(App\\Contracts\\Mailer::class)",
      ),
    ).toBeNull();
  });

  it("does not turn FQN-shaped service IDs into type bindings", () => {
    expect(
      phpNetteContainerBindingsFromSource(`
services:
    App\\Contracts\\Mailer: App\\Mail\\SmtpMailer
    App\\Contracts\\Notifier:
        factory: App\\Notifications\\EmailNotifier
    'App\\Contracts\\Gateway': 'App\\Billing\\StripeGateway'
`),
    ).toEqual([]);
  });

  it("ignores ambiguous NEON service definitions", () => {
    expect(
      phpNetteContainerBindingsFromSource(`
parameters:
    App\\Contracts\\Parameter: App\\Services\\NotAService
extensions:
    App\\Contracts\\Extension: App\\Services\\NotAService
services:
    mailer: App\\Mail\\SmtpMailer
    App\\Contracts\\Mailer: @mailer
    App\\Contracts\\Factory:
        factory: App\\Factories\\MailerFactory::create
    App\\Contracts\\Dynamic:
        factory: %mailer.class%
parameters:
    App\\Contracts\\AfterServices: App\\Services\\NotAService
`),
    ).toEqual([]);
  });

  it("excludes autowiring-disabled ebox-style aliases and factories", () => {
    const source = `
services:
    Crm\\RecencyModule\\Storage\\IRecencyStorage:
        factory: Crm\\RecencyModule\\Storage\\RedisRecencyStorage
        autowired: false
    'Crm\\RecencyModule\\Storage\\IQuotedStorage':
        factory: Crm\\RecencyModule\\Storage\\QuotedStorage
        autowired: false
    disabledStorageAlias: @Crm\\RecencyModule\\Storage\\IRecencyStorage
    enabledStorage: Crm\\RecencyModule\\Storage\\DatabaseRecencyStorage
`;

    expect(neonServicesFromSource(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceName: "Crm\\RecencyModule\\Storage\\IRecencyStorage",
          className: "Crm\\RecencyModule\\Storage\\RedisRecencyStorage",
          autowired: false,
        }),
        expect.objectContaining({
          serviceName: "Crm\\RecencyModule\\Storage\\IQuotedStorage",
          className: "Crm\\RecencyModule\\Storage\\QuotedStorage",
          autowired: false,
        }),
      ]),
    );
    expect(neonServiceAliasesFromSource(source)).toEqual([
      expect.objectContaining({
        serviceName: "disabledStorageAlias",
        targetName: "Crm\\RecencyModule\\Storage\\IRecencyStorage",
      }),
    ]);
    expect(phpNetteContainerBindingsFromSource(source)).toEqual([]);
    expect(phpNetteContainerConcreteClassNamesFromSource(source)).toEqual([
      "Crm\\RecencyModule\\Storage\\DatabaseRecencyStorage",
    ]);
    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        source,
        "$container->getByType(Crm\\RecencyModule\\Storage\\IRecencyStorage::class)",
        [phpNetteFrameworkProvider],
      ),
    ).toBe("Crm\\RecencyModule\\Storage\\IRecencyStorage");
  });

  it("recognizes NEON binding candidate paths", () => {
    expect(
      isNetteContainerBindingCandidatePath("/workspace/config/services.neon"),
    ).toBe(true);
    expect(
      isNetteContainerBindingCandidatePath("/workspace/config/services.php"),
    ).toBe(false);
  });

  it("wires Nette container semantics through provider dispatch", () => {
    const source = `
services:
    App\\Contracts\\Mailer: App\\Mail\\SmtpMailer
`;
    const providers = [phpNetteFrameworkProvider];

    expect(
      phpFrameworkContainerExpressionClassName(
        "$this->container->getByType(App\\Contracts\\Mailer::class)",
        providers,
      ),
    ).toBe("App\\Contracts\\Mailer");
    expect(phpFrameworkContainerBindingsFromSource(source, providers)).toEqual([]);
    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        source,
        "$this->container->getByType(App\\Contracts\\Mailer::class)",
        providers,
      ),
    ).toBe("App\\Contracts\\Mailer");
    expect(
      isPhpFrameworkContainerBindingCandidatePath(
        "/workspace/config/services.neon",
        providers,
      ),
    ).toBe(true);
  });

  it("resolves Nette autowired concrete services that implement getByType interfaces", () => {
    const neonSource = `
services:
    reportRepository: App\\Repository\\DatabaseReportRepository
    - App\\Repository\\FileReportRepository
`;
    const interfaceSource = `<?php
namespace App\\Contracts;

interface ReportRepository
{
}
`;
    const namedConcreteSource = `<?php
namespace App\\Repository;

use App\\Contracts\\ReportRepository;

final class DatabaseReportRepository implements ReportRepository
{
}
`;
    const anonymousConcreteSource = `<?php
namespace App\\Repository;

use App\\Contracts\\ReportRepository;

final class FileReportRepository implements ReportRepository
{
}
`;
    const namedSourceContext = {
      workspaceSources: [interfaceSource, namedConcreteSource],
    };
    const anonymousSourceContext = {
      workspaceSources: [interfaceSource, anonymousConcreteSource],
    };
    const ambiguousSourceContext = {
      workspaceSources: [
        interfaceSource,
        namedConcreteSource,
        anonymousConcreteSource,
      ],
    };

    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        neonSource,
        "$this->container->getByType(App\\Contracts\\ReportRepository::class)",
        [phpNetteFrameworkProvider],
        namedSourceContext,
      ),
    ).toBe("App\\Repository\\DatabaseReportRepository");
    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        `
services:
    - App\\Repository\\FileReportRepository
`,
        "$this->container->getByType(App\\Contracts\\ReportRepository::class)",
        [phpNetteFrameworkProvider],
        anonymousSourceContext,
      ),
    ).toBe("App\\Repository\\FileReportRepository");
    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        neonSource,
        "$this->container->getByType(App\\Contracts\\ReportRepository::class)",
        [phpNetteFrameworkProvider],
        ambiguousSourceContext,
      ),
    ).toBe("App\\Contracts\\ReportRepository");
  });

  it("resolves mixed eligible services without counting disabled implementations", () => {
    const interfaceSource = `<?php
namespace Crm\\RecencyModule\\Storage;

interface IRecencyStorage
{
}
`;
    const redisSource = `<?php
namespace Crm\\RecencyModule\\Storage;

final class RedisRecencyStorage implements IRecencyStorage
{
}
`;
    const databaseSource = `<?php
namespace Crm\\RecencyModule\\Storage;

final class DatabaseRecencyStorage implements IRecencyStorage
{
}
`;
    const expression =
      "$this->container->getByType(Crm\\RecencyModule\\Storage\\IRecencyStorage::class)";
    const sourceContext = {
      workspaceSources: [interfaceSource, redisSource, databaseSource],
    };

    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        `
services:
    redisStorage:
        factory: Crm\\RecencyModule\\Storage\\RedisRecencyStorage
        autowired: false
    databaseStorage: Crm\\RecencyModule\\Storage\\DatabaseRecencyStorage
`,
        expression,
        [phpNetteFrameworkProvider],
        sourceContext,
      ),
    ).toBe("Crm\\RecencyModule\\Storage\\DatabaseRecencyStorage");

    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        `
services:
    redisStorage: Crm\\RecencyModule\\Storage\\RedisRecencyStorage
    databaseStorage: Crm\\RecencyModule\\Storage\\DatabaseRecencyStorage
`,
        expression,
        [phpNetteFrameworkProvider],
        sourceContext,
      ),
    ).toBe("Crm\\RecencyModule\\Storage\\IRecencyStorage");
  });

  it("keeps FQN-shaped names from overriding real autowiring ambiguity", () => {
    const contract = `<?php
namespace App\\Contracts;
interface Mailer {}
`;
    const smtp = `<?php
namespace App\\Mail;
final class SmtpMailer implements \\App\\Contracts\\Mailer {}
`;
    const api = `<?php
namespace App\\Mail;
final class ApiMailer implements \\App\\Contracts\\Mailer {}
`;

    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        `services:
    App\\Contracts\\Mailer: App\\Mail\\SmtpMailer
    apiMailer: App\\Mail\\ApiMailer
`,
        "$container->getByType(App\\Contracts\\Mailer::class)",
        [phpNetteFrameworkProvider],
        { workspaceSources: [contract, smtp, api] },
      ),
    ).toBe("App\\Contracts\\Mailer");
  });

  it("suppresses a lower-priority candidate when the same service ID is disabled", () => {
    const contract = `<?php
namespace App\\Contracts;
interface Mailer {}
`;
    const smtp = `<?php
namespace App\\Mail;
final class SmtpMailer implements \\App\\Contracts\\Mailer {}
`;

    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        `services:
    mailer:
        factory: App\\Mail\\SmtpMailer
        autowired: false
`,
        "$container->getByType(App\\Contracts\\Mailer::class)",
        [phpNetteFrameworkProvider],
        {
          workspaceSources: [
            `services:
    mailer: App\\Mail\\SmtpMailer
`,
            contract,
            smtp,
          ],
        },
      ),
    ).toBe("App\\Contracts\\Mailer");
  });

  it("merges named service fields across source precedence", () => {
    const lower = `services:
    mailer:
        factory: App\\Mail\\IncludedMailer
        autowired: [App\\Contracts\\Fallback, App\\Contracts\\Secondary]
    other: App\\Mail\\OtherMailer
`;

    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        `services:
    mailer:
        autowired: App\\Contracts\\Mailer
`,
        lower,
      ]),
    ).toEqual([
      {
        autowiredTypes: ["App\\Contracts\\Mailer"],
        producedTypeSource: {
          className: "App\\Mail\\IncludedMailer",
          kind: "class",
        },
        source: lower,
      },
      {
        autowiredTypes: null,
        producedTypeSource: {
          className: "App\\Mail\\OtherMailer",
          kind: "class",
        },
        source: lower,
      },
    ]);
  });

  it("applies higher false and class overrides without leaking fields", () => {
    const lower = `services:
    mailer:
        factory: App\\Mail\\IncludedMailer
        autowired: [App\\Contracts\\Mailer, App\\Contracts\\Secondary]
    other: App\\Mail\\OtherMailer
`;

    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        `services:
    mailer:
        autowired: false
`,
        lower,
      ]),
    ).toEqual([
      expect.objectContaining({
        producedTypeSource: {
          className: "App\\Mail\\OtherMailer",
          kind: "class",
        },
      }),
    ]);
    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        `services:
    mailer: App\\Mail\\RootMailer
`,
        lower,
      ]),
    ).toEqual([
      {
        autowiredTypes: [
          "App\\Contracts\\Mailer",
          "App\\Contracts\\Secondary",
        ],
        producedTypeSource: {
          className: "App\\Mail\\RootMailer",
          kind: "class",
        },
        source: `services:
    mailer: App\\Mail\\RootMailer
`,
      },
      expect.objectContaining({
        producedTypeSource: {
          className: "App\\Mail\\OtherMailer",
          kind: "class",
        },
      }),
    ]);
  });

  it("keeps named-service field merges isolated per invocation", () => {
    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        "services:\n    mailer:\n        autowired: App\\Contracts\\Mailer",
        "services:\n    mailer: App\\Mail\\FirstMailer",
      ])[0]?.producedTypeSource,
    ).toEqual({ className: "App\\Mail\\FirstMailer", kind: "class" });
    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        "services:\n    mailer:\n        autowired: App\\Contracts\\Mailer",
        "services:\n    mailer: App\\Mail\\SecondMailer",
      ])[0]?.producedTypeSource,
    ).toEqual({ className: "App\\Mail\\SecondMailer", kind: "class" });
  });

  it("describes class and service method factories for async materialization", () => {
    const candidates = phpNetteContainerAutowiredCandidatesFromSources([
      `services:
    routerFactory: App\\Routing\\RouterFactory
    router: @routerFactory::createRouter
    staticRouter: App\\Routing\\StaticRouterFactory::createRouter
    directOwner: @\\App\\Routing\\RouterFactory::createRouter
`,
    ]);

    expect(candidates.map((candidate) => candidate.producedTypeSource)).toEqual(
      expect.arrayContaining([
        {
          declaringClassName: "App\\Routing\\RouterFactory",
          kind: "factoryMethod",
          methodName: "createRouter",
          staticOnly: false,
        },
        {
          declaringClassName: "App\\Routing\\StaticRouterFactory",
          kind: "factoryMethod",
          methodName: "createRouter",
          staticOnly: true,
        },
      ]),
    );
    expect(
      candidates.filter(
        (candidate) => candidate.producedTypeSource.kind === "factoryMethod",
      ),
    ).toHaveLength(3);
  });

  it("keeps anonymous service-method factories as autowiring candidates", () => {
    const candidates = phpNetteContainerAutowiredCandidatesFromSources([
      `services:
    routerFactory: App\\Routing\\RouterFactory
    - @routerFactory::createRouter
    - { factory: @routerFactory::createRouter }
`,
    ]);

    expect(
      candidates.filter(
        (candidate) => candidate.producedTypeSource.kind === "factoryMethod",
      ),
    ).toEqual([
      expect.objectContaining({
        producedTypeSource: {
          declaringClassName: "App\\Routing\\RouterFactory",
          kind: "factoryMethod",
          methodName: "createRouter",
          staticOnly: false,
        },
      }),
      expect.objectContaining({
        producedTypeSource: {
          declaringClassName: "App\\Routing\\RouterFactory",
          kind: "factoryMethod",
          methodName: "createRouter",
          staticOnly: false,
        },
      }),
    ]);
  });

  it("resolves unique factory service aliases and rejects cycles and conflicts", () => {
    const candidates = phpNetteContainerAutowiredCandidatesFromSources([
      `services:
    routerFactory: App\\Routing\\RouterFactory
    factoryAlias: @routerFactory
    router: @factoryAlias::createRouter
    cycleA: @cycleB
    cycleB: @cycleA
    rejected: @cycleA::createRouter
`,
      `services:
    conflictingAlias: @routerFactory
    conflictingRouter: @conflictingAlias::createRouter
`,
      `services:
    otherFactory: App\\Routing\\OtherFactory
    conflictingAlias: @otherFactory
`,
    ]);

    expect(candidates).toContainEqual(
      expect.objectContaining({
        producedTypeSource: {
          declaringClassName: "App\\Routing\\RouterFactory",
          kind: "factoryMethod",
          methodName: "createRouter",
          staticOnly: false,
        },
      }),
    );
    expect(
      candidates.some(
        (candidate) =>
          candidate.producedTypeSource.kind === "factoryMethod" &&
          (candidate.producedTypeSource.declaringClassName === "cycleA" ||
            candidate.producedTypeSource.declaringClassName ===
              "App\\Routing\\OtherFactory"),
      ),
    ).toBe(false);
  });

  it("honors merge prevention and blocks unsupported creation leakage", () => {
    const lower = "services:\n    mailer: App\\Mail\\IncludedMailer";

    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        "services:\n    mailer!:\n        autowired: App\\Contracts\\Mailer",
        lower,
      ]),
    ).toEqual([]);
    expect(
      phpNetteContainerAutowiredCandidatesFromSources([
        "services:\n    mailer: false",
        lower,
      ]),
    ).toEqual([]);
  });

  it("preserves explicit empty autowiring as a no-contract candidate", () => {
    const source = `services:
    mailer:
        factory: App\\Mail\\Mailer
        autowired: []
`;

    expect(phpNetteContainerAutowiredCandidatesFromSources([source])).toEqual([
      {
        autowiredTypes: [],
        producedTypeSource: {
          className: "App\\Mail\\Mailer",
          kind: "class",
        },
        source,
      },
    ]);
  });

  it("does not resolve getByType through empty or invalid autowiring policies", () => {
    const contractSource = `<?php
namespace App\\Contracts;

interface Gateway
{
}
`;
    const concreteSource = `<?php
namespace App\\Services;

final class SoleGateway implements \\App\\Contracts\\Gateway
{
}
`;
    const expression =
      "$container->getByType(App\\Contracts\\Gateway::class)";
    const resolve = (neonSource: string) =>
      phpFrameworkContainerConcreteClassNameFromSource(
        neonSource,
        expression,
        [phpNetteFrameworkProvider],
        { workspaceSources: [contractSource, concreteSource] },
      );

    expect(
      resolve(`services:
    gateway: { factory: App\\Services\\SoleGateway, autowired: [] }
`),
    ).toBe("App\\Contracts\\Gateway");
    expect(
      resolve(`services:
    gateway:
        factory: App\\Services\\SoleGateway
        autowired:
`),
    ).toBe("App\\Contracts\\Gateway");
    expect(
      resolve(`services:
    gateway:
        factory: App\\Services\\SoleGateway
        autowired:
            - invalid value
            - %dynamic%
`),
    ).toBe("App\\Contracts\\Gateway");
  });

  it("narrows and prefers scalar or array autowired targets per contract", () => {
    const parent = `<?php
namespace App\\Contracts;

interface ParentContract
{
}
`;
    const secondary = `<?php
namespace App\\Contracts;

interface SecondaryContract
{
}
`;
    const child = `<?php
namespace App\\Service;

final class ChildService implements \\App\\Contracts\\ParentContract, \\App\\Contracts\\SecondaryContract
{
}
`;
    const parentService = `<?php
namespace App\\Service;

final class ParentService implements \\App\\Contracts\\ParentContract
{
}
`;
    const sources = [parent, secondary, child, parentService];

    const resolve = (neon: string, contract: string) =>
      phpFrameworkContainerConcreteClassNameFromSource(
        neon,
        `$container->getByType(${contract}::class)`,
        [phpNetteFrameworkProvider],
        { workspaceSources: sources },
      );

    expect(
      resolve(
        `services:
    child:
        factory: App\\Service\\ChildService
        autowired: App\\Service\\ChildService
    parent: App\\Service\\ParentService
`,
        "App\\Contracts\\ParentContract",
      ),
    ).toBe("App\\Service\\ParentService");

    expect(
      resolve(
        `services:
    child:
        factory: App\\Service\\ChildService
        autowired: [App\\Contracts\\ParentContract, App\\Contracts\\SecondaryContract]
    parent: App\\Service\\ParentService
`,
        "App\\Contracts\\ParentContract",
      ),
    ).toBe("App\\Service\\ChildService");
    expect(
      resolve(
        `services:
    child:
        factory: App\\Service\\ChildService
        autowired: [App\\Contracts\\ParentContract, App\\Contracts\\SecondaryContract]
`,
        "App\\Contracts\\SecondaryContract",
      ),
    ).toBe("App\\Service\\ChildService");
  });
});
