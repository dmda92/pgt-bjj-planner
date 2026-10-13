import { build } from "esbuild";
await build({
  entryPoints: ["worker/index.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: ".worker-build/index.js",
});
console.log(
  "Worker compilado localmente con esbuild. Sin acceso a Cloudflare.",
);
