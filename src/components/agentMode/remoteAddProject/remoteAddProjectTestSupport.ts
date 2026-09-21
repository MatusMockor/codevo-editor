import { vi, type Mock } from "vitest";
import type {
  RemoteAddProjectLookupState,
  RemoteAddProjectPendingClone,
  RemoteAddProjectServerProject,
  RemoteAddProjectSourceAvailability,
  RemoteAddProjectStep,
} from "../../../application/useRemoteAddProject";
import type { CloneProtocol } from "../../../domain/repositoryCloneUrl";
import type {
  RemoteProjectSourceKind,
  RepositoryInfo,
  RepositoryLookupRequest,
} from "../../../domain/repositoryLookup";

export type FakeRemoteAddProjectController = Readonly<{
  open: boolean;
  step: RemoteAddProjectStep;
  serverProjects: readonly RemoteAddProjectServerProject[];
  availability: Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>>;
  pendingClone: RemoteAddProjectPendingClone | null;
  openDialog: Mock<() => void>;
  close: Mock<() => void>;
  back: Mock<() => void>;
  chooseSource: Mock<(source: RemoteProjectSourceKind) => void>;
  useGitUrl: Mock<() => void>;
  retrySources: Mock<() => void>;
  chooseHost: Mock<(host: string) => void>;
  submitEntry: Mock<(raw: string) => void>;
  selectServerProject: Mock<(key: string) => void>;
  setName: Mock<(value: string) => void>;
  setBranch: Mock<(value: string) => void>;
  setProtocol: Mock<(value: CloneProtocol) => void>;
  confirmClone: Mock<() => void>;
  openExisting: Mock<() => void>;
  retryPendingClone: Mock<() => void>;
  cancelPendingClone: Mock<() => void>;
  dismissPendingClone: Mock<() => void>;
}>;

export type FakeRemoteAddProjectState = Partial<
  Pick<
    FakeRemoteAddProjectController,
    "open" | "step" | "serverProjects" | "availability" | "pendingClone"
  >
>;

const READY: RemoteAddProjectSourceAvailability = { status: "ready" };

export function fakeRemoteAddProjectController(
  state: FakeRemoteAddProjectState,
): FakeRemoteAddProjectController {
  return {
    open: state.open ?? true,
    step: state.step ?? { kind: "sources" },
    serverProjects: state.serverProjects ?? [],
    availability: state.availability ?? readyAvailability(),
    pendingClone: state.pendingClone ?? null,
    openDialog: vi.fn<() => void>(),
    close: vi.fn<() => void>(),
    back: vi.fn<() => void>(),
    chooseSource: vi.fn<(source: RemoteProjectSourceKind) => void>(),
    useGitUrl: vi.fn<() => void>(),
    retrySources: vi.fn<() => void>(),
    chooseHost: vi.fn<(host: string) => void>(),
    submitEntry: vi.fn<(raw: string) => void>(),
    selectServerProject: vi.fn<(key: string) => void>(),
    setName: vi.fn<(value: string) => void>(),
    setBranch: vi.fn<(value: string) => void>(),
    setProtocol: vi.fn<(value: CloneProtocol) => void>(),
    confirmClone: vi.fn<() => void>(),
    openExisting: vi.fn<() => void>(),
    retryPendingClone: vi.fn<() => void>(),
    cancelPendingClone: vi.fn<() => void>(),
    dismissPendingClone: vi.fn<() => void>(),
  };
}

export function readyAvailability(): Readonly<
  Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>
> {
  return { serverProject: READY, gitUrl: READY, github: READY, gitlab: READY };
}

export function pendingLookupFixture(
  overrides: Partial<RepositoryLookupRequest> = {},
): Extract<RemoteAddProjectLookupState, { status: "pending" }> {
  return {
    status: "pending",
    request: { provider: "github", host: "github.com", path: "octo/editor", ...overrides },
  };
}

export function repositoryInfoFixture(overrides: Partial<RepositoryInfo>): RepositoryInfo {
  return {
    provider: "github",
    host: "github.com",
    fullPath: "octo/editor",
    description: null,
    visibility: "private",
    defaultBranch: "main",
    sshUrl: "git@github.com:octo/editor.git",
    httpsUrl: "https://github.com/octo/editor.git",
    ...overrides,
  };
}
