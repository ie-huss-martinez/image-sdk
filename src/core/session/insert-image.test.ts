import { describe, expect, it } from "vitest";
import type { TestImageSpec } from "../../../test/contracts/harness-types.js";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { fakeEngineHarness } from "../../../test/fakes/harness.js";
import { isImageError } from "../errors/image-error.js";
import { compositionSize, cropRect } from "../model/geometry.js";
import { applyMatrix, layerToOutput } from "../model/layer-geometry.js";
import type { ImageImageLayer, ImagePlan } from "../model/plan.js";
import type { ImageProcessor } from "../ports/image-processor.js";
import { createImageSession, type ImageSessionEvent, type ImageSessionOptions } from "./session.js";

/**
 * `session.insertImage`, and how long the session holds an image layer's
 * source (ADR 0003, ADR 0004): while the plan, an undo or redo step, or an
 * export in progress refers to it, and no longer.
 */

const file = (spec: Partial<TestImageSpec> = {}) =>
  fakeEngineHarness.file({ width: 40, height: 20, ...spec });

/** Decoded bytes, as the session counts them. */
const bytes = (width: number, height: number) => width * height * 4;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

async function setup(overrides: Partial<ImageSessionOptions> = {}) {
  const engine = createFakeEngine();
  const events: ImageSessionEvent[] = [];
  const session = createImageSession({
    engine,
    processor: createFakeProcessor(engine),
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const base = await session.open(await file());
  const plan = () => session.getSnapshot().plan as ImagePlan;
  const layers = () => plan().layers as readonly ImageImageLayer[];
  /** The ids the engine holds: what the session hasn't released. */
  const held = () => [...engine.sources.keys()];
  return { engine, session, events, base, plan, layers, held };
}

describe("session.insertImage (ADR 0003, ADR 0004)", () => {
  it("adds an image as a layer over the others, centred, as one undoable step", async () => {
    const { session, events, base, layers, held } = await setup();
    const added = await session.insertImage(await file({ width: 10, height: 6 }));
    expect(added).toMatchObject({ width: 10, height: 6 });
    expect(added.id).not.toBe(base.id);
    // Smaller than half the image: at its own size, in the middle.
    expect(layers()).toEqual([
      {
        key: expect.stringMatching(/^[0-9a-f]{24}$/),
        kind: "image",
        name: "",
        visible: true,
        opacity: 100,
        x: 15,
        y: 7,
        width: 10,
        height: 6,
        rotation: 0,
        flipX: false,
        source: added.id,
        crop: null,
      },
    ]);
    const snapshot = session.getSnapshot();
    expect(snapshot.sources.map((source) => source.id)).toEqual([base.id, added.id]);
    expect(snapshot.source?.id).toBe(base.id);
    expect(snapshot).toMatchObject({ canUndo: true, inserting: false, historyTrimmed: false });
    expect(held()).toEqual([base.id, added.id]);
    expect(events.slice(-2)).toEqual([
      { type: "execute", outcome: "done", commands: ["image.insertLayers"] },
      { type: "insert", outcome: "done", commands: [] },
    ]);
    // A second one goes over the first.
    const second = await session.insertImage(await file({ width: 4, height: 4 }));
    expect(layers().map((layer) => layer.source)).toEqual([added.id, second.id]);
  });

  it("places the image upright and unmirrored in the output, whatever the plan's rotation and flips", async () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const { session, layers, base } = await setup();
          const orientation = { rotate, flipX, flipY };
          session.execute({ type: "image.setOrientation", orientation });
          await session.insertImage(await file({ width: 10, height: 6 }));
          const [layer] = layers();
          if (!layer) throw new Error("no layer");
          const plan = session.getSnapshot().plan as ImagePlan;
          const composition = compositionSize(plan, base);
          const toOutput = layerToOutput(
            layer,
            cropRect(plan.base.crop, base),
            orientation,
            composition,
          );
          const what = JSON.stringify(orientation);
          // Where the file's own corners are in the output: its top left at
          // the top left, its right to the right, its bottom at the bottom.
          const topLeft = applyMatrix(toOutput, { x: 0, y: 0 });
          const topRight = applyMatrix(toOutput, { x: layer.width, y: 0 });
          const bottomLeft = applyMatrix(toOutput, { x: 0, y: layer.height });
          expect(topRight.x - topLeft.x, what).toBeCloseTo(10, 9);
          expect(topRight.y - topLeft.y, what).toBeCloseTo(0, 9);
          expect(bottomLeft.x - topLeft.x, what).toBeCloseTo(0, 9);
          expect(bottomLeft.y - topLeft.y, what).toBeCloseTo(6, 9);
          // Its own size, in the middle of what's shown, to the whole-pixel grid.
          expect([layer.width, layer.height], what).toEqual([10, 6]);
          expect(Math.abs(topLeft.x + 5 - composition.width / 2), what).toBeLessThanOrEqual(0.5);
          expect(Math.abs(topLeft.y + 3 - composition.height / 2), what).toBeLessThanOrEqual(0.5);
          // Mirrored exactly when the plan mirrors once, and turned back by its quarter turns.
          expect(layer.flipX, what).toBe(flipX !== flipY);
          expect(layer.rotation % 900, what).toBe(0);
        }
      }
    }
  });

  it("fits a large image in half of what's shown, keeping its shape, inside the crop", async () => {
    const { session, layers } = await setup();
    session.execute({ type: "image.setCrop", crop: { x: 10, y: 4, width: 20, height: 12 } });
    await session.insertImage(await file({ width: 100, height: 40 }));
    // Half of 20 × 12 is 10 × 6; 100 × 40 fits it at a tenth: 10 × 4, centred in the crop.
    expect(layers()[0]).toMatchObject({ x: 15, y: 8, width: 10, height: 4 });
  });

  it("says it's inserting while the file is probed and decoded", async () => {
    const { session, engine } = await setup();
    const seen: boolean[] = [];
    const unsubscribe = session.subscribe(() => seen.push(session.getSnapshot().inserting));
    const register = engine.register;
    let during: boolean | undefined;
    engine.register = (...args) => {
      during = session.getSnapshot().inserting;
      return register(...args);
    };
    await session.insertImage(await file());
    unsubscribe();
    expect(during).toBe(true);
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });

  it("holds a source while undo or redo can bring its layer back, and releases it when neither can", async () => {
    const { session, base, layers, held } = await setup();
    const added = await session.insertImage(await file({ width: 10, height: 6 }));
    // Undone: the plan no longer names it, but redo does.
    expect(session.undo()).toBe(true);
    expect(layers()).toEqual([]);
    expect(held()).toEqual([base.id, added.id]);
    expect(session.redo()).toBe(true);
    expect(layers()).toHaveLength(1);
    // Removed: undo can still restore the layer, so the source stays.
    session.execute({ type: "image.removeLayers", keys: [layers()[0]?.key ?? ""] });
    expect(held()).toEqual([base.id, added.id]);
    expect(session.getSnapshot().sources).toHaveLength(2);
    expect(session.undo()).toBe(true);
    expect(layers()[0]?.source).toBe(added.id);
    // Undone back to before the insert, then a new edit: redo is gone, and
    // with it the last reference.
    expect(session.undo()).toBe(true);
    expect(held()).toEqual([base.id, added.id]);
    session.execute({ type: "image.setDevelop", values: { exposure: 10 } });
    expect(held()).toEqual([base.id]);
    expect(session.getSnapshot().sources.map((source) => source.id)).toEqual([base.id]);
  });

  it("keeps a source that an update points a layer at, and one a step would restore it to", async () => {
    const { session, base, layers, held } = await setup();
    const first = await session.insertImage(await file({ width: 10, height: 6 }));
    const second = await session.insertImage(await file({ width: 8, height: 8 }));
    const [one, two] = layers();
    // Point the first layer at the second source, and remove the second layer.
    session.execute({
      type: "image.updateLayers",
      updates: [{ key: one?.key ?? "", props: { source: second.id } }],
    });
    session.execute({ type: "image.removeLayers", keys: [two?.key ?? ""] });
    // No layer shows the first source now; undoing the update would.
    expect(layers().map((layer) => layer.source)).toEqual([second.id]);
    expect(held()).toEqual([base.id, first.id, second.id]);
  });

  it("releases every layer source when another file opens, and when destroyed", async () => {
    const { session, engine, held } = await setup();
    await session.insertImage(await file({ width: 10, height: 6 }));
    await session.insertImage(await file({ width: 8, height: 8 }));
    expect(held()).toHaveLength(3);
    const next = await session.open(await file({ width: 30, height: 30 }));
    expect(held()).toEqual([next.id]);
    expect(session.getSnapshot().sources.map((source) => source.id)).toEqual([next.id]);
    await session.insertImage(await file());
    await session.destroy();
    expect([...engine.sources.keys()]).toEqual([]);
  });

  it("counts every source it holds against maxFiles", async () => {
    const { session, base, held, layers } = await setup({ filePolicy: { maxFiles: 2 } });
    const added = await session.insertImage(await file({ width: 10, height: 6 }));
    const error = await rejection(session.insertImage(await file({ width: 4, height: 4 })));
    expect(isImageError(error, "TOO_MANY_FILES")).toBe(true);
    expect(held()).toEqual([base.id, added.id]);
    expect(layers()).toHaveLength(1);
    expect(session.getSnapshot().error).toBe(error);
    // A source only the history keeps still counts: it's still held.
    session.execute({ type: "image.removeLayers", keys: [layers()[0]?.key ?? ""] });
    const again = await rejection(session.insertImage(await file({ width: 4, height: 4 })));
    expect(isImageError(again, "TOO_MANY_FILES")).toBe(true);
  });

  it("makes room by dropping the oldest steps that alone keep an image, and says the history was trimmed", async () => {
    // The base is 40 × 20; with one 40 × 20 layer source the session is full.
    const { session, base, held, layers } = await setup({
      filePolicy: { maxSessionSize: bytes(40, 20) * 2 },
    });
    const first = await session.insertImage(await file());
    session.execute({ type: "image.removeLayers", keys: [layers()[0]?.key ?? ""] });
    session.execute({ type: "image.setDevelop", values: { contrast: 5 } });
    expect(held()).toEqual([base.id, first.id]);
    expect(session.getSnapshot().historyTrimmed).toBe(false);

    const second = await session.insertImage(await file());
    // The insert and the removal of the first image were the only things
    // keeping it: they're gone, and it's released. The later step stays.
    expect(held()).toEqual([base.id, second.id]);
    expect(session.getSnapshot().historyTrimmed).toBe(true);
    expect(layers().map((layer) => layer.source)).toEqual([second.id]);
    expect(session.undo()).toBe(true); // the second insert
    expect(session.undo()).toBe(true); // the contrast
    expect(session.getSnapshot().plan?.base.develop.contrast).toBe(0);
    expect(session.undo()).toBe(false);
  });

  it("fails with SESSION_TOO_LARGE, dropping nothing, when no history frees enough", async () => {
    const { session, base, held, layers } = await setup({
      filePolicy: { maxSessionSize: bytes(40, 20) * 2 },
    });
    const first = await session.insertImage(await file());
    session.execute({ type: "image.setDevelop", values: { contrast: 5 } });
    // The plan itself shows the first image: no step's going frees it.
    const error = await rejection(session.insertImage(await file()));
    expect(isImageError(error, "SESSION_TOO_LARGE")).toBe(true);
    expect(held()).toEqual([base.id, first.id]);
    expect(layers()).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ historyTrimmed: false, canUndo: true });
    expect(session.undo()).toBe(true);
    expect(session.undo()).toBe(true);
    expect(layers()).toEqual([]);
  });

  it("warns when the session comes near its size, without stopping", async () => {
    const { session } = await setup({
      filePolicy: { maxSessionSize: { maximum: bytes(40, 20) * 4, warning: bytes(40, 20) * 2 } },
    });
    await session.insertImage(await file());
    expect(session.getSnapshot().warnings).toContain("maxSessionSize");
  });

  it("checks the file's own limits before decoding it, and registers nothing that fails", async () => {
    const { session, engine, base, held } = await setup({ filePolicy: { maxImagePixels: 1_000 } });
    let registered = 0;
    const register = engine.register;
    engine.register = (...args) => {
      registered += 1;
      return register(...args);
    };
    const error = await rejection(session.insertImage(await file({ width: 100, height: 100 })));
    expect(isImageError(error, "IMAGE_TOO_LARGE")).toBe(true);
    expect(registered).toBe(0);
    expect(held()).toEqual([base.id]);
    const malformed = await rejection(session.insertImage(await fakeEngineHarness.malformed()));
    expect(isImageError(malformed, "INVALID_IMAGE")).toBe(true);
    expect(held()).toEqual([base.id]);
  });

  it("places the image with the caller's commands, and releases it if they don't name it", async () => {
    const { session, base, held, layers } = await setup();
    const added = await session.insertImage(await file({ width: 10, height: 6 }), {
      place: (source, plan) => [
        {
          type: "image.insertLayers",
          at: plan.layers.length,
          layers: [
            {
              key: "logo",
              kind: "image",
              name: "Logo",
              visible: true,
              opacity: 80,
              x: 0,
              y: 0,
              width: source.width * 2,
              height: source.height * 2,
              rotation: 900,
              flipX: false,
              source: source.id,
              crop: { x: 1, y: 1, width: 8, height: 4 },
            },
          ],
        },
        { type: "image.setDevelop", values: { exposure: 5 } },
      ],
    });
    expect(layers()[0]).toMatchObject({ key: "logo", source: added.id, width: 20, rotation: 900 });
    // Its commands are one step.
    expect(session.undo()).toBe(true);
    expect(layers()).toEqual([]);
    expect(session.getSnapshot().plan?.base.develop.exposure).toBe(0);

    // Commands that never refer to the source: it isn't kept.
    const unused = await rejection(
      session.insertImage(await file({ width: 4, height: 4 }), {
        place: () => ({ type: "image.setDevelop", values: { exposure: 7 } }),
      }),
    );
    expect(isImageError(unused, "INVALID_COMMAND")).toBe(true);
    // They didn't run: a failed insert changes nothing.
    expect(session.getSnapshot().plan?.base.develop.exposure).toBe(0);
    expect(session.getSnapshot().canRedo).toBe(true);
    // Commands the reducer refuses: nothing changes, and it isn't kept.
    const refused = await rejection(
      session.insertImage(await file({ width: 4, height: 4 }), {
        place: (source) => ({
          type: "image.insertLayers",
          at: 99,
          layers: [{ ...(layers()[0] as ImageImageLayer), key: "x", source: source.id }],
        }),
      }),
    );
    expect(isImageError(refused, "INVALID_COMMAND")).toBe(true);
    // The first image is still held, by redo; neither of the others is.
    expect(held()).toEqual([base.id, added.id]);
  });

  it("adds nothing when cancelled, or when another file opens meanwhile", async () => {
    const { session, engine, base, held, events } = await setup();
    const cancelled = await rejection(
      session.insertImage(await file(), { signal: AbortSignal.abort() }),
    );
    expect(isImageError(cancelled, "ABORTED")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "insert", outcome: "cancelled", commands: [] });
    expect(session.getSnapshot().error).toBeNull();
    expect(held()).toEqual([base.id]);

    // An open that finishes while the insert is decoding.
    const register = engine.register;
    let release: (() => void) | undefined;
    engine.register = async (id, f, probe, o) => {
      if (release === undefined) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return register(id, f, probe, o);
    };
    const pending = session.insertImage(await file({ width: 10, height: 6 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = await session.open(await file({ width: 30, height: 30 }));
    release?.();
    const superseded = await rejection(pending);
    expect(isImageError(superseded, "ABORTED")).toBe(true);
    expect(session.getSnapshot().plan?.layers).toEqual([]);
    expect(held()).toEqual([next.id]);
  });

  it("refuses before a file is open, and after the session is destroyed", async () => {
    const engine = createFakeEngine();
    const session = createImageSession({ engine, processor: createFakeProcessor(engine) });
    const early = await rejection(session.insertImage(await file()));
    expect(isImageError(early, "INVALID_COMMAND")).toBe(true);
    await session.destroy();
    await expect(session.insertImage(await file())).rejects.toThrow();
  });

  it("keeps an export's sources until it ends, whatever happens to the plan meanwhile", async () => {
    const engine = createFakeEngine();
    let finish: (() => void) | undefined;
    const during: string[][] = [];
    // A processor that waits, then reports which sources the engine still holds.
    const processor: ImageProcessor = {
      async export() {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        during.push([...engine.sources.keys()]);
        return new Blob(["done"]);
      },
      async destroy() {},
    };
    const session = createImageSession({ engine, processor });
    const base = await session.open(await file());
    const added = await session.insertImage(await file({ width: 10, height: 6 }));
    const exporting = session.export({ type: "png" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The layer is undone, and a new edit drops the redo that named it.
    session.undo();
    session.execute({ type: "image.setDevelop", values: { exposure: 3 } });
    expect([...engine.sources.keys()]).toEqual([base.id, added.id]);
    finish?.();
    await exporting;
    expect(during).toEqual([[base.id, added.id]]);
    // Released once the export is over.
    expect([...engine.sources.keys()]).toEqual([base.id]);
  });

  it("never puts file names, sizes or sources in its events", async () => {
    const { session, events } = await setup();
    await session.insertImage(
      new File([await file({ width: 10, height: 6 })], "passport-scan.png"),
    );
    const text = JSON.stringify(events);
    expect(text).not.toContain("passport");
    expect(text).not.toContain("source-");
    expect(events.at(-1)).toEqual({ type: "insert", outcome: "done", commands: [] });
  });
});
