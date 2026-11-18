/**
 * The job worker's RPC contract (docs/adr/0011): it writes GIFs, a frame at
 * a time, and holds no session data. Each export is a job with an id the
 * page chooses; the worker holds the job's file so far, and nothing of the
 * frames it has written.
 */
export interface JobWorkerContract {
  /** Starts a GIF of this size and loop count. */
  readonly gifStart: {
    readonly input: {
      readonly id: string;
      readonly width: number;
      readonly height: number;
      /** `null`: play once. 0: for ever. Otherwise that many repeats. */
      readonly loop: number | null;
    };
    readonly output: undefined;
  };
  /**
   * Writes one frame: `width × height` RGBA pixels, not premultiplied, as a
   * buffer the page transfers, and its delay in hundredths of a second.
   */
  readonly gifFrame: {
    readonly input: { readonly id: string; readonly pixels: ArrayBuffer; readonly delay: number };
    readonly output: undefined;
  };
  /** Ends the job and returns its file. */
  readonly gifFinish: { readonly input: { readonly id: string }; readonly output: Blob };
  /** Forgets a job, finished or not. Forgetting one it doesn't have does nothing. */
  readonly gifAbandon: { readonly input: { readonly id: string }; readonly output: undefined };
}
