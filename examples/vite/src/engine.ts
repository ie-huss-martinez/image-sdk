import { createImageEngine, isImageError } from "@hussmartinez/image-sdk";

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

declare global {
  interface Window {
    /** The hooks the end-to-end tests call. */
    imageSdk: {
      run(bytes: ArrayBuffer, selfHosted: boolean): Promise<EngineOutcome>;
      readonly violations: readonly string[];
    };
  }
}

window.imageSdk = { run: (bytes, selfHosted) => run(new Blob([bytes]), selfHosted), violations };

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
