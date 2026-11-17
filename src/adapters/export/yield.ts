/**
 * Lets the worker handle its other messages, such as a cancellation from
 * the page, before the next strip: a message rather than a timer, which
 * engines delay by several milliseconds.
 */
export function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

/** Yields to the worker's messages, then stops a cancelled call. */
export async function checkpoint(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return;
  await yieldToMessages();
  if (signal.aborted) throw signal.reason;
}
