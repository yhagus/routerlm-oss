/**
 * The time zone the gateway's server runs in, as an IANA name such as "UTC" or
 * "Asia/Jakarta". Stored times are instants, so this only matters for what the
 * server writes in local time, such as its log lines. The Overview's buckets
 * are always UTC, whatever this is.
 */
export interface ServerTimeZone {
  timeZone: string;
}
