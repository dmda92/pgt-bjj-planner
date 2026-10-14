import { test } from "node:test";
import assert from "node:assert/strict";
import { GithubContentsStorage, safePath } from "../worker/storage.ts";
import { ApiError } from "../worker/security.ts";
const one = "1".repeat(40),
  two = "2".repeat(40);
test("Rutas restringidas a PGT, sin traversal ni URLs arbitrarias", () => {
  assert.equal(
    safePath("PGT/users_data/a@example.com/viability.json"),
    "PGT/users_data/a%40example.com/viability.json",
  );
  for (const value of [
    "PGT/../x.json",
    "PGT//x.json",
    "PGT/%2e%2e/x.json",
    "PGT/a\\b.json",
    "PGT/a.json?ref=other",
    "https://evil/x.json",
    "outside/a.json",
  ])
    assert.throws(() => safePath(value));
});
test("Repositorio público o distinto y token ausente se rechazan", async () => {
  await assert.rejects(
    new GithubContentsStorage("example", "main", async () =>
      Response.json({ private: false, full_name: "dmda92/pgt-bjj-data" }),
    ).verifyPrivate(),
    (e: unknown) => e instanceof ApiError && e.status === 503,
  );
  await assert.rejects(
    new GithubContentsStorage("example", "main", async () =>
      Response.json({ private: true, full_name: "other/repo" }),
    ).verifyPrivate(),
  );
  await assert.rejects(new GithubContentsStorage("").verifyPrivate());
});
test("Lectura decodifica JSON UTF8 y obtiene SHA de la misma respuesta", async () => {
  const text = JSON.stringify({ value: "Técnica · 日本語" });
  const content = Buffer.from(text).toString("base64");
  let authorization = "";
  const provider = new GithubContentsStorage(
    "secret-test",
    "main",
    async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization") || "";
      return Response.json({
        type: "file",
        size: 50,
        encoding: "base64",
        content,
        sha: one,
      });
    },
  );
  const result = await provider.read("PGT/a.json");
  assert.equal(result?.sha, one);
  assert.equal(result?.data.value, "Técnica · 日本語");
  assert.equal(authorization, "Bearer secret-test");
});
test("Contenido corrupto/grande y recurso que no es archivo se rechazan", async () => {
  for (const value of [
    { type: "dir" },
    {
      type: "file",
      size: 4194305,
      encoding: "base64",
      content: "e30=",
      sha: one,
    },
    {
      type: "file",
      size: 4,
      encoding: "base64",
      content: "invalid!",
      sha: one,
    },
  ])
    await assert.rejects(
      new GithubContentsStorage("t", "main", async () =>
        Response.json(value),
      ).read("PGT/a.json"),
    );
});
test("Creación omite SHA; actualización y borrado exigen SHA exacto", async () => {
  const requests: Record<string, unknown>[] = [];
  const provider = new GithubContentsStorage(
    "t",
    "main",
    async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ content: { sha: two } });
    },
  );
  await provider.write("PGT/a.json", { value: "a" }, null);
  await provider.write("PGT/a.json", { value: "b" }, one);
  await provider.remove("PGT/a.json", two);
  assert.equal("sha" in requests[0], false);
  assert.equal(requests[1].sha, one);
  assert.equal(requests[2].sha, two);
  await assert.rejects(provider.write("PGT/a.json", {}, "*"));
});
test("Conflictos y validación 409/422 conservan error y no se reintentan", async () => {
  for (const status of [409, 422]) {
    let count = 0;
    const provider = new GithubContentsStorage("t", "main", async () => {
      count++;
      return new Response("{}", { status });
    });
    await assert.rejects(
      provider.write("PGT/a.json", {}, one),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    assert.equal(count, 1);
  }
});
test("Token inválido, sin permisos, repositorio invisible y rate limit se distinguen sin exponer detalles", async () => {
  for (const [status, headers, code] of [
    [401, {}, "DATA_TOKEN_INVALID_OR_EXPIRED"],
    [403, {}, "DATA_TOKEN_PERMISSION_OR_SECONDARY_LIMIT"],
    [404, {}, "DATA_REPO_NOT_FOUND_OR_TOKEN_DENIED"],
    [
      403,
      { "x-ratelimit-remaining": "0", "Retry-After": "2" },
      "GITHUB_RATE_LIMIT",
    ],
  ] as const) {
    const provider = new GithubContentsStorage(
      "private-token",
      "main",
      async () =>
        new Response('{"private-details":"never-return"}', { status, headers }),
    );
    await assert.rejects(
      provider.verifyPrivate(),
      (e: unknown) =>
        e instanceof ApiError &&
        e.message === code &&
        !e.message.includes("private-token"),
    );
  }
});
test("Error transitorio de lectura reintenta con backoff limitado; mutación ambigua no se repite", async () => {
  let count = 0;
  const read = new GithubContentsStorage("t", "main", async () => {
    count++;
    return count === 1
      ? new Response("{}", { status: 503 })
      : new Response("{}", { status: 404 });
  });
  assert.equal(await read.read("PGT/a.json"), null);
  assert.equal(count, 2);
  count = 0;
  const write = new GithubContentsStorage("t", "main", async () => {
    count++;
    throw Error("network-private-detail");
  });
  await assert.rejects(
    write.write("PGT/a.json", {}, one),
    (e: unknown) => e instanceof ApiError && e.message === "DATA_NETWORK_RETRY",
  );
  assert.equal(count, 1);
});

test('Large Unicode JSON survives failed write, retry, download by immutable blob, and size rejection', async () => {
  const {MAX_JSON_BYTES,jsonBytes}=await import('../src/domain/json-limits.ts');
  const value={positions:Array.from({length:12},(_,i)=>({id:crypto.randomUUID(),posicion:`Posición ${i} áéíóú`,tecnicas:[{id:crypto.randomUUID(),tipo:'Salida',descripcion_del_alumno:('Ángulo 日本語 🙂\nhttps://video.example/watch?v=é&x=1\n').repeat(1800)}]}))};
  assert.ok(jsonBytes(value)>1000000);assert.ok(jsonBytes(value)<MAX_JSON_BYTES);
  const original=JSON.stringify(value);let content='',fail=true,writes=0;
  const provider=new GithubContentsStorage('synthetic','main',async(url,init)=>{
    const path=String(url);
    if(init?.method==='PUT'){
      writes++;
      if(fail){fail=false;return Response.json({}, {status:503});}
      content=JSON.parse(String(init.body)).content;
      return Response.json({content:{sha:two}});
    }
    if(path.includes('/git/blobs/')){assert.ok(path.endsWith(two));return Response.json({sha:two,size:Buffer.from(content,'base64').length,encoding:'base64',content});}
    assert.equal(new Headers(init?.headers).get('Accept'),'application/vnd.github.object+json');
    return Response.json({type:'file',sha:two,size:Buffer.from(content,'base64').length,encoding:'none',content:''});
  });
  await assert.rejects(provider.write('PGT/users_data/qa@example.com/tecnics.json',value,one));
  assert.equal(JSON.stringify(value),original);
  await provider.write('PGT/users_data/qa@example.com/tecnics.json',value,one);
  const downloaded=await provider.read('PGT/users_data/qa@example.com/tecnics.json');
  assert.deepEqual(downloaded?.data,value);assert.equal(downloaded?.sha,two);
  const before=writes;const tooLarge={text:'á'.repeat(MAX_JSON_BYTES)};
  await assert.rejects(provider.write('PGT/tecnics.json',tooLarge,two),(e:unknown)=>e instanceof ApiError&&e.status===413&&e.size?.file==='tecnics.json'&&e.size.bytes===jsonBytes(tooLarge)&&e.size.limitBytes===MAX_JSON_BYTES);
  assert.equal(writes,before);
  const oversizeRead=new GithubContentsStorage('synthetic','main',async()=>Response.json({type:'file',sha:one,size:MAX_JSON_BYTES+1,encoding:'none',content:''}));
  await assert.rejects(oversizeRead.read('PGT/plan_test.json'),(e:unknown)=>e instanceof ApiError&&e.size?.file==='plan_test.json'&&e.message==='REMOTE_JSON_TOO_LARGE');
});
