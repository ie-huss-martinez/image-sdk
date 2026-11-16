import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import TerminalWorker from "../../../test/browser/fixtures/terminal.worker.ts?worker";
import { loadStyles } from "../../../test/browser/styles.js";
import { ControlledWorker } from "../../../test/fakes/controlled-worker.js";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { createEngine, engineInternals } from "../../adapters/image-engine.js";
import {
  defineImageEditorElement,
  type ImageEditorElementMethods,
  type ImageEditorElementProps,
} from "../../element.js";
import { ImageEditorProvider } from "../ImageEditorProvider.js";
import { ImageStage } from "../stage/ImageStage.js";
import { ImageEditor } from "./ImageEditor.js";
import type { ImageEditorHandle } from "./types.js";

let unload = () => {};
beforeAll(async () => {
  unload = await loadStyles();
});
afterAll(() => unload());
let root: Root | undefined;
const hosts: HTMLElement[] = [];
const engines: ReturnType<typeof createEngine>[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  for (const host of hosts.splice(0)) host.remove();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  for (const engine of engines.splice(0)) await engine.destroy();
});
function host() {
  const element = document.createElement("div");
  element.style.width = "640px";
  element.style.height = "480px";
  document.body.append(element);
  hosts.push(element);
  return element;
}
async function until(condition: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(condition()).toBe(true);
}
async function photo() {
  const canvas = new OffscreenCanvas(4, 2);
  canvas.getContext("2d")?.fillRect(0, 0, 4, 2);
  return canvas.convertToBlob();
}
function engine(failFirst = false) {
  let fail = failFirst;
  const failures: ControlledWorker[] = [];
  const workers: Worker[] = [];
  const rendered = new Set<number>();
  const attached = new Set<number>();
  const engine = createEngine({
    version: __IMAGE_SDK_VERSION__,
    loadWorker: async () => () => {
      if (fail) {
        fail = false;
        const wrong = new ControlledWorker("wrong-version");
        failures.push(wrong);
        return wrong;
      }
      const worker = new TerminalWorker();
      workers.push(worker);
      const calls = new Map<number, string>();
      const post = worker.postMessage.bind(worker);
      worker.postMessage = ((message: Record<string, unknown>, transfer: Transferable[]) => {
        if (typeof message["method"] === "string")
          calls.set(message["id"] as number, message["method"]);
        post(message, transfer);
      }) as Worker["postMessage"];
      worker.addEventListener("message", (event) => {
        if (event.data?.type === "result") {
          if (calls.get(event.data.id) === "render") rendered.add(workers.indexOf(worker));
          if (calls.get(event.data.id) === "attachCanvas") attached.add(workers.indexOf(worker));
        }
      });
      return worker;
    },
  });
  engines.push(engine);
  return { engine, workers, rendered, attached, failures };
}
const alert = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".hm-image-engine-unavailable");
const unavailable = "Image processing stopped.";

async function mountEditor(value = engine(), props = {}) {
  const container = host();
  root = createRoot(container);
  const handle = createRef<ImageEditorHandle>();
  await act(async () =>
    root?.render(
      <StrictMode>
        <ImageEditor ref={handle} engine={value.engine} {...props} />
      </StrictMode>,
    ),
  );
  await act(async () => handle.current?.open(await photo()));
  await until(() => value.rendered.size === 1);
  return { ...value, container, handle };
}

describe("terminal editor surface (ADR 0008)", () => {
  it.each(["crop", "export"])(
    "replaces the %s surface, moves owned focus and renders one translated notice",
    async (mode) => {
      const value = await mountEditor(engine(), {
        messages: { "editor.engineUnavailable": "Processing stopped: reopen this editor." },
      });
      const button = value.container.querySelector<HTMLButtonElement>(
        `button[data-tool="image.${mode}"]`,
      );
      if (!button) throw new Error("no tool");
      await act(async () => {
        button.focus();
        button.click();
      });
      if (mode === "export") await until(() => !!value.container.querySelector("dialog[open]"));
      else await until(() => !!value.container.querySelector(".hm-image-crop-frame"));
      const active = document.activeElement;
      expect(value.container.contains(active)).toBe(true);
      value.workers[0]?.postMessage({ type: "test-crash" });
      await until(() => !!alert(value.container));
      await until(() => document.activeElement === alert(value.container));
      expect(alert(value.container)?.textContent).toBe("Processing stopped: reopen this editor.");
      expect(value.container.querySelectorAll(".hm-image-engine-unavailable")).toHaveLength(1);
      expect(
        value.container.querySelector("canvas,button,input,dialog,.hm-image-crop-frame"),
      ).toBeNull();
      expect(value.workers).toHaveLength(1);
      await expect(value.handle.current?.export({ type: "png" })).rejects.toMatchObject({
        code: "WORKER_TERMINATED",
        details: { reason: "engine-invalidated" },
      });
      expect(value.handle.current?.session.getSnapshot().plan).not.toBeNull();
    },
  );

  it("does not take focus from a host control", async () => {
    const value = await mountEditor();
    const external = document.createElement("button");
    external.textContent = "Host control";
    const outside = host();
    outside.append(external);
    external.focus();
    value.workers[0]?.postMessage({ type: "test-crash" });
    await until(() => !!alert(value.container));
    expect(document.activeElement).toBe(external);
    expect(alert(value.container)?.textContent).toContain(unavailable);
  });

  it("recreates a fresh engine, session and DOM canvas on an explicit remount", async () => {
    const value = await mountEditor();
    const before = value.container.querySelector("canvas");
    value.workers[0]?.postMessage({ type: "test-crash" });
    await until(() => !!alert(value.container));
    await act(async () => root?.unmount());
    root = undefined;
    const fresh = engine();
    const handle = createRef<ImageEditorHandle>();
    root = createRoot(value.container);
    await act(async () => root?.render(<ImageEditor ref={handle} engine={fresh.engine} />));
    await act(async () => handle.current?.open(await photo()));
    await until(() => fresh.rendered.size === 1);
    expect(value.container.querySelector("canvas")).not.toBe(before);
    expect(alert(value.container)).toBeNull();
    expect((await handle.current?.export({ type: "png" }))?.blob.size).toBeGreaterThan(0);
    expect(value.workers).toHaveLength(1);
  });

  it("also removes custom building-block layouts under the provider", async () => {
    const value = engine();
    const container = host();
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <ImageEditorProvider engine={value.engine}>
          <button type="button">Custom control</button>
          <ImageStage />
        </ImageEditorProvider>,
      ),
    );
    await until(() => value.workers.length === 1);
    // Canvas ownership is sufficient even before any image was opened.
    await until(() => value.attached.size === 1);
    value.workers[0]?.postMessage({ type: "test-crash" });
    await until(() => !!alert(container));
    expect(container.querySelector("button,canvas")).toBeNull();
  });

  it("does not impose lifecycle state on a host-injected adapter", async () => {
    const custom = createFakeEngine();
    const processor = createFakeProcessor(custom);
    const container = host();
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <ImageEditorProvider engine={custom} processor={processor}>
          <p>Custom layout</p>
        </ImageEditorProvider>,
      ),
    );
    expect(engineInternals(custom)).toBeUndefined();
    expect(alert(container)).toBeNull();
    expect(container.textContent).toContain("Custom layout");
    await act(async () => root?.unmount());
    root = undefined;
    await processor.destroy();
    await custom.destroy();
  });

  it("requires a new element instance and fresh engine for a working preview", async () => {
    defineImageEditorElement();
    const container = host();
    type Element = HTMLElement & ImageEditorElementProps & ImageEditorElementMethods;
    const old = engine();
    const element = document.createElement("hm-image-editor") as Element;
    element.engine = old.engine;
    container.append(element);
    await until(() => element.querySelector("section") !== null);
    await act(async () => element.open(await photo()));
    await until(() => old.rendered.size === 1);
    const canvas = element.querySelector("canvas");
    old.workers[0]?.postMessage({ type: "test-crash" });
    await until(() => !!alert(element));
    await expect(element.export({ type: "png" })).rejects.toMatchObject({
      code: "WORKER_TERMINATED",
    });
    element.remove();
    const fresh = engine();
    const replacement = document.createElement("hm-image-editor") as Element;
    replacement.engine = fresh.engine;
    container.append(replacement);
    await until(() => replacement.querySelector("section") !== null);
    await act(async () => replacement.open(await photo()));
    await until(() => fresh.rendered.size === 1);
    expect(replacement.querySelector("canvas")).not.toBe(canvas);
    expect(alert(replacement)).toBeNull();
  });
});

it("does not hand a failed export to the host or retain its download dialog", async () => {
  const onExport = vi.fn();
  const value = await mountEditor(engine(), { onExport });
  const exportButton = value.container.querySelector<HTMLButtonElement>(
    'button[data-tool="image.export"]',
  );
  await act(async () => exportButton?.click());
  await until(() => !!value.container.querySelector("dialog[open]"));
  value.workers[0]?.postMessage({ type: "test-crash-next-export" });
  const confirm = [...value.container.querySelectorAll<HTMLButtonElement>("dialog button")].find(
    (b) => b.textContent === "Export",
  );
  if (!confirm) throw new Error("no export confirmation");
  await act(async () => confirm.click());
  await until(() => !!alert(value.container));
  expect(onExport).not.toHaveBeenCalled();
  expect(value.container.querySelector("dialog,a[download],canvas")).toBeNull();
});

it("unsubscribes one shared-engine consumer without destroying or notifying another", async () => {
  const value = engine();
  const container = host();
  root = createRoot(container);
  const lifecycle = engineInternals(value.engine);
  if (!lifecycle) throw new Error("no lifecycle");
  const subscribe = lifecycle.subscribe;
  let active = 0;
  vi.spyOn(lifecycle, "subscribe").mockImplementation((listener) => {
    active += 1;
    const remove = subscribe(listener);
    let removed = false;
    return () => {
      if (!removed) {
        removed = true;
        active -= 1;
        remove();
      }
    };
  });
  await act(async () =>
    root?.render(
      <StrictMode>
        <ImageEditor key="first" engine={value.engine} />
        <ImageEditor key="second" engine={value.engine} />
      </StrictMode>,
    ),
  );
  await until(() => value.attached.size === 1 && active === 2);
  await act(async () =>
    root?.render(
      <StrictMode>
        <ImageEditor key="second" engine={value.engine} />
      </StrictMode>,
    ),
  );
  expect(active).toBe(1);
  expect(lifecycle.getSnapshot()).toBe(false);
  value.workers[0]?.postMessage({ type: "test-crash" });
  await until(() => !!alert(container));
  expect(container.querySelectorAll(".hm-image-engine-unavailable")).toHaveLength(1);
  await act(async () => root?.unmount());
  root = undefined;
  expect(active).toBe(0);
});

it("draws after an explicit open retries a pre-resource handshake failure", async () => {
  const value = engine(true);
  const container = host();
  root = createRoot(container);
  const handle = createRef<ImageEditorHandle>();
  await act(async () => root?.render(<ImageEditor ref={handle} engine={value.engine} />));
  await until(() => value.failures[0]?.terminated === 1);
  expect(engineInternals(value.engine)?.getSnapshot()).toBe(false);
  await act(async () => handle.current?.open(await photo()));
  await until(() => value.rendered.size === 1);
  expect(alert(container)).toBeNull();
  expect(value.workers).toHaveLength(1);
});
