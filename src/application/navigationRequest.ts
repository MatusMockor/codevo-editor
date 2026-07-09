export interface NavigationRequest {
  canNavigate(): boolean;
}

export function canNavigate(request?: NavigationRequest): boolean {
  return request?.canNavigate() ?? true;
}
