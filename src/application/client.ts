import {Client} from './client-base.ts';
import {OnlineClient} from './online-client.ts';

export * from './client-base.ts';
export const onlineMode = import.meta.env?.VITE_PERSISTENCE === 'firestore-dev';
export const client: Client = onlineMode ? new OnlineClient() : new Client();
