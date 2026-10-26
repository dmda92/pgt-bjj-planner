import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

const source = JSON.parse(
        await readFile(process.argv[2] || "data/official-source.json", "utf8"),
    ),
    base = JSON.parse(
        await readFile(process.argv[3] || "data/tecnics_base.json", "utf8"),
    );
const fields = (p) => ({
    posicion: p.posicion,
    prioridad: p.prioridad,
    tipos: p.tecnicas.map((t) => t.tipo),
});
assert.deepEqual(base.positions.map(fields), source.map(fields));
assert.equal(base.positions.length, 17);
assert.equal(base.positions.flatMap((p) => p.tecnicas).length, 36);
assert.ok(!JSON.stringify(base).includes('"order"'));
assert.ok(
    base.positions.every((p) =>
        p.tecnicas.every((t) => t.descripcion_del_alumno === ""),
    ),
);
console.log(
    "Plantilla oficial: 17 posiciones / 36 técnicas. Nombres, tipos, prioridades y orden exactos; descripciones vacías y sin order. SHA256 de campos auditados:",
    createHash("sha256")
        .update(JSON.stringify(source.map(fields)))
        .digest("hex"),
);
