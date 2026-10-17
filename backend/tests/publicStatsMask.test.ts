import { describe, expect, test } from "bun:test";
import { maskIp } from "../src/routes/publicStats";

describe("public stats IP masking", () => {
  test("masks every address in a forwarded chain", () => {
    expect(maskIp("140.245.45.163, 172.69.166.125")).toBe("140.*.*.163, 172.*.*.125");
    expect(maskIp("140.245.45.163,172.69.166.125")).toBe("140.*.*.163, 172.*.*.125");
  });

  test("masks IPv4 with port, IPv6, and IPv4-mapped IPv6", () => {
    expect(maskIp("203.0.113.9:443")).toBe("203.*.*.9:443");
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:*:*:7334");
    expect(maskIp("[2001:db8::1]:8080")).toBe("[2001:*:*:1]:8080");
    expect(maskIp("::ffff:198.51.100.7")).toBe("::ffff:198.*.*.7");
  });

  test("never returns an unrecognized value raw", () => {
    expect(maskIp("client.example.test")).toBe("*");
    expect(maskIp("")).toBe("");
  });
});
