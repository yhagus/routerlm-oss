import dns from "dns";

// Force public DNS to bypass OS negative cache (mDNSResponder holds NXDOMAIN)
const resolver = new dns.promises.Resolver();
resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

// Try custom public DNS first, fall back to OS resolver
// (Cloudflare DNS may not resolve all hostnames, e.g. *.ts.net)
export async function resolveDns(hostname: any, timeoutMs: any) {
  const tryResolver = (fn: any) => Promise.race([
    fn(),
    new Promise<any>((_, rej) => setTimeout(() => rej(new Error("dns timeout")), timeoutMs)),
  ]).then(() => true).catch(() => false);

  if (await tryResolver(() => resolver.resolve4(hostname))) return true;
  return tryResolver(() => dns.promises.resolve4(hostname));
}
