import { describe, expect, it } from "vitest";
import {
  isPhpFrameworkContainerBindingCandidatePath,
  phpFrameworkContainerBindingsFromSource,
  phpFrameworkContainerConcreteClassNameFromSource,
  phpFrameworkContainerExpressionClassName,
  phpNetteFrameworkProvider,
} from "./phpFrameworkProviders";
import {
  isNetteContainerBindingCandidatePath,
  phpNetteContainerBindingsFromSource,
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

  it("extracts conservative NEON service bindings", () => {
    expect(
      phpNetteContainerBindingsFromSource(`
services:
    App\\Contracts\\Mailer: App\\Mail\\SmtpMailer
    App\\Contracts\\Notifier:
        factory: App\\Notifications\\EmailNotifier
    'App\\Contracts\\Gateway': 'App\\Billing\\StripeGateway'
`),
    ).toEqual([
      {
        abstractClassName: "App\\Contracts\\Mailer",
        concreteClassName: "App\\Mail\\SmtpMailer",
      },
      {
        abstractClassName: "App\\Contracts\\Notifier",
        concreteClassName: "App\\Notifications\\EmailNotifier",
      },
      {
        abstractClassName: "App\\Contracts\\Gateway",
        concreteClassName: "App\\Billing\\StripeGateway",
      },
    ]);
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
    expect(phpFrameworkContainerBindingsFromSource(source, providers)).toEqual([
      {
        abstractClassName: "App\\Contracts\\Mailer",
        concreteClassName: "App\\Mail\\SmtpMailer",
      },
    ]);
    expect(
      phpFrameworkContainerConcreteClassNameFromSource(
        source,
        "$this->container->getByType(App\\Contracts\\Mailer::class)",
        providers,
      ),
    ).toBe("App\\Mail\\SmtpMailer");
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
});
