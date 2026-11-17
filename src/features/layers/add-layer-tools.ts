import { defineTool } from "@hussmartinez/sdk-core";
import { asImageError } from "../../core/errors/error-helpers.js";
import { isImageError } from "../../core/errors/image-error.js";
import type { ImageLayer, ImagePlan } from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";
import { NO_TOOL } from "../editor-state.js";
import { hasDocument, type ImageTool, type ImageToolContext } from "../tool-types.js";
import { insertOnTop, newArrowLayer, newShapeLayer, newTextLayer } from "./new-layer.js";

/**
 * Adds a layer over every other, as one step, and shows the layers with it
 * selected (docs/adr/0013). What the session refuses, such as a layer over
 * the limit, goes to the editor's state, which the stage shows.
 */
function add(
  { session, editor }: ImageToolContext,
  create: (plan: ImagePlan, source: ImageSize) => ImageLayer,
  edit = false,
): void {
  const { plan, source } = session.getSnapshot();
  if (!plan || !source) return;
  const layer = create(plan, source);
  try {
    session.execute(insertOnTop(plan, layer));
  } catch (reason) {
    const error = isImageError(reason) ? reason : asImageError(reason);
    editor.set((state) => ({ ...state, error }));
    return;
  }
  editor.set((state) => ({
    ...state,
    // One tool has the stage at a time.
    ...NO_TOOL,
    tool: "layers",
    preview: null,
    error: null,
    layers: edit ? { selected: layer.key, focus: "text" } : { selected: layer.key },
  }));
}

/**
 * Adds a text layer in the middle of the image, with no text yet, and moves
 * focus to its text field.
 */
export const addTextTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.add-text",
  label: "tools.add-text",
  icon: "text",
  group: "add",
  isEnabled: hasDocument,
  run: (context) => add(context, newTextLayer, true),
  shortcuts: ["T"],
});

/** Adds an outlined rectangle in the middle of the image. */
export const addRectangleTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.add-rectangle",
  label: "tools.add-rectangle",
  icon: "rectangle",
  group: "add",
  isEnabled: hasDocument,
  run: (context) => add(context, (plan, source) => newShapeLayer(plan, source, "rectangle")),
});

/** Adds an outlined ellipse in the middle of the image. */
export const addEllipseTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.add-ellipse",
  label: "tools.add-ellipse",
  icon: "ellipse",
  group: "add",
  isEnabled: hasDocument,
  run: (context) => add(context, (plan, source) => newShapeLayer(plan, source, "ellipse")),
});

/**
 * Adds an arrow across the middle of the image, pointing right: the
 * keyboard's way to point at something, since freehand drawing needs a
 * pointer (docs/adr/0014). Its ends are then moved from its frame or the
 * panel's fields.
 */
export const addArrowTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.add-arrow",
  label: "tools.add-arrow",
  icon: "arrow",
  group: "add",
  isEnabled: hasDocument,
  run: (context) => add(context, newArrowLayer),
});

/**
 * Asks for an image and adds it as a layer in the middle of the image
 * (`session.insertImage`). Off while another is being added.
 */
export const addImageTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.add-image",
  label: "tools.add-image",
  icon: "add-image",
  group: "add",
  isEnabled: (state) => hasDocument(state) && !state.snapshot.inserting,
  run: ({ chooseLayerImage }) => chooseLayerImage(),
});
