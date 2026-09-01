import { describe, expect, it } from "vitest";
import {
  filenameWithExtension,
  markdownHref,
  safeAttachmentName,
  uniqueFilename
} from "../utils.js";

describe("attachment filenames and paths", () => {
  it("adds the resolved extension to a generated-image title without changing the title", () => {
    expect(filenameWithExtension(
      "Эфирный силуэт с золотыми акцентами",
      "png"
    )).toBe("Эфирный силуэт с золотыми акцентами.png");
  });

  it("deduplicates filenames case-insensitively", () => {
    const used = new Set();

    expect(uniqueFilename("Image.png", "fallback.png", used)).toBe("Image.png");
    expect(uniqueFilename("image.png", "fallback.png", used)).toBe("image (2).png");
  });

  it("sanitizes a filename as one filesystem path component", () => {
    expect(safeAttachmentName('bad:name?.png ')).toBe("bad_name_.png");
  });

  it("URL-encodes each local attachment path segment for Markdown/HTML links", () => {
    expect(markdownHref(
      "Экспорт/Эфирный силуэт.png"
    )).toBe(
      "%D0%AD%D0%BA%D1%81%D0%BF%D0%BE%D1%80%D1%82/%D0%AD%D1%84%D0%B8%D1%80%D0%BD%D1%8B%D0%B9%20%D1%81%D0%B8%D0%BB%D1%83%D1%8D%D1%82.png"
    );
  });
});
