import type {
  LocalProjectCloneJobRequest,
  LocalProjectCloneRequest,
  LocalProjectCloneSnapshot,
} from "../../domain/localProjectClone";

export interface LocalProjectCloneGateway {
  start(request: LocalProjectCloneRequest): Promise<LocalProjectCloneSnapshot>;
  get(request: LocalProjectCloneJobRequest): Promise<LocalProjectCloneSnapshot>;
  cancel(request: LocalProjectCloneJobRequest): Promise<LocalProjectCloneSnapshot>;
}
