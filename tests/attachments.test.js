import { describe, expect, it } from "vitest";
import {
  attachmentRecords,
  replaceSandboxLinkDestinations,
  sandboxAttachmentRecords
} from "../attachments.js";

describe("attachment normalization", () => {
  it("recovers a generated-image title and image type from legacy structural metadata", () => {
    const msg = {
      id: "image-message",
      author: { role: "tool" },
      metadata: {
        image_gen_title: "Эфирный силуэт с золотыми акцентами"
      },
      content: {
        content_type: "multimodal_text",
        parts: [{
          content_type: "image_asset_pointer",
          asset_pointer: "sediment://file_deleted_image",
          width: 1024,
          height: 1024
        }]
      }
    };

    expect(attachmentRecords(msg)).toEqual([
      expect.objectContaining({
        id: "file_deleted_image",
        originalName: "Эфирный силуэт с золотыми акцентами",
        isImage: true,
        width: 1024,
        height: 1024
      })
    ]);
  });

  it("does not mark an ordinary text attachment as an image", () => {
    const msg = {
      id: "user-file",
      author: { role: "user" },
      metadata: {
        attachments: [{
          id: "file_notes",
          name: "notes.txt",
          mime_type: "text/plain"
        }]
      },
      content: {
        content_type: "text",
        parts: ["see attachment"]
      }
    };

    const [record] = attachmentRecords(msg);
    expect(record).toMatchObject({
      id: "file_notes",
      originalName: "notes.txt",
      mimeType: "text/plain"
    });
    expect(record?.isImage).not.toBe(true);
  });
});

describe("sandbox attachment links", () => {
  it("discovers and rewrites ChatGPT sandbox links without duplicating identical URLs", () => {
    const msg = {
      id: "assistant-file",
      author: { role: "assistant" },
      content: {
        content_type: "text",
        parts: [
          "[Download](sandbox:/mnt/data/report%20one.pdf) and again [same](sandbox:/mnt/data/report%20one.pdf)"
        ]
      },
      metadata: {}
    };

    const records = sandboxAttachmentRecords(msg);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "sandbox",
      originalName: "report one.pdf",
      sandboxPath: "/mnt/data/report one.pdf"
    });

    const rewritten = replaceSandboxLinkDestinations(
      msg.content.parts[0],
      new Map([[
        "sandbox:/mnt/data/report%20one.pdf",
        "Export/report%20one.pdf"
      ]])
    );

    expect(rewritten).toBe(
      "[Download](Export/report%20one.pdf) and again [same](Export/report%20one.pdf)"
    );
  });
});
