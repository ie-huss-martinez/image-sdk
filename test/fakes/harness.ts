import { EMPTY_KEEPABLE_METADATA, NO_METADATA } from "../../src/index.js";
import type { TestImageSpec } from "../contracts/harness-types.js";
import type { ImageEngineHarness } from "../contracts/image-engine.contract.js";
import type { ImageProcessorHarness } from "../contracts/image-processor.contract.js";
import { createFakeEngine } from "./fake-engine.js";
import {
  decodeJson,
  encodeJson,
  type FakeExportFile,
  type FakeImageFile,
  storedColour,
  storedPixels,
} from "./fake-image.js";
import { createFakeProcessor } from "./fake-processor.js";

function fakeFile(spec: TestImageSpec, extra: Partial<FakeImageFile> = {}): Blob {
  return encodeJson({
    magic: "FAKEIMG1",
    width: spec.width,
    height: spec.height,
    orientation: spec.orientation ?? 1,
    pixels: storedPixels(spec.width, spec.height),
    metadata: { ...NO_METADATA, ...spec.metadata },
    keepable: { ...EMPTY_KEEPABLE_METADATA, ...spec.keepable },
    ...extra,
  } satisfies FakeImageFile);
}

export const fakeEngineHarness: ImageEngineHarness = {
  createEngine: createFakeEngine,
  async file(spec) {
    return fakeFile(spec);
  },
  async lyingHeader() {
    return fakeFile({ width: 4, height: 4 }, { declaredHeight: 30_000 });
  },
  async mismatchedDecode() {
    return fakeFile({ width: 4, height: 4 }, { decodesAs: { width: 4_000, height: 4_000 } });
  },
  async malformed() {
    return new Blob(['{"magic":"FAKEIMG1",not json']);
  },
  async unknown() {
    return new Blob(["GIF87a nothing we know"]);
  },
};

export const fakeProcessorHarness: ImageProcessorHarness = {
  create() {
    const engine = createFakeEngine();
    return { engine, processor: createFakeProcessor(engine) };
  },
  async file(spec) {
    return fakeFile(spec);
  },
  storedColour,
  async inspect(output) {
    const file = (await decodeJson(output)) as FakeExportFile;
    return {
      width: file.width,
      height: file.height,
      pixel: (x, y) => file.pixels.slice((y * file.width + x) * 4, (y * file.width + x) * 4 + 4),
      metadata: file.metadata,
      hasLocation: Object.keys(file.metadata).some((key) => /gps|location/i.test(key)),
    };
  },
};
