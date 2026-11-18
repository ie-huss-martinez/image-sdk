import { afterEach, describe, expect, it } from "vitest";
import { createImageEngine, engineInternals } from "../../src/adapters/image-engine.js";
import { createImageProcessor } from "../../src/adapters/image-processor.js";
import { isImageError } from "../../src/core/errors/image-error.js";
import type { ImageEngine } from "../../src/core/ports/image-engine.js";
import { createImageSession } from "../../src/core/session/session.js";
import { writeGif } from "../fixtures/gif-writer.js";

const FOUR = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
] as const;
const pattern = (width: number, height: number, shift: number) =>
  Array.from(
    { length: width * height },
    (_, i) => ((i % width) + Math.floor(i / width) * 3 + shift) % 4,
  );

const engines: ImageEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.destroy();
});

/** Waits until the worker itself has no source with this id: its bitmap was closed and dropped. */
async function expectReleased(own: ImageEngine, id: string) {
  const internals = engineInternals(own);
  if (!internals) throw new Error("not the SDK's engine");
  const deadline = Date.now() + 5_000;
  for (;;) {
    const held = await internals.call("thumbnail", { id, maxSize: 4 }).then(
      (bitmap) => {
        bitmap.close();
        return true;
      },
      () => false,
    );
    if (!held) return;
    if (Date.now() > deadline) throw new Error(`the worker still holds "${id}"`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("an animation's first frame while the session opens it (docs/adr/0011)", () => {
  it("is released when the open fails after it, as it does over maxSessionSize", async () => {
    const long = writeGif({
      width: 160,
      height: 120,
      palette: FOUR,
      loop: 0,
      frames: Array.from({ length: 60 }, (_, n) => ({ pixels: pattern(160, 120, n), delay: 2 })),
    });
    const own = createImageEngine();
    engines.push(own);
    // Room for one still of 160 × 120, not for an animation's working set.
    const session = createImageSession({
      engine: own,
      processor: createImageProcessor(own),
      filePolicy: { maxSessionSize: { maximum: 200_000, warning: 100_000 } },
    });
    let firstFrame: string | null = null;
    const stop = session.subscribe(() => {
      firstFrame = session.getSnapshot().openingFrame?.source ?? firstFrame;
    });
    const error = await session.open(new Blob([long.slice()], { type: "image/gif" })).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    stop();
    expect(isImageError(error, "SESSION_TOO_LARGE")).toBe(true);
    // It had a first frame to show, and the worker holds nothing of it now.
    expect(firstFrame).not.toBeNull();
    await expectReleased(own, firstFrame as unknown as string);
    expect(session.getSnapshot()).toMatchObject({ openingFrame: null, status: "empty" });
    await session.destroy();
  });
});
