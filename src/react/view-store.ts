import { createStore, type Store } from "@hussmartinez/sdk-core";

/**
 * The stage's zoom and pan: view state, outside the session and its history
 * (ADR 0003, docs/adr/0007). Zoom 1 fits the image to the stage.
 *
 * @public
 */
export interface ImageViewState {
  readonly zoom: number;
  readonly pan: { readonly x: number; readonly y: number };
}

/** The fitted view, with no pan. */
export const FITTED: ImageViewState = Object.freeze({
  zoom: 1,
  pan: Object.freeze({ x: 0, y: 0 }),
});

/** The zoom range, and the step of the zoom tools. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;
export const ZOOM_STEP = 1.25;

/** A store of the view, which the stage reads with the session's plan. */
export function createViewStore(): Store<ImageViewState> {
  return createStore<ImageViewState>(FITTED);
}

/** The view zoomed by a factor, within the range. */
export function zoomBy(view: ImageViewState, factor: number): ImageViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  return { ...view, zoom };
}
