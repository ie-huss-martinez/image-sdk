import { defineTool } from "@hussmartinez/sdk-core";
import { MAX_STROKE_WIDTH } from "../../core/model/plan.js";
import { NO_TOOL } from "../editor-state.js";
import { DEFAULT_SHAPE_COLOUR, defaultStrokeWidth } from "../layers/new-layer.js";
import { hasDocument, type ImageTool, type ImageToolContext } from "../tool-types.js";

/** What draws: a pen's strokes are opaque, a highlighter's wide in a see-through drawing. */
export type ImageDrawMode = "pen" | "highlighter";

/**
 * The opacity of the drawing layer each mode draws into (docs/adr/0014): a
 * highlighter is a wide stroke in a drawing with a low opacity, composited
 * as one, so its strokes don't darken where they cross.
 */
export const DRAW_OPACITY: Readonly<Record<ImageDrawMode, number>> = { pen: 100, highlighter: 40 };

/** The colour each mode starts with: a pen's red, a highlighter's yellow. */
export const DRAW_COLOUR: Readonly<Record<ImageDrawMode, string>> = {
  pen: DEFAULT_SHAPE_COLOUR,
  highlighter: "#f0c020",
};

/** How many times a pen's width a highlighter's is. */
const HIGHLIGHTER_WIDTH = 6;

/**
 * The width each mode starts with, in scene pixels: a pen's is a new
 * shape's outline, a hundredth of the image's shorter side and at least 2;
 * a highlighter's is six of those.
 */
export function drawWidth({ session }: Pick<ImageToolContext, "session">, mode: ImageDrawMode) {
  const { plan, source } = session.getSnapshot();
  const pen = plan && source ? defaultStrokeWidth(plan, source) : 2;
  return mode === "pen" ? pen : Math.min(pen * HIGHLIGHTER_WIDTH, MAX_STROKE_WIDTH);
}

/**
 * Starts and ends drawing (docs/adr/0015): while it's on, a drag across the
 * image draws a stroke, and the inspector shows what it's drawn with. It
 * starts with the pen. If the layers were showing a drawing a pen can add
 * to, the strokes join it; otherwise the first stroke starts a new drawing.
 */
export const drawTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.draw",
  label: "tools.draw",
  icon: "pen",
  group: "draw",
  isEnabled: hasDocument,
  isActive: ({ editor }) => editor.tool === "draw",
  run: (context) => {
    const { editor, session } = context;
    const selected = editor.getSnapshot().layers?.selected ?? null;
    const layer = session.getSnapshot().plan?.layers.find((item) => item.key === selected);
    const target =
      layer?.kind === "drawing" && layer.opacity === DRAW_OPACITY.pen ? layer.key : null;
    editor.set((state) =>
      state.tool === "draw"
        ? { ...state, ...NO_TOOL, preview: null }
        : {
            ...state,
            // One tool has the stage at a time.
            ...NO_TOOL,
            tool: "draw",
            preview: null,
            draw: {
              mode: "pen",
              colour: DRAW_COLOUR.pen,
              width: drawWidth(context, "pen"),
              target,
            },
          },
    );
  },
  shortcuts: ["D"],
});
