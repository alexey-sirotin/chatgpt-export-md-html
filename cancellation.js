export function createAbortError(message = "Operation canceled") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export function throwIfAborted(signal, message) {
  if (signal?.aborted) throw createAbortError(message);
}
