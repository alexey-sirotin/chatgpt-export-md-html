import { describe, expect, it, vi } from "vitest";
import {
  getInstallType,
  resolveAttachmentDownloadConcurrency
} from "../runtime-mode.js";

describe("getInstallType", () => {
  it("returns the extension install type", async () => {
    const management = {
      getSelf: vi.fn().mockResolvedValue({ installType: "development" })
    };

    await expect(getInstallType(management)).resolves.toBe("development");
  });

  it("fails closed to production semantics when management is unavailable", async () => {
    await expect(getInstallType(undefined)).resolves.toBeNull();
  });

  it("fails closed to production semantics when getSelf rejects", async () => {
    const management = {
      getSelf: vi.fn().mockRejectedValue(new Error("unavailable"))
    };

    await expect(getInstallType(management)).resolves.toBeNull();
  });
});

describe("resolveAttachmentDownloadConcurrency", () => {
  it.each([undefined, null, "normal", "sideload", "admin"]) (
    "forces 10 outside development mode (%s)",
    installType => {
      expect(resolveAttachmentDownloadConcurrency(1, installType)).toBe(10);
      expect(resolveAttachmentDownloadConcurrency(3, installType)).toBe(10);
      expect(resolveAttachmentDownloadConcurrency(99, installType)).toBe(10);
    }
  );

  it("keeps the saved development value and clamps it to the supported range", () => {
    expect(resolveAttachmentDownloadConcurrency(undefined, "development")).toBe(3);
    expect(resolveAttachmentDownloadConcurrency(1, "development")).toBe(1);
    expect(resolveAttachmentDownloadConcurrency("6", "development")).toBe(6);
    expect(resolveAttachmentDownloadConcurrency(99, "development")).toBe(10);
  });
});
