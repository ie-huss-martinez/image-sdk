import { createWindowReader } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { createImageEngine } from "../../src/adapters/image-engine.js";
import { createImageProcessor } from "../../src/adapters/image-processor.js";
import { probeImage } from "../../src/adapters/probe/probe.js";
import { createImageSession } from "../../src/core/session/session.js";
import { concat, exif, pngChunk } from "../fixtures/image-writers.js";

describe("a session over the SDK's own engine and processor (ADR 0003)", () => {
  it("opens a photo, edits it, undoes, and exports a clean, upright file", async () => {
    const canvas = new OffscreenCanvas(30, 20);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D canvas");
    context.fillStyle = "#c08040";
    context.fillRect(0, 0, 30, 20);
    const stored = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    const at = 8 + 8 + 13 + 4;
    const file = new Blob([
      concat([
        stored.subarray(0, at),
        pngChunk("eXIf", exif({ orientation: 6, gps: true, make: "Camera Co" })),
        stored.subarray(at),
      ]).slice(),
    ]);

    const engine = createImageEngine();
    const session = createImageSession({ engine, processor: createImageProcessor(engine) });
    const source = await session.open(file);
    expect([source.width, source.height]).toEqual([20, 30]);
    expect(source.metadata).toMatchObject({ location: true, camera: true });

    session.execute({ type: "image.setCrop", crop: { x: 0, y: 0, width: 20, height: 20 } });
    session.execute({ type: "image.setFilter", filter: { preset: "mono", strength: 100 } });
    session.undo();
    const result = await session.export({ type: "jpeg", quality: 0.9 });
    expect(result).toMatchObject({
      width: 20,
      height: 20,
      removed: ["location", "camera"],
      kept: [],
    });
    const probe = await probeImage(createWindowReader(result.blob));
    expect(probe).toMatchObject({
      format: "jpeg",
      stored: { width: 20, height: 20 },
      orientation: 1,
      metadata: { location: false, camera: false },
    });
    await session.destroy();
    await engine.destroy();
  });

  it("adds a second image as a layer source in the worker, and releases it when nothing refers to it", async () => {
    const png = async (width: number, height: number, colour: string) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2D canvas");
      context.fillStyle = colour;
      context.fillRect(0, 0, width, height);
      return canvas.convertToBlob();
    };
    const engine = createImageEngine();
    const session = createImageSession({ engine, processor: createImageProcessor(engine) });
    const base = await session.open(await png(40, 30, "#204060"));
    const added = await session.insertImage(await png(16, 12, "#c08040"));
    expect([added.width, added.height]).toEqual([16, 12]);
    expect(session.getSnapshot().plan?.layers[0]).toMatchObject({
      kind: "image",
      source: added.id,
      x: 12,
      y: 9,
      width: 16,
      height: 12,
    });
    // Both are decoded in the worker: each gives a thumbnail of its own size.
    expect((await engine.thumbnail(base.id, 100)).width).toBe(40);
    expect((await engine.thumbnail(added.id, 100)).width).toBe(16);
    // A file that isn't an image is refused, and the document is unchanged.
    await expect(session.insertImage(new Blob(["not an image"]))).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
    });
    expect(session.getSnapshot().plan?.layers).toHaveLength(1);
    // Undone, then a new edit: nothing refers to it, and the worker lets it go.
    session.undo();
    session.execute({ type: "image.setDevelop", values: { exposure: 5 } });
    expect(session.getSnapshot().sources.map((source) => source.id)).toEqual([base.id]);
    await expect(engine.thumbnail(added.id, 100)).rejects.toThrow();
    expect((await engine.thumbnail(base.id, 100)).width).toBe(40);
    await session.destroy();
    await engine.destroy();
  });
});
