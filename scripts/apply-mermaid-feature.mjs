import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function replaceOnce(relativePath, before, after) {
  const path = resolve(root, relativePath);
  let source = readFileSync(path, "utf8");

  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`Could not find Mermaid patch anchor in ${relativePath}`);
  }

  source = source.replace(before, after);
  writeFileSync(path, source);
  return true;
}

replaceOnce(
  "background.js",
  'import { buildMarkdownExport, buildHtmlExport } from "./render.js";\n',
  'import { buildMarkdownExport, buildHtmlExport } from "./render.js";\n' +
    'import { prepareMessagesForMermaid, applyMermaidRenderings } from "./mermaid-html.js";\n' +
    'import { renderMermaidSources } from "./mermaid-service.js";\n'
);

replaceOnce(
  "background.js",
  `    if (exportHtml) {
      const html = buildHtmlExport({
        title: conversationTitle,
        conversationUrl,
        messages: jsonMessages,
        includeOriginalLink
      });
      files.push({ name: \`${"${exportName}"}.html\`, bytes: enc(html) });
    }
`,
  `    if (exportHtml) {
      const mermaidPlan = prepareMessagesForMermaid(jsonMessages);
      let mermaidRenderings = [];
      if (mermaidPlan.blocks.length) {
        try {
          mermaidRenderings = await renderMermaidSources(
            mermaidPlan.blocks.map(block => block.source)
          );
        } catch (error) {
          console.warn("chatgpt-export-md-html: Mermaid rendering failed; keeping source blocks", error);
          mermaidRenderings = mermaidPlan.blocks.map(() => null);
        }
        throwIfAborted(signal, t("exportCanceled"));
      }

      const html = applyMermaidRenderings(
        buildHtmlExport({
          title: conversationTitle,
          conversationUrl,
          messages: mermaidPlan.messages,
          includeOriginalLink
        }),
        mermaidPlan.blocks,
        mermaidRenderings
      );
      files.push({ name: \`${"${exportName}"}.html\`, bytes: enc(html) });
    }
`
);

replaceOnce(
  "scripts/package-smoke.py",
  `    "math-render.js",\n    "ordered-selection.js",\n`,
  `    "math-render.js",\n    "mermaid-html.js",\n    "mermaid-runtime.js",\n    "mermaid-service.js",\n    "ordered-selection.js",\n`
);

replaceOnce(
  "scripts/package-smoke.py",
  `    "vendor/KATEX-LICENSE.txt",\n    "vendor/katex.mjs",\n`,
  `    "vendor/KATEX-LICENSE.txt",\n    "vendor/MERMAID-LICENSE.txt",\n    "vendor/katex.mjs",\n    "vendor/mermaid.min.js",\n`
);
