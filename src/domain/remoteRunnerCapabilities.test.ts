import { describe, expect, it } from "vitest";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";

const descriptor = {
  protocolVersion: 1,
  runnerId: "test",
  name: "Test",
  capabilities: { taskExecution: true, eventReplay: true },
};

describe("remote runner output artifact capability", () => {
  it("accepts older runners with the capability absent", () => {
    expect(() => validateRemoteRunnerValue("getRunner", "response", descriptor)).not.toThrow();
  });

  it.each([true, false])("accepts explicit boolean %s", (outputArtifacts) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, outputArtifacts },
      }),
    ).not.toThrow();
  });

  it.each([null, "true", 1, {}, []])("rejects invalid capability %j", (outputArtifacts) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, outputArtifacts },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });

  it("continues rejecting unknown capabilities", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, outputArtifacts: true, unknown: true },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
});

describe("remote runner interaction and execution policy", () => {
  it.each([true, false])("accepts explicit interactiveQuestions %s", (interactiveQuestions) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, interactiveQuestions },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}, []])(
    "rejects invalid interactiveQuestions %j",
    (interactiveQuestions) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, interactiveQuestions },
        }),
      ).toThrow();
    },
  );
  it.each([60000, 43200000, 604800000])(
    "accepts bounded execution policy %s",
    (executionTimeoutMs) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", { ...descriptor, executionTimeoutMs }),
      ).not.toThrow();
    },
  );
  it.each([null, "60000", 59999, 604800001, 60000.5, -1])(
    "rejects invalid execution policy %j",
    (executionTimeoutMs) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", { ...descriptor, executionTimeoutMs }),
      ).toThrow();
    },
  );
});

describe("remote runner isolation capability", () => {
  it.each([true, false, undefined])("accepts supported optional flag %s", (taskIsolation) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, taskIsolation },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}])("rejects malformed isolation flag %j", (taskIsolation) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, taskIsolation },
      }),
    ).toThrow();
  });
});

describe("remote runner lifecycle retention capability", () => {
  it.each([true, false, undefined])("accepts optional boolean %s", (subagentLifecycleRetention) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, subagentLifecycleRetention },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}, []])("rejects malformed flag %j", (subagentLifecycleRetention) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, subagentLifecycleRetention },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
  it("accepts the current Linux runner descriptor", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        protocolVersion: 1,
        runnerId: "linux-runner",
        name: "Linux",
        executionTimeoutMs: 43_200_000,
        capabilities: {
          taskIsolation: true,
          interactiveQuestions: true,
          instructionSync: true,
          outputArtifacts: true,
          pendingMessages: true,
          taskSteering: true,
          subagentTelemetry: true,
          taskFileDiffs: true,
          taskLaunchOptions: true,
          taskContinuation: true,
          taskExecution: true,
          eventReplay: true,
          subagentLifecycleRetention: true,
          taskDrafts: true,
          imageAttachments: true,
          projectCloning: true,
        },
      }),
    ).not.toThrow();
  });
});

describe("remote runner text attachments capability", () => {
  it.each([true, false, undefined])("accepts optional boolean %s", (textAttachments) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, textAttachments },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}, []])("rejects malformed flag %j", (textAttachments) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, textAttachments },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
});
