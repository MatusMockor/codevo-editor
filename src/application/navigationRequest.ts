export interface NavigationRequest {
  canNavigate(): boolean;
  canFinalize?(): boolean;
}

export function canNavigate(request?: NavigationRequest): boolean {
  return request?.canNavigate() ?? true;
}

export function canFinalizeNavigation(request?: NavigationRequest): boolean {
  return request?.canFinalize?.() ?? canNavigate(request);
}
