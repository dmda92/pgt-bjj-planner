import { madridDate } from "../src/domain/plan-text-updates.ts";
import { template } from "../tests/template-fixture.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import {GithubContentsStorage} from "../worker/storage.ts";
import { AppApi } from "../worker/application.ts";
import { ApiError } from "../worker/security.ts";
// Isolated local fixture. Does not use Cloudflare or GitHub credentials and cannot deploy.
const files = new Map([
    [
      "PGT/master_data/tecnics_base.json",
      {
        data: structuredClone(template),
        sha: "1".repeat(40),
      },
    ],
  ]),
  sessions = new Map();
let revision = 1,
  failSnapshots = false;
const store = {
  get: async (k) => sessions.get(k),
  put: async (k, v) => sessions.set(k, v),
  delete: async (k) => sessions.delete(k),
  list: async ({ prefix }) =>
    new Map([...sessions].filter(([k]) => k.startsWith(prefix))),
};
const cloud = {
  verifyPrivate: async () => {},
  read: async (p) => structuredClone(files.get(p) || null),
  write: async (p, data, sha) => {
    if ((files.get(p)?.sha ?? null) !== sha)
      throw new ApiError(409, "VERSION_CONFLICT");
    const next = (++revision).toString(16).padStart(40, "0");
    files.set(p, { data: structuredClone(data), sha: next });
    return next;
  },
  remove: async (p, sha) => {
    assert.equal(files.get(p)?.sha, sha);
    files.delete(p);
  },
  list: async (dir) =>
    [
      ...new Set(
        [...files.keys()]
          .filter((p) => p.startsWith(dir + "/"))
          .map((p) => p.slice(dir.length + 1).split("/")[0]),
      ),
    ].map((name) => ({ name, type: name.endsWith(".json") ? "file" : "dir", sha:files.get(dir+"/"+name)?.sha })),
};
// Exercise the real document-size validator before each in-memory CAS write.
const validateStorage = new GithubContentsStorage('synthetic','main',async()=>Response.json({content:{sha:'1'.repeat(40)}}));
const write=cloud.write;
cloud.write=async(path,data,sha)=>{await validateStorage.write(path,data,sha);return write(path,data,sha);};
const api = new AppApi(store, cloud, () => new Date("2026-10-16T10:00:00Z"));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      if (failSnapshots && url.pathname.endsWith("/snapshot")) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "SYNTHETIC_UNAVAILABLE" }));
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
      });
      let response;
      try {
        response = await api.handle(request, url);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        response = Response.json({ error: e.message,...(e.size?{size:e.size}:{}) }, { status: e.status });
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve("dist", "." + url.pathname);
    if (!path.startsWith(resolve("dist") + "/") && path !== resolve("dist")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = await readFile(
      url.pathname === "/" ? "dist/index.html" : path,
    );
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ttf": "font/ttf",
      }[extname(path)] || "text/html";
    res.writeHead(200, { "Content-Type": mime });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end("Local fixture error");
    console.error(e.name);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;

export {files,sessions,api,server,origin,cloud};
