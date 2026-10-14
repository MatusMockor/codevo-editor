import { describe, expect, it, vi } from "vitest";
import ipc from "../../contracts/remote-agent-thread-requests-ipc.json";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS,
  REMOTE_AGENT_THREAD_RESPOND_OUTCOMES,
  RemoteAgentThreadRequestNotSentError,
  isRemoteAgentThreadRequestNotSentError,
  type RemoteAgentThreadRequestsRequest,
  type RemoteAgentThreadRespondRequest,
} from "../application/remoteAgentThreadRequestPorts";
import { AGENT_APPROVAL_DECISIONS } from "../domain/agentApproval";
import {
  MAX_AGENT_QUESTIONS,
  MAX_AGENT_QUESTION_OPTIONS,
  MAX_AGENT_QUESTION_TEXT_BYTES,
} from "../domain/agentQuestion";
import {
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
  parseAgentThreadRequests,
} from "../domain/agentRuntimeRequest";
import {
  GET_REMOTE_AGENT_THREAD_REQUESTS_IPC_COMMAND,
  MAX_REMOTE_AGENT_THREAD_REQUESTS_CURSOR_CHARS,
  MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_BYTES,
  RESPOND_REMOTE_AGENT_THREAD_REQUEST_IPC_COMMAND,
  TauriRemoteAgentThreadRequestGateway,
  type InvokeRemoteAgentThreadRequestCommand,
} from "./tauriRemoteAgentThreadRequestGateway";

type WireValue = Readonly<Record<string, unknown>>;

interface ValidCase {
  readonly name: string;
  readonly description: string;
  readonly value: WireValue;
  readonly request?: string;
}

interface InvalidCase {
  readonly name: string;
  readonly description: string;
  readonly base: string;
  readonly patch: WireValue;
  readonly omit?: readonly string[];
}

interface Section {
  readonly description: string;
  readonly valid: readonly ValidCase[];
  readonly invalid: readonly InvalidCase[];
}

const LIST_REQUESTS: Section = ipc.listRequests;
const LIST_RESPONSES: Section = ipc.listResponses;
const RESPOND_REQUESTS: Section = ipc.respondRequests;
const RESPOND_RESPONSES: Section = ipc.respondResponses;
const SECTIONS: readonly Section[] = [
  LIST_REQUESTS,
  LIST_RESPONSES,
  RESPOND_REQUESTS,
  RESPOND_RESPONSES,
];

function validCase(section: Section, name: string): ValidCase {
  const found = section.valid.find((candidate) => candidate.name === name);
  expect(found, `valid case ${name}`).toBeDefined();
  return found ?? { name, description: "", value: {} };
}

function invalidCase(section: Section, name: string): InvalidCase {
  const found = section.invalid.find((candidate) => candidate.name === name);
  expect(found, `invalid case ${name}`).toBeDefined();
  return found ?? { name, description: "", base: "", patch: {} };
}

function patchedValue(section: Section, invalid: InvalidCase): WireValue {
  const omitted = invalid.omit ?? [];
  const patched = { ...validCase(section, invalid.base).value, ...invalid.patch };
  return Object.fromEntries(Object.entries(patched).filter(([key]) => !omitted.includes(key)));
}

function answeredRequest(requests: Section, responses: Section, responseName: string): WireValue {
  return validCase(requests, validCase(responses, responseName).request ?? "").value;
}

function listRequest(value: WireValue): RemoteAgentThreadRequestsRequest {
  return value as unknown as RemoteAgentThreadRequestsRequest;
}

function respondRequest(value: WireValue): RemoteAgentThreadRespondRequest {
  return value as unknown as RemoteAgentThreadRespondRequest;
}

function gatewayReturning(response: unknown, runtimeAvailable = true) {
  const invokeCommand = vi.fn<InvokeRemoteAgentThreadRequestCommand>(() =>
    Promise.resolve(response),
  );
  const gateway = new TauriRemoteAgentThreadRequestGateway(invokeCommand, () => runtimeAvailable);
  return { gateway, invokeCommand };
}

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => undefined,
    (failure: unknown) => failure,
  );
}

const EMPTY_PAGE = validCase(LIST_RESPONSES, "emptySnapshot").value;
const REFUSED_WITHOUT_MESSAGE = validCase(RESPOND_RESPONSES, "notAnswerableWithoutMessage").value;

describe("remote agent thread request IPC fixture", () => {
  it("pins the commands, closed variants and limits shared with the Rust backend", () => {
    expect(ipc.schemaVersion).toBe(1);
    expect(ipc.commands).toEqual({
      list: GET_REMOTE_AGENT_THREAD_REQUESTS_IPC_COMMAND,
      respond: RESPOND_REMOTE_AGENT_THREAD_REQUEST_IPC_COMMAND,
    });
    expect(ipc.responseKinds).toEqual(["question", "approval"]);
    expect(ipc.decisions).toEqual(AGENT_APPROVAL_DECISIONS);
    expect(ipc.outcomes).toEqual(REMOTE_AGENT_THREAD_RESPOND_OUTCOMES);
    expect(ipc.limits).toEqual({
      serverIdBytes: 64,
      runnerIdBytes: MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_BYTES,
      idBytes: 128,
      turnsPerRequest: MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS,
      cursorChars: MAX_REMOTE_AGENT_THREAD_REQUESTS_CURSOR_CHARS,
      answersPerResponse: MAX_AGENT_QUESTIONS,
      optionIdsPerAnswer: MAX_AGENT_QUESTION_OPTIONS,
      answerTextBytes: MAX_AGENT_QUESTION_TEXT_BYTES,
      requestsPerMessage: MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
    });
  });

  it("names and describes every case exactly once per section", () => {
    for (const section of SECTIONS) {
      expect(section.description.trim().length).toBeGreaterThan(0);
      for (const cases of [section.valid, section.invalid]) {
        const names = cases.map((candidate) => candidate.name);

        expect(new Set(names).size).toBe(names.length);
        expect(cases.every((candidate) => candidate.description.trim().length > 0)).toBe(true);
      }
    }
  });

  it("bases every invalid case on a valid case of its section", () => {
    for (const section of SECTIONS) {
      const names = section.valid.map((candidate) => candidate.name);

      expect(section.invalid.filter((invalid) => !names.includes(invalid.base))).toEqual([]);
    }
  });

  it("answers every valid response with a valid request of the matching section", () => {
    for (const [requests, responses] of [
      [LIST_REQUESTS, LIST_RESPONSES],
      [RESPOND_REQUESTS, RESPOND_RESPONSES],
    ] as const) {
      const names = requests.valid.map((candidate) => candidate.name);

      expect(requests.valid.every((candidate) => candidate.request === undefined)).toBe(true);
      expect(
        responses.valid.filter((candidate) => !names.includes(candidate.request ?? "")),
      ).toEqual([]);
    }
  });

  it("answers each respond request with records of the request it targets", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const response of RESPOND_RESPONSES.valid) {
      const request = validCase(RESPOND_REQUESTS, response.request ?? "").value;
      const message = response.value.message as { readonly requests: readonly WireValue[] } | null;
      const ids = message?.requests.map((record) => record.id) ?? [];

      expect(request.requestId).toMatch(uuid);
      expect(message === null || ids.includes(request.requestId)).toBe(true);
    }
  });

  it("keeps the boundary cases on their limits", () => {
    const longestCursor = validCase(LIST_REQUESTS, "longestCursor").value.cursor;
    const maximumTurns = validCase(LIST_REQUESTS, "maximumTurns").value.turns;

    expect(longestCursor).toHaveLength(ipc.limits.cursorChars);
    expect(maximumTurns).toHaveLength(ipc.limits.turnsPerRequest);
  });

  it.each([...LIST_RESPONSES.valid, ...RESPOND_RESPONSES.valid])(
    "carries a valid thread message in $name",
    ({ value }) => {
      if (value.message === null) return;

      expect(parseAgentThreadRequests(value.message)).toEqual(value.message);
    },
  );
});

describe("TauriRemoteAgentThreadRequestGateway thread requests", () => {
  it.each(LIST_REQUESTS.valid)("sends the valid request $name unchanged", async ({ value }) => {
    const { gateway, invokeCommand } = gatewayReturning(EMPTY_PAGE);

    await expect(gateway.threadRequests(listRequest(value))).resolves.toEqual(EMPTY_PAGE);

    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith(GET_REMOTE_AGENT_THREAD_REQUESTS_IPC_COMMAND, {
      request: value,
    });
  });

  it.each(LIST_REQUESTS.invalid)(
    "rejects the invalid request $name before the invoke",
    async (invalid) => {
      const { gateway, invokeCommand } = gatewayReturning(EMPTY_PAGE);

      await expect(
        gateway.threadRequests(listRequest(patchedValue(LIST_REQUESTS, invalid))),
      ).rejects.toThrow("Invalid remote agent thread request payload.");

      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it.each(LIST_RESPONSES.valid)("returns the valid response $name unchanged", async ({ name }) => {
    const response = validCase(LIST_RESPONSES, name).value;
    const { gateway } = gatewayReturning(response);

    await expect(
      gateway.threadRequests(listRequest(answeredRequest(LIST_REQUESTS, LIST_RESPONSES, name))),
    ).resolves.toEqual(response);
  });

  it.each(LIST_RESPONSES.invalid)("rejects the invalid response $name", async (invalid) => {
    const request = answeredRequest(LIST_REQUESTS, LIST_RESPONSES, invalid.base);
    const { gateway, invokeCommand } = gatewayReturning(patchedValue(LIST_RESPONSES, invalid));

    await expect(gateway.threadRequests(listRequest(request))).rejects.toThrow();

    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("names the foreign thread and the foreign server in the rejection", async () => {
    const request = listRequest(validCase(LIST_REQUESTS, "singleRunningTurn").value);
    const foreign = (name: string) =>
      gatewayReturning(patchedValue(LIST_RESPONSES, invalidCase(LIST_RESPONSES, name))).gateway;

    await expect(foreign("messageForAnotherThread").threadRequests(request)).rejects.toThrow(
      "Remote agent thread requests belong to another thread.",
    );
    await expect(foreign("messageForAnotherServer").threadRequests(request)).rejects.toThrow(
      "Remote agent thread requests belong to another server.",
    );
    await expect(foreign("messageWithoutWorkspace").threadRequests(request)).rejects.toThrow(
      "Remote agent thread requests belong to another server.",
    );
  });

  it("rejects a response of another server's thread with the same thread id", async () => {
    const request = validCase(LIST_REQUESTS, "singleRunningTurn").value;
    const { gateway } = gatewayReturning(EMPTY_PAGE);

    await expect(
      gateway.threadRequests(listRequest({ ...request, serverId: "srv-beta" })),
    ).rejects.toThrow("Remote agent thread requests belong to another server.");
  });

  it("sends a rebuilt request instead of the caller's object", async () => {
    const request = listRequest(validCase(LIST_REQUESTS, "turnsWithAndWithoutSequence").value);
    const { gateway, invokeCommand } = gatewayReturning(EMPTY_PAGE);

    await gateway.threadRequests(request);

    const sent = invokeCommand.mock.calls[0]?.[1].request;
    expect(sent).toEqual(request);
    expect(sent).not.toBe(request);
  });

  it("rejects without the native runtime before the invoke", async () => {
    const request = listRequest(validCase(LIST_REQUESTS, "singleRunningTurn").value);
    const { gateway, invokeCommand } = gatewayReturning(EMPTY_PAGE, false);

    await expect(gateway.threadRequests(request)).rejects.toThrow(
      "Remote agent thread requests need the native runtime.",
    );

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("passes a native failure through", async () => {
    const request = listRequest(validCase(LIST_REQUESTS, "singleRunningTurn").value);
    const gateway = new TauriRemoteAgentThreadRequestGateway(
      () => Promise.reject(new Error("Runner changed.")),
      () => true,
    );

    await expect(gateway.threadRequests(request)).rejects.toThrow("Runner changed.");
  });
});

describe("TauriRemoteAgentThreadRequestGateway respond", () => {
  it.each(RESPOND_REQUESTS.valid)("sends the valid request $name unchanged", async ({ value }) => {
    const { gateway, invokeCommand } = gatewayReturning(REFUSED_WITHOUT_MESSAGE);

    await expect(gateway.respond(respondRequest(value))).resolves.toEqual(REFUSED_WITHOUT_MESSAGE);

    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith(RESPOND_REMOTE_AGENT_THREAD_REQUEST_IPC_COMMAND, {
      request: value,
    });
  });

  it.each(RESPOND_REQUESTS.invalid)(
    "rejects the invalid request $name before the invoke",
    async (invalid) => {
      const { gateway, invokeCommand } = gatewayReturning(REFUSED_WITHOUT_MESSAGE);

      await expect(
        gateway.respond(respondRequest(patchedValue(RESPOND_REQUESTS, invalid))),
      ).rejects.toThrow("Invalid remote agent thread request payload.");

      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it.each(RESPOND_RESPONSES.valid)(
    "returns the valid response $name unchanged",
    async ({ name }) => {
      const response = validCase(RESPOND_RESPONSES, name).value;
      const { gateway } = gatewayReturning(response);

      await expect(
        gateway.respond(respondRequest(answeredRequest(RESPOND_REQUESTS, RESPOND_RESPONSES, name))),
      ).resolves.toEqual(response);
    },
  );

  it.each(RESPOND_RESPONSES.invalid)("rejects the invalid response $name", async (invalid) => {
    const request = answeredRequest(RESPOND_REQUESTS, RESPOND_RESPONSES, invalid.base);
    const { gateway, invokeCommand } = gatewayReturning(patchedValue(RESPOND_RESPONSES, invalid));

    await expect(gateway.respond(respondRequest(request))).rejects.toThrow();

    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("rejects an answered outcome of another thread", async () => {
    const answered = validCase(RESPOND_RESPONSES, "answeredApproval").value;
    const request = answeredRequest(RESPOND_REQUESTS, RESPOND_RESPONSES, "answeredApproval");
    const { gateway } = gatewayReturning(answered);

    await expect(
      gateway.respond(
        respondRequest({ ...request, threadId: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d" }),
      ),
    ).rejects.toThrow("Remote agent thread requests belong to another thread.");
  });

  it("rejects without the native runtime before the invoke", async () => {
    const request = respondRequest(validCase(RESPOND_REQUESTS, "approvalDenied").value);
    const { gateway, invokeCommand } = gatewayReturning(REFUSED_WITHOUT_MESSAGE, false);

    await expect(gateway.respond(request)).rejects.toThrow(
      "Remote agent thread requests need the native runtime.",
    );

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("passes a native failure through without sending the answer again", async () => {
    const request = respondRequest(validCase(RESPOND_REQUESTS, "approvalDenied").value);
    const invokeCommand = vi.fn<InvokeRemoteAgentThreadRequestCommand>(() =>
      Promise.reject(new Error("Runner changed.")),
    );
    const gateway = new TauriRemoteAgentThreadRequestGateway(invokeCommand, () => true);

    await expect(gateway.respond(request)).rejects.toThrow("Runner changed.");

    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });
});

describe("TauriRemoteAgentThreadRequestGateway proof that nothing was sent", () => {
  it.each(LIST_REQUESTS.invalid)(
    "marks the invalid list request $name as not sent",
    async (invalid) => {
      const { gateway, invokeCommand } = gatewayReturning(EMPTY_PAGE);

      const failure = await rejection(
        gateway.threadRequests(listRequest(patchedValue(LIST_REQUESTS, invalid))),
      );

      expect(failure).toBeInstanceOf(RemoteAgentThreadRequestNotSentError);
      expect(isRemoteAgentThreadRequestNotSentError(failure)).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it.each(RESPOND_REQUESTS.invalid)(
    "marks the invalid respond request $name as not sent",
    async (invalid) => {
      const { gateway, invokeCommand } = gatewayReturning(REFUSED_WITHOUT_MESSAGE);

      const failure = await rejection(
        gateway.respond(respondRequest(patchedValue(RESPOND_REQUESTS, invalid))),
      );

      expect(failure).toBeInstanceOf(RemoteAgentThreadRequestNotSentError);
      expect(isRemoteAgentThreadRequestNotSentError(failure)).toBe(true);
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("marks a missing native runtime as not sent for both commands", async () => {
    const { gateway, invokeCommand } = gatewayReturning(REFUSED_WITHOUT_MESSAGE, false);

    const read = await rejection(
      gateway.threadRequests(listRequest(validCase(LIST_REQUESTS, "singleRunningTurn").value)),
    );
    const answer = await rejection(
      gateway.respond(respondRequest(validCase(RESPOND_REQUESTS, "approvalDenied").value)),
    );

    expect(read).toBeInstanceOf(RemoteAgentThreadRequestNotSentError);
    expect(answer).toBeInstanceOf(RemoteAgentThreadRequestNotSentError);
    expect(answer).toBeInstanceOf(Error);
    expect((answer as Error).name).toBe("RemoteAgentThreadRequestNotSentError");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each(RESPOND_RESPONSES.invalid)(
    "does not mark the invalid respond response $name as not sent",
    async (invalid) => {
      const request = answeredRequest(RESPOND_REQUESTS, RESPOND_RESPONSES, invalid.base);
      const { gateway, invokeCommand } = gatewayReturning(patchedValue(RESPOND_RESPONSES, invalid));

      const failure = await rejection(gateway.respond(respondRequest(request)));

      expect(failure).toBeInstanceOf(Error);
      expect(isRemoteAgentThreadRequestNotSentError(failure)).toBe(false);
      expect(invokeCommand).toHaveBeenCalledTimes(1);
    },
  );

  it.each(LIST_RESPONSES.invalid)(
    "does not mark the invalid list response $name as not sent",
    async (invalid) => {
      const request = answeredRequest(LIST_REQUESTS, LIST_RESPONSES, invalid.base);
      const { gateway, invokeCommand } = gatewayReturning(patchedValue(LIST_RESPONSES, invalid));

      const failure = await rejection(gateway.threadRequests(listRequest(request)));

      expect(failure).toBeInstanceOf(Error);
      expect(isRemoteAgentThreadRequestNotSentError(failure)).toBe(false);
      expect(invokeCommand).toHaveBeenCalledTimes(1);
    },
  );

  it("does not mark a native failure of the respond command as not sent", async () => {
    const request = respondRequest(validCase(RESPOND_REQUESTS, "approvalDenied").value);
    const invokeCommand = vi.fn<InvokeRemoteAgentThreadRequestCommand>(() =>
      Promise.reject(new Error("Runner changed.")),
    );
    const gateway = new TauriRemoteAgentThreadRequestGateway(invokeCommand, () => true);

    const failure = await rejection(gateway.respond(request));

    expect(failure).toBeInstanceOf(Error);
    expect(isRemoteAgentThreadRequestNotSentError(failure)).toBe(false);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("does not mark a native rejection with the same text as not sent", async () => {
    const request = respondRequest(validCase(RESPOND_REQUESTS, "approvalDenied").value);
    const invokeCommand = vi.fn<InvokeRemoteAgentThreadRequestCommand>(() =>
      Promise.reject("Invalid remote agent thread request payload."),
    );
    const gateway = new TauriRemoteAgentThreadRequestGateway(invokeCommand, () => true);

    const failure = await rejection(gateway.respond(request));

    expect(failure).toBe("Invalid remote agent thread request payload.");
    expect(isRemoteAgentThreadRequestNotSentError(failure)).toBe(false);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("recognises only its own error class in the guard", () => {
    expect(
      isRemoteAgentThreadRequestNotSentError(new RemoteAgentThreadRequestNotSentError("Not sent.")),
    ).toBe(true);
    expect(isRemoteAgentThreadRequestNotSentError(new Error("Not sent."))).toBe(false);
    expect(
      isRemoteAgentThreadRequestNotSentError({ name: "RemoteAgentThreadRequestNotSentError" }),
    ).toBe(false);
    expect(isRemoteAgentThreadRequestNotSentError(null)).toBe(false);
  });
});
