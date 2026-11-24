let isAllowed = false;

export function allowsPrivateUpstreams(): boolean {
  return isAllowed;
}

export function publishPrivateUpstreamsAllowed(allowed: boolean): void {
  isAllowed = allowed;
}
