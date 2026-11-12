import type { DecodeOutcome, FeatureOutcome, Request } from "./protocol.js";

/** How long a decode may take before the page stops waiting, as the engine will (sdk-core ADR 0031). */
const DECODE_TIMEOUT = 10_000;

/** Runs one request in a fresh worker, and ends the worker afterwards. */
function inWorker<T>(request: Request, timeout: number, onTimeout: T): Promise<T> {
  const worker = new Worker(new URL("./capabilities.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), timeout);
    worker.addEventListener("message", (event: MessageEvent<T>) => {
      clearTimeout(timer);
      resolve(event.data);
    });
    worker.postMessage(request, request.kind === "decode" ? [request.bytes] : []);
  }).finally(() => worker.terminate());
}

const decode = (bytes: ArrayBuffer) =>
  inWorker<DecodeOutcome>({ kind: "decode", bytes }, DECODE_TIMEOUT, { status: "timeout" });

const features = () =>
  inWorker<FeatureOutcome | undefined>({ kind: "features" }, 60_000, undefined);

declare global {
  interface Window {
    /** The hooks the end-to-end tests call. */
    imageCapabilities: {
      decode(bytes: ArrayBuffer): Promise<DecodeOutcome>;
      features(): Promise<FeatureOutcome | undefined>;
    };
  }
}

window.imageCapabilities = { decode, features };

const output = document.querySelector<HTMLOutputElement>("#result");
const input = document.querySelector<HTMLInputElement>("#file");
input?.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file || !output) return;
  output.value = "Decoding…";
  const outcome = await decode(await file.arrayBuffer());
  output.value =
    outcome.status === "decoded"
      ? `Decoded at ${outcome.width} × ${outcome.height}.`
      : `This browser couldn't decode it (${outcome.status}).`;
});
document.querySelector("#features")?.addEventListener("click", async () => {
  if (!output) return;
  output.value = "Measuring…";
  output.value = JSON.stringify(await features(), null, 2);
});
