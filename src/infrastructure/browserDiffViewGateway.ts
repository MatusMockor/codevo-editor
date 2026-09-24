import type {
  DiffViewComputationGateway,
  DiffViewComputationInput,
  DiffViewWorkerResponse,
} from "../application/diffViewComputation";
import type { LineDiffResult } from "../domain/diffView/lineDiff";

export const DIFF_VIEW_TIMEOUT_MS = 5_000;
export const MAX_PENDING_DIFF_VIEW_REQUESTS = 32;

type DiffViewWorker = Pick<
  Worker,
  "onerror" | "onmessage" | "onmessageerror" | "postMessage" | "terminate"
>;

interface QueuedRequest {
  readonly requestId: number;
  readonly input: DiffViewComputationInput;
  readonly signal: AbortSignal;
  readonly resolve: (result: LineDiffResult) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
}

interface InFlightRequest {
  readonly request: QueuedRequest;
  readonly timeout: number;
}

type Settlement =
  | { readonly kind: "resolve"; readonly result: LineDiffResult }
  | { readonly kind: "reject"; readonly error: unknown };

export class BrowserDiffViewGateway implements DiffViewComputationGateway {
  private worker: DiffViewWorker | null = null;
  private nextRequestId = 1;
  private readonly queue: QueuedRequest[] = [];
  private inFlight: InFlightRequest | null = null;

  constructor(
    private readonly createWorker: () => DiffViewWorker = defaultWorkerFactory,
    private readonly timeoutMs = DIFF_VIEW_TIMEOUT_MS,
  ) {}

  compute(input: DiffViewComputationInput, signal: AbortSignal): Promise<LineDiffResult> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.pendingCount() >= MAX_PENDING_DIFF_VIEW_REQUESTS) {
      return Promise.reject(new Error("Too many diff calculations are pending."));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<LineDiffResult>((resolve, reject) => {
      const request: QueuedRequest = {
        requestId,
        input,
        signal,
        resolve,
        reject,
        onAbort: () => this.abort(request),
      };
      signal.addEventListener("abort", request.onAbort, { once: true });
      this.queue.push(request);
      this.pump();
    });
  }

  private pendingCount(): number {
    return this.queue.length + (this.inFlight === null ? 0 : 1);
  }

  private abort(request: QueuedRequest): void {
    if (this.inFlight?.request === request) {
      this.failInFlight(abortError());
      return;
    }
    const index = this.queue.indexOf(request);
    if (index === -1) return;
    this.queue.splice(index, 1);
    finish(request, { kind: "reject", error: abortError() });
  }

  private pump(): void {
    if (this.inFlight !== null) return;
    const request = this.queue.shift();
    if (request === undefined) return;
    let worker: DiffViewWorker;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      finish(request, { kind: "reject", error });
      this.pump();
      return;
    }
    const timeout = window.setTimeout(
      () => this.failInFlight(new Error("Diff calculation timed out.")),
      Math.max(1, this.timeoutMs),
    );
    this.inFlight = { request, timeout };
    try {
      worker.postMessage({ requestId: request.requestId, ...request.input });
    } catch (error) {
      this.failInFlight(error);
    }
  }

  private ensureWorker(): DiffViewWorker {
    if (this.worker !== null) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<DiffViewWorkerResponse>) =>
      this.handleResponse(worker, event.data);
    worker.onerror = (event) =>
      this.handleWorkerFailure(
        worker,
        new Error(event.message || "Diff calculation worker failed."),
      );
    worker.onmessageerror = () =>
      this.handleWorkerFailure(
        worker,
        new Error("Diff calculation returned an unreadable response."),
      );
    this.worker = worker;
    return worker;
  }

  private handleResponse(worker: DiffViewWorker, response: DiffViewWorkerResponse): void {
    if (worker !== this.worker) return;
    const current = this.inFlight;
    if (current === null) return;
    if (current.request.requestId !== response.requestId) return;
    this.inFlight = null;
    window.clearTimeout(current.timeout);
    finish(current.request, { kind: "resolve", result: response.result });
    this.pump();
  }

  private handleWorkerFailure(worker: DiffViewWorker, error: Error): void {
    if (worker !== this.worker) return;
    if (this.inFlight !== null) {
      this.failInFlight(error);
      return;
    }
    this.discardWorker();
  }

  private failInFlight(error: unknown): void {
    const current = this.inFlight;
    if (current === null) return;
    this.inFlight = null;
    window.clearTimeout(current.timeout);
    this.discardWorker();
    finish(current.request, { kind: "reject", error });
    this.pump();
  }

  private discardWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}

function finish(request: QueuedRequest, settlement: Settlement): void {
  request.signal.removeEventListener("abort", request.onAbort);
  if (settlement.kind === "resolve") {
    request.resolve(settlement.result);
    return;
  }
  request.reject(settlement.error);
}

function defaultWorkerFactory(): DiffViewWorker {
  return new Worker(new URL("./diffView.worker.ts", import.meta.url), { type: "module" });
}

function abortError(): DOMException {
  return new DOMException("Diff calculation was cancelled.", "AbortError");
}
