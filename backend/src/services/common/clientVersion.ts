// Version oracle for upstream client headers.
//
// Preserves the legacy v1 package.json version ("0.0.0") so wire
// headers (User-Agent, X-CLIENT-VERSION) stay byte-identical after the
// dissolve. A later change may align this with the backend release
// version, but that alters upstream-facing headers and needs review.
export const CLIENT_VERSION = "0.0.0";
