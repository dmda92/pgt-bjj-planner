import { DurableObject } from 'cloudflare:workers';
export { ProbeSecurity as FirestoreSecurity, DomainIO } from './v2/runtime.ts';
/** Preserve the historical PRO Durable Object namespace without executing legacy
 * GitHub code, accepting old sessions or inspecting/deleting its stored data. */
export class ProbeSecurity extends DurableObject {
    fetch() { return new Response(null, { status: 410 }); }
    alarm() { /* Legacy scheduled work is deliberately inert after promotion. */ }
}

import runtime from './v2/runtime.ts';
import type { V2Env } from './v2/runtime.ts';
export default {
    fetch(request: Request, env: V2Env) {
        if (env.FIRESTORE_ENVIRONMENT !== 'pro') return Response.json({ error: 'FIRESTORE_ENVIRONMENT_MISMATCH' }, { status: 503 });
        return runtime.fetch(request, env);
    }
};
