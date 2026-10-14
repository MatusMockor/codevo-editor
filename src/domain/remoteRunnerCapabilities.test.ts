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

describe.each(["gitSync", "portPreview"] as const)("remote runner %s capability", (capability) => {
  it.each([true, false, undefined])("accepts optional boolean %s", (supported) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, [capability]: supported },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}, []])("rejects malformed flag %j", (supported) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, [capability]: supported },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
  it("keeps the descriptor closed next to the new flag", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, [capability]: true, gitSyncV2: true },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
});

describe.each(["runtimeRequests", "interactiveApprovals"] as const)(
  "remote runner %s capability",
  (capability) => {
    it.each([true, false, undefined])("accepts optional boolean %s", (supported) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, [capability]: supported },
        }),
      ).not.toThrow();
    });
    it.each([null, "true", 1, {}, []])("rejects malformed flag %j", (supported) => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, [capability]: supported },
        }),
      ).toThrow("Invalid remote runner getRunner response.");
    });
    it("keeps the descriptor closed next to the new flag", () => {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, [capability]: true, runtimeRequestsV2: true },
        }),
      ).toThrow("Invalid remote runner getRunner response.");
    });
  },
);

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  sequence: 1,
  runnerId: "runner-1",
  provider: "codex",
  status: "running",
  projectId: "editor",
  parts: [{ type: "text", text: "Run" }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("remote runner task interaction facts", () => {
  it("accepts a task of an older runner without the facts", () => {
    expect(() => validateRemoteRunnerValue("getTask", "response", task)).not.toThrow();
  });

  it.each([0, 1, 42, Number.MAX_SAFE_INTEGER])(
    "accepts interactionSequence %s",
    (interactionSequence) => {
      expect(() =>
        validateRemoteRunnerValue("getTask", "response", { ...task, interactionSequence }),
      ).not.toThrow();
    },
  );

  it.each([-1, "5", 1.5, null, true, Number.MAX_SAFE_INTEGER + 1])(
    "rejects interactionSequence %j",
    (interactionSequence) => {
      expect(() =>
        validateRemoteRunnerValue("getTask", "response", { ...task, interactionSequence }),
      ).toThrow("Invalid remote runner getTask response.");
    },
  );

  it("accepts a task awaiting an approval", () => {
    expect(() =>
      validateRemoteRunnerValue("getTask", "response", {
        ...task,
        interactionSequence: 3,
        awaiting: "approval",
      }),
    ).not.toThrow();
  });

  it.each(["question", "", null, true, ["approval"]])("rejects awaiting %j", (awaiting) => {
    expect(() => validateRemoteRunnerValue("getTask", "response", { ...task, awaiting })).toThrow(
      "Invalid remote runner getTask response.",
    );
  });

  it("keeps the task record closed next to the new facts", () => {
    expect(() =>
      validateRemoteRunnerValue("getTask", "response", {
        ...task,
        interactionSequence: 3,
        awaitingSince: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow("Invalid remote runner getTask response.");
  });

  it("applies the same rules to every task of a listed page", () => {
    const page = (items: readonly unknown[]) => ({ items, nextCursor: null });

    expect(() =>
      validateRemoteRunnerValue(
        "listTasks",
        "response",
        page([task, { ...task, interactionSequence: 0, awaiting: "approval" }]),
      ),
    ).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue(
        "listTasks",
        "response",
        page([task, { ...task, interactionSequence: -1 }]),
      ),
    ).toThrow("Invalid remote runner listTasks response.");
  });
});

describe("remote runner folder projects capability", () => {
  it.each([true, false, undefined])("accepts optional boolean %s", (folderProjects) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, folderProjects },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}, []])("rejects malformed flag %j", (folderProjects) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, folderProjects },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
  it("keeps the descriptor closed next to the new flag", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, folderProjects: true, folderProjectsV2: true },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
});
