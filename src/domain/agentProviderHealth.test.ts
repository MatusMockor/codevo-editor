import { describe, expect, it } from "vitest";
import {
  agentProviderInstallerLabel,
  agentProviderSelfUpdateCommandLabel,
  appendAgentProviderUpdateOutputTail,
  parseAgentProviderCurrentPolicyResult,
  parseAgentProviderHealthProbeResult,
  parseAgentProviderPolicyRegistrationReceipt,
  parseAgentProviderUpdateResult,
  parseAgentProviderUpdateProgressEvent,
  validateAgentProviderHealthProbeRequest,
  validateAgentProviderCurrentPolicyRequest,
  validateAgentProviderPolicyRegistrationRequest,
  validateAgentProviderUpdateRequest,
} from "./agentProviderHealth";

describe("provider policy contracts", () => {
  it("validates registration and exact generation receipt", () => {
    expect(
      validateAgentProviderPolicyRegistrationRequest({
        provider: "codex",
        settingsRevision: 7,
        expectedProviderGeneration: null,
        enabled: true,
        cliPath: "/usr/local/bin/codex",
        checkForUpdates: true,
      }),
    ).toEqual({
      provider: "codex",
      settingsRevision: 7,
      expectedProviderGeneration: null,
      enabled: true,
      cliPath: "/usr/local/bin/codex",
      checkForUpdates: true,
    });
    expect(
      parseAgentProviderPolicyRegistrationReceipt({
        provider: "codex",
        settingsRevision: 7,
        providerGeneration: 3,
      }),
    ).toEqual({ provider: "codex", settingsRevision: 7, providerGeneration: 3 });
    expect(() =>
      parseAgentProviderPolicyRegistrationReceipt({
        provider: "codex",
        settingsRevision: 0,
        providerGeneration: 0,
      }),
    ).toThrow(TypeError);
  });

  it("accepts disabled pathless replacement and rejects secrets or extra authority", () => {
    expect(
      validateAgentProviderPolicyRegistrationRequest({
        provider: "claudeCode",
        settingsRevision: 8,
        expectedProviderGeneration: 3,
        enabled: false,
        cliPath: null,
        checkForUpdates: false,
      }),
    ).toMatchObject({ enabled: false, cliPath: null });
    for (const malformed of [
      {
        provider: "codex",
        settingsRevision: 7,
        expectedProviderGeneration: null,
        enabled: true,
        cliPath: "/bin/codex",
        checkForUpdates: false,
        token: "secret",
      },
      {
        provider: "codex",
        settingsRevision: 0,
        expectedProviderGeneration: null,
        enabled: true,
        cliPath: "/bin/codex",
        checkForUpdates: false,
      },
      {
        provider: "cursor",
        settingsRevision: 7,
        expectedProviderGeneration: null,
        enabled: true,
        cliPath: "/bin/cursor",
        checkForUpdates: false,
      },
      {
        provider: "codex",
        settingsRevision: 8,
        expectedProviderGeneration: 0,
        enabled: true,
        cliPath: "/bin/codex",
        checkForUpdates: false,
      },
    ]) {
      expect(() => validateAgentProviderPolicyRegistrationRequest(malformed)).toThrow(TypeError);
    }
  });

  it("parses strict current policy for reload reconciliation", () => {
    expect(validateAgentProviderCurrentPolicyRequest({ provider: "codex" })).toEqual({
      provider: "codex",
    });
    expect(
      parseAgentProviderCurrentPolicyResult({
        kind: "registered",
        receipt: { provider: "codex", settingsRevision: 7, providerGeneration: 3 },
        enabled: true,
        cliPath: "/usr/local/bin/codex",
        checkForUpdates: true,
      }),
    ).toMatchObject({ kind: "registered", receipt: { providerGeneration: 3 } });
    expect(parseAgentProviderCurrentPolicyResult({ kind: "unregistered" })).toEqual({
      kind: "unregistered",
    });
    expect(() =>
      parseAgentProviderCurrentPolicyResult({
        kind: "unregistered",
        generation: 1,
      }),
    ).toThrow(TypeError);
  });
});

describe("provider health contracts", () => {
  it("requires only exact registered provider authority", () => {
    expect(
      validateAgentProviderHealthProbeRequest({ provider: "codex", providerGeneration: 3 }),
    ).toEqual({ provider: "codex", providerGeneration: 3 });
    expect(() =>
      validateAgentProviderHealthProbeRequest({
        provider: "codex",
        providerGeneration: 3,
        cliPath: "/bin/codex",
      }),
    ).toThrow(TypeError);
    expect(() =>
      validateAgentProviderHealthProbeRequest({ provider: "codex", providerGeneration: 0 }),
    ).toThrow(TypeError);
  });

  it("parses signed-in health and provider-matched installer", () => {
    expect(
      parseAgentProviderHealthProbeResult("codex", {
        installedVersion: "0.149.1",
        auth: { kind: "signedIn", label: "ChatGPT Plus" },
        update: {
          kind: "available",
          installedVersion: "0.149.1",
          availableVersion: "0.150.1",
          installer: { kind: "npm", packageName: "@openai/codex" },
        },
        checkedAtEpochMs: 1,
      }),
    ).toMatchObject({
      auth: { kind: "signedIn", label: "ChatGPT Plus" },
      update: { kind: "available", availableVersion: "0.150.1" },
    });
    expect(
      parseAgentProviderHealthProbeResult("claudeCode", {
        installedVersion: "2.1.245",
        auth: { kind: "unknown" },
        update: {
          kind: "available",
          installedVersion: "2.1.245",
          availableVersion: "2.1.246",
          installer: { kind: "homebrew", cask: "claude-code" },
        },
        checkedAtEpochMs: 2,
      }),
    ).toMatchObject({ update: { installer: { kind: "homebrew", cask: "claude-code" } } });
  });

  it.each([
    ["codex", "0.149.1", "0.150.1", "codexUpdate"],
    ["claudeCode", "2.1.245", "2.1.246", "claudeUpdate"],
  ] as const)(
    "parses the native self-update installer for %s",
    (provider, installedVersion, availableVersion, command) => {
      expect(
        parseAgentProviderHealthProbeResult(provider, {
          installedVersion,
          auth: { kind: "signedIn", label: null },
          update: {
            kind: "available",
            installedVersion,
            availableVersion,
            installer: { kind: "selfUpdate", command },
          },
          checkedAtEpochMs: 1,
        }),
      ).toEqual({
        installedVersion,
        auth: { kind: "signedIn", label: null },
        update: {
          kind: "available",
          installedVersion,
          availableVersion,
          installer: { kind: "selfUpdate", command },
        },
        checkedAtEpochMs: 1,
      });
    },
  );

  it("rejects foreign, unknown, and malformed self-update installers", () => {
    const base = {
      installedVersion: "0.149.1",
      auth: { kind: "signedOut" },
      checkedAtEpochMs: 1,
    };
    const update = {
      kind: "available",
      installedVersion: "0.149.1",
      availableVersion: "0.150.1",
    };
    for (const installer of [
      { kind: "selfUpdate", command: "claudeUpdate" },
      { kind: "selfUpdate", command: "codex update" },
      { kind: "selfUpdate", command: "" },
      { kind: "selfUpdate", command: null },
      { kind: "selfUpdate" },
      { kind: "selfUpdate", command: "codexUpdate", argv: ["codex", "update"] },
      { kind: "selfUpdate", command: "codexUpdate", path: "/Users/private/.codex/packages" },
      { kind: "volta", packageName: "@openai/codex" },
      { kind: "unknown" },
    ]) {
      expect(() =>
        parseAgentProviderHealthProbeResult("codex", { ...base, update: { ...update, installer } }),
      ).toThrow(TypeError);
    }
  });

  it("labels installers for display without leaking executable recipes", () => {
    expect(agentProviderSelfUpdateCommandLabel("claudeUpdate")).toBe("claude update");
    expect(agentProviderSelfUpdateCommandLabel("codexUpdate")).toBe("codex update");
    expect(agentProviderInstallerLabel({ kind: "selfUpdate", command: "codexUpdate" })).toBe(
      "built-in updater (codex update)",
    );
    expect(agentProviderInstallerLabel({ kind: "npm", packageName: "@openai/codex" })).toBe(
      "npm package @openai/codex",
    );
    expect(agentProviderInstallerLabel({ kind: "homebrew", cask: "claude-code" })).toBe(
      "Homebrew cask claude-code",
    );
    expect(agentProviderInstallerLabel({ kind: "unknown" })).toBe("an unidentified installer");
  });

  it.each(["unknownInstaller", "unsupportedProbe", "invalidVersion", "probeFailed"] as const)(
    "parses the closed %s update-unavailable reason",
    (reason) => {
      expect(
        parseAgentProviderHealthProbeResult("codex", {
          installedVersion: "0.149.1",
          auth: { kind: "signedOut" },
          update: { kind: "unavailable", reason },
          checkedAtEpochMs: 1,
        }),
      ).toMatchObject({ update: { kind: "unavailable", reason } });
    },
  );

  it.each(["codex", "claudeCode"] as const)(
    "parses a manual update notice for %s without installer authority",
    (provider) => {
      const installedVersion = provider === "codex" ? "0.149.1" : "2.1.245";
      const availableVersion = provider === "codex" ? "0.153.0" : "2.1.246";
      const update = { kind: "manualUpdateAvailable", installedVersion, availableVersion };
      expect(
        parseAgentProviderHealthProbeResult(provider, {
          installedVersion,
          auth: { kind: "unknown" },
          update,
          checkedAtEpochMs: 1,
        }),
      ).toEqual({ installedVersion, auth: { kind: "unknown" }, update, checkedAtEpochMs: 1 });
    },
  );

  it.each(["codex", "claudeCode"] as const)(
    "rejects malformed or executable manual update notices for %s",
    (provider) => {
      const installedVersion = provider === "codex" ? "0.149.1" : "2.1.245";
      const availableVersion = provider === "codex" ? "0.153.0" : "2.1.246";
      const update = { kind: "manualUpdateAvailable", installedVersion, availableVersion };
      const base = { installedVersion, auth: { kind: "unknown" }, checkedAtEpochMs: 1 };
      for (const malformed of [
        { ...update, installer: { kind: "npm", packageName: "@openai/codex" } },
        { ...update, candidate: { path: "/tmp/codex" } },
        { ...update, command: "npm install --global @openai/codex" },
        { ...update, availableVersion: null },
        { ...update, availableVersion: 153 },
        { ...update, availableVersion: "latest" },
        { ...update, availableVersion: ` ${availableVersion}` },
        { ...update, availableVersion: `${availableVersion}\n` },
        { ...update, availableVersion: "1.0.0-" + "x".repeat(65) },
        { ...update, installedVersion: null },
        { ...update, installedVersion: "latest" },
        { ...update, installedVersion: "1.0.0" },
        { kind: "manualUpdateAvailable", installedVersion },
        { kind: "manualUpdateAvailable", availableVersion },
      ]) {
        expect(() =>
          parseAgentProviderHealthProbeResult(provider, { ...base, update: malformed }),
        ).toThrow(TypeError);
      }
      expect(() =>
        parseAgentProviderHealthProbeResult(provider, {
          ...base,
          installedVersion: null,
          update,
        }),
      ).toThrow(TypeError);
    },
  );

  it("rejects unknown, missing, and extra update-unavailable reason fields", () => {
    const base = {
      installedVersion: "0.149.1",
      auth: { kind: "signedOut" },
      checkedAtEpochMs: 1,
    };
    for (const update of [
      { kind: "unavailable", reason: "futureReason" },
      { kind: "unavailable" },
      { kind: "unavailable", reason: "unknownInstaller", detail: "npm missing" },
    ]) {
      expect(() => parseAgentProviderHealthProbeResult("codex", { ...base, update })).toThrow(
        TypeError,
      );
    }
  });

  it("fails extra keys, credentials, oversized labels, and contradictions closed", () => {
    const base = {
      installedVersion: "0.149.1",
      auth: { kind: "signedOut" },
      update: { kind: "current", installedVersion: "0.149.1" },
      checkedAtEpochMs: 1,
    };
    for (const malformed of [
      { ...base, token: "secret" },
      { ...base, auth: { kind: "signedOut", token: "secret" } },
      { ...base, auth: { kind: "signedIn", label: "a".repeat(257) } },
      { ...base, update: { kind: "current", installedVersion: "0.148.0" } },
      {
        ...base,
        update: {
          kind: "available",
          installedVersion: "0.149.1",
          availableVersion: "0.150.1",
          installer: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
        },
      },
      {
        ...base,
        update: {
          kind: "available",
          installedVersion: "0.149.1",
          availableVersion: "0.150.1",
          installer: { kind: "homebrew", cask: "claude-code" },
        },
      },
      {
        ...base,
        update: {
          kind: "available",
          installedVersion: "0.149.1",
          availableVersion: "0.150.1",
          installer: { kind: "homebrew", formula: "codex" },
        },
      },
    ]) {
      expect(() => parseAgentProviderHealthProbeResult("codex", malformed)).toThrow(TypeError);
    }
  });
});

describe("provider update contracts", () => {
  const authority = {
    provider: "codex",
    providerGeneration: 3,
    operationId: "provider-update-1234",
  } as const;

  it("rejects caller-selected paths, installers, and versions", () => {
    expect(validateAgentProviderUpdateRequest(authority)).toEqual(authority);
    for (const malformed of [
      { ...authority, providerGeneration: 0 },
      { ...authority, cliPath: "/bin/codex" },
      { ...authority, availableVersion: "0.150.1" },
      { ...authority, packageName: "@openai/codex" },
      { ...authority, operationId: "short" },
      { ...authority, operationId: "update id" },
      { ...authority, operationId: "aktualizácia" },
      { ...authority, operationId: "a".repeat(129) },
    ]) {
      expect(() => validateAgentProviderUpdateRequest(malformed)).toThrow(TypeError);
    }
  });

  it("parses synchronous success and bounded failure", () => {
    expect(
      parseAgentProviderUpdateResult({
        kind: "succeeded",
        previousVersion: "0.149.1",
        installedVersion: "0.150.1",
      }),
    ).toMatchObject({ kind: "succeeded", installedVersion: "0.150.1" });
    expect(
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "outputLimitExceeded",
        outputTail: "Installer output withheld (stdout: 524288 bytes, stderr: 524288 bytes).",
        outputTruncated: true,
      }),
    ).toMatchObject({ reason: "outputLimitExceeded", outputTruncated: true });
  });

  it("parses the closed versionNotAdvanced update failure", () => {
    expect(
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "versionNotAdvanced",
        outputTail: "Installer output withheld (stdout: 12 bytes, stderr: 0 bytes).",
        outputTruncated: false,
      }),
    ).toEqual({
      kind: "failed",
      reason: "versionNotAdvanced",
      outputTail: "Installer output withheld (stdout: 12 bytes, stderr: 0 bytes).",
      outputTruncated: false,
    });
    expect(() =>
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "versionnotadvanced",
        outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
        outputTruncated: false,
      }),
    ).toThrow(TypeError);
  });

  it("rejects process identifiers, unbounded output, and unknown failures", () => {
    expect(() =>
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "exited",
        outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 7 bytes).",
        outputTruncated: false,
        pid: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "exited",
        outputTail: "a".repeat(32 * 1024 + 1),
        outputTruncated: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "unknown",
        outputTail: "",
        outputTruncated: false,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseAgentProviderUpdateResult({
        kind: "failed",
        reason: "outputLimitExceeded",
        outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
        outputTruncated: false,
      }),
    ).toThrow(TypeError);
    for (const outputTail of [
      "password=hunter2",
      "AWS_SECRET_ACCESS_KEY=secret",
      "Cookie: session=secret",
      "pid=1234",
      "argv=[npm, install]",
      "HOME=/Users/private",
      "/Users/private/project",
      "raw installer line\n",
      "Installer output withheld (stdout: 01 bytes, stderr: 0 bytes).",
      "Installer output withheld (stdout: 1048577 bytes, stderr: 0 bytes).",
      "Installer output withheld (stdout: 600000 bytes, stderr: 600000 bytes).",
    ]) {
      expect(() =>
        parseAgentProviderUpdateResult({
          kind: "failed",
          reason: "exited",
          outputTail,
          outputTruncated: false,
        }),
      ).toThrow(TypeError);
    }
  });

  it("parses only the strict opaque progress projection", () => {
    const progress = {
      ...authority,
      sequence: 1,
      stream: "stdout",
      data: "Installer stdout activity: 1 bytes.",
      truncated: false,
      redacted: true,
    } as const;
    expect(parseAgentProviderUpdateProgressEvent(progress)).toEqual(progress);
    expect(
      parseAgentProviderUpdateProgressEvent({
        ...progress,
        data: "Installer stdout activity: 4096 bytes.",
      }),
    ).toMatchObject({ data: "Installer stdout activity: 4096 bytes." });
    expect(
      parseAgentProviderUpdateProgressEvent({
        ...progress,
        data: "Additional installer activity withheld.",
        truncated: true,
      }),
    ).toMatchObject({ truncated: true });
    for (const malformed of [
      { ...progress, sequence: 0 },
      { ...progress, sequence: 4_097 },
      { ...progress, stream: "combined" },
      { ...progress, data: "Installer stdout activity: 0 bytes." },
      { ...progress, data: "Installer stdout activity: 4097 bytes." },
      { ...progress, data: "Installer stdout activity: 01 bytes." },
      { ...progress, data: "Installer stderr activity: 1 bytes." },
      { ...progress, truncated: true },
      { ...progress, data: "Additional installer activity withheld." },
      { ...progress, redacted: false },
      { ...progress, redacted: "true" },
      { ...progress, pid: 42 },
    ]) {
      expect(() => parseAgentProviderUpdateProgressEvent(malformed)).toThrow(TypeError);
    }
    for (const data of [
      "password=hunter2",
      "AWS_SECRET_ACCESS_KEY=secret",
      "Cookie: session=secret",
      "pid=1234",
      "argv=[npm, install]",
      "HOME=/Users/private",
      "/Users/private/project",
      "raw installer line\n",
    ]) {
      expect(() => parseAgentProviderUpdateProgressEvent({ ...progress, data })).toThrow(TypeError);
    }
  });

  it("retains a bounded tail of opaque activity projections", () => {
    const line = "Installer stdout activity: 4096 bytes.\n";
    const tail = appendAgentProviderUpdateOutputTail(line, line.repeat(1_000));
    expect(new TextEncoder().encode(tail).byteLength).toBeLessThanOrEqual(32 * 1024);
    expect(tail.startsWith(line)).toBe(true);
    expect(tail.endsWith(line)).toBe(true);
  });
});
