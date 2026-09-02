import { describe, expect, it } from "vitest";
import {
  createAbortError,
  isAbortError,
  throwIfAborted
} from "../cancellation.js";

describe("export cancellation helpers", () => {
  it("creates a recognizable AbortError with the requested message", () => {
    const error = createAbortError("Canceled by user");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("Canceled by user");
    expect(isAbortError(error)).toBe(true);
  });

  it("recognizes standard abort error codes", () => {
    expect(isAbortError({ code: "ABORT_ERR" })).toBe(true);
    expect(isAbortError(new Error("ordinary failure"))).toBe(false);
  });

  it("throws only after the AbortSignal is aborted", () => {
    const controller = new AbortController();

    expect(() => throwIfAborted(controller.signal, "Canceled")).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal, "Canceled"))
      .toThrowError(expect.objectContaining({
        name: "AbortError",
        message: "Canceled"
      }));
  });
});
