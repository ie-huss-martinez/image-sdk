// The render worker (docs/adr/0002): probes files, decodes them upright and
// holds the sources, behind the family's worker RPC. It makes no requests.
import { exposeRenderWorker } from "../adapters/render-worker/expose.js";

exposeRenderWorker();
