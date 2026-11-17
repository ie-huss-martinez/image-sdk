import { ImageError } from "../errors/image-error.js";
import type { ImagePlan } from "../model/plan.js";

/**
 * A part of a plan that a renderer or processor may not know how to draw.
 * `layers` is any layer; `drawings` is a drawing or an arrow layer, which a
 * renderer that draws the other kinds may not.
 *
 * @public
 */
export type ImagePlanPart = "layers" | "drawings" | "redactions" | "animation";

/**
 * Refuses a plan that holds something a renderer or processor can't draw
 * (ADR 0009). Nothing may be drawn or exported without a part of its plan:
 * an export that left out a redaction would show what it was meant to hide.
 * Every renderer and processor calls this, with the parts it draws, before
 * it draws anything.
 *
 * @param plan - The plan to draw.
 * @param supported - The parts this renderer or processor draws.
 * @throws `ImageError` with `UNSUPPORTED_PLAN`, and the first part it can't
 *   draw as `details.reason`.
 * @public
 */
export function checkPlanSupport(plan: ImagePlan, supported: readonly ImagePlanPart[]): void {
  const used: Record<ImagePlanPart, boolean> = {
    // Anything but an empty list or `null` counts, including a value the
    // types don't allow: a plan can come from a host's own storage.
    layers: !(Array.isArray(plan.layers) && plan.layers.length === 0),
    // Drawings and arrows, the kinds format version 3 added (docs/adr/0014).
    drawings:
      Array.isArray(plan.layers) &&
      plan.layers.some((layer) => layer?.kind === "drawing" || layer?.kind === "arrow"),
    redactions: !(Array.isArray(plan.redactions) && plan.redactions.length === 0),
    animation: plan.animation !== null,
  };
  for (const part of ["layers", "drawings", "redactions", "animation"] as const) {
    if (used[part] && !supported.includes(part)) {
      throw new ImageError("UNSUPPORTED_PLAN", `This renderer can't draw the plan's ${part}.`, {
        details: { reason: part },
      });
    }
  }
}
