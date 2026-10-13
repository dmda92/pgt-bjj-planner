import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const html = await readFile("dist/index.html", "utf8");
const fingerprint = createHash("sha256").update(html);
async function files(dir) {
  const result = [];
  for (const f of await readdir(dir, { withFileTypes: true }))
    if (f.isDirectory()) result.push(...(await files(dir + "/" + f.name)));
    else result.push((dir + "/" + f.name).replace(/^dist/, ""));
  return result;
}
const assets = [
  "/",
  ...(await files("dist")).filter(
    (p) => !["/sw.js", "/_headers", "/_redirects", "/index.html"].includes(p),
  ),
];
for (const path of assets.filter((p) => p !== "/").sort()) {
  fingerprint.update(path);
  fingerprint.update(await readFile("dist" + path));
}
const hash = fingerprint.digest("hex").slice(0, 16);
const sw = await readFile("dist/sw.js", "utf8");
await writeFile(
  "dist/sw.js",
  sw
    .replace("pgt-app-v1", "pgt-app-" + hash)
    .replace(/\/\* PGT_ASSETS \*\/\s*\[[^;]+\]/, JSON.stringify(assets)),
);
