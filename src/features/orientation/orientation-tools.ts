import { defineTool } from "@hussmartinez/sdk-core";
import type { ImageOrientation, ImageRotation } from "../../core/model/plan.js";
import { hasDocument, type ImageTool, type ImageToolContext } from "../tool-types.js";

/**
 * The orientation after a quarter turn of what's on screen. The plan's flips
 * come after its rotation, so with exactly one flip, turning the result
 * left is turning the rotation right.
 */
export function turned(
  orientation: ImageOrientation,
  direction: "left" | "right",
): ImageOrientation {
  const mirrored = orientation.flipX !== orientation.flipY;
  const clockwise = (direction === "right") !== mirrored;
  const rotate = ((orientation.rotate + (clockwise ? 90 : 270)) % 360) as ImageRotation;
  return { ...orientation, rotate };
}

function turn({ session }: ImageToolContext, direction: "left" | "right"): void {
  const plan = session.getSnapshot().plan;
  if (!plan) return;
  session.execute({
    type: "image.setOrientation",
    orientation: turned(plan.base.orientation, direction),
  });
}

/** Turns the image a quarter turn anticlockwise. */
export const rotateLeftTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.rotate-left",
  label: "tools.rotate-left",
  icon: "rotate-left",
  group: "orientation",
  isEnabled: hasDocument,
  run: (context) => turn(context, "left"),
  shortcuts: ["["],
});

/** Turns the image a quarter turn clockwise. */
export const rotateRightTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.rotate-right",
  label: "tools.rotate-right",
  icon: "rotate-right",
  group: "orientation",
  isEnabled: hasDocument,
  run: (context) => turn(context, "right"),
  shortcuts: ["]"],
});
