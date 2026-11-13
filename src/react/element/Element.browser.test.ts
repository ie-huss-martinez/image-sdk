import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import type { ImagePlan } from "../../core/model/plan.js";
import { defineImageEditorElement } from "../../element.js";
import type { ImageEditorElementMethods, ImageEditorElementProps } from "./mount.js";

type Editor = HTMLElement & Partial<ImageEditorElementProps> & ImageEditorElementMethods;

let unloadStyles: () => void = () => {};
beforeAll(async () => {
  unloadStyles = await loadStyles();
});
afterAll(() => unloadStyles());

const editors: HTMLElement[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A PNG with a name, which no event may carry. */
async function photo(width = 30, height = 20): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")?.fillRect(0, 0, width, height);
  return new File([await canvas.convertToBlob()], "private-holiday.png", { type: "image/png" });
}

function create(attributes: Record<string, string> = {}): Editor {
  defineImageEditorElement();
  const editor = document.createElement("hm-image-editor") as Editor;
  for (const [name, value] of Object.entries(attributes)) editor.setAttribute(name, value);
  editor.style.width = "900px";
  editor.style.height = "600px";
  editors.push(editor);
  return editor;
}

/** Every event's detail, by name, as JSON: what a host could send anywhere. */
function record(editor: HTMLElement) {
  const events: { name: string; detail: unknown; json: string }[] = [];
  for (const name of ["change", "event", "export", "error"]) {
    editor.addEventListener(`hm-image-editor-${name}`, (event) => {
      const { detail } = event as CustomEvent;
      events.push({ name, detail, json: JSON.stringify(detail) });
    });
  }
  return events;
}

const button = (editor: HTMLElement, tool: string) =>
  editor.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`);
const preview = (editor: HTMLElement) =>
  editor.querySelector("canvas")?.getAttribute("aria-label") ?? "";

describe("<hm-image-editor> (docs/adr/0007, sdk-core ADR 0040)", () => {
  it("registers once, and renders the editor into its light DOM", async () => {
    const Class = defineImageEditorElement();
    expect(defineImageEditorElement()).toBe(Class);
    expect(customElements.get("hm-image-editor")).toBe(Class);
    const editor = create();
    document.body.append(editor);
    await until(() => editor.querySelector("section") !== null, "the editor");
    expect(editor.shadowRoot).toBeNull();
    // The package's stylesheet makes it a block, which the host sizes.
    expect(getComputedStyle(editor).display).toBe("block");
    expect(editor.querySelector("section")?.getAttribute("aria-label")).toBe("Image editor");
  });

  it("opens its file property, fires change with the plan, and forwards the handle's methods", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = await photo();
    await until(() => preview(editor) === "Edited image preview, 30 × 20", "the open");
    expect(events.some((event) => event.name === "change")).toBe(true);

    editor.execute({
      type: "image.setOrientation",
      orientation: { rotate: 90, flipX: false, flipY: false },
    });
    const last = events.filter((event) => event.name === "change").at(-1)?.detail as ImagePlan;
    expect(last.base.orientation.rotate).toBe(90);
    await until(() => preview(editor) === "Edited image preview, 20 × 30", "the rotation");
    editor.undo();
    await until(() => preview(editor) === "Edited image preview, 30 × 20", "the undo");
    editor.redo();
    await until(() => preview(editor) === "Edited image preview, 20 × 30", "the redo");

    const exported = await editor.export({ type: "png" });
    expect(exported).toMatchObject({ width: 20, height: 30 });
    expect(exported.blob.type).toBe("image/png");

    // A host's usage events: anonymous, and never the file's name.
    expect(events.some((event) => event.name === "event")).toBe(true);
    for (const event of events) expect(event.json).not.toContain("private-holiday");
  });

  it("opens through open() as soon as it's connected, before its first render", async () => {
    const editor = create();
    document.body.append(editor);
    await editor.open(await photo(12, 8));
    await until(() => preview(editor) === "Edited image preview, 12 × 8", "the open");
  });

  it("takes theme, locale and tools from attributes, and follows their changes", async () => {
    const editor = create({ theme: "dark", tools: "image.undo image.redo" });
    document.body.append(editor);
    await until(() => editor.querySelector("section") !== null, "the editor");
    expect(editor.getAttribute("data-hm-theme")).toBe("dark");
    expect(button(editor, "image.undo")).not.toBeNull();
    expect(button(editor, "image.rotate-left")).toBeNull();

    editor.setAttribute("theme", "light");
    editor.setAttribute("tools", "image.rotate-left");
    await until(() => button(editor, "image.rotate-left") !== null, "the new tools");
    expect(editor.getAttribute("data-hm-theme")).toBe("light");
    expect(button(editor, "image.undo")).toBeNull();
    editor.removeAttribute("theme");
    await until(() => !editor.hasAttribute("data-hm-theme"), "the inherited theme");
  });

  it("fires error with the code and no name, for a file it can't open", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = new File([new Uint8Array([1, 2, 3, 4])], "private-holiday.png", {
      type: "image/png",
    });
    await until(() => events.some((event) => event.name === "error"), "the error");
    const error = events.find((event) => event.name === "error")?.detail as { code: string };
    expect(error.code).toMatch(/^[A-Z_]+$/);
    for (const event of events) expect(event.json).not.toContain("private-holiday");
  });

  it("fires export after the dialog's export, with a report and no file", async () => {
    const editor = create();
    const events = record(editor);
    document.body.append(editor);
    editor.file = await photo();
    await until(() => preview(editor) === "Edited image preview, 30 × 20", "the open");
    button(editor, "image.export")?.click();
    await until(() => editor.querySelector("dialog[open]") !== null, "the dialog");
    const confirm = [...editor.querySelectorAll<HTMLButtonElement>("dialog button")].find(
      (element) => element.textContent === "Export",
    );
    confirm?.click();
    await until(() => events.some((event) => event.name === "export"), "the export event");
    const report = events.find((event) => event.name === "export");
    if (!report) throw new Error("no export event");
    expect(report.detail).toMatchObject({
      format: "png",
      width: 30,
      height: 20,
      removed: [],
      kept: [],
    });
    expect((report.detail as { size: number }).size).toBeGreaterThan(0);
    expect(Object.values(report.detail as object).some((value) => value instanceof Blob)).toBe(
      false,
    );
  });

  it("keeps the editor across a move, and tears it down when removed", async () => {
    const editor = create();
    document.body.append(editor);
    editor.file = await photo();
    await until(() => preview(editor) === "Edited image preview, 30 × 20", "the open");
    const canvas = editor.querySelector("canvas");
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    elsewhere.append(editor);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.querySelector("canvas")).toBe(canvas);

    editor.remove();
    elsewhere.remove();
    await until(() => editor.childElementCount === 0, "the teardown");
    expect(() => editor.undo()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
  });
});
