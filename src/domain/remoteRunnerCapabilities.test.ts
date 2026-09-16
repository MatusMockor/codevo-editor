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
