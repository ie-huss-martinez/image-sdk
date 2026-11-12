import { afterEach, describe, expect, it } from "vitest";
import { isImageError } from "../core/errors/image-error.js";
import { createPlan, type ImageDevelop, NEUTRAL_DEVELOP } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import { fittedView, type ImageRenderer } from "../core/ports/image-renderer.js";
import { classifyQuadrants, QUADRANT_COLOURS, quadrantCentres } from "./decode/orientation.js";
import { developPixels } from "./export/develop.js";
import { createImageEngine } from "./image-engine.js";
import { createImageRenderer, rendererInternals } from "./image-renderer.js";

/** A four-colour PNG of this size, registered as "s". */
async function open(width = 48, height = 32) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  QUADRANT_COLOURS.forEach(([r, g, b], quadrant) => {
    context.fillStyle = `rgb(${r} ${g} ${b})`;
    context.fillRect(
      (quadrant % 2) * (width / 2),
      Math.floor(quadrant / 2) * (height / 2),
      width / 2,
      height / 2,
    );
  });
  const file = await canvas.convertToBlob();
  const engine = createImageEngine();
  await engine.register("s", file, await engine.probe(file));
  const renderer = createImageRenderer(engine);
  await renderer.attach(document.createElement("canvas"));
  return { engine, renderer };
}

const opened: { engine: ImageEngine; renderer: ImageRenderer }[] = [];
afterEach(async () => {
  for (const { engine, renderer } of opened.splice(0)) {
    await renderer.destroy();
    await engine.destroy();
  }
});

async function snapshot(renderer: ImageRenderer) {
  const bitmap = await rendererInternals(renderer)?.snapshot();
  if (!bitmap) throw new Error("no snapshot");
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  return {
    width,
    height,
    bitmap,
    pixel: (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data),
  };
}

const withDevelop = (develop: Partial<ImageDevelop>) => {
  const plan = createPlan("s");
  return { ...plan, base: { ...plan.base, develop: { ...NEUTRAL_DEVELOP, ...develop } } };
};

describe("the preview renderer (docs/adr/0002)", () => {
  it("draws the plan fitted to the stage, at the device pixel ratio", async () => {
    const { engine, renderer } = await open();
    opened.push({ engine, renderer });
    expect(await renderer.render(createPlan("s"), fittedView(48, 32, 2))).toBe("drawn");
    const shot = await snapshot(renderer);
    expect([shot.width, shot.height]).toEqual([96, 64]);
    expect(
      classifyQuadrants(shot.bitmap, quadrantCentres(shot.bitmap), { width: 96, height: 64 }),
    ).toBe(1);
  });

  it("letterboxes a composition that doesn't fill the stage, and pans it", async () => {
    const { engine, renderer } = await open();
    opened.push({ engine, renderer });
    await renderer.render(createPlan("s"), fittedView(96, 32));
    let shot = await snapshot(renderer);
    // The image is 48 wide, centred: transparent on both sides.
    expect(shot.pixel(10, 16)[3]).toBe(0);
    expect(shot.pixel(30, 8)).toEqual([255, 0, 0, 255]);
    await renderer.render(createPlan("s"), { ...fittedView(96, 32), pan: { x: 24, y: 0 } });
    shot = await snapshot(renderer);
    expect(shot.pixel(30, 8)[3]).toBe(0);
    expect(shot.pixel(54, 8)).toEqual([255, 0, 0, 255]);
  });

  it("shows develop exactly as the export's reference math does (docs/adr/0006)", async () => {
    const { engine, renderer } = await open();
    opened.push({ engine, renderer });
    const develop = { exposure: 25, saturation: -40 };
    await renderer.render(withDevelop(develop), fittedView(48, 32));
    const shot = await snapshot(renderer);
    const expected = Uint8ClampedArray.from([0, 0, 255, 255]);
    developPixels(expected, { ...NEUTRAL_DEVELOP, ...develop }, null);
    expect(shot.pixel(12, 24)).toEqual(Array.from(expected));
  });

  it("ends a burst of develop changes with one final render of the last (docs/adr/0006)", async () => {
    // Large enough that develop takes several strips.
    const { engine, renderer } = await open(2_400, 1_600);
    opened.push({ engine, renderer });
    const view = fittedView(2_400, 1_600);
    const outcomes = await Promise.all(
      Array.from({ length: 25 }, (_, i) => renderer.render(withDevelop({ exposure: i * 2 }), view)),
    );
    expect(outcomes.at(-1)).toBe("drawn");
    expect(outcomes.slice(0, -1).every((outcome) => outcome === "superseded")).toBe(true);
    expect(rendererInternals(renderer)?.drawn()).toBe(1);
    const shot = await snapshot(renderer);
    const expected = Uint8ClampedArray.from([255, 0, 0, 255]);
    developPixels(expected, { ...NEUTRAL_DEVELOP, exposure: 48 }, null);
    expect(shot.pixel(600, 400)).toEqual(Array.from(expected));
  });

  it("stops a render in progress when a later one arrives", async () => {
    const { engine, renderer } = await open(2_400, 1_600);
    opened.push({ engine, renderer });
    const view = fittedView(2_400, 1_600);
    const first = renderer.render(withDevelop({ contrast: 30 }), view);
    // Let the first render reach the worker and start its strips.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = renderer.render(withDevelop({ contrast: -30 }), view);
    expect(await second).toBe("drawn");
    expect(["drawn", "superseded"]).toContain(await first);
    const shot = await snapshot(renderer);
    const expected = Uint8ClampedArray.from([255, 0, 0, 255]);
    developPixels(expected, { ...NEUTRAL_DEVELOP, contrast: -30 }, null);
    expect(shot.pixel(600, 400)).toEqual(Array.from(expected));
  });

  it("rejects renders before attach, of unknown sources and with impossible views", async () => {
    const engine = createImageEngine();
    const renderer = createImageRenderer(engine);
    opened.push({ engine, renderer });
    await expect(renderer.render(createPlan("s"), fittedView(10, 10))).rejects.toThrow(TypeError);
    const { engine: other, renderer: attached } = await open();
    opened.push({ engine: other, renderer: attached });
    await expect(attached.render(createPlan("missing"), fittedView(10, 10))).rejects.toThrow(
      TypeError,
    );
    await expect(attached.render(createPlan("s"), fittedView(0, 10))).rejects.toThrow(RangeError);
  });

  it("fails with UNSUPPORTED_ENVIRONMENT without transferControlToOffscreen", async () => {
    const engine = createImageEngine();
    const renderer = createImageRenderer(engine);
    opened.push({ engine, renderer });
    const error = await renderer.attach({} as HTMLCanvasElement).catch((reason: unknown) => reason);
    expect(isImageError(error, "UNSUPPORTED_ENVIRONMENT")).toBe(true);
  });

  it("resolves a waiting render as superseded when destroyed", async () => {
    const { engine, renderer } = await open(2_400, 1_600);
    const view = fittedView(2_400, 1_600);
    const first = renderer.render(withDevelop({ contrast: 10 }), view);
    const second = renderer.render(withDevelop({ contrast: 20 }), view);
    await renderer.destroy();
    expect(await second).toBe("superseded");
    expect(["drawn", "superseded"]).toContain(await first);
    await expect(renderer.render(createPlan("s"), view)).rejects.toThrow();
    await engine.destroy();
  });
});
