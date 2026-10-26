import {build} from "esbuild";

await build({
    entryPoints: ["worker/dev.ts"],
    bundle: true,
    format: "esm",
    target: "es2022",
    external: ['cloudflare:workers'],
    outfile: ".worker-build/index.js",
});
console.log(
    "Worker DEV Firestore V2 compilado localmente. Sin acceso a Cloudflare.",
);
