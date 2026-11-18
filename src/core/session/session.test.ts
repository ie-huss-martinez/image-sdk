import { describe, expect, it } from "vitest";
import type { TestImageSpec } from "../../../test/contracts/harness-types.js";
import { createFakeEngine, type FakeEngine } from "../../../test/fakes/fake-engine.js";
import { encodeJson, type FakeImageFile, storedPixels } from "../../../test/fakes/fake-image.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { fakeEngineHarness } from "../../../test/fakes/harness.js";
import { type ImageError, isImageError } from "../errors/image-error.js";
import { createPlan, type ImageAnimation, type ImageFrame, type ImagePlan } from "../model/plan.js";
import { EMPTY_KEEPABLE_METADATA, NO_METADATA } from "../model/source.js";
import type { ImageEngine } from "../ports/image-engine.js";
import type { ImageProcessor } from "../ports/image-processor.js";
import { createImageSession, type ImageSessionEvent, type ImageSessionOptions } from "./session.js";

const file = (spec: Partial<TestImageSpec> = {}) =>
  fakeEngineHarness.file({ width: 40, height: 20, ...spec });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

/** A gate a test opens when it wants a call to finish. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function setup(overrides: Partial<ImageSessionOptions> = {}) {
  const engine = createFakeEngine();
  const events: ImageSessionEvent[] = [];
  const session = createImageSession({
    engine,
    processor: createFakeProcessor(engine),
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { engine, session, events };
}

/** An engine whose registrations wait for their gates, in the order they start. */
function gatedEngine(engine: FakeEngine) {
  const gates: ReturnType<typeof gate>[] = [];
  const gated: ImageEngine = {
    ...engine,
    probe: (f, o) => engine.probe(f, o),
    release: (id) => engine.release(id),
    thumbnail: (id, size, o) => engine.thumbnail(id, size, o),
    destroy: () => engine.destroy(),
    async register(id, f, probe, o) {
      const g = gate();
      gates.push(g);
      await g.opened;
      return engine.register(id, f, probe, o);
    },
  };
  return { gated, gates };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the image session (ADR 0003)", () => {
  it("starts empty, and opens a file as a new document", async () => {
    const { session, events } = setup();
    expect(session.getSnapshot()).toMatchObject({ status: "empty", plan: null, source: null });
    const source = await session.open(
      await file({ metadata: { location: true, camera: true }, keepable: { title: "Harbour" } }),
    );
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({
      status: "ready",
      canUndo: false,
      opening: false,
      error: null,
    });
    expect(snapshot.plan?.base.source).toBe(source.id);
    expect(snapshot.source).toMatchObject({
      width: 40,
      height: 20,
      metadata: { location: true, camera: true },
      keepable: { title: "Harbour" },
    });
    expect(events).toEqual([{ type: "open", outcome: "done", commands: [] }]);
  });

  it("refuses a file over maxFileSize before reading it, and keeps the document", async () => {
    const { session, engine } = setup({ filePolicy: { maxFileSize: 10 } });
    let probed = false;
    const probe = engine.probe;
    engine.probe = (f, o) => {
      probed = true;
      return probe(f, o);
    };
    const error = await rejection(session.open(await file()));
    expect(isImageError(error, "FILE_TOO_LARGE")).toBe(true);
    expect(probed).toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      status: "empty",
      error: { code: "FILE_TOO_LARGE" },
    });
  });

  it("refuses a file over its probe's limits before decoding it", async () => {
    const { session, engine } = setup({ filePolicy: { maxImagePixels: 799 } });
    let registered = false;
    const register = engine.register;
    engine.register = (...args) => {
      registered = true;
      return register(...args);
    };
    expect(isImageError(await rejection(session.open(await file())), "IMAGE_TOO_LARGE")).toBe(true);
    expect(registered).toBe(false);
    expect(engine.sources.size).toBe(0);
  });

  it("reports limits the file comes near as warnings", async () => {
    const { session } = setup({
      filePolicy: {
        maxImagePixels: { maximum: 1_000, warning: 500 },
        maxSessionSize: { maximum: 1e9, warning: 100 },
      },
    });
    await session.open(await file());
    expect(session.getSnapshot().warnings).toEqual(["maxImagePixels", "maxSessionSize"]);
  });

  it.each(["earlier first", "later first"] as const)(
    "lets the newest open win, whichever finishes %s, and releases the other's source",
    async (order) => {
      const engine = createFakeEngine();
      const { gated, gates } = gatedEngine(engine);
      const session = createImageSession({ engine: gated, processor: createFakeProcessor(engine) });
      // Handled at once: it's superseded before the test awaits it.
      const first = rejection(session.open(await file({ width: 10, height: 10 })));
      await settle();
      const second = session.open(await file({ width: 30, height: 30 }));
      await settle();
      expect(session.getSnapshot()).toMatchObject({ status: "opening", opening: true });
      const [earlier, later] = gates;
      if (order === "earlier first") {
        earlier?.open();
        await settle();
        later?.open();
      } else {
        later?.open();
        await settle();
        earlier?.open();
      }
      const firstError = await first;
      expect(isImageError(firstError, "ABORTED")).toBe(true);
      const winner = await second;
      await settle();
      expect(winner.width).toBe(30);
      expect(session.getSnapshot()).toMatchObject({
        status: "ready",
        source: { width: 30 },
        error: null,
      });
      // Only the winner's source is held.
      expect([...engine.sources.keys()]).toEqual([winner.id]);
    },
  );

  it("replaces the document on a new open: a new plan, an empty history, the old source released", async () => {
    const { session, engine } = setup();
    const first = await session.open(await file());
    session.execute({ type: "image.setDevelop", values: { exposure: 20 } });
    expect(session.getSnapshot().canUndo).toBe(true);
    const second = await session.open(await file({ width: 8, height: 8 }));
    await settle();
    expect(session.getSnapshot()).toMatchObject({
      canUndo: false,
      plan: { base: { source: second.id } },
    });
    expect(engine.sources.has(first.id)).toBe(false);
  });

  it("keeps the current document when a later open fails", async () => {
    const { session } = setup();
    const first = await session.open(await file());
    await rejection(session.open(await fakeEngineHarness.malformed()));
    expect(session.getSnapshot()).toMatchObject({
      status: "ready",
      source: { id: first.id },
      error: { code: "INVALID_IMAGE" },
    });
  });

  it("executes commands as undoable steps, and groups a gesture into one", async () => {
    const { session, events } = setup();
    await session.open(await file());
    session.execute({ type: "image.setDevelop", values: { exposure: 20 } });
    session.group(() => {
      session.execute({ type: "image.setCrop", crop: { x: 0, y: 0, width: 30, height: 20 } });
      session.execute({ type: "image.setCrop", crop: { x: 2, y: 0, width: 30, height: 20 } });
    });
    expect(session.getSnapshot().plan?.base.crop).toEqual({ x: 2, y: 0, width: 30, height: 20 });
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().plan?.base.crop).toBeNull();
    expect(session.getSnapshot().plan?.base.develop.exposure).toBe(20);
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().plan?.base.develop.exposure).toBe(0);
    expect(session.undo()).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.getSnapshot().plan?.base.develop.exposure).toBe(20);
    expect(events.map((e) => `${e.type}:${e.outcome}`)).toContain("undo:done");
  });

  it("applies a host's plan as one step of the commands that reach it", async () => {
    const { session, events } = setup();
    await session.open(await file());
    const start = session.getSnapshot().plan;
    if (!start) throw new Error("no plan");
    const target = {
      ...start,
      base: {
        ...start.base,
        crop: { x: 1, y: 2, width: 20, height: 10 },
        develop: { ...start.base.develop, exposure: 30 },
        filter: { preset: "mono" as const, strength: 40 },
      },
      metadata: { ...start.metadata, title: "Harbour" },
    };
    session.applyPlan(target);
    expect(session.getSnapshot().plan).toEqual(target);
    expect(events.at(-1)?.commands).toEqual([
      "image.setCrop",
      "image.setDevelop",
      "image.setFilter",
      "image.setMetadata",
    ]);
    // The same plan again changes nothing, and adds no step.
    const count = events.length;
    session.applyPlan(target);
    expect(events).toHaveLength(count);
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().plan).toEqual(start);
    expect(() =>
      session.applyPlan({ ...target, base: { ...target.base, source: "other" } }),
    ).toThrow();
    expect(() =>
      session.applyPlan({
        ...target,
        base: { ...target.base, develop: { ...target.base.develop, tint: 500 } },
      }),
    ).toThrow();
  });

  describe("an animation (docs/adr/0011)", () => {
    const delays = [10, 0, 25, 65_535, 7];
    /** A fake animation: five frames, and what the file says of them. */
    const animated = (
      animation: Partial<NonNullable<FakeImageFile["animation"]>> = {},
      size: { width: number; height: number } = { width: 40, height: 20 },
    ) =>
      encodeJson({
        magic: "FAKEIMG1",
        ...size,
        orientation: 1,
        pixels: storedPixels(size.width, size.height),
        metadata: NO_METADATA,
        keepable: EMPTY_KEEPABLE_METADATA,
        animation: { loop: 2, delays, ...animation },
      } satisfies FakeImageFile);
    const code = async (promise: Promise<unknown>) => {
      const error = (await rejection(promise)) as ImageError;
      return [error.code, error.details?.["reason"] ?? error.details?.["limit"]];
    };

    it("opens a file of several frames as an animation, with the file's timing", async () => {
      const { session, events } = setup();
      const source = await session.open(animated());
      expect(source).toMatchObject({ frames: 5, fileFrames: 5, incomplete: false });
      const { plan, warnings, progress } = session.getSnapshot();
      expect(plan?.animation).toEqual({
        loop: 2,
        frames: delays.map((delay, frame) => ({ key: `frame-${frame + 1}`, frame, delay })),
      });
      // Everything else is a new plan's.
      expect({ ...plan, animation: null }).toEqual(createPlan(source.id));
      expect(warnings).toEqual([]);
      expect(progress).toBeNull();
      expect(events.at(-1)).toMatchObject({ type: "open", outcome: "done" });
      // And nothing to undo: opening isn't an edit.
      expect(session.undo()).toBe(false);
    });

    it("says how far the check of its frames has got, while it opens", async () => {
      const { session } = setup();
      const seen: (number | null)[] = [];
      const stop = session.subscribe(() => {
        const { progress, opening } = session.getSnapshot();
        const done = progress?.done ?? null;
        if (opening && seen.at(-1) !== done) seen.push(done);
        if (progress) expect(progress.total).toBe(5);
      });
      await session.open(animated());
      stop();
      // Nothing until the first frame is checked, then each frame.
      expect(seen).toEqual([null, 1, 2, 3, 4, 5]);
      expect(session.getSnapshot().progress).toBeNull();
      // A still has none.
      const steps: unknown[] = [];
      const off = session.subscribe(() => steps.push(session.getSnapshot().progress));
      await session.open(await file());
      off();
      expect(steps.every((step) => step === null)).toBe(true);
    });

    it("offers the opening animation's first frame while the rest are checked", async () => {
      const { session } = setup();
      const seen: (string | null)[] = [];
      const stop = session.subscribe(() => {
        const { openingFrame, opening } = session.getSnapshot();
        const line = openingFrame
          ? `${openingFrame.source} ${openingFrame.width}x${openingFrame.height}`
          : null;
        if (opening && seen.at(-1) !== line) seen.push(line);
      });
      const source = await session.open(animated());
      stop();
      // Nothing before the first frame is ready; then the source being opened, at its size.
      expect(seen).toEqual([null, `${source.id} 40x20`]);
      // Gone once it's open: the document shows it now.
      expect(session.getSnapshot().openingFrame).toBeNull();
      // A still offers none.
      const still: (unknown | null)[] = [];
      const off = session.subscribe(() => still.push(session.getSnapshot().openingFrame));
      await session.open(await file());
      off();
      expect(still.every((frame) => frame === null)).toBe(true);
    });

    it("drops the first frame when the open is cancelled", async () => {
      const { session } = setup();
      const controller = new AbortController();
      const stop = session.subscribe(() => {
        if (session.getSnapshot().openingFrame) controller.abort();
      });
      await rejection(session.open(animated(), { signal: controller.signal }));
      stop();
      expect(session.getSnapshot()).toMatchObject({ openingFrame: null, opening: false });
    });

    it("ends at the frame before one that can't be decoded, and says the file was incomplete", async () => {
      const { session } = setup();
      const source = await session.open(animated({ decodes: 3 }));
      expect(source).toMatchObject({ frames: 3, fileFrames: 5, incomplete: true });
      expect(session.getSnapshot().plan?.animation?.frames.map((frame) => frame.delay)).toEqual([
        10, 0, 25,
      ]);
      // A file cut at its end, with every frame: all of them, and incomplete.
      const cut = await session.open(animated({ cut: true }));
      expect(cut).toMatchObject({ frames: 5, fileFrames: 5, incomplete: true });
      // Only its first frame: a still, that says so.
      const one = await session.open(animated({ decodes: 1 }));
      expect(one).toMatchObject({ frames: 1, fileFrames: 5, incomplete: true, timing: null });
      expect(session.getSnapshot().plan?.animation).toBeNull();
    });

    it("opens an animation over maxAnimationPixels as its first frame, never refusing it", async () => {
      // 40 × 20 is 800 pixels: over a limit of 500, and near one of 1,000.
      const { session, engine } = setup({
        filePolicy: { maxAnimationPixels: { maximum: 500, warning: 100 } },
      });
      const source = await session.open(animated());
      expect(source).toMatchObject({ frames: 1, fileFrames: 5, incomplete: false, timing: null });
      const snapshot = session.getSnapshot();
      expect(snapshot.plan).toEqual(createPlan(source.id));
      expect(snapshot.error).toBeNull();
      // The snapshot names the limit, so the editor can say why it's a still.
      expect(snapshot.warnings).toEqual(["maxAnimationPixels"]);
      // It's held as a still: one frame's pixels, not an animation's working set.
      expect(source.decodedBytes).toBe(40 * 20 * 4);
      expect(engine.sources.get(source.id)?.frames).toBe(1);
      // And it exports, as any still does.
      expect((await session.export({ type: "png" })).blob.size).toBeGreaterThan(0);

      // Near the limit, it's an animation, with a warning.
      const near = setup({ filePolicy: { maxAnimationPixels: { maximum: 1_000, warning: 100 } } });
      const held = await near.session.open(animated());
      expect(held.frames).toBe(5);
      expect(near.session.getSnapshot().warnings).toEqual(["maxAnimationPixels"]);
      // A still of the same size isn't an animation at all: no warning.
      await near.session.open(await file());
      expect(near.session.getSnapshot().warnings).toEqual([]);
    });

    it("opens an animation over maxFrames or maxDecodedSize as its first frame, never refusing it", async () => {
      // Five frames, over a limit of four.
      const frames = setup({ filePolicy: { maxFrames: { maximum: 4, warning: 2 } } });
      const source = await frames.session.open(animated());
      expect(source).toMatchObject({ frames: 1, fileFrames: 5, incomplete: false, timing: null });
      expect(frames.session.getSnapshot()).toMatchObject({
        error: null,
        warnings: ["maxFrames"],
        plan: createPlan(source.id),
      });
      expect(frames.engine.sources.get(source.id)?.frames).toBe(1);
      expect((await frames.session.export({ type: "png" })).blob.size).toBeGreaterThan(0);

      // Five frames of 40 × 20 could decode to 16,000 bytes: over 10,000, though one frame is 3,200.
      const decoded = setup({
        filePolicy: { maxDecodedSize: { maximum: 10_000, warning: 5_000 } },
      });
      const held = await decoded.session.open(animated());
      expect(held).toMatchObject({ frames: 1, fileFrames: 5 });
      expect(decoded.session.getSnapshot()).toMatchObject({
        error: null,
        warnings: ["maxDecodedSize"],
      });

      // Over two of them at once: both are named, once each.
      const both = setup({ filePolicy: { maxFrames: 4, maxAnimationPixels: 500 } });
      await both.session.open(animated());
      expect(both.session.getSnapshot().warnings).toEqual(["maxFrames", "maxAnimationPixels"]);

      // At the limits exactly, it's an animation.
      const at = setup({ filePolicy: { maxFrames: 5, maxDecodedSize: 16_000 } });
      expect((await at.session.open(animated())).frames).toBe(5);
    });

    it("still refuses a file whose first frame alone is over a limit", async () => {
      // One frame of 40 × 20 is 3,200 bytes and 800 pixels.
      const decoded = setup({ filePolicy: { maxDecodedSize: 3_000 } });
      expect(await code(decoded.session.open(animated()))).toEqual([
        "DECODED_SIZE_TOO_LARGE",
        "maxDecodedSize",
      ]);
      const pixels = setup({ filePolicy: { maxImagePixels: 700 } });
      expect(await code(pixels.session.open(animated()))).toEqual([
        "IMAGE_TOO_LARGE",
        "maxImagePixels",
      ]);
      expect(pixels.session.getSnapshot().status).toBe("empty");
    });

    it("adds an animation over its limits as a layer: its first frame", async () => {
      const { session } = setup({ filePolicy: { maxFrames: 4 } });
      await session.open(await file());
      const added = await session.insertImage(animated());
      expect(added).toMatchObject({ frames: 1, fileFrames: 5 });
      expect(session.getSnapshot().plan?.layers).toHaveLength(1);
    });

    it("opens every file as a still when the host asks for no animations", async () => {
      const { session, engine } = setup({ animations: false });
      const steps: unknown[] = [];
      const off = session.subscribe(() => steps.push(session.getSnapshot().progress));
      const source = await session.open(animated());
      off();
      expect(source).toMatchObject({ frames: 1, fileFrames: 5, incomplete: false, timing: null });
      const snapshot = session.getSnapshot();
      expect(snapshot.plan).toEqual(createPlan(source.id));
      // It's the host's choice, not a limit: nothing is warned, and no frames are checked.
      expect(snapshot.warnings).toEqual([]);
      expect(steps.every((step) => step === null)).toBe(true);
      expect(engine.sources.get(source.id)?.frames).toBe(1);
      expect(source.decodedBytes).toBe(40 * 20 * 4);
      // Even one the limit would refuse as an animation: the limit isn't asked.
      const small = setup({
        animations: false,
        filePolicy: { maxAnimationPixels: { maximum: 500, warning: 100 } },
      });
      await small.session.open(animated());
      expect(small.session.getSnapshot().warnings).toEqual([]);
      // And frame commands are refused, as for any still.
      expect(() => session.execute({ type: "image.reverseFrames" })).toThrow();
      // Asked for explicitly, or not said, animations open.
      for (const options of [{ animations: true }, {}]) {
        const other = setup(options);
        expect((await other.session.open(animated())).frames).toBe(5);
      }
    });

    it("can be cancelled while its frames are checked, and keeps the document that was open", async () => {
      const { session, engine } = setup();
      const first = await session.open(await file());
      const before = session.getSnapshot().plan;
      const controller = new AbortController();
      const stop = session.subscribe(() => {
        if (session.getSnapshot().progress?.done === 2) controller.abort();
      });
      const error = await rejection(session.open(animated(), { signal: controller.signal }));
      stop();
      expect(isImageError(error, "ABORTED")).toBe(true);
      const snapshot = session.getSnapshot();
      expect(snapshot).toMatchObject({ opening: false, progress: null, error: null });
      expect(snapshot.source?.id).toBe(first.id);
      expect(snapshot.plan).toBe(before);
      // Only the document's source is held.
      expect([...engine.sources.keys()]).toEqual([first.id]);
    });

    it("counts what an animation holds against maxSessionSize, and keeps the open document if it's too much", async () => {
      // A still of 40 × 20 holds 3,200 bytes; the fake's animation of five holds seven times that.
      const { session, engine } = setup({ filePolicy: { maxSessionSize: 10_000 } });
      const first = await session.open(await file());
      expect(await code(session.open(animated()))).toEqual(["SESSION_TOO_LARGE", "maxSessionSize"]);
      expect(session.getSnapshot().source?.id).toBe(first.id);
      expect([...engine.sources.keys()]).toEqual([first.id]);
    });

    it("edits the frames, undoes each step, and exports the frame asked for", async () => {
      const { session } = setup();
      await session.open(animated());
      const keys = () => session.getSnapshot().plan?.animation?.frames.map((frame) => frame.key);
      session.execute({ type: "image.removeFrames", keys: ["frame-2", "frame-4"] });
      expect(keys()).toEqual(["frame-1", "frame-3", "frame-5"]);
      session.execute({ type: "image.reverseFrames" });
      session.execute({
        type: "image.insertFrames",
        at: 0,
        frames: [{ key: "again", frame: 3, delay: 1 }],
      });
      expect(keys()).toEqual(["again", "frame-5", "frame-3", "frame-1"]);
      // A frame the source doesn't have is refused: the source holds five.
      expect(() =>
        session.execute({
          type: "image.insertFrames",
          at: 0,
          frames: [{ key: "none", frame: 5, delay: 1 }],
        }),
      ).toThrow(/no frame 5/);
      expect((await session.export({ type: "png" }, { frame: 3 })).blob.size).toBeGreaterThan(0);
      await expect(session.export({ type: "png" }, { frame: 4 })).rejects.toBeDefined();
      expect(session.undo()).toBe(true);
      expect(session.undo()).toBe(true);
      expect(session.undo()).toBe(true);
      expect(keys()).toEqual(["frame-1", "frame-2", "frame-3", "frame-4", "frame-5"]);
      expect(session.undo()).toBe(false);
    });

    it("reports no kept fields for a GIF or a WebP, which carry none", async () => {
      const { session } = setup();
      await session.open(animated());
      session.execute({ type: "image.setMetadata", field: "title", value: "Party" });
      expect((await session.export({ type: "png" })).kept).toEqual(["title"]);
      expect((await session.export({ type: "gif" })).kept).toEqual([]);
      // Nor for a WebP, which carries none either.
      expect((await session.export({ type: "webp" })).kept).toEqual([]);
      expect((await session.export({ type: "jpeg" })).kept).toEqual(["title"]);
    });

    it("holds the frames a command adds to maxFrames, and lets a plan over it be trimmed", async () => {
      const { session } = setup({ filePolicy: { maxFrames: 6 } });
      await session.open(animated());
      const add = (...names: string[]) =>
        session.execute({
          type: "image.insertFrames",
          at: 0,
          frames: names.map((key) => ({ key, frame: 0, delay: 1 })),
        });
      add("a");
      let refused: unknown;
      try {
        add("b");
      } catch (error) {
        refused = error;
      }
      expect(isImageError(refused, "TOO_MANY_FRAMES")).toBe(true);
      expect(session.getSnapshot().plan?.animation?.frames).toHaveLength(6);
      // Removing, reordering and timing aren't adding: they're allowed at the limit.
      session.execute({ type: "image.reverseFrames" });
      session.execute({ type: "image.removeFrames", keys: ["a"] });
      expect(session.getSnapshot().plan?.animation?.frames).toHaveLength(5);
    });

    it("applies a host's animation as one step: frames added, removed, reordered and retimed", async () => {
      const { session, events } = setup();
      await session.open(animated());
      const start = session.getSnapshot().plan;
      if (!start?.animation) throw new Error("no animation");
      const [one, two, three, four, five] = start.animation.frames as [
        ImageFrame,
        ImageFrame,
        ImageFrame,
        ImageFrame,
        ImageFrame,
      ];
      const targets: ImageAnimation[] = [
        // Retimed, and the loop changed.
        { loop: null, frames: start.animation.frames.map((frame) => ({ ...frame, delay: 4 })) },
        // Trimmed and reordered.
        { loop: 2, frames: [five, two] },
        // Every frame replaced by new ones.
        {
          loop: 2,
          frames: [
            { key: "x", frame: 4, delay: 1 },
            { key: "y", frame: 0, delay: 2 },
          ],
        },
        // Some kept, some new, in another order, one retimed.
        { loop: 0, frames: [{ key: "n", frame: 2, delay: 9 }, four, { ...one, delay: 99 }, three] },
        // One frame left.
        { loop: 2, frames: [three] },
      ];
      for (const animation of targets) {
        const count = events.length;
        session.applyPlan({ ...start, animation });
        expect(session.getSnapshot().plan?.animation).toEqual(animation);
        // One step, whatever changed: one event, and one undo back to the start.
        expect(events.length - count).toBe(1);
        expect(session.undo()).toBe(true);
        expect(session.getSnapshot().plan).toEqual(start);
      }
      // The same animation again changes nothing.
      const count = events.length;
      session.applyPlan(start);
      expect(events).toHaveLength(count);
    });

    it("refuses a host plan no command can reach, and changes nothing", async () => {
      const { session } = setup();
      await session.open(animated());
      const start = session.getSnapshot().plan;
      if (!start?.animation) throw new Error("no animation");
      const refused = (next: ImagePlan) => {
        try {
          session.applyPlan(next);
        } catch (error) {
          return [(error as ImageError).code, (error as ImageError).details?.["reason"]];
        }
        throw new Error("expected a refusal");
      };
      // An animation can't become a still.
      expect(refused({ ...start, animation: null })).toEqual(["INVALID_COMMAND", "no-frames"]);
      // A frame can't show another frame of the source under the same key.
      expect(
        refused({
          ...start,
          animation: {
            ...start.animation,
            frames: start.animation.frames.map((frame, index) =>
              index === 0 ? { ...frame, frame: 3 } : frame,
            ),
          },
        }),
      ).toEqual(["INVALID_COMMAND", "duplicate-key"]);
      // A frame the source doesn't have.
      expect(
        refused({
          ...start,
          animation: {
            ...start.animation,
            frames: [...start.animation.frames, { key: "z", frame: 9, delay: 1 }],
          },
        }),
      ).toEqual(["INVALID_COMMAND", "invalid-frame"]);
      expect(session.getSnapshot().plan).toEqual(start);
      expect(session.undo()).toBe(false);
    });
  });

  it("refuses frame commands and a host's animation for a still (docs/adr/0011)", async () => {
    const { session } = setup();
    await session.open(await file());
    const start = session.getSnapshot().plan;
    if (!start) throw new Error("no plan");
    expect(start.animation).toBeNull();
    const refused = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return [(error as ImageError).code, (error as ImageError).details?.["reason"]];
      }
      throw new Error("expected a refusal");
    };
    expect(refused(() => session.execute({ type: "image.setLoop", loop: 0 }))).toEqual([
      "INVALID_COMMAND",
      "not-animated",
    ]);
    expect(refused(() => session.execute({ type: "image.reverseFrames" }))).toEqual([
      "INVALID_COMMAND",
      "not-animated",
    ]);
    expect(
      refused(() =>
        session.applyPlan({
          ...start,
          animation: { loop: 0, frames: [{ key: "f", frame: 0, delay: 10 }] },
        }),
      ),
    ).toEqual(["INVALID_COMMAND", "not-animated"]);
    // Nothing changed, and nothing can be undone.
    expect(session.getSnapshot().plan).toEqual(start);
    expect(session.undo()).toBe(false);
  });

  it("applies a host's redactions as one step, and refuses a plan from before they existed", async () => {
    const { session, events } = setup();
    await session.open(await file());
    const start = session.getSnapshot().plan;
    if (!start) throw new Error("no plan");
    const first = {
      key: "a",
      mode: "solid",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      colour: "#000000",
    } as const;
    const second = { key: "b", mode: "pixelate", x: 2, y: 2, width: 4, height: 4 } as const;
    session.applyPlan({ ...start, redactions: [first] });
    expect(events.at(-1)?.commands).toEqual(["image.insertRedactions"]);
    session.applyPlan({ ...start, redactions: [second, first] });
    expect(events.at(-1)?.commands).toEqual(["image.removeRedactions", "image.insertRedactions"]);
    expect(session.getSnapshot().plan?.redactions).toEqual([second, first]);
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().plan?.redactions).toEqual([first]);
    session.applyPlan(start);
    expect(session.getSnapshot().plan?.redactions).toEqual([]);

    // A plan stored before format version 2 has no lists. It isn't read as
    // a plan without redactions: the host migrates it with the reader.
    const { layers: _layers, redactions: _redactions, animation: _animation, ...old } = start;
    const before = session.getSnapshot().plan;
    expect(() => session.applyPlan(old as ImagePlan)).toThrow(/createPlan/);
    expect(session.getSnapshot().plan).toBe(before);
  });

  it("checks maxLayers when a step adds redactions, and never when it removes them", async () => {
    const { session } = setup({ filePolicy: { maxLayers: 2 } });
    await session.open(await file());
    const redaction = (key: string) =>
      ({ key, mode: "pixelate", x: 0, y: 0, width: 2, height: 2 }) as const;
    session.execute({
      type: "image.insertRedactions",
      at: 0,
      redactions: [redaction("a"), redaction("b")],
    });
    let error: unknown;
    try {
      session.execute({ type: "image.insertRedactions", at: 0, redactions: [redaction("c")] });
    } catch (reason) {
      error = reason;
    }
    expect(isImageError(error, "TOO_MANY_LAYERS")).toBe(true);
    expect(session.getSnapshot().plan?.redactions).toHaveLength(2);
    session.execute({ type: "image.removeRedactions", keys: ["a"] });
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().plan?.redactions).toHaveLength(2);
  });

  it("limits the points a plan's drawings hold, warns near the limit, and follows undo", async () => {
    const { session } = setup({ filePolicy: { maxDrawingPoints: { maximum: 10, warning: 6 } } });
    await session.open(await file());
    const stroke = (points: number) => ({
      colour: "#000000",
      width: 1,
      runs: [Array.from({ length: points }, (_, i) => [i, 0]).flat()],
    });
    const drawing = (key: string, points: number) => ({
      key,
      kind: "drawing" as const,
      name: "",
      visible: true,
      opacity: 100,
      x: 0,
      y: 0,
      strokes: [stroke(points)],
    });
    const warnings = () => session.getSnapshot().warnings;
    session.execute({ type: "image.insertLayers", at: 0, layers: [drawing("d", 5)] });
    expect(warnings()).not.toContain("maxDrawingPoints");
    // Six points: at the warning.
    session.execute({ type: "image.addStrokes", key: "d", strokes: [stroke(1)] });
    expect(warnings()).toContain("maxDrawingPoints");
    // Eleven would be over: refused with the limit's own code, and nothing changes.
    const before = session.getSnapshot().plan;
    const over = await rejection(
      (async () => session.execute({ type: "image.addStrokes", key: "d", strokes: [stroke(5)] }))(),
    );
    expect(isImageError(over, "TOO_MANY_POINTS")).toBe(true);
    expect((over as { details?: unknown }).details).toMatchObject({
      limit: "maxDrawingPoints",
      maximum: 10,
      actual: 11,
    });
    expect(session.getSnapshot().plan).toBe(before);
    // A second drawing counts with the first.
    const another = await rejection(
      (async () =>
        session.execute({ type: "image.insertLayers", at: 0, layers: [drawing("e", 5)] }))(),
    );
    expect(isImageError(another, "TOO_MANY_POINTS")).toBe(true);
    // Removing a stroke, and undoing the addition, end the warning; redo brings it back.
    session.undo();
    expect(warnings()).not.toContain("maxDrawingPoints");
    session.redo();
    expect(warnings()).toContain("maxDrawingPoints");
    session.execute({ type: "image.removeStrokes", key: "d", indexes: [1] });
    expect(warnings()).not.toContain("maxDrawingPoints");
    // A step that adds no points is never checked: other edits still work at the limit.
    session.execute({ type: "image.addStrokes", key: "d", strokes: [stroke(5)] });
    session.execute({ type: "image.updateLayers", updates: [{ key: "d", props: { x: 3 } }] });
    expect(session.getSnapshot().plan?.layers[0]).toMatchObject({ x: 3 });
  });

  it("bounds the drawn points its history holds, dropping the oldest steps", async () => {
    const { session } = setup();
    await session.open(await file());
    // 76 runs of 2,000 points are two strokes of 38: 152,000 points, under the plan's 200,000.
    const run = Array.from({ length: 2_000 }, (_, i) => [i % 30, i % 20]).flat();
    const stroke = { colour: "#000000", width: 1, runs: Array.from({ length: 38 }, () => run) };
    const drawing = (key: string) => ({
      key,
      kind: "drawing" as const,
      name: "",
      visible: true,
      opacity: 100,
      x: 0,
      y: 0,
      strokes: [stroke, stroke],
    });
    // Each step holds the drawing's 152,000 points: in its command, or in what undoes it.
    session.execute({
      type: "image.setOrientation",
      orientation: { rotate: 90, flipX: false, flipY: false },
    });
    for (let round = 0; round < 3; round += 1) {
      session.execute({ type: "image.insertLayers", at: 0, layers: [drawing(`d${round}`)] });
      session.execute({ type: "image.removeLayers", keys: [`d${round}`] });
    }
    // Six steps of 152,000 are 912,000: under a million, and nothing is dropped.
    expect(session.getSnapshot().historyTrimmed).toBe(false);
    session.execute({ type: "image.insertLayers", at: 0, layers: [drawing("last")] });
    // The seventh takes it over: the oldest steps go, the newest stays.
    expect(session.getSnapshot().historyTrimmed).toBe(true);
    expect(session.getSnapshot().plan?.layers).toHaveLength(1);
    let undone = 0;
    while (session.undo()) undone += 1;
    // What's left holds at most a million points: six steps of 152,000.
    expect(undone).toBe(6);
    // The first edit, which held no points, went with the oldest.
    expect(session.getSnapshot().plan?.base.orientation.rotate).toBe(90);
  });

  it("applies layers as undoable steps, counts them with redactions, and refuses to export what nothing draws", async () => {
    const { session, events } = setup({ filePolicy: { maxLayers: 2 } });
    await session.open(await file());
    const start = session.getSnapshot().plan;
    const source = session.getSnapshot().source;
    if (!start || !source) throw new Error("no plan");
    const box = {
      name: "",
      visible: true,
      opacity: 100,
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      rotation: 0,
      flipX: false,
    };
    const caption = {
      ...box,
      key: "caption",
      kind: "text",
      text: "Hi",
      font: "serif",
      bold: false,
      colour: "#000000",
      align: "start",
    } as const;
    // An image layer may draw the open image itself: its source is registered.
    const inset = { ...box, key: "inset", kind: "image", source: source.id, crop: null } as const;
    session.execute({ type: "image.insertLayers", at: 0, layers: [caption] });
    session.execute({
      type: "image.insertRedactions",
      at: 0,
      redactions: [{ key: "r", mode: "pixelate", x: 0, y: 0, width: 2, height: 2 }],
    });
    // Two items is the limit here, whichever lists they're in.
    let error: unknown;
    try {
      session.execute({ type: "image.insertLayers", at: 1, layers: [inset] });
    } catch (reason) {
      error = reason;
    }
    expect(isImageError(error, "TOO_MANY_LAYERS")).toBe(true);
    expect(session.getSnapshot().plan?.layers).toEqual([caption]);

    // A host's plan replaces the list as one step.
    session.applyPlan({ ...start, layers: [inset] });
    expect(events.at(-1)?.commands).toEqual([
      "image.removeLayers",
      "image.insertLayers",
      "image.removeRedactions",
    ]);
    expect(session.getSnapshot().plan?.layers).toEqual([inset]);
    expect(session.undo()).toBe(true);
    expect(session.getSnapshot().plan?.layers).toEqual([caption]);
    expect(session.getSnapshot().plan?.redactions).toHaveLength(1);

    // An image layer of a source the session doesn't hold is refused.
    expect(() =>
      session.execute({
        type: "image.updateLayers",
        updates: [{ key: "caption", props: { text: "\u202E" } }],
      }),
    ).toThrow();
    expect(() =>
      session.execute({
        type: "image.insertLayers",
        at: 0,
        layers: [{ ...inset, key: "other", source: "another-file" }],
      }),
    ).toThrow();

    // Until a renderer draws layers, nothing is exported without them (ADR 0009).
    const failure = await session.export({ type: "png" }).catch((reason: unknown) => reason);
    expect(isImageError(failure, "UNSUPPORTED_PLAN")).toBe(true);
    expect((failure as { details?: unknown }).details).toEqual({ reason: "layers" });
  });

  it("exports a plan with redactions", async () => {
    const { session } = setup();
    await session.open(await file());
    session.execute({
      type: "image.insertRedactions",
      at: 0,
      redactions: [{ key: "a", mode: "solid", x: 0, y: 0, width: 2, height: 2, colour: "#000000" }],
    });
    const { blob } = await session.export({ type: "png" });
    expect(blob.size).toBeGreaterThan(0);
  });

  it("rejects an invalid command and changes nothing", async () => {
    const { session, events } = setup();
    expect(() => session.execute({ type: "image.setDevelop", values: { exposure: 5 } })).toThrow();
    await session.open(await file());
    const before = session.getSnapshot().plan;
    expect(() =>
      session.execute({ type: "image.setDevelop", values: { exposure: 500 } }),
    ).toThrow();
    expect(session.getSnapshot()).toMatchObject({
      plan: before,
      canUndo: false,
      error: { code: "INVALID_COMMAND" },
    });
    expect(events.at(-1)).toEqual({
      type: "execute",
      outcome: "failed",
      commands: ["image.setDevelop"],
    });
  });

  it("exports with a summary of what was removed and what was kept", async () => {
    const { session } = setup();
    await session.open(
      await file({ metadata: { location: true, timestamps: true, colourProfile: true } }),
    );
    session.execute([
      { type: "image.setOutput", output: { kind: "scale", scale: 0.5 } },
      { type: "image.setMetadata", field: "title", value: "Harbour" },
    ]);
    const result = await session.export({ type: "png" });
    expect(result).toMatchObject({
      width: 20,
      height: 10,
      removed: ["location", "timestamps", "colourProfile"],
      kept: ["title"],
    });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(session.getSnapshot().exporting).toBe(false);
  });

  it("rejects an export that finishes after another file was opened", async () => {
    const engine = createFakeEngine();
    const processor = createFakeProcessor(engine);
    const exportGate = gate();
    const gatedProcessor: ImageProcessor = {
      destroy: () => processor.destroy(),
      async export(job, o) {
        const blob = await processor.export(job, o);
        await exportGate.opened;
        return blob;
      },
    };
    const session = createImageSession({ engine, processor: gatedProcessor });
    await session.open(await file());
    const exporting = session.export({ type: "png" });
    await settle();
    await session.open(await file({ width: 8, height: 8 }));
    exportGate.open();
    const error = await rejection(exporting);
    expect(isImageError(error, "ABORTED")).toBe(true);
    expect(session.getSnapshot().error).toBeNull();
  });

  it("never puts names, values or metadata in events", async () => {
    const { session, events } = setup();
    await session.open(await file({ keepable: { title: "Private title" } }));
    session.execute({ type: "image.setMetadata", field: "artist", value: "Private name" });
    await session.export({ type: "png" });
    const text = JSON.stringify(events);
    expect(text).not.toContain("Private");
    for (const event of events)
      expect(Object.keys(event).sort()).toEqual(["commands", "outcome", "type"]);
  });

  it("releases its source when destroyed, and refuses later calls", async () => {
    const { session, engine } = setup();
    const source = await session.open(await file());
    await session.destroy();
    expect(engine.sources.has(source.id)).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ status: "empty", plan: null });
    await expect(session.open(await file())).rejects.toThrow();
    expect(() => session.undo()).toThrow();
  });
});
