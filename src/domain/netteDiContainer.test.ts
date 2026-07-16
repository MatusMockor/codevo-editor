import { describe, expect, it } from "vitest";
import {
  detectNeonParameterReferenceAt,
  detectNeonServiceMethodReferenceAt,
  detectNeonServiceReferenceAt,
  detectNeonServiceSetupMethodAt,
  neonGeneratedServiceNamesFromServices,
  neonParameterCompletionContextAt,
  neonParametersFromSource,
  neonServiceAliasesFromSource,
  neonServiceReferenceCompletionContextAt,
  neonServiceSetupMethodCompletionContextAt,
  neonServicesFromSource,
  netteInjectionTypeReferenceAt,
  netteInjectedPropertyTypes,
} from "./netteDiContainer";

/**
 * Returns the offset of the FIRST occurrence of `needle`, advanced by
 * `withinOffset` characters so a test can target a precise cursor position.
 */
function offsetOf(source: string, needle: string, withinOffset = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index + withinOffset;
}

function spanOf(source: string, needle: string) {
  const start = source.indexOf(needle);

  if (start < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return { start, end: start + needle.length };
}

describe("neonParametersFromSource", () => {
  it("extracts flat scalar parameters with raw values and name spans", () => {
    const source =
      "parameters:\n    dbHost: localhost\n    dbUser: root\n";

    expect(neonParametersFromSource(source)).toEqual([
      {
        name: "dbHost",
        value: "localhost",
        offset: offsetOf(source, "dbHost"),
        span: spanOf(source, "dbHost"),
      },
      {
        name: "dbUser",
        value: "root",
        offset: offsetOf(source, "dbUser"),
        span: spanOf(source, "dbUser"),
      },
    ]);
  });

  it("builds dotted names for nested block maps", () => {
    const source =
      "parameters:\n    mail:\n        sender: a@b.cz\n        host: smtp\n";
    const params = neonParametersFromSource(source);

    expect(params).toEqual([
      {
        name: "mail.sender",
        value: "a@b.cz",
        offset: offsetOf(source, "sender"),
        span: spanOf(source, "sender"),
      },
      {
        name: "mail.host",
        value: "smtp",
        offset: offsetOf(source, "host"),
        span: spanOf(source, "host"),
      },
    ]);
  });

  it("builds dotted names for inline maps", () => {
    const source = "parameters:\n    mail: { sender: a@b.cz, host: smtp }\n";
    const params = neonParametersFromSource(source);

    expect(params).toEqual([
      {
        name: "mail.sender",
        value: "a@b.cz",
        offset: offsetOf(source, "sender"),
        span: spanOf(source, "sender"),
      },
      {
        name: "mail.host",
        value: "smtp",
        offset: offsetOf(source, "host"),
        span: spanOf(source, "host"),
      },
    ]);
  });

  it("strips an inline comment from the raw value", () => {
    const source = "parameters:\n    dbHost: localhost # primary\n";

    expect(neonParametersFromSource(source)).toEqual([
      {
        name: "dbHost",
        value: "localhost",
        offset: offsetOf(source, "dbHost"),
        span: spanOf(source, "dbHost"),
      },
    ]);
  });

  it("keeps a quoted value raw (quotes preserved)", () => {
    const source = "parameters:\n    secret: 'p@ss word'\n";

    expect(neonParametersFromSource(source)).toEqual([
      {
        name: "secret",
        value: "'p@ss word'",
        offset: offsetOf(source, "secret"),
        span: spanOf(source, "secret"),
      },
    ]);
  });

  it("ignores keys outside the parameters section", () => {
    const source =
      "parameters:\n    appName: Demo\n\nservices:\n    mailer: App\\Mailer\n";
    const params = neonParametersFromSource(source);

    expect(params.map((p) => p.name)).toEqual(["appName"]);
  });

  it("stays bounded on very large, deeply repeated input", () => {
    const source =
      "parameters:\n" + "    k: v\n".repeat(50_000);
    const params = neonParametersFromSource(source);

    expect(params).toHaveLength(50_000);
  });
});

describe("detectNeonParameterReferenceAt", () => {
  it("detects a %param% reference inside a service argument", () => {
    const source =
      "services:\n    mailer: App\\Mailer(%dbHost%)\n";
    const onRef = offsetOf(source, "%dbHost%", 3);

    expect(detectNeonParameterReferenceAt(source, onRef)).toEqual({
      name: "dbHost",
      span: spanOf(source, "%dbHost%"),
    });
  });

  it("detects a dotted %mail.from% reference", () => {
    const source = "services:\n    m: App\\Mailer(%mail.from%)\n";
    const onRef = offsetOf(source, "%mail.from%", 4);

    expect(detectNeonParameterReferenceAt(source, onRef)).toEqual({
      name: "mail.from",
      span: spanOf(source, "%mail.from%"),
    });
  });

  it("does not treat a %% escape as a reference", () => {
    const source = "parameters:\n    ratio: 50%% done\n";
    const between = offsetOf(source, "%%", 1);

    expect(detectNeonParameterReferenceAt(source, between)).toBeNull();
  });

  it("does not detect a % inside a quoted string", () => {
    const source = "parameters:\n    tpl: 'literal %notparam% text'\n";
    const inString = offsetOf(source, "notparam", 1);

    expect(detectNeonParameterReferenceAt(source, inString)).toBeNull();
  });

  it("does not detect a bare trailing percent", () => {
    const source = "parameters:\n    complete: 100% ready\n";
    const onPercent = offsetOf(source, "100%", 3);

    expect(detectNeonParameterReferenceAt(source, onPercent)).toBeNull();
  });
});

describe("neonParameterCompletionContextAt", () => {
  it("offers completion right after an opening percent", () => {
    const source = "services:\n    m: App\\Mailer(%)\n";
    const cursor = offsetOf(source, "%") + 1;

    expect(neonParameterCompletionContextAt(source, cursor)).toEqual({
      prefix: "",
      span: { start: cursor, end: cursor },
    });
  });

  it("offers completion for a partially typed parameter name", () => {
    const source = "services:\n    m: App\\Mailer(%dbH)\n";
    const nameStart = offsetOf(source, "%dbH") + 1;
    const cursor = nameStart + 3;

    expect(neonParameterCompletionContextAt(source, cursor)).toEqual({
      prefix: "dbH",
      span: { start: nameStart, end: nameStart + 3 },
    });
  });

  it("does not offer completion after a closed reference", () => {
    const source = "services:\n    m: App\\Mailer(%dbHost%)\n";
    const afterClose = offsetOf(source, "%dbHost%") + "%dbHost%".length;

    expect(neonParameterCompletionContextAt(source, afterClose)).toBeNull();
  });

  it("does not offer completion inside a quoted string", () => {
    const source = "parameters:\n    x: 'text %here'\n";
    const cursor = offsetOf(source, "%here") + 1;

    expect(neonParameterCompletionContextAt(source, cursor)).toBeNull();
  });

  it("does not offer completion between the two percents of an escape", () => {
    const source = "parameters:\n    r: 50%% off\n";
    const cursor = offsetOf(source, "%%") + 1;

    expect(neonParameterCompletionContextAt(source, cursor)).toBeNull();
  });
});

describe("neonServicesFromSource", () => {
  it("registers an anonymous class service", () => {
    const source = "services:\n    - App\\Model\\ProductRepository\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: null,
        className: "App\\Model\\ProductRepository",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "App\\Model\\ProductRepository"),
      },
    ]);
  });

  it("registers a named class service preserving name case", () => {
    const source = "services:\n    productFacade: App\\Model\\ProductFacade\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: "productFacade",
        className: "App\\Model\\ProductFacade",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "productFacade"),
      },
    ]);
  });

  it("treats an entity Class(args) as a class service", () => {
    const source =
      "services:\n    db: App\\Database\\Connection(%dsn%)\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: "db",
        className: "App\\Database\\Connection",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "db"),
      },
    ]);
  });

  it("captures a Class::method static factory", () => {
    const source =
      "services:\n    router: App\\Router\\RouterFactory::createRouter\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: "router",
        className: null,
        factory: "App\\Router\\RouterFactory::createRouter",
        autowired: true,
        offset: offsetOf(source, "router"),
      },
    ]);
  });

  it("captures a factory key static factory in a block service", () => {
    const source =
      "services:\n    router:\n        factory: App\\Router\\RouterFactory::createRouter\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: "router",
        className: null,
        factory: "App\\Router\\RouterFactory::createRouter",
        autowired: true,
        offset: offsetOf(source, "router"),
      },
    ]);
  });

  it("uses an explicit type key as the service class reference", () => {
    const source =
      "services:\n    logger:\n        type: App\\Logging\\LoggerInterface\n        factory: @loggerFactory::create\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: "logger",
        className: "App\\Logging\\LoggerInterface",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "logger"),
      },
    ]);
  });

  it("parses an inline map with factory + setup", () => {
    const source =
      "services:\n    - { factory: App\\Model\\Factory, setup: [setDebug(@logger)] }\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: null,
        className: "App\\Model\\Factory",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "App\\Model\\Factory"),
      },
    ]);
  });

  it("parses a multi-line block service with a class key", () => {
    const source =
      "services:\n    facade:\n        class: App\\Model\\Facade\n        arguments: [%dbHost%]\n";

    expect(neonServicesFromSource(source)).toEqual([
      {
        serviceName: "facade",
        className: "App\\Model\\Facade",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "facade"),
      },
    ]);
  });

  it("preserves disabled, narrowed, and preferred autowiring policies", () => {
    const source = [
      "services:",
      "    lowerFalse: { factory: EBox\\Repository\\LowerFalse, autowired: false }",
      "    upperFalse: { factory: EBox\\Repository\\UpperFalse, autowired: FALSE }",
      "    lowerNo: { factory: EBox\\Repository\\LowerNo, autowired: no }",
      "    titleNo: { factory: EBox\\Repository\\TitleNo, autowired: No }",
      "    upperNo: { factory: EBox\\Repository\\UpperNo, autowired: NO }",
      "    narrowed: { factory: EBox\\Repository\\Narrowed, autowired: EBox\\Contract\\Primary }",
      "    preferred: { factory: EBox\\Repository\\Preferred, autowired: [EBox\\Contract\\Primary, EBox\\Contract\\Secondary] }",
      "    empty: { factory: EBox\\Repository\\Empty, autowired: [] }",
      "    dynamic: { factory: EBox\\Repository\\Dynamic, autowired: %autowired% }",
    ].join("\n");

    expect(
      neonServicesFromSource(source).map((service) => ({
        className: service.className,
        autowired: service.autowired,
      })),
    ).toEqual([
      { className: "EBox\\Repository\\LowerFalse", autowired: false },
      { className: "EBox\\Repository\\UpperFalse", autowired: false },
      { className: "EBox\\Repository\\LowerNo", autowired: false },
      { className: "EBox\\Repository\\TitleNo", autowired: false },
      { className: "EBox\\Repository\\UpperNo", autowired: false },
      {
        className: "EBox\\Repository\\Narrowed",
        autowired: ["EBox\\Contract\\Primary"],
      },
      {
        className: "EBox\\Repository\\Preferred",
        autowired: [
          "EBox\\Contract\\Primary",
          "EBox\\Contract\\Secondary",
        ],
      },
      { className: "EBox\\Repository\\Empty", autowired: [] },
      { className: "EBox\\Repository\\Dynamic", autowired: [] },
    ]);
  });

  it("parses block-form autowired target arrays and ignores malformed items", () => {
    const source = [
      "services:",
      "    repository:",
      "        factory: App\\Repository\\DatabaseRepository",
      "        autowired:",
      "            - App\\Contracts\\PrimaryRepository",
      "            - broken value",
      "            - App\\Contracts\\SecondaryRepository",
    ].join("\n");

    expect(neonServicesFromSource(source)[0]?.autowired).toEqual([
      "App\\Contracts\\PrimaryRepository",
      "App\\Contracts\\SecondaryRepository",
    ]);
  });

  it("preserves an explicit block policy with no valid targets as empty", () => {
    const source = [
      "services:",
      "    repository:",
      "        factory: App\\Repository\\DatabaseRepository",
      "        autowired:",
      "            - broken value",
      "            - %dynamic%",
    ].join("\n");

    expect(neonServicesFromSource(source)[0]?.autowired).toEqual([]);
  });

  it("decodes double-quoted service keys and preserves single-quoted backslashes", () => {
    const source = String.raw`services:
    "App\\Contracts\\Escaped": App\Service\Escaped
    'App\Contracts\Literal': App\Service\Literal
    "service\\\"name": App\Service\Named
`;

    expect(
      neonServicesFromSource(source).map((service) => service.serviceName),
    ).toEqual([
      "App\\Contracts\\Escaped",
      "App\\Contracts\\Literal",
      'service\\"name',
    ]);
  });

  it("derives Nette generated names for explicit anonymous services", () => {
    const source = [
      "services:",
      "    - Crm\\ApplicationModule\\Router\\RouterFactory",
      "    router: @Crm\\ApplicationModule\\Router\\RouterFactory::createRouter",
      "    - Crm\\ApplicationModule\\Widget\\WidgetManager",
      "    -",
      "        create: Crm\\ApplicationModule\\Translator\\FrontendTranslator()",
    ].join("\n");

    expect(
      neonGeneratedServiceNamesFromServices(neonServicesFromSource(source)).map(
        (entry) => [entry.name, entry.service.className],
      ),
    ).toEqual([
      ["01", "Crm\\ApplicationModule\\Router\\RouterFactory"],
      ["02", "Crm\\ApplicationModule\\Widget\\WidgetManager"],
      ["03", "Crm\\ApplicationModule\\Translator\\FrontendTranslator"],
    ]);
  });
});

describe("neonServiceAliasesFromSource", () => {
  it("extracts a named service alias target", () => {
    const source =
      "services:\n    mailer: App\\Mail\\Mailer\n    publicMailer: @mailer\n";

    expect(neonServiceAliasesFromSource(source)).toEqual([
      {
        serviceName: "publicMailer",
        targetName: "mailer",
        offset: offsetOf(source, "publicMailer"),
        targetSpan: spanOf(source, "@mailer"),
      },
    ]);
  });

  it("does not treat a factory service call as a plain alias", () => {
    const source =
      "services:\n    router: @routerFactory::createRouter\n";

    expect(neonServiceAliasesFromSource(source)).toEqual([]);
  });
});

describe("detectNeonServiceReferenceAt", () => {
  it("detects an @serviceName reference in a setup argument", () => {
    const source =
      "services:\n    - App\\Foo(setup: [setLogger(@logger)])\n";
    const onRef = offsetOf(source, "@logger", 3);

    expect(detectNeonServiceReferenceAt(source, onRef)).toEqual({
      name: "logger",
      span: spanOf(source, "@logger"),
    });
  });

  it("detects a typed @\\App\\Class reference", () => {
    const source = "services:\n    x: App\\Foo(@\\App\\Model\\Repo)\n";
    const onRef = offsetOf(source, "@\\App\\Model\\Repo", 4);

    expect(detectNeonServiceReferenceAt(source, onRef)).toEqual({
      name: "\\App\\Model\\Repo",
      span: spanOf(source, "@\\App\\Model\\Repo"),
    });
  });

  it("detects an @App\\Class typed reference without leading backslash", () => {
    const source = "services:\n    x: App\\Foo(@App\\Model\\Repo)\n";
    const onRef = offsetOf(source, "@App\\Model\\Repo", 3);

    expect(detectNeonServiceReferenceAt(source, onRef)).toEqual({
      name: "App\\Model\\Repo",
      span: spanOf(source, "@App\\Model\\Repo"),
    });
  });

  it("detects a generated numeric @service reference", () => {
    const source = "services:\n    router: @01::createRouter\n";
    const onRef = offsetOf(source, "@01", 2);

    expect(detectNeonServiceReferenceAt(source, onRef)).toEqual({
      name: "01",
      span: spanOf(source, "@01"),
    });
  });

  it("detects dotted Nette service names", () => {
    const source = "services:\n    x: Foo(@nette.latteFactory)\n";
    const onRef = offsetOf(source, "@nette.latteFactory", 4);

    expect(detectNeonServiceReferenceAt(source, onRef)).toEqual({
      name: "nette.latteFactory",
      span: spanOf(source, "@nette.latteFactory"),
    });
  });

  it("does not treat an email address as a service reference", () => {
    const source = "parameters:\n    adminEmail: admin@example.com\n";
    const onAt = offsetOf(source, "@example", 2);

    expect(detectNeonServiceReferenceAt(source, onAt)).toBeNull();
  });

  it("does not detect an @ inside a quoted string", () => {
    const source = "parameters:\n    note: 'ping @support now'\n";
    const inString = offsetOf(source, "@support", 2);

    expect(detectNeonServiceReferenceAt(source, inString)).toBeNull();
  });
});

describe("detectNeonServiceMethodReferenceAt", () => {
  it("detects the method part of an @service::method reference", () => {
    const source =
      "services:\n    router: @routerFactory::createRouter\n";
    const onMethod = offsetOf(source, "createRouter", 3);

    expect(detectNeonServiceMethodReferenceAt(source, onMethod)).toEqual({
      methodName: "createRouter",
      methodSpan: spanOf(source, "createRouter"),
      serviceName: "routerFactory",
      serviceSpan: spanOf(source, "@routerFactory"),
    });
  });

  it("does not detect the service part as a service method reference", () => {
    const source =
      "services:\n    router: @routerFactory::createRouter\n";
    const onService = offsetOf(source, "@routerFactory", 3);

    expect(detectNeonServiceMethodReferenceAt(source, onService)).toBeNull();
  });
});

describe("neonServiceReferenceCompletionContextAt", () => {
  it("offers completion right after an @", () => {
    const source = "services:\n    x: App\\Foo(@)\n";
    const cursor = offsetOf(source, "@") + 1;

    expect(neonServiceReferenceCompletionContextAt(source, cursor)).toEqual({
      prefix: "",
      span: { start: cursor, end: cursor },
    });
  });

  it("offers completion for a partially typed service reference", () => {
    const source = "services:\n    x: App\\Foo(@log)\n";
    const nameStart = offsetOf(source, "@log") + 1;
    const cursor = nameStart + 3;

    expect(neonServiceReferenceCompletionContextAt(source, cursor)).toEqual({
      prefix: "log",
      span: { start: nameStart, end: nameStart + 3 },
    });
  });

  it("offers completion for a generated numeric service reference", () => {
    const source = "services:\n    x: App\\Foo(@0)\n";
    const nameStart = offsetOf(source, "@0") + 1;
    const cursor = nameStart + 1;

    expect(neonServiceReferenceCompletionContextAt(source, cursor)).toEqual({
      prefix: "0",
      span: { start: nameStart, end: nameStart + 1 },
    });
  });

  it("offers completion for dotted service references", () => {
    const source = "services:\n    x: App\\Foo(@nette.lat)\n";
    const nameStart = offsetOf(source, "@nette.lat") + 1;
    const cursor = nameStart + "nette.lat".length;

    expect(neonServiceReferenceCompletionContextAt(source, cursor)).toEqual({
      prefix: "nette.lat",
      span: { start: nameStart, end: nameStart + "nette.lat".length },
    });
  });

  it("does not offer completion after an email @", () => {
    const source = "parameters:\n    m: admin@ex\n";
    const cursor = offsetOf(source, "@ex") + 3;

    expect(neonServiceReferenceCompletionContextAt(source, cursor)).toBeNull();
  });
});

describe("detectNeonServiceSetupMethodAt", () => {
  it("detects a setup method in a block setup list with its owning service", () => {
    const source =
      "services:\n    mailer:\n        class: App\\Mail\\Mailer\n        setup:\n            - setLogger(@logger)\n";
    const onMethod = offsetOf(source, "setLogger", 4);

    expect(detectNeonServiceSetupMethodAt(source, onMethod)).toEqual({
      methodName: "setLogger",
      span: spanOf(source, "setLogger"),
      service: {
        serviceName: "mailer",
        className: "App\\Mail\\Mailer",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "mailer"),
      },
    });
  });

  it("detects a setup method in an inline service map", () => {
    const source =
      "services:\n    - { factory: App\\Model\\Factory, setup: [setDebug(@logger)] }\n";
    const onMethod = offsetOf(source, "setDebug", 3);

    expect(detectNeonServiceSetupMethodAt(source, onMethod)).toEqual({
      methodName: "setDebug",
      span: spanOf(source, "setDebug"),
      service: {
        serviceName: null,
        className: "App\\Model\\Factory",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "App\\Model\\Factory"),
      },
    });
  });

  it("does not treat service-reference method calls as receiver setup methods", () => {
    const source =
      "services:\n    mailer:\n        class: App\\Mail\\Mailer\n        setup:\n            - @logger::setMailer()\n";
    const onMethod = offsetOf(source, "setMailer", 3);

    expect(detectNeonServiceSetupMethodAt(source, onMethod)).toBeNull();
  });
});

describe("neonServiceSetupMethodCompletionContextAt", () => {
  it("offers completion for a partially typed setup method", () => {
    const source =
      "services:\n    mailer:\n        class: App\\Mail\\Mailer\n        setup:\n            - setLog";
    const cursor = source.length;

    expect(neonServiceSetupMethodCompletionContextAt(source, cursor)).toEqual({
      prefix: "setLog",
      span: spanOf(source, "setLog"),
      service: {
        serviceName: "mailer",
        className: "App\\Mail\\Mailer",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "mailer"),
      },
    });
  });

  it("offers completion in a one-line setup value", () => {
    const source =
      "services:\n    mailer:\n        class: App\\Mail\\Mailer\n        setup: setLog";
    const cursor = source.length;

    expect(neonServiceSetupMethodCompletionContextAt(source, cursor)).toEqual({
      prefix: "setLog",
      span: spanOf(source, "setLog"),
      service: {
        serviceName: "mailer",
        className: "App\\Mail\\Mailer",
        factory: null,
        autowired: true,
        offset: offsetOf(source, "mailer"),
      },
    });
  });

  it("does not offer method completion inside a setup argument", () => {
    const source =
      "services:\n    mailer:\n        class: App\\Mail\\Mailer\n        setup:\n            - setLogger(log";
    const cursor = source.length;

    expect(neonServiceSetupMethodCompletionContextAt(source, cursor)).toBeNull();
  });

  it("does not offer method completion outside setup", () => {
    const source = "services:\n    mailer: App\\Mail\\Mailer(setLog";
    const cursor = source.length;

    expect(neonServiceSetupMethodCompletionContextAt(source, cursor)).toBeNull();
  });
});

describe("netteInjectedPropertyTypes", () => {
  it("reads a #[Inject] attribute property", () => {
    const source =
      "<?php\nclass P {\n    #[Inject] public FooService $foo;\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "foo",
        type: "FooService",
        offset: offsetOf(source, "$foo") + 1,
      },
    ]);
  });

  it("reads a fully-qualified Inject attribute", () => {
    const source =
      "<?php\nclass P {\n    #[\\Nette\\DI\\Attributes\\Inject]\n    public BarService $bar;\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "bar",
        type: "BarService",
        offset: offsetOf(source, "$bar") + 1,
      },
    ]);
  });

  it("reads a docblock @inject property", () => {
    const source =
      "<?php\nclass P {\n    /** @inject */\n    public BazService $baz;\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "baz",
        type: "BazService",
        offset: offsetOf(source, "$baz") + 1,
      },
    ]);
  });

  it("reads an inject* setter method typed parameter", () => {
    const source =
      "<?php\nclass P {\n    public function injectRouter(RouterFactory $router) {}\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "router",
        type: "RouterFactory",
        offset: offsetOf(source, "$router") + 1,
      },
    ]);
  });

  it("reads promoted constructor parameters", () => {
    const source =
      "<?php\nclass P {\n    public function __construct(private ProductRepository $products) {}\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "products",
        type: "ProductRepository",
        offset: offsetOf(source, "$products") + 1,
      },
    ]);
  });

  it("reads plain typed constructor parameters", () => {
    const source =
      "<?php\nclass P {\n    public function __construct(Logger $logger) {}\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "logger",
        type: "Logger",
        offset: offsetOf(source, "$logger") + 1,
      },
    ]);
  });

  it("keeps a fully-qualified type and strips a nullable marker", () => {
    const source =
      "<?php\nclass P {\n    #[Inject] public ?\\App\\Model\\Foo $foo;\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "foo",
        type: "\\App\\Model\\Foo",
        offset: offsetOf(source, "$foo") + 1,
      },
    ]);
  });

  it("ignores builtin scalar constructor parameters", () => {
    const source =
      "<?php\nclass P {\n    public function __construct(int $count, string $label, Repo $repo) {}\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "repo",
        type: "Repo",
        offset: offsetOf(source, "$repo") + 1,
      },
    ]);
  });

  it("ignores untyped constructor parameters", () => {
    const source =
      "<?php\nclass P {\n    public function __construct($raw) {}\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([]);
  });

  it("skips union-typed parameters as ambiguous receivers", () => {
    const source =
      "<?php\nclass P {\n    #[Inject] public Foo|Bar $either;\n}\n";

    expect(netteInjectedPropertyTypes(source)).toEqual([]);
  });

  it("reads injected presenter and control properties in document order", () => {
    const source = `<?php

class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    #[Nette\\DI\\Attributes\\Inject]
    public ProductRepository $products;
}

class CartSummaryControl extends Nette\\Application\\UI\\Control
{
    /**
     * @inject
     * @var CartFacade
     */
    public $cartFacade;
}
`;

    expect(netteInjectedPropertyTypes(source)).toEqual([
      {
        name: "products",
        type: "ProductRepository",
        offset: offsetOf(source, "$products") + 1,
      },
      {
        name: "cartFacade",
        type: "CartFacade",
        offset: offsetOf(source, "$cartFacade") + 1,
      },
    ]);
  });
});

describe("netteInjectionTypeReferenceAt", () => {
  it.each([
    "private ProductRepository $products",
    "ProductRepository $products",
  ])("detects a constructor parameter type in %s", (parameter) => {
    const source = `<?php
namespace App\\Presenters;
use App\\Model\\ProductRepository;
class ProductPresenter {
    public function __construct(${parameter}) {}
}`;

    expect(
      netteInjectionTypeReferenceAt(
        source,
        source.lastIndexOf("ProductRepository") + 3,
      ),
    ).toEqual({
      className: "App\\Model\\ProductRepository",
      span: {
        start: source.lastIndexOf("ProductRepository"),
        end: source.lastIndexOf("ProductRepository") + "ProductRepository".length,
      },
      type: "ProductRepository",
    });
  });

  it.each([
    "#[Inject] public Catalog $catalog;",
    "/** @inject */ public Catalog $catalog;",
  ])("detects an injected property type in %s", (property) => {
    const source = `<?php
namespace App\\Presenters;
use App\\Services\\Catalog;
class ProductPresenter { ${property} }`;

    expect(
      netteInjectionTypeReferenceAt(source, source.lastIndexOf("Catalog") + 2)
        ?.className,
    ).toBe("App\\Services\\Catalog");
  });

  it("detects an untyped @inject property's @var type", () => {
    const source = `<?php
namespace App\\Presenters;
use App\\Services\\Catalog;
class ProductPresenter {
    /**
     * @inject
     * @var Catalog
     */
    public $catalog;
}`;

    expect(
      netteInjectionTypeReferenceAt(source, source.lastIndexOf("Catalog") + 2)
        ?.className,
    ).toBe("App\\Services\\Catalog");
  });

  it("returns null on the injected property name", () => {
    const source = "<?php class P { #[Inject] public Catalog $catalog; }";

    expect(
      netteInjectionTypeReferenceAt(source, offsetOf(source, "$catalog") + 2),
    ).toBeNull();
  });

  it("resolves a use-statement alias", () => {
    const source = `<?php
namespace App\\Presenters;
use App\\Services\\Catalog as ProductCatalog;
class P { public function injectCatalog(ProductCatalog $catalog) {} }`;

    expect(
      netteInjectionTypeReferenceAt(
        source,
        source.lastIndexOf("ProductCatalog") + 2,
      )?.className,
    ).toBe("App\\Services\\Catalog");
  });

  it.each([
    {
      label: "line comment",
      source:
        "<?php class P { // public function __construct(Catalog $catalog) {}\n}",
    },
    {
      label: "string literal",
      source:
        "<?php class P { public string $value = 'function __construct(Catalog $catalog)'; }",
    },
    {
      label: "heredoc",
      source: `<?php class P {
    public string $value = <<<PHP
function __construct(Catalog $catalog)
PHP;
}`,
    },
  ])("ignores injection-like types inside a $label", ({ source }) => {
    expect(
      netteInjectionTypeReferenceAt(source, source.indexOf("Catalog") + 2),
    ).toBeNull();
  });

  it("excludes the nullable marker from the injection type span", () => {
    const source =
      "<?php class P { public function __construct(?Catalog $catalog) {} }";
    const typeStart = source.indexOf("Catalog");

    expect(netteInjectionTypeReferenceAt(source, typeStart + 2)).toEqual({
      className: "Catalog",
      span: { start: typeStart, end: typeStart + "Catalog".length },
      type: "Catalog",
    });
    expect(netteInjectionTypeReferenceAt(source, typeStart - 1)).toBeNull();
  });

  it.each(["Catalog|Other", "Catalog|null"])(
    "rejects the union injection type %s",
    (type) => {
      const source = `<?php class P { public function __construct(${type} $catalog) {} }`;

      expect(
        netteInjectionTypeReferenceAt(source, source.indexOf("Catalog") + 2),
      ).toBeNull();
    },
  );

  it("resolves a global injection type without its leading slash", () => {
    const source =
      "<?php class P { public function __construct(\\App\\Services\\Catalog $catalog) {} }";

    expect(
      netteInjectionTypeReferenceAt(source, source.indexOf("Catalog") + 2)
        ?.className,
    ).toBe("App\\Services\\Catalog");
  });

  it.each([
    {
      expected: "App\\Services\\Catalog",
      importedType: "Catalog",
      useStatement: "use App\\Services\\{Catalog, Other};",
    },
    {
      expected: "App\\Services\\Catalog",
      importedType: "Cat",
      useStatement: "use App\\Services\\{Catalog as Cat};",
    },
  ])(
    "resolves $importedType from a grouped use statement",
    ({ expected, importedType, useStatement }) => {
      const source = `<?php
${useStatement}
class P { public function __construct(${importedType} $catalog) {} }`;

      expect(
        netteInjectionTypeReferenceAt(
          source,
          source.lastIndexOf(importedType) + 1,
        )?.className,
      ).toBe(expected);
    },
  );

  it("stops an @var injection type span before generic arguments", () => {
    const source = `<?php
use App\\Services\\Catalog;
class P {
    /** @inject @var Catalog<Other> */
    public $catalog;
}`;
    const typeStart = source.lastIndexOf("Catalog");

    expect(netteInjectionTypeReferenceAt(source, typeStart + 2)).toEqual({
      className: "App\\Services\\Catalog",
      span: { start: typeStart, end: typeStart + "Catalog".length },
      type: "Catalog",
    });
    expect(
      netteInjectionTypeReferenceAt(source, source.indexOf("<Other>") + 1),
    ).toBeNull();
  });
});
