import { structuredFixture } from './structured-firestore-fixture.ts';
import { DEV_DATABASE_NAME } from '../worker/firestore-auth.ts';
/** Synthetic in-memory PRO transport. Never contacts Google. */
export async function proMigrationFixture() {
    const fixture = await structuredFixture(), project = 'pgt-bjj-pro', databaseName = `projects/${project}/databases/(default)`;
    const credential = JSON.parse(fixture.env.FIRESTORE_SERVICE_ACCOUNT_JSON);
    credential.project_id = project; credential.client_email = `pgt-importer-pro@${project}.iam.gserviceaccount.com`;
    const env = { ...fixture.env, FIRESTORE_ENVIRONMENT: 'pro' as const, FIRESTORE_PROJECT_ID: project,
        FIRESTORE_SERVICE_ACCOUNT_EMAIL: credential.client_email, FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify(credential) };
    const transport: typeof fixture.transport = async (url, init = {}) => {
        const response = await fixture.transport(url.replace(databaseName, DEV_DATABASE_NAME), {
            ...init, ...(typeof init.body === 'string' ? { body: init.body.replaceAll(databaseName, DEV_DATABASE_NAME) } : {})
        });
        return new Response((await response.text()).replaceAll(DEV_DATABASE_NAME, databaseName), { status: response.status, headers: response.headers });
    };
    return { ...fixture, env, transport };
}
