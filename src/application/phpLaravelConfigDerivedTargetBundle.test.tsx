// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelAuthGuardConfigKey } from "../domain/phpLaravelAuth";
import { phpLaravelBroadcastConnectionConfigKey } from "../domain/phpLaravelBroadcasting";
import { phpLaravelCacheStoreConfigKey } from "../domain/phpLaravelCache";
import { phpLaravelDatabaseConnectionConfigKey } from "../domain/phpLaravelDatabase";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";
import { phpLaravelLogChannelConfigKey } from "../domain/phpLaravelLog";
import { phpLaravelMailMailerConfigKey } from "../domain/phpLaravelMail";
import { phpLaravelPasswordBrokerConfigKey } from "../domain/phpLaravelPassword";
import { phpLaravelQueueConnectionConfigKey } from "../domain/phpLaravelQueue";
import { phpLaravelRedisConnectionConfigKey } from "../domain/phpLaravelRedis";
import { phpLaravelStorageDiskConfigKey } from "../domain/phpLaravelStorage";
import {
  usePhpLaravelConfigDerivedTargetBundle,
  type PhpLaravelConfigDerivedTargetBundle,
  type PhpLaravelConfigTargetResolverLike,
} from "./phpLaravelConfigDerivedTargetBundle";

function requiredConfigKey(key: string | null): string {
  if (!key) {
    throw new Error("expected valid config key");
  }

  return key;
}

function configTarget(key: string): PhpLaravelConfigTarget {
  const fileName = key.slice(0, key.indexOf("."));

  return {
    key,
    path: `/workspace/config/${fileName}.php`,
    position: { column: 1, lineNumber: 1 },
    relativePath: `config/${fileName}.php`,
  };
}

interface Harness {
  bundle: () => PhpLaravelConfigDerivedTargetBundle;
  collect: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderBundle(
  resolver: PhpLaravelConfigTargetResolverLike,
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { bundle: PhpLaravelConfigDerivedTargetBundle | null } = {
    bundle: null,
  };

  function HarnessComponent() {
    captured.bundle = usePhpLaravelConfigDerivedTargetBundle(resolver);
    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    bundle: () => {
      if (!captured.bundle) {
        throw new Error("bundle not mounted");
      }

      return captured.bundle;
    },
    collect: resolver.collect as ReturnType<typeof vi.fn>,
    find: resolver.find as ReturnType<typeof vi.fn>,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelConfigDerivedTargetBundle", () => {
  const targetKeys = {
    authGuard: requiredConfigKey(phpLaravelAuthGuardConfigKey("web")),
    cacheStore: requiredConfigKey(phpLaravelCacheStoreConfigKey("redis")),
    databaseConnection: requiredConfigKey(
      phpLaravelDatabaseConnectionConfigKey("mysql"),
    ),
    broadcastConnection: requiredConfigKey(
      phpLaravelBroadcastConnectionConfigKey("pusher"),
    ),
    queueConnection: requiredConfigKey(
      phpLaravelQueueConnectionConfigKey("database"),
    ),
    redisConnection: requiredConfigKey(phpLaravelRedisConnectionConfigKey("cache")),
    mailMailer: requiredConfigKey(phpLaravelMailMailerConfigKey("smtp")),
    passwordBroker: requiredConfigKey(phpLaravelPasswordBrokerConfigKey("users")),
    logChannel: requiredConfigKey(phpLaravelLogChannelConfigKey("stack")),
    storageDisk: requiredConfigKey(phpLaravelStorageDiskConfigKey("local")),
  };
  const targetsByKey = new Map(
    Object.values(targetKeys).map((key) => [key, configTarget(key)]),
  );

  function renderHarness(): Harness {
    const collect = vi.fn(async () => Array.from(targetsByKey.values()));
    const find = vi.fn(async (key: string) => targetsByKey.get(key) ?? null);

    return renderBundle({ collect, find });
  }

  it("collects all ten config-derived target kinds through config target collection", async () => {
    const harness = renderHarness();
    const bundle = harness.bundle();

    await expect(bundle.collectPhpLaravelAuthGuardTargets()).resolves.toMatchObject([
      { guardName: "web", key: targetKeys.authGuard },
    ]);
    await expect(bundle.collectPhpLaravelCacheStoreTargets()).resolves.toMatchObject([
      { storeName: "redis", key: targetKeys.cacheStore },
    ]);
    await expect(
      bundle.collectPhpLaravelDatabaseConnectionTargets(),
    ).resolves.toMatchObject([
      { connectionName: "mysql", key: targetKeys.databaseConnection },
    ]);
    await expect(
      bundle.collectPhpLaravelBroadcastConnectionTargets(),
    ).resolves.toMatchObject([
      { connectionName: "pusher", key: targetKeys.broadcastConnection },
    ]);
    await expect(
      bundle.collectPhpLaravelQueueConnectionTargets(),
    ).resolves.toMatchObject([
      { connectionName: "database", key: targetKeys.queueConnection },
    ]);
    await expect(
      bundle.collectPhpLaravelRedisConnectionTargets(),
    ).resolves.toMatchObject([
      { connectionName: "cache", key: targetKeys.redisConnection },
    ]);
    await expect(bundle.collectPhpLaravelMailMailerTargets()).resolves.toMatchObject([
      { mailerName: "smtp", key: targetKeys.mailMailer },
    ]);
    await expect(
      bundle.collectPhpLaravelPasswordBrokerTargets(),
    ).resolves.toMatchObject([
      { brokerName: "users", key: targetKeys.passwordBroker },
    ]);
    await expect(bundle.collectPhpLaravelLogChannelTargets()).resolves.toMatchObject([
      { channelName: "stack", key: targetKeys.logChannel },
    ]);
    await expect(
      bundle.collectPhpLaravelStorageDiskTargets(),
    ).resolves.toMatchObject([
      { diskName: "local", key: targetKeys.storageDisk },
    ]);
    expect(harness.collect).toHaveBeenCalledTimes(10);
    expect(harness.find).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("finds all ten config-derived target kinds through config target lookup", async () => {
    const harness = renderHarness();
    const bundle = harness.bundle();

    await expect(bundle.findPhpLaravelAuthGuardTarget("web")).resolves.toMatchObject({
      guardName: "web",
      key: targetKeys.authGuard,
    });
    await expect(
      bundle.findPhpLaravelCacheStoreTarget("redis"),
    ).resolves.toMatchObject({
      storeName: "redis",
      key: targetKeys.cacheStore,
    });
    await expect(
      bundle.findPhpLaravelDatabaseConnectionTarget("mysql"),
    ).resolves.toMatchObject({
      connectionName: "mysql",
      key: targetKeys.databaseConnection,
    });
    await expect(
      bundle.findPhpLaravelBroadcastConnectionTarget("pusher"),
    ).resolves.toMatchObject({
      connectionName: "pusher",
      key: targetKeys.broadcastConnection,
    });
    await expect(
      bundle.findPhpLaravelQueueConnectionTarget("database"),
    ).resolves.toMatchObject({
      connectionName: "database",
      key: targetKeys.queueConnection,
    });
    await expect(
      bundle.findPhpLaravelRedisConnectionTarget("cache"),
    ).resolves.toMatchObject({
      connectionName: "cache",
      key: targetKeys.redisConnection,
    });
    await expect(bundle.findPhpLaravelMailMailerTarget("smtp")).resolves.toMatchObject({
      mailerName: "smtp",
      key: targetKeys.mailMailer,
    });
    await expect(
      bundle.findPhpLaravelPasswordBrokerTarget("users"),
    ).resolves.toMatchObject({
      brokerName: "users",
      key: targetKeys.passwordBroker,
    });
    await expect(bundle.findPhpLaravelLogChannelTarget("stack")).resolves.toMatchObject({
      channelName: "stack",
      key: targetKeys.logChannel,
    });
    await expect(
      bundle.findPhpLaravelStorageDiskTarget("local"),
    ).resolves.toMatchObject({
      diskName: "local",
      key: targetKeys.storageDisk,
    });
    expect(harness.find.mock.calls.map(([key]) => key)).toEqual([
      targetKeys.authGuard,
      targetKeys.cacheStore,
      targetKeys.databaseConnection,
      targetKeys.broadcastConnection,
      targetKeys.queueConnection,
      targetKeys.redisConnection,
      targetKeys.mailMailer,
      targetKeys.passwordBroker,
      targetKeys.logChannel,
      targetKeys.storageDisk,
    ]);
    expect(harness.collect).not.toHaveBeenCalled();

    harness.unmount();
  });
});
