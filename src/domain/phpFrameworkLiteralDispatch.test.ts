import { describe, expect, it } from "vitest";
import * as facade from "./phpFrameworkProviders";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import * as dispatch from "./phpFrameworkLiteralDispatch";

const position = { column: 4, lineNumber: 2 };

function providers(): readonly PhpFrameworkProvider[] {
  const inert: PhpFrameworkProvider = { id: "inert" };
  const primary: PhpFrameworkProvider = {
    config: {
      keysFromSource: () => [{ key: "app.name", position }],
      missingTargetMessage: ({ key }) => `config:${key}`,
      referenceAt: () => ({
        call: "config",
        key: "app.na",
        position,
        prefix: "app.na",
      }),
      resolveLiteralTarget: ({ literal }) => ({ kind: "config", literal }),
      targetFromSource: ({ key }) => ({ key, position }),
    },
    env: {
      entriesFromSource: () => [{ name: "APP_ENV", position }],
      missingTargetMessage: ({ name }) => `env:${name}`,
      referenceAt: () => ({ name: "APP_", position, prefix: "APP_" }),
      resolveLiteralTarget: ({ literal }) => ({ kind: "env", literal }),
    },
    id: "primary",
    inertia: {
      referenceAt: () => ({
        call: "render",
        name: "Users",
        position,
        prefix: "Us",
      }),
      resolveLiteralTarget: ({ literal }) => ({ kind: "inertia", literal }),
    },
    php: {
      isScopedStringCompletionContext: () => true,
      scopedStringCompletionAt: () => ({ kind: "cacheStore", prefix: "re" }),
      scopedStringCompletionInsertText: ({ name }) => `cache:${name}`,
    },
    routes: {
      missingTargetMessage: ({ name }) => `route:${name}`,
    },
    stringLiterals: {
      helperAt: () => ({
        helper: "route",
        literal: "dashboard",
        literalEnd: 12,
        literalStart: 3,
      }),
    },
    translations: {
      jsonKeysFromSource: () => [{ key: "Welcome", position }],
      jsonTargetFromSource: ({ key }) => ({ key, position }),
      keysFromSource: () => [{ key: "messages.welcome", position }],
      missingTargetMessage: ({ key }) => `translation:${key}`,
      referenceAt: () => ({
        call: "__",
        key: "messages.",
        position,
        prefix: "messages.",
      }),
      resolveLiteralTarget: ({ literal }) => ({ kind: "translation", literal }),
      targetFromSource: ({ key }) => ({ key, position }),
    },
  };
  const secondary: PhpFrameworkProvider = {
    config: {
      keysFromSource: () => [{ key: "secondary.key", position }],
      referenceAt: () => ({
        call: "secondary",
        key: "ignored",
        position,
        prefix: "",
      }),
    },
    env: {
      entriesFromSource: () => [{ name: "SECONDARY", position }],
      targetFromSource: ({ name }) => ({ name, position }),
    },
    id: "secondary",
    translations: {
      jsonKeysFromSource: () => [{ key: "Secondary", position }],
      keysFromSource: () => [{ key: "secondary.message", position }],
    },
  };

  return [inert, primary, secondary];
}

describe("PHP framework literal dispatch", () => {
  it("matches facade ordering, aggregation, and fallback behavior", () => {
    const active = providers();
    const source = "<?php route('dashboard');";
    const calls: readonly [string, () => unknown, () => unknown][] = [
      [
        "route message",
        () =>
          dispatch.phpFrameworkRouteMissingTargetMessage("dashboard", active),
        () => facade.phpFrameworkRouteMissingTargetMessage("dashboard", active),
      ],
      [
        "config reference",
        () => dispatch.phpFrameworkConfigReferenceAt(source, position, active),
        () => facade.phpFrameworkConfigReferenceAt(source, position, active),
      ],
      [
        "config context",
        () =>
          dispatch.phpFrameworkConfigCompletionContextAt(
            source,
            position,
            active,
          ),
        () =>
          facade.phpFrameworkConfigCompletionContextAt(
            source,
            position,
            active,
          ),
      ],
      [
        "config keys",
        () => dispatch.phpFrameworkConfigKeysFromSource(source, "app", active),
        () => facade.phpFrameworkConfigKeysFromSource(source, "app", active),
      ],
      [
        "config target",
        () =>
          dispatch.phpFrameworkConfigTargetFromSource(
            source,
            "app",
            "app.name",
            active,
          ),
        () =>
          facade.phpFrameworkConfigTargetFromSource(
            source,
            "app",
            "app.name",
            active,
          ),
      ],
      [
        "config literal",
        () => dispatch.phpFrameworkConfigLiteralTarget("app.name", active),
        () => facade.phpFrameworkConfigLiteralTarget("app.name", active),
      ],
      [
        "config message",
        () =>
          dispatch.phpFrameworkConfigMissingTargetMessage("app.name", active),
        () => facade.phpFrameworkConfigMissingTargetMessage("app.name", active),
      ],
      [
        "env reference",
        () => dispatch.phpFrameworkEnvReferenceAt(source, position, active),
        () => facade.phpFrameworkEnvReferenceAt(source, position, active),
      ],
      [
        "env context",
        () =>
          dispatch.phpFrameworkEnvCompletionContextAt(source, position, active),
        () =>
          facade.phpFrameworkEnvCompletionContextAt(source, position, active),
      ],
      [
        "env entries",
        () => dispatch.phpFrameworkEnvEntriesFromSource(source, active),
        () => facade.phpFrameworkEnvEntriesFromSource(source, active),
      ],
      [
        "env fallback target",
        () =>
          dispatch.phpFrameworkEnvTargetFromSource(source, "APP_ENV", active),
        () => facade.phpFrameworkEnvTargetFromSource(source, "APP_ENV", active),
      ],
      [
        "env direct target",
        () =>
          dispatch.phpFrameworkEnvTargetFromSource(source, "SECONDARY", active),
        () =>
          facade.phpFrameworkEnvTargetFromSource(source, "SECONDARY", active),
      ],
      [
        "env literal",
        () => dispatch.phpFrameworkEnvLiteralTarget("APP_ENV", active),
        () => facade.phpFrameworkEnvLiteralTarget("APP_ENV", active),
      ],
      [
        "env message",
        () => dispatch.phpFrameworkEnvMissingTargetMessage("APP_ENV", active),
        () => facade.phpFrameworkEnvMissingTargetMessage("APP_ENV", active),
      ],
      [
        "translation reference",
        () =>
          dispatch.phpFrameworkTranslationReferenceAt(source, position, active),
        () =>
          facade.phpFrameworkTranslationReferenceAt(source, position, active),
      ],
      [
        "translation context",
        () =>
          dispatch.phpFrameworkTranslationCompletionContextAt(
            source,
            position,
            active,
          ),
        () =>
          facade.phpFrameworkTranslationCompletionContextAt(
            source,
            position,
            active,
          ),
      ],
      [
        "translation keys",
        () =>
          dispatch.phpFrameworkTranslationKeysFromSource(
            source,
            "messages",
            active,
          ),
        () =>
          facade.phpFrameworkTranslationKeysFromSource(
            source,
            "messages",
            active,
          ),
      ],
      [
        "translation target",
        () =>
          dispatch.phpFrameworkTranslationTargetFromSource(
            source,
            "messages",
            "messages.welcome",
            active,
          ),
        () =>
          facade.phpFrameworkTranslationTargetFromSource(
            source,
            "messages",
            "messages.welcome",
            active,
          ),
      ],
      [
        "translation literal",
        () =>
          dispatch.phpFrameworkTranslationLiteralTarget(
            "messages.welcome",
            active,
          ),
        () =>
          facade.phpFrameworkTranslationLiteralTarget(
            "messages.welcome",
            active,
          ),
      ],
      [
        "translation message",
        () =>
          dispatch.phpFrameworkTranslationMissingTargetMessage(
            "messages.welcome",
            active,
          ),
        () =>
          facade.phpFrameworkTranslationMissingTargetMessage(
            "messages.welcome",
            active,
          ),
      ],
      [
        "JSON keys",
        () =>
          dispatch.phpFrameworkJsonTranslationKeysFromSource(source, active),
        () => facade.phpFrameworkJsonTranslationKeysFromSource(source, active),
      ],
      [
        "JSON target",
        () =>
          dispatch.phpFrameworkJsonTranslationTargetFromSource(
            source,
            "Welcome",
            active,
          ),
        () =>
          facade.phpFrameworkJsonTranslationTargetFromSource(
            source,
            "Welcome",
            active,
          ),
      ],
      [
        "Inertia reference",
        () => dispatch.phpFrameworkInertiaReferenceAt(source, position, active),
        () => facade.phpFrameworkInertiaReferenceAt(source, position, active),
      ],
      [
        "Inertia context",
        () =>
          dispatch.phpFrameworkInertiaCompletionContextAt(
            source,
            position,
            active,
          ),
        () =>
          facade.phpFrameworkInertiaCompletionContextAt(
            source,
            position,
            active,
          ),
      ],
      [
        "Inertia literal",
        () => dispatch.phpFrameworkInertiaLiteralTarget("Users", active),
        () => facade.phpFrameworkInertiaLiteralTarget("Users", active),
      ],
      [
        "helper",
        () => dispatch.phpFrameworkStringLiteralHelperAt(source, 5, active),
        () => facade.phpFrameworkStringLiteralHelperAt(source, 5, active),
      ],
      [
        "scoped context",
        () =>
          dispatch.phpFrameworkScopedStringCompletionContextAt(
            source,
            position,
            active,
          ),
        () =>
          facade.phpFrameworkScopedStringCompletionContextAt(
            source,
            position,
            active,
          ),
      ],
    ];

    for (const [label, actual, expected] of calls) {
      expect(actual(), label).toEqual(expected());
    }

    expect(
      dispatch.phpFrameworkConfigReferenceAt(source, position, active)?.call,
    ).toBe("config");
    expect(
      dispatch.phpFrameworkConfigKeysFromSource(source, "app", active),
    ).toHaveLength(2);
    expect(
      dispatch.phpFrameworkEnvEntriesFromSource(source, active),
    ).toHaveLength(2);
    expect(
      dispatch.phpFrameworkTranslationKeysFromSource(
        source,
        "messages",
        active,
      ),
    ).toHaveLength(2);
    expect(
      dispatch.phpFrameworkStringLiteralHelperAt(source, 5, active)?.providerId,
    ).toBe("primary");
  });

  it("preserves scoped completion metadata and insertion strategy", () => {
    const active = providers();
    const actual = dispatch.phpFrameworkScopedStringCompletionAt(
      "<?php",
      position,
      active,
    );
    const expected = facade.phpFrameworkScopedStringCompletionAt(
      "<?php",
      position,
      active,
    );

    expect(
      actual && {
        kind: actual.kind,
        prefix: actual.prefix,
        providerId: actual.providerId,
      },
    ).toEqual(
      expected && {
        kind: expected.kind,
        prefix: expected.prefix,
        providerId: expected.providerId,
      },
    );
    expect(actual?.insertText("redis")).toBe(expected?.insertText("redis"));
    expect(dispatch.phpFrameworkConfigReferenceAt("", position, [])).toBeNull();
  });
});
