import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "node_modules/katex");
const targetDir = resolve(root, "vendor");

const files = [
  [resolve(sourceDir, "dist/katex.mjs"), resolve(targetDir, "katex.mjs")],
  [resolve(sourceDir, "LICENSE"), resolve(targetDir, "KATEX-LICENSE.txt")]
];

for (const [source, target] of files) {
  if (!existsSync(source)) {
    throw new Error(`KaTeX runtime file is missing: ${source}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
