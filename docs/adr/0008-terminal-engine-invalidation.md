# 0008. Fail closed after a render worker loses its resources

- **Status:** Accepted
- **Date:** 2026-11-16
- **Accepted:** 2026-11-16
- **Partially supersedes:** [ADR 0002](0002-workers-and-assets.md), only its automatic source/canvas recovery and lossless worker-recreation claims and the corresponding recovery test requirement

## Context

The render worker owns decoded sources and the editor's transferred canvas. The page keeps an edit plan, but the current adapter does not retain and re-register original `Blob`s or recreate a lost canvas. ADR 0002 describes that transparent recovery as if it existed.

The [deadline integration test](../../test/integration/session-deadline.browser.test.ts) demonstrates the actual distinction. A cooperative cancelled export leaves its source reusable. An unacknowledged cancellation rejects the original call immediately, then terminates the worker after the image adapter's separate 30-second cancellation grace period. Other pending calls fail with `WORKER_TERMINATED`. The engine and session can retain source IDs that a fresh worker does not know. A headless caller can currently reopen on that engine, but the editor's transferred canvas is not repaired by reopening the source.

Clearing IDs in a call's error handler is insufficient. The deadline call has already rejected when the grace period expires, and there may be no other pending call to report the termination. The processor and renderer also call the raw client through `EngineInternals.client()`, bypassing the engine's `run()` helper. The renderer can have work queued after its initial source check, and the stage currently suppresses rendering failures while retaining the previous frame.

The family's [ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md) deliberately excludes cancellation-forced termination, idle shutdown and client destruction from `onCrash`. Reinterpreting that callback locally would change a shared contract. The client remains responsible for RPC cancellation, timeouts, error adaptation and closing connections; this decision governs the image adapter's resource lifetime above it.

This decision governs the built-in adapter and its bindings. It does not include transparent source or canvas recovery.

## Decision

### Engine states and generations

The built-in engine has an internal lifecycle, separate from the public document snapshot:

| State | Meaning | Allowed transitions |
|---|---|---|
| Usable | No worker yet, or a live worker generation can accept work | Another usable generation only after a shutdown that owned no source/canvas resources; terminal after unexpected resource loss; destroyed by its owner |
| Terminal | A resource-owning generation was lost; its IDs and canvas are unusable | Destroyed only |
| Destroyed | The owner explicitly released the engine | None |

Assign a monotonically increasing token to each worker generation. Track source reservations, successful registrations and canvas ownership against that token. Record resource ownership at the actual worker-bound `register` or `attachCanvas` transport submission, after successful setup and the version handshake. An API call or source-ID reservation merely awaiting startup is not resource ownership; a handshake failure before any resource message stays retryable. Complete startup before irreversible canvas transfer. Termination during resource submission, transfer or registration is conservatively terminal. Once resources have been submitted, a failed operation does not prove the entire generation resource-free.

Unexpected termination of a resource-owning generation marks that engine terminal synchronously, clears its registered and reserved source IDs, and invalidates attached canvases and queued work. A terminal engine never starts another worker. Calls to `probe`, `register`, export or render cannot revive it. Explicit recreation produces a new engine instance and a new generation; it does not reset the old instance's latch.

A worker startup failure before any resource submission keeps its existing retry-on-a-later-call behavior, including its original start/version/protocol error. Cooperative cancellation, an ordinary handler error, or a superseded render does not by itself make an engine terminal. Explicit owner destruction is intentional cleanup, not an unexpected failure.

The model remains inspectable. Do not silently erase the session's plan, history or source description, or label the existing public snapshot as a new lifecycle state. Pure plan/history operations do not establish that the image is renderable. The built-in editor removes its editing surface while terminal; headless callers may inspect/save their model but cannot process it with the terminal engine. This decision adds no public engine subscription or session reset API and imposes no private adapter mechanism on custom engines.

### Observe termination at the transport boundary

Wrap each `WorkerLike` returned to `createWorkerClient`. Its `terminate()` observes actual worker disposal even when no RPC is pending. Retain `onCrash` for its documented error reporting; do not add expected terminations to that shared callback or change sdk-core here.

The wrapper must:

- delegate `postMessage`, transfer lists, and listener registration/removal to the original worker with its original receiver; never pass a detached browser method;
- preserve the exact listener identity for `addEventListener` and `removeEventListener`; it must not leave an additional forwarding listener attached;
- close the generation exactly once, invalidate its owned resources before notifying observers, and always delegate the underlying termination even if internal notification fails;
- distinguish engine-owned destruction before destroying the client, so cleanup cannot produce a recovery notice or another invalidation event;
- ignore duplicate closure and callbacks from older generations when updating the current generation, including delayed crash callbacks or promise continuations;
- isolate notification failures from transport cleanup and other subscribers, without introducing unhandled rejections or data-bearing telemetry.

An internal invalidation subscription is local to the built-in adapter. Subscribing returns an idempotent unsubscribe function, exposes the current terminal snapshot for a subscriber arriving after invalidation, and emits at most one terminal transition per engine. It does not expose files, metadata or file names. React/custom-element bindings unsubscribe when their consumers unmount; unsubscribe never destroys an externally owned engine.

### One guarded internal call boundary

Replace exposure of the raw worker client through `EngineInternals.client()` with one typed internal dispatch boundary, or a facade that enforces the same invariants. Merely changing the engine's `run()` catch is not sufficient.

Every path uses it: engine probe/register/thumbnail/release, processor export, renderer attach/render, renderer diagnostic snapshot, and detach/cleanup. It preserves the existing transfer options, caller signals, progress, package version handshake and error adaptation. No public entry exposes this boundary.

Check lifecycle and generation before dispatch and again after awaited setup and completion. Check the terminal latch before an unknown-source or unattached-canvas check, so known resource loss is not reported as a programming `TypeError`. The renderer also rechecks when pumping queued work; a source check at enqueue time cannot authorize a later call on a lost generation. Cleanup must never reconnect a worker just to send `release` or `detachCanvas`.

Concurrent calls share a generation and one terminal transition. A registration result already queued on the page when termination occurs must not restore its ID. A late render must not increment the drawn count, resolve as a successful frame, or hide terminal loss behind `superseded`. Late exports must not be offered for download. Results already accepted before invalidation remain completed operations. Dispatch and post-completion guards do not replace an originating RPC rejection or an already-settled deadline/crash error. Apply the post-completion guard to a result that would otherwise succeed, and close any rejected owned transferable; discard non-transferable results.

There are no automatic call retries, source registrations or worker replacements after terminal invalidation. The underlying sdk-core client retains its normal next-call recreation behavior; the terminal image engine does not submit that next call. This is an image resource ownership rule, not a change to the RPC protocol.

### Errors and visible state

Preserve the originating call's settled error: a policy deadline remains `PROCESSING_TIME_EXCEEDED` with its limit details; caller abort/timeout/custom `SdkError` adaptation remains unchanged. Other calls pending on the terminated worker retain the RPC's original failure, such as `WORKER_TERMINATED` or `WORKER_CRASHED`. Do not rewrite those errors or their events to make them look like a retry.

Subsequent processing attempts through a terminal engine reject with `ImageError("WORKER_TERMINATED")` and stable `details.reason: "engine-invalidated"`. Unknown source IDs on an otherwise usable engine remain programming errors as documented. Destroyed engines retain their documented post-destroy behavior. `release` and resource cleanup may finish locally as no-ops after invalidation; they never reconnect. The new reason is a documented lifecycle diagnostic, not a file-derived value.

A local lifecycle notification does not overwrite a newer document's error or manufacture a session operation event. It tells bindings that the engine shared by those documents is unusable. Original operations keep their existing failed/cancelled event and settle their counters. A later document on the same terminal engine is also unusable, but its failure must not be misattributed to an earlier operation.

The built-in editor replaces the stale preview, crop handles and editing/export controls with a recovery notice. Any open export dialog closes without offering a stale result; no automatic download, file reopen or page reload follows. An SDK-owned catalogue key, such as `editor.engineUnavailable`, supplies this text:

> Image processing stopped. Reload this page or reopen the editor, then choose the image again. Unsaved edits will be lost unless your application has saved them.

Do not override sdk-core's shared `errors.WORKER_TERMINATED` text or render `error.message`. Hosts can translate the SDK key through `messages`. Announce the terminal notice once. If focus was inside the editor's removed surface/dialog, move it to the notice; do not take focus from another editor or host control. The notice must remain visible even if the last operation's deadline error was already shown or no call was pending when termination occurred.

Custom building-block layouts receive the same internal built-in-engine invalidation state and must not continue presenting a stale image as current. Host-injected adapters keep their own ownership/lifecycle contract; absence of this private signal is not evidence that such an adapter is healthy.

### Explicit reopening and ownership

Reopening means creating fresh processing resources and a new editing session:

- **React:** explicitly remount an editor/provider to recreate its owned engine, processor, session, renderer and DOM canvas. A new React key alone cannot fix a host-supplied terminal engine; the host must supply fresh resources too.
- **Custom element:** create a new element instance and fresh supplied resources where applicable. Moving or disconnecting/reconnecting the same element may preserve its mount. Assigning `file` on the terminal element is not recovery.
- **Headless:** destroy the old owned session, processor and engine, then construct compatible fresh resources and explicitly open the caller's file. Renderer users also need a new renderer and a new DOM canvas; a previously transferred canvas cannot be transferred again.

This action starts a new session. Retaining a `Blob` or saving/reapplying a plan is the host's explicit choice, not an SDK recovery promise. Instructions and examples must not suggest that `session.open()` on the old engine repairs a preview.

Destroy remains idempotent and follows existing ownership: a provider destroys only resources it created, a session releases its own source but does not destroy its engine/processor, and processor/renderer cleanup does not destroy the shared engine. Intentional destruction first marks lifecycle state and disconnects observers/queued work, then releases transport resources. StrictMode cleanup, shared engines with several consumers, late subscribers, and destruction during an invalidation notification must not cause double termination, reentrant worker creation or another notice. Unsubscribing one consumer must not affect another.

### Scope and implementation gate

No transparent source or canvas recovery is included: no original-Blob retention, hidden re-probing/re-decoding, automatic plan replay, canvas reattachment or user action replay. Keep relative-asset resolution, dependencies, worker RPC semantics, file limits, metadata policy and network behavior unchanged.

The implementation must demonstrate:

- cooperative cancellation leaves the same source and worker reusable;
- an unacknowledged cancellation with **only the cancelled call pending** still invalidates at actual termination, plus a case with collateral calls;
- processor and all renderer paths, queued work and post-await continuations cannot bypass invalidation; no new worker or successful stale render/export/registration appears;
- calls/reservations awaiting startup and handshake failures before actual resource submission remain retryable, while termination during actual transfer/registration is conservatively terminal; worker crashes, duplicate/late notifications, concurrent registrations and intentional destruction follow the state table;
- receiver-sensitive method delegation and exact listener removal work, internal subscriber failures do not prevent termination, and unsubscribe/remount/shared-engine cases leave no listeners or unhandled errors;
- all public error/event distinctions survive, and the translated recovery notice, focus handling, hidden stale surface/dialog and absence of automatic retries/downloads work in the three browser engines;
- explicit recreation with a new engine and canvas followed by a user-directed reopen succeeds, without reusing a terminated worker fixture or a transferred DOM canvas.

Run the normal full verification and package/API/size checks for that implementation. The implementation changes observable behavior for headless callers that can currently reopen on the same engine; document the recreate-and-reopen migration and use the repository's pre-1.0 minor changeset rule for that breaking restriction.

## Alternatives considered

- **Clear IDs on a rejected call or in `onCrash`:** misses a cancellation-forced termination with no other pending call. Raw processor/renderer paths bypass an engine-only catch. Expanding `onCrash` would contradict the family contract.
- **Invalidate IDs but let the same editor reopen a file:** can restore a headless source while leaving the transferred preview canvas lost. A successful open would incorrectly suggest that the editing surface works again. One terminal resource lifetime is easier to explain and test than partial revival.
- **A public sdk-core termination callback first:** a callback at `Connection.close` could remove the local transport wrapper. It still requires this engine's state/dispatch guards, ownership, subscriptions and UI handling, plus a new shared API contract for reasons, ordering, intentional shutdown and listener failures, its release and adoption. It is not materially smaller for this isolated fix. Propose it separately in sdk-core if another consumer needs the same lifecycle; do not modify that repository from this PR.
- **Transparent re-registration and canvas recovery:** requires retained bytes, memory accounting, source generation coordination, new canvases, crash-loop policy and a promise about preserving work. That deserves a separate design. It is not an incidental part of deadline enforcement or source invalidation.
- **Automatically remount the editor or reload the page:** discards session state and can repeat hostile input or host callbacks without user direction. Recreation stays explicit.

## Consequences

Known worker resource loss becomes a visible, stable failure rather than stale IDs, swallowed render errors or a misleading successful reopen. Cancellation and lifecycle notification remain distinct, and no shared worker contract or public reset API is added.

Users must explicitly recreate resources and reopen an image after terminal loss; unsaved edits require host-managed preservation. The adapter gains generation accounting, four transport-method delegations and one guarded dispatch boundary, whose correctness must be proved before implementation merges. The accepted parts of ADR 0002 about worker-owned pixels, DOM interaction, typed RPC and assets remain in force; only its automatic recovery claims and recovery test requirement are replaced by this decision.
