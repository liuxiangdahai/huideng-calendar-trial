// Settings contain JSON data only. Older Safari versions can keep their drafts.
export const cloneSettings = value => typeof globalThis.structuredClone === 'function'
  ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));

// A controller works on browsers predating AbortSignal.timeout and is cancelled
// after the body has arrived, so a connection that stalls mid-response also ends.
export async function fetchJSON(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    let result;
    try { result = await response.json(); }
    catch (error) { if (controller.signal.aborted) throw error; result = {}; }
    return {response, result};
  } finally { clearTimeout(timer); }
}
