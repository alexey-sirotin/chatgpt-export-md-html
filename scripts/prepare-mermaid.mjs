import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "node_modules/mermaid");
const targetDir = resolve(root, "vendor");

const files = [
  [resolve(sourceDir, "dist/mermaid.min.js"), resolve(targetDir, "mermaid.min.js")],
  [resolve(sourceDir, "LICENSE"), resolve(targetDir, "MERMAID-LICENSE.txt")]
];

for (const [source, target] of files) {
  if (!existsSync(source)) {
    throw new Error(`Mermaid runtime file is missing: ${source}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
