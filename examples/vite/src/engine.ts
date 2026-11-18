import {
  createImageEngine,
  createImageProcessor,
  createPlan,
  isImageError,
} from "@hussmartinez/image-sdk";

/** What one run of the engine produced, for the page and the end-to-end tests. */
export interface EngineOutcome {
  /** `decoded`, or the `ImageError` code. */
  readonly status: string;
  readonly width?: number;
  readonly height?: number;
  /** The orientation the probe read. */
  readonly orientation?: number;
  readonly decodedBytes?: number;
  /** The centres of the source's four quadrants, as `[r, g, b, a]`, read back on the page. */
  readonly quadrants?: readonly (readonly number[])[];
}

/** The violations of this page's Content Security Policy. */
const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.violatedDirective} ${event.blockedURI}`);
});

function quadrantCentres(bitmap: ImageBitmap): number[][] {
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) return [];
  context.drawImage(bitmap, 0, 0);
  return [
    [width / 4, height / 4],
    [(3 * width) / 4, height / 4],
    [width / 4, (3 * height) / 4],
    [(3 * width) / 4, (3 * height) / 4],
  ].map(([x = 0, y = 0]) =>
    Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data),
  );
}

/** Probes and registers a file, as a host would, and reads the source back through a full-size thumbnail. */
async function run(file: Blob, selfHosted: boolean): Promise<EngineOutcome> {
  const engine = createImageEngine(selfHosted ? { assetsUrl: "/image-sdk/" } : {});
  try {
    const probe = await engine.probe(file);
    const source = await engine.register("source", file, probe, {
      signal: AbortSignal.timeout(10_000),
    });
    const thumbnail = await engine.thumbnail("source", Math.max(source.width, source.height));
    const quadrants = quadrantCentres(thumbnail as unknown as ImageBitmap);
    thumbnail.close();
    return {
      status: "decoded",
      width: source.width,
      height: source.height,
      orientation: probe.orientation,
      decodedBytes: source.decodedBytes,
      quadrants,
    };
  } catch (error) {
    return { status: isImageError(error) ? error.code : "error" };
  } finally {
    await engine.destroy();
  }
}

/** What exporting an animation to GIF produced, for the end-to-end tests. */
export interface GifOutcome {
  /** `exported`, or the `ImageError` code. */
  readonly status: string;
  readonly type?: string;
  /** The delays of the written file's frames, read back. */
  readonly delays?: readonly number[];
}

/** Opens an animated GIF with all its frames and exports it to GIF, as a host would (docs/adr/0011). */
async function exportGif(file: Blob, selfHosted: boolean): Promise<GifOutcome> {
  const engine = createImageEngine(selfHosted ? { assetsUrl: "/image-sdk/" } : {});
  const processor = createImageProcessor(engine);
  try {
    const source = await engine.register("source", file, await engine.probe(file), {
      frames: "all",
    });
    const delays = source.timing?.delays ?? [0];
    const plan = {
      ...createPlan("source"),
      animation: {
        loop: 0,
        frames: delays.map((delay, frame) => ({ key: `f${frame}`, frame, delay: delay + 1 })),
      },
    };
    const blob = await processor.export({ plan, format: { type: "gif" } });
    // Read back through the same engine, as any GIF is opened.
    const written = await engine.register("written", blob, await engine.probe(blob), {
      frames: "all",
    });
    return { status: "exported", type: blob.type, delays: written.timing?.delays ?? [] };
  } catch (error) {
    return { status: isImageError(error) ? error.code : "error" };
  } finally {
    await processor.destroy();
    await engine.destroy();
  }
}

declare global {
  interface Window {
    /** The hooks the end-to-end tests call. */
    imageSdk: {
      run(bytes: ArrayBuffer, selfHosted: boolean): Promise<EngineOutcome>;
      exportGif(bytes: ArrayBuffer, selfHosted: boolean): Promise<GifOutcome>;
      readonly violations: readonly string[];
    };
  }
}

window.imageSdk = {
  run: (bytes, selfHosted) => run(new Blob([bytes]), selfHosted),
  exportGif: (bytes, selfHosted) => exportGif(new Blob([bytes]), selfHosted),
  violations,
};

const input = document.querySelector<HTMLInputElement>("#file");
const selfHostedBox = document.querySelector<HTMLInputElement>("#self-hosted");
const output = document.querySelector<HTMLOutputElement>("#result");
input?.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file || !output) return;
  output.value = "Working…";
  const outcome = await run(file, selfHostedBox?.checked ?? false);
  output.value =
    outcome.status === "decoded"
      ? `Decoded upright at ${outcome.width} × ${outcome.height}.`
      : `Couldn't open it: ${outcome.status}.`;
});
