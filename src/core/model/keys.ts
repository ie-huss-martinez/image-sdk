/**
 * A new key for a layer, a redaction or a frame (ADR 0009): 24 hexadecimal
 * digits from the platform's random source, so a key is never reused, even
 * one a removed item had and the history may put back.
 *
 * Commands carry their keys, so the reducer stays pure: whatever builds an
 * `image.insertRedactions` command calls this first.
 *
 * @param used - Keys to avoid, such as the plan's. A clash is not expected:
 *   it's checked so that a broken random source can't produce one.
 * @public
 */
export function createImageKey(used?: ReadonlySet<string>): string {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!used?.has(key)) return key;
  }
}
