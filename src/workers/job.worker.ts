// The job worker (docs/adr/0011): writes GIFs from frames the render worker
// rendered, behind the family's worker RPC. It holds no session data, and
// makes no requests.
import { exposeJobWorker } from "../adapters/job-worker/expose.js";

exposeJobWorker();
