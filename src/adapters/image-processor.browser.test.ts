import { createWindowReader } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { describeImageProcessorContract } from "../../test/contracts/image-processor.contract.js";
import { concat, exif, pngChunk } from "../../test/fixtures/image-writers.js";
import { isImageError } from "../core/errors/image-error.js";
import { createPlan, NEUTRAL_DEVELOP } from "../core/model/plan.js";
import { developPixels } from "./export/develop.js";
import { encodePlan } from "./export/encode.js";
import { renderPlan } from "./export/render.js";
import { createImageEngine } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { probeImage } from "./probe/probe.js";

/** A distinct, opaque colour for every stored pixel. */
const storedColour = (x: number, y: number) => [(x * 50) % 256, (y * 60) % 256, 128, 255];

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const probe = (bytes: Uint8Array) => probeImage(createWindowReader(new Blob([bytes.slice()])));
const latin1 = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/** A PNG the browser encodes, with every stored pixel's colour, and chunks after IHDR. */
async function pngWith(width: number, height: number, chunks: Uint8Array[]): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) image.data.set(storedColour(x, y), (y * width + x) * 4);
  }
  context.putImageData(image, 0, 0);
  const stored = await bytesOf(await canvas.convertToBlob());
  const at = 8 + 8 + 13 + 4;
  return new Blob([concat([stored.subarray(0, at), ...chunks, stored.subarray(at)]).slice()]);
}

const TEXT_FIELDS: Record<string, string> = {
  Title: "title",
  Description: "description",
  Author: "artist",
  Copyright: "copyright",
};

describeImageProcessorContract("createImageProcessor", {
  create() {
    const engine = createImageEngine();
    return { engine, processor: createImageProcessor(engine) };
  },
  file(spec) {
    const chunks: Uint8Array[] = [
      pngChunk(
        "eXIf",
        exif({
          orientation: spec.orientation ?? 1,
          ...(spec.metadata?.location ? { gps: true } : {}),
          ...(spec.metadata?.camera ? { make: "Camera Co" } : {}),
          ...(spec.metadata?.timestamps ? { dateTime: "2026:11:12 10:00:00" } : {}),
          ...(spec.metadata?.thumbnail ? { thumbnail: true } : {}),
        }),
      ),
    ];
    for (const [keyword, field] of Object.entries(TEXT_FIELDS)) {
      const value = spec.keepable?.[field as "title"];
      if (value) chunks.push(pngChunk("tEXt", [...latin1(keyword), 0, ...latin1(value)]));
    }
    return pngWith(spec.width, spec.height, chunks);
  },
  storedColour,
  async inspect(output) {
    const bytes = await bytesOf(output);
    // Every text chunk, read directly from the bytes rather than by the SDK's probe.
    const metadata: Record<string, string> = {};
    let hasExif = false;
    for (let at = 8; at + 12 <= bytes.length; ) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + at).getUint32(0);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      const data = bytes.subarray(at + 8, at + 8 + length);
      if (type === "eXIf") hasExif = true;
      if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
        const end = data.indexOf(0);
        const keyword = String.fromCharCode(...data.subarray(0, end));
        let text = data.subarray(end + 1);
        if (type === "iTXt") {
          let skip = 2;
          for (let zeros = 0; zeros < 2; skip += 1) if (text[skip] === 0) zeros += 1;
          text = text.subarray(skip);
        }
        metadata[TEXT_FIELDS[keyword] ?? keyword] = new TextDecoder().decode(text);
      }
      at += 12 + length;
    }
    const bitmap = await createImageBitmap(output);
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("no 2D canvas");
    context.drawImage(bitmap, 0, 0);
    const { width, height } = bitmap;
    bitmap.close();
    const probed = await probe(bytes);
    return {
      width,
      height,
      pixel: (x, y) => Array.from(context.getImageData(x, y, 1, 1).data),
      metadata,
      hasLocation: hasExif || probed.metadata.location,
    };
  },
});

describe("exports from the real engine (docs/adr/0005)", () => {
  const KEPT = { title: "Harbour, à l'aube", description: "", artist: "", copyright: "© 2026" };

  async function exported(type: "png" | "jpeg" | "webp", metadata = KEPT) {
    const engine = createImageEngine();
    const processor = createImageProcessor(engine);
    const file = await pngWith(6, 4, [
      pngChunk(
        "eXIf",
        exif({
          orientation: 6,
          gps: true,
          make: "Camera Co",
          dateTime: "2026:11:12 10:00:00",
          thumbnail: true,
        }),
      ),
    ]);
    await engine.register("s", file, await engine.probe(file));
    const blob = await processor.export({
      plan: { ...createPlan("s"), metadata },
      format: { type },
    });
    await engine.destroy();
    return blob;
  }

  it.each(["jpeg", "png"] as const)(
    "%s keeps exactly the kept fields: no GPS, camera, time, thumbnail, profile or orientation",
    async (type) => {
      const blob = await exported(type);
      expect(blob.type).toBe(`image/${type}`);
      const bytes = await bytesOf(blob);
      expect(await probe(bytes)).toMatchObject({
        format: type,
        // Upright pixels, and no orientation written.
        stored: { width: 4, height: 6 },
        orientation: 1,
        metadata: {
          location: false,
          camera: false,
          timestamps: false,
          thumbnail: false,
          colourProfile: false,
          other: false,
        },
        keepable: KEPT,
      });
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text).not.toContain("Camera Co");
      expect(text).not.toContain("2026:11:12");
    },
  );

  it("WebP is encoded where the browser can, and carries no metadata", async () => {
    const blob = await exported("webp");
    expect(blob.type).toBe("image/webp");
    expect(await probe(await bytesOf(blob))).toMatchObject({
      format: "webp",
      stored: { width: 4, height: 6 },
      metadata: {
        location: false,
        camera: false,
        timestamps: false,
        colourProfile: false,
        other: false,
      },
    });
  });

  it("fails with UNSUPPORTED_FORMAT when the browser returns another type than requested", async () => {
    const real = OffscreenCanvas.prototype.convertToBlob;
    // A browser without a WebP encoder returns PNG.
    OffscreenCanvas.prototype.convertToBlob = function (this: OffscreenCanvas) {
      return real.call(this, { type: "image/png" });
    };
    try {
      const blank = new OffscreenCanvas(2, 2);
      blank.getContext("2d")?.fillRect(0, 0, 2, 2);
      const source = await createImageBitmap(blank);
      const error = await encodePlan(source, createPlan("s"), { type: "webp" }).catch(
        (reason: unknown) => reason,
      );
      expect(isImageError(error, "UNSUPPORTED_FORMAT")).toBe(true);
    } finally {
      OffscreenCanvas.prototype.convertToBlob = real;
    }
  });

  it("refuses formats it doesn't export, and qualities outside 0 to 1", async () => {
    const engine = createImageEngine();
    const processor = createImageProcessor(engine);
    const file = await pngWith(2, 2, []);
    await engine.register("s", file, await engine.probe(file));
    const plan = createPlan("s");
    await expect(processor.export({ plan, format: { type: "avif" } as never })).rejects.toThrow(
      TypeError,
    );
    await expect(processor.export({ plan, format: { type: "jpeg", quality: 2 } })).rejects.toThrow(
      RangeError,
    );
    await engine.destroy();
  });

  it("needs an engine from createImageEngine", () => {
    expect(() => createImageProcessor({} as never)).toThrow(TypeError);
  });
});

describe("develop in the renderer (docs/adr/0006)", () => {
  async function bitmapOf(width: number, height: number, rgba: readonly number[]) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D canvas");
    const image = context.createImageData(width, height);
    for (let i = 0; i < width * height; i += 1) image.data.set(rgba, i * 4);
    context.putImageData(image, 0, 0);
    return createImageBitmap(canvas, { premultiplyAlpha: "none" });
  }

  const read = (canvas: OffscreenCanvas) =>
    Array.from(
      canvas
        .getContext("2d", { willReadFrequently: true })
        ?.getImageData(0, 0, 1, 1, { colorSpace: "srgb" }).data ?? [],
    );

  it("keeps semi-transparent pixels within a known tolerance of the reference", async () => {
    // Alpha 10 passes through premultiplied storage once on drawing and once
    // per read-back; develop reads back once, so the error stays bounded.
    const colour = [200, 120, 60, 10];
    const develop = { ...NEUTRAL_DEVELOP, exposure: 30, saturation: 40 };
    const plan = { ...createPlan("s"), base: { ...createPlan("s").base, develop } };
    const canvas = await renderPlan(await bitmapOf(4, 4, colour), plan, false);
    const expected = Uint8ClampedArray.from(colour);
    developPixels(expected, develop, null);
    const actual = read(canvas);
    expect(actual[3]).toBe(10);
    for (let channel = 0; channel < 3; channel += 1) {
      // Premultiplied 8-bit storage at alpha 10 keeps about 255 / 10 levels.
      expect(
        Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)),
        `channel ${channel}`,
      ).toBeLessThanOrEqual(26);
    }
  });

  it("stops at the next strip when the render is cancelled", async () => {
    const develop = { ...NEUTRAL_DEVELOP, contrast: 10 };
    const plan = { ...createPlan("s"), base: { ...createPlan("s").base, develop } };
    const controller = new AbortController();
    controller.abort(new DOMException("superseded", "AbortError"));
    const source = await bitmapOf(8, 8, [10, 20, 30, 255]);
    await expect(renderPlan(source, plan, true, controller.signal)).rejects.toThrow("superseded");
  });
});
