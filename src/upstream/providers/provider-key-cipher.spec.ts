import { randomBytes } from "node:crypto";
import { ProviderKeyCipher } from "./provider-key-cipher.js";

// 24 bytes, so every bit of the ciphertext's last base64 character is significant.
const PROVIDER_ACCOUNT_KEY = "sk-live-0123456789abcdef";

function cipherWithRandomKey(): ProviderKeyCipher {
  return new ProviderKeyCipher(randomBytes(32).toString("base64"));
}

describe("ProviderKeyCipher", () => {
  it("decrypts what it encrypted, and the ciphertext doesn't reveal the key", () => {
    const cipher = cipherWithRandomKey();

    const encrypted = cipher.encrypt(PROVIDER_ACCOUNT_KEY);

    expect(encrypted).not.toContain(PROVIDER_ACCOUNT_KEY);
    expect(cipher.decrypt(encrypted)).toBe(PROVIDER_ACCOUNT_KEY);
  });

  it("encrypts the same key differently each time", () => {
    const cipher = cipherWithRandomKey();

    expect(cipher.encrypt(PROVIDER_ACCOUNT_KEY)).not.toBe(cipher.encrypt(PROVIDER_ACCOUNT_KEY));
  });

  it("refuses ciphertext that was tampered with", () => {
    const cipher = cipherWithRandomKey();
    const encrypted = cipher.encrypt(PROVIDER_ACCOUNT_KEY);
    const lastCharacter = encrypted.at(-1) === "A" ? "B" : "A";

    expect(() => cipher.decrypt(encrypted.slice(0, -1) + lastCharacter)).toThrow();
  });

  it("refuses ciphertext encrypted under another encryption key", () => {
    const encrypted = cipherWithRandomKey().encrypt(PROVIDER_ACCOUNT_KEY);

    expect(() => cipherWithRandomKey().decrypt(encrypted)).toThrow();
  });
});
