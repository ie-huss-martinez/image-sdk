import { describe, expect, it } from "vitest";
import type { TestImageSpec } from "../../../test/contracts/harness-types.js";
import { createFakeEngine, type FakeEngine } from "../../../test/fakes/fake-engine.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { fakeEngineHarness } from "../../../test/fakes/harness.js";
import { isImageError } from "../errors/image-error.js";
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
