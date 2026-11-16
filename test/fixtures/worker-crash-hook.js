// Appended only to the example's failure-test worker. The normal shipped
// worker is unchanged. Triggering a bounded generated marker in a worker
// lets browser/visual tests use the same public open() API as a host.
globalThis.addEventListener("message", (event) => {
  const call = event.data;
  if (call?.protocol !== "hm-rpc" || call.type !== "call" || call.method !== "probe") return;
  const file = call.input?.file;
  if (!(file instanceof Blob) || file.size !== 20) return;
  void file.text().then((text) => {
    if (text !== "hm-image-test-crash!") return;
    globalThis.postMessage({
      protocol: "hm-rpc",
      version: 1,
      type: "crash",
      error: { name: "SdkError", code: "WORKER_CRASHED", message: "Controlled test crash" },
    });
  });
});
