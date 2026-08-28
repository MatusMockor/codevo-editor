import { describe, expect, it } from "vitest";
import {
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
