import { describe, expect, it, vi } from "vitest";
import {
  latteFunctionReferenceAt,
  resolveLatteFunctionDefinition,
  type LatteFunctionDefinitionContext,
} from "./latteFunctionDefinitions";
import type { LatteFunctionRegistrationTarget } from "./latteFunctionDiscovery";

const EXTENSION_PATH = "/ws/app/Latte/AppLatteExtension.php";
const EXTENSION_SOURCE = `<?php
final class AppLatteExtension extends Latte\\Extension
{
    public function getFunctions(): array
    {
        return [
            'money' => [$this, 'formatMoney'],
        ];
    }

    public function formatMoney(float $value): string
    {
        return '';
    }
}
`;
const CLOSURE_PATH = "/ws/app/Model/TemplateFactory.php";
const CLOSURE_SOURCE = `<?php
$latte->addFunction('shuffled', fn(array $values) => $values);
`;

function offsetAfter(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`missing needle: ${needle}`);
  }

  return index + needle.length;
}

function methodRegistration(): LatteFunctionRegistrationTarget {
  return {
    callableKind: "instance",
    callableOffset: EXTENSION_SOURCE.indexOf(
      "formatMoney",
      EXTENSION_SOURCE.indexOf("function formatMoney"),
    ),
    className: "AppLatteExtension",
    methodName: "formatMoney",
    name: "money",
    offset: EXTENSION_SOURCE.indexOf("money"),
    path: EXTENSION_PATH,
    serviceClassName: "AppLatteExtension",
  };
}

function closureRegistration(): LatteFunctionRegistrationTarget {
  return {
    name: "shuffled",
    offset: CLOSURE_SOURCE.indexOf("shuffled"),
    path: CLOSURE_PATH,
  };
}

function makeContext({
  active = true,
  registrations = [methodRegistration()],
  sourceByPath = { [EXTENSION_PATH]: EXTENSION_SOURCE },
}: {
  active?: boolean | (() => boolean);
  registrations?: LatteFunctionRegistrationTarget[];
  sourceByPath?: Record<string, string>;
} = {}): LatteFunctionDefinitionContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    deps: {
      openPhpMethodTarget: vi.fn(async () => true),
      openTarget: vi.fn(async () => true),
      readFileContent: vi.fn(async (path: string) => {
        const source = sourceByPath[path];

        if (source === undefined) {
          throw new Error(`no such file: ${path}`);
        }

        return source;
      }),
    },
    isRequestedRootActive: isActive,
    loadFunctionRegistrations: vi.fn(async () => registrations),
  };
}

describe("latteFunctionReferenceAt", () => {
  it("detects a function call inside a known tag expression", () => {
    const source = "{if isEven($number)}x{/if}";

    expect(
      latteFunctionReferenceAt(source, offsetAfter(source, "isEv")),
    ).toEqual({ name: "isEven" });
  });

  it("detects a bare unknown-tag function call", () => {
    const source = "<p>{money($amount)}</p>";

    expect(
      latteFunctionReferenceAt(source, offsetAfter(source, "mon")),
    ).toEqual({ name: "money" });
  });

  it("detects a function call inside an n:attribute expression", () => {
    const source = '<li n:if="isEven($number)">even</li>';

    expect(
      latteFunctionReferenceAt(source, offsetAfter(source, "isEv")),
    ).toEqual({ name: "isEven" });
  });

  it("ignores filters, variables, members, and static calls", () => {
    const filterSource = "{$total|money}";
    const memberSource = "{$formatter->money($total)}";
    const staticSource = "{if Helpers::money($total)}x{/if}";

    expect(
      latteFunctionReferenceAt(filterSource, offsetAfter(filterSource, "mon")),
    ).toBeNull();
    expect(
      latteFunctionReferenceAt(memberSource, offsetAfter(memberSource, "mon")),
    ).toBeNull();
    expect(
      latteFunctionReferenceAt(staticSource, offsetAfter(staticSource, "mon")),
    ).toBeNull();
  });

  it("ignores identifiers without a call and names inside strings", () => {
    const bareSource = "{if $money}x{/if}";
    const stringSource = "{if $label === 'money($x)'}x{/if}";
    const commentSource = "{* money($x) *}";

    expect(
      latteFunctionReferenceAt(bareSource, offsetAfter(bareSource, "$mon")),
    ).toBeNull();
    expect(
      latteFunctionReferenceAt(stringSource, offsetAfter(stringSource, "'mon")),
    ).toBeNull();
    expect(
      latteFunctionReferenceAt(commentSource, offsetAfter(commentSource, "mon")),
    ).toBeNull();
  });

  it("ignores a tag name that is not a call", () => {
    const source = "{include 'money.latte'}";

    expect(
      latteFunctionReferenceAt(source, source.indexOf("include") + 3),
    ).toBeNull();
  });
});

describe("resolveLatteFunctionDefinition", () => {
  it("opens the PHP method behind a getFunctions map entry", async () => {
    const context = makeContext();
    const source = "{if isEven($n)}{/if}{money($amount)}";

    await expect(
      resolveLatteFunctionDefinition(
        context,
        source,
        offsetAfter(source, "{mon"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "AppLatteExtension",
      "formatMoney",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("falls back to the addFunction call site for closure registrations", async () => {
    const context = makeContext({
      registrations: [closureRegistration()],
      sourceByPath: { [CLOSURE_PATH]: CLOSURE_SOURCE },
    });
    context.deps.openPhpMethodTarget = vi.fn(async () => false);
    const source = "{foreach shuffled($items) as $item}{/foreach}";

    await expect(
      resolveLatteFunctionDefinition(
        context,
        source,
        offsetAfter(source, "shuff"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openTarget).toHaveBeenCalledWith(
      CLOSURE_PATH,
      { column: CLOSURE_SOURCE.indexOf("shuffled") - CLOSURE_SOURCE.indexOf("$latte") + 1, lineNumber: 2 },
      "shuffled",
    );
  });

  it("lets a custom function win over a builtin of the same name", async () => {
    const context = makeContext({
      registrations: [
        {
          ...closureRegistration(),
          name: "clamp",
          offset: CLOSURE_SOURCE.indexOf("shuffled"),
        },
      ],
      sourceByPath: { [CLOSURE_PATH]: CLOSURE_SOURCE },
    });
    const source = "{=clamp($level, 0, 255)}";

    await expect(
      resolveLatteFunctionDefinition(
        context,
        source,
        offsetAfter(source, "{=cl"),
      ),
    ).resolves.toBe(true);
    expect(context.deps.openTarget).toHaveBeenCalled();
  });

  it("returns false for builtins without a project registration", async () => {
    const context = makeContext({ registrations: [] });
    const source = "{if even($n)}{/if}";

    await expect(
      resolveLatteFunctionDefinition(context, source, offsetAfter(source, "ev")),
    ).resolves.toBe(false);
    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalled();
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("drops the result when the root goes stale after loading registrations", async () => {
    let active = true;
    const context = makeContext({ active: () => active });
    context.loadFunctionRegistrations = vi.fn(async () => {
      active = false;
      return [methodRegistration()];
    });
    const source = "{money($amount)}";

    await expect(
      resolveLatteFunctionDefinition(
        context,
        source,
        offsetAfter(source, "mon"),
      ),
    ).resolves.toBe(false);
    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalled();
  });
});
