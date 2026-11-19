/** Whether Provider URLs may be http or name a private host, as the dashboard shows it. */
export interface PrivateUpstreamsSetting {
  allowed: boolean;
  defaultAllowed: boolean;
  isDefault: boolean;
}
