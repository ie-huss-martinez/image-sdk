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
        frames: 1,
        hasAlpha: true,
        decodedPixelBound: oriented.width * oriented.height,
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
      checkFileLimits(
        options?.filePolicy ?? imageLimits.resolve(),
        file.size,
        await engine.probe(file),
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
      sources.set(id, { width: decoded.width, height: decoded.height, pixels });
      options?.onProgress?.(1);
      return {
        id,
        format: probe.format,
        width: decoded.width,
        height: decoded.height,
        frames: 1,
        hasAlpha: probe.hasAlpha,
        decodedBytes: decoded.width * decoded.height * 4,
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
