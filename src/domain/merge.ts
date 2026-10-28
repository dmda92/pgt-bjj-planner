export interface MergeResult<T> {
    value: T;
    conflicts: string[];
}

const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);

// Three-way merge by UUID; deletion/edit collisions remain explicit, never resurrect silently.
export function merge<T>(base: T, local: T, remote: T): MergeResult<T> {
    const conflicts: string[] = [];

    function visit(b: any, l: any, r: any, path: string): any {
        if (same(l, r)) return structuredClone(l);
        if (same(l, b)) return r === undefined ? undefined : structuredClone(r);
        if (same(r, b)) return l === undefined ? undefined : structuredClone(l);
        if (
            l &&
            r &&
            b &&
            typeof l === "object" &&
            typeof r === "object" &&
            typeof b === "object"
        ) {
            if (Array.isArray(l) && Array.isArray(r) && Array.isArray(b)) {
                if (
                    [...b, ...l, ...r].every(
                        (v) => v && typeof v === "object" && (v.id || v.techniqueId),
                    )
                ) {
                    const key = (v: any) => v.id || v.techniqueId;
                    const bm = new Map(b.map((v) => [key(v), v])),
                        lm = new Map(l.map((v) => [key(v), v])),
                        rm = new Map(r.map((v) => [key(v), v]));
                    const bo = b.map(key),
                        lo = l.map(key),
                        ro = r.map(key);
                    const moved = (ids: any[]) =>
                        !same(
                            ids.filter((id) => bm.has(id)),
                            bo.filter((id) => ids.includes(id)),
                        );
                    let order = lo;
                    if (!moved(lo)) order = ro;
                    else if (
                        moved(ro) &&
                        !same(
                            lo.filter((id) => rm.has(id) && bm.has(id)),
                            ro.filter((id) => lm.has(id) && bm.has(id)),
                        )
                    )
                        conflicts.push(path + "/order");
                    order = [...order];
                    for (const source of [ro, lo])
                        for (let i = 0; i < source.length; i++) {
                            const id = source[i];
                            if (order.includes(id)) continue;
                            const next = source
                                .slice(i + 1)
                                .find((v: any) => order.includes(v));
                            if (next !== undefined) order.splice(order.indexOf(next), 0, id);
                            else order.push(id);
                        }
                    return order
                        .map((id) =>
                            visit(bm.get(id), lm.get(id), rm.get(id), path + "/" + id),
                        )
                        .filter((v) => v !== undefined);
                }
            } else if (!Array.isArray(l) && !Array.isArray(r) && !Array.isArray(b)) {
                const out: any = {};
                for (const key of new Set([
                    ...Object.keys(b),
                    ...Object.keys(l),
                    ...Object.keys(r),
                ])) {
                    if (["revision", "updatedAt"].includes(key)) {
                        out[key] = r[key];
                        continue;
                    }
                    const value = visit(b[key], l[key], r[key], path + "/" + key);
                    if (value !== undefined) out[key] = value;
                }
                return out;
            }
        }
        conflicts.push(path || "/");
        return l === undefined ? undefined : structuredClone(l);
    }

    return {value: visit(base, local, remote, "") as T, conflicts};
}

// Apply only conflicting remote fields; keep independent local changes already merged.
export function resolveRemote<T>(merged: T, remote: T, paths: string[]): T {
    const copy = (value: any) =>
        value === undefined ? undefined : structuredClone(value);

    function pick(local: any, other: any, parts: string[]): any {
        if (!parts.length) return copy(other);
        const [key, ...rest] = parts;
        if (Array.isArray(local)) {
            if (key === "order" && !rest.length) {
                const id = (v: any) => v.id || v.techniqueId;
                const map = new Map(local.map((v) => [id(v), v]));
                return [
                    ...(other || []).map(id).filter((id: any) => map.has(id)),
                    ...local
                        .map(id)
                        .filter(
                            (id: any) =>
                                !(other || []).some((v: any) => (v.id || v.techniqueId) === id),
                        ),
                ].map((id) => map.get(id));
            }
            const target = local.findIndex((v) => (v.id || v.techniqueId) === key),
                r = (other || []).find((v: any) => (v.id || v.techniqueId) === key),
                value = pick(target < 0 ? undefined : local[target], r, rest),
                out = copy(local);
            if (value === undefined) {
                if (target >= 0) out.splice(target, 1);
            } else if (target >= 0) out[target] = value;
            else out.push(value);
            return out;
        }
        const out = copy(local) || {},
            value = pick(local?.[key], other?.[key], rest);
        if (value === undefined) delete out[key];
        else out[key] = value;
        return out;
    }

    let value = copy(merged);
    for (const path of paths)
        value = pick(value, remote, path.split("/").filter(Boolean));
    return value as T;
}
