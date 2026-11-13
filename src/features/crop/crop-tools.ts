import { defineTool } from "@hussmartinez/sdk-core";
import { wholeCrop } from "../../core/model/crop.js";
import type { ImageOrientation } from "../../core/model/plan.js";
import { hasDocument, type ImageTool, type ImageToolContext } from "../tool-types.js";

/** Starts cropping: the stage shows the whole image, with the current crop as the frame. */
function startCrop({ session, editor }: ImageToolContext): void {
  const { plan, source } = session.getSnapshot();
  if (!plan || !source) return;
  editor.set((state) => ({
    ...state,
    tool: "crop",
    crop: { pending: plan.base.crop ?? wholeCrop(source), aspect: "free" },
  }));
}

/** Shows the crop frame, which the editor then focuses (docs/adr/0007). */
export const cropTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.crop",
  label: "tools.crop",
  icon: "crop",
  group: "crop",
  isEnabled: hasDocument,
  isActive: ({ editor }) => editor.tool === "crop",
  run: (context) => {
    if (context.editor.getSnapshot().tool === "crop") return;
    startCrop(context);
  },
  shortcuts: ["C"],
});

function flip({ session }: ImageToolContext, axis: "flipX" | "flipY"): void {
  const plan = session.getSnapshot().plan;
  if (!plan) return;
  const orientation: ImageOrientation = {
    ...plan.base.orientation,
    [axis]: !plan.base.orientation[axis],
  };
  session.execute({ type: "image.setOrientation", orientation });
}

/** Mirrors what's on screen left to right: the plan's flips come after its rotation. */
export const flipHorizontalTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.flip-horizontal",
  label: "tools.flip-horizontal",
  icon: "flip-horizontal",
  group: "orientation",
  isEnabled: hasDocument,
  run: (context) => flip(context, "flipX"),
});

/** Mirrors what's on screen top to bottom. */
export const flipVerticalTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.flip-vertical",
  label: "tools.flip-vertical",
  icon: "flip-vertical",
  group: "orientation",
  isEnabled: hasDocument,
  run: (context) => flip(context, "flipY"),
});
