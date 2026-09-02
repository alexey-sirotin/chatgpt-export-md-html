import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../async-pool.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order while limiting active workers", async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async value => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay((6 - value) * 2);
      active--;
      return `value-${value}`;
    });

    expect(result).toEqual([
      "value-0", "value-1", "value-2",
      "value-3", "value-4", "value-5"
    ]);
    expect(maxActive).toBe(3);
  });

  it("falls back to one worker for an invalid concurrency value", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency([1, 2, 3], 0, async value => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(1);
      active--;
      return value;
    });

    expect(maxActive).toBe(1);
  });

  it("waits for already-running workers before rejecting", async () => {
    const events = [];

    await expect(mapWithConcurrency([0, 1, 2, 3], 2, async value => {
      events.push(`start-${value}`);
      if (value === 0) {
        await delay(1);
        throw new Error("boom");
      }
      await delay(20);
      events.push(`end-${value}`);
      return value;
    })).rejects.toThrow("boom");

    expect(events).toContain("end-1");
    expect(events).not.toContain("start-2");
    expect(events).not.toContain("start-3");
  });

  it("returns an empty array without calling the worker", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 3, async () => {
      calls++;
    });

    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });
});
