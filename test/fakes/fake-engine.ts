import { throwIfAborted } from "../../src/core/errors/error-helpers.js";
import { orientedSize } from "../../src/core/model/geometry.js";
import {
  checkFileLimits,
  type ImageEngine,
  ImageError,
  type ImageProbe,
  type ImageSourceInfo,
  type ImageThumbnail,
  imageLimits,
} from "../../src/index.js";
import { decodeJson, type FakeImageFile, storedPixelFor } from "./fake-image.js";

/** A decoded fake source: upright RGBA, as a worker would hold it. */
export interface FakeSource {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  /** The frames it holds: 1 for a still. Every frame shows the same pixels. */
  readonly frames: number;
}

export interface FakeEngine extends ImageEngine {
  /** The engine's sources, for the fake processor, which shares its "worker". */
  readonly sources: ReadonlyMap<string, FakeSource>;
}

async function readFake(file: Blob): Promise<FakeImageFile> {
  const head = new TextDecoder().decode(await file.slice(0, 20).arrayBuffer());
  if (!head.includes('"magic":"FAKEIMG1"')) {
    throw new ImageError("UNSUPPORTED_FORMAT", "Not a recognised image format.", {
      details: { format: "unknown" },
    });
  }
  try {
    return (await decodeJson(file)) as FakeImageFile;
  } catch (cause) {
    throw new ImageError("INVALID_IMAGE", "The fake image is malformed.", {
      details: { format: "fake" },
      cause,
    });
  }
}

/** An engine over the fakes' JSON format, which passes the engine's contract suite. */
export function createFakeEngine(): FakeEngine {
  const sources = new Map<string, FakeSource>();
  let destroyed = false;
  const alive = () => {
    if (destroyed) {
      throw new Error("The engine was destroyed.");
    }
  };

  const engine: FakeEngine = {
    sources,
    async probe(file, options) {
      alive();
      throwIfAborted(options?.signal);
      const fake = await readFake(file);
      const height = fake.declaredHeight ?? fake.height;
      if (fake.pixels.length < fake.width * height * 4) {
        throw new ImageError(
          "INVALID_IMAGE",
          "The header claims more pixels than the file holds.",
          {
            details: { format: "fake" },
          },
        );
      }
      const oriented = orientedSize({ width: fake.width, height }, fake.orientation);
      return {
        format: "png",
        stored: { width: fake.width, height },
        oriented,
        orientation: fake.orientation,
        frames: fake.animation?.delays.length ?? 1,
        hasAlpha: true,
        decodedPixelBound: (fake.animation?.delays.length ?? 1) * oriented.width * oriented.height,
        metadata: fake.metadata,
        keepable: fake.keepable,
      } satisfies ImageProbe;
    },
    async register(id, file, probe, options) {
      alive();
      throwIfAborted(options?.signal);
      if (sources.has(id)) {
        throw new TypeError(`Source "${id}" is already registered.`);
      }
      // Its own probe, under the policy, before anything decodes.
      const own = await engine.probe(file);
      checkFileLimits(
        options?.filePolicy ?? imageLimits.resolve(),
        file.size,
        own,
        // A still counts one frame; a source with its frames, every one.
        options?.frames === "all" && own.frames > 1 ? "all" : "first",
      );
      const fake = await readFake(file);
      const decoded = fake.decodesAs ?? orientedSize(fake, fake.orientation);
      if (decoded.width !== probe.oriented.width || decoded.height !== probe.oriented.height) {
        throw new ImageError("INVALID_IMAGE", "The decoded size differs from the probe's.", {
          details: { format: "fake" },
        });
      }
      const pixels = new Uint8ClampedArray(decoded.width * decoded.height * 4);
      for (let y = 0; y < decoded.height; y += 1) {
        for (let x = 0; x < decoded.width; x += 1) {
          const from = storedPixelFor(fake.orientation, x, y, fake);
          const s = (from.y * fake.width + from.x) * 4;
          pixels.set(fake.pixels.slice(s, s + 4), (y * decoded.width + x) * 4);
        }
      }
      throwIfAborted(options?.signal);
      const still = decoded.width * decoded.height * 4;
      const listed = fake.animation?.delays.length ?? 1;
      if (options?.frames === "all" && fake.animation && listed > 1) {
        // Held with all its frames (docs/adr/0011): each is checked in turn.
        (options.filePolicy ?? imageLimits.resolve()).check(
          "maxAnimationPixels",
          decoded.width * decoded.height,
        );
        const frames = Math.min(listed, fake.animation.decodes ?? listed);
        for (let done = 1; done <= frames; done += 1) {
          options.onProgress?.(done / listed);
          // Its first frame can be drawn from here, before the rest are checked.
          if (done === 1) options.onFirstFrame?.();
          // A turn of the event loop, so a cancel can arrive between two frames.
          await new Promise((resolve) => setTimeout(resolve, 0));
          throwIfAborted(options.signal);
        }
        sources.set(id, { width: decoded.width, height: decoded.height, pixels, frames });
        options.onProgress?.(1);
        return {
          id,
          format: probe.format,
          width: decoded.width,
          height: decoded.height,
          frames,
          hasAlpha: probe.hasAlpha,
          // The first frame, a screen, and a cache of every frame.
          decodedBytes: still * (2 + frames),
          timing:
            frames > 1
              ? { loop: fake.animation.loop, delays: fake.animation.delays.slice(0, frames) }
              : null,
          incomplete: frames < listed || fake.animation.cut === true,
        } satisfies ImageSourceInfo;
      }
      sources.set(id, { width: decoded.width, height: decoded.height, pixels, frames: 1 });
      options?.onProgress?.(1);
      return {
        id,
        format: probe.format,
        width: decoded.width,
        height: decoded.height,
        frames: 1,
        hasAlpha: probe.hasAlpha,
        decodedBytes: still,
        timing: null,
        incomplete: false,
      } satisfies ImageSourceInfo;
    },
    async thumbnail(id, maxSize, options) {
      alive();
      throwIfAborted(options?.signal);
      const source = sources.get(id);
      if (source === undefined) {
        throw new TypeError(`Unknown source "${id}".`);
      }
      const factor = Math.min(1, maxSize / source.width, maxSize / source.height);
      return {
        width: Math.max(1, Math.round(source.width * factor)),
        height: Math.max(1, Math.round(source.height * factor)),
        close() {},
      } satisfies ImageThumbnail;
    },
    async release(id) {
      alive();
      sources.delete(id);
    },
    async destroy() {
      destroyed = true;
      sources.clear();
    },
  };
  return engine;
}
