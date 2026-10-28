import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {db, type CommentNotice} from "../infrastructure/local.ts";
import type {Comments, Techniques} from "../domain/models.ts";

const versionOf = (comments: Comments | undefined, id: string, text: string) => {
    return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([text, text ? comments?.commentUpdates?.[id] || "" : ""]))));
};
// Called inside the same transaction that accepts a comments snapshot. Existing local
// comments seed the upgrade baseline; first restoration also surfaces existing comments.
export async function receiveComments(owner: string, comments: Comments, techniques: Techniques, previous?: Comments) {
    const records = await db.commentNotices.where("owner").equals(owner).toArray();
    const byId = new Map(records.map(n => [n.techniqueId, n]));
    const ids = new Set(techniques.positions.flatMap(p => p.tecnicas.map(t => t.id)));
    const incoming = new Map(comments.comments.map(c => [c.techniqueId, c.comment]));
    const prior = new Map(previous?.comments.map(c => [c.techniqueId, c.comment]) || []);
    const writes: CommentNotice[] = [], removals: [string, string][] = [];
    const receivedAt = new Date().toISOString();
    for (const id of new Set([...incoming.keys(), ...byId.keys()])) {
        if (!ids.has(id)) {
            if (byId.has(id)) removals.push([owner, id]);
            continue;
        }
        const old = byId.get(id), version = versionOf(comments, id, incoming.get(id) || "");
        const changed = version !== (old?.version ?? versionOf(previous, id, prior.get(id) || ""));
        const nonempty = Boolean(incoming.get(id)?.trim());
        const unread = nonempty && (changed || Boolean(old?.unread));
        if (!old || old.version !== version || old.unread !== unread) writes.push({
            owner, techniqueId: id, version, unread,
            receivedAt: changed ? receivedAt : old?.receivedAt || ""
        });
    }
    if (writes.length) await db.commentNotices.bulkPut(writes);
    if (removals.length) await db.commentNotices.bulkDelete(removals);
}
