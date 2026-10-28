export { ProbeSecurity, DomainIO } from './v2/runtime.ts';

import runtime from './v2/runtime.ts';
import type { V2Env } from './v2/runtime.ts';
export default {
    fetch(request: Request, env: V2Env) {
        if (env.FIRESTORE_ENVIRONMENT !== 'dev') return Response.json({ error: 'FIRESTORE_ENVIRONMENT_MISMATCH' }, { status: 503 });
        return runtime.fetch(request, env);
    }
};
