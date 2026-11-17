import { describe, expect, it, vi } from "vitest";
import { createImageKey } from "./keys.js";
import { MAX_KEY_LENGTH } from "./plan.js";

describe("createImageKey (ADR 0009)", () => {
  it("gives 24 hexadecimal digits, a valid key, different every time", () => {
    const keys = new Set(Array.from({ length: 1_000 }, () => createImageKey()));
    expect(keys.size).toBe(1_000);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{24}$/);
      expect(key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    }
  });

  it("never returns a key that's in use, even from a random source that repeats", () => {
    const bytes = [
      new Uint8Array(12).fill(1),
      new Uint8Array(12).fill(1),
      new Uint8Array(12).fill(2),
    ];
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).set(bytes.shift() ?? new Uint8Array(12));
      return array;
    });
    const taken = "01".repeat(12);
    expect(createImageKey(new Set([taken]))).toBe("02".repeat(12));
    expect(random).toHaveBeenCalledTimes(3);
    random.mockRestore();
  });
});
