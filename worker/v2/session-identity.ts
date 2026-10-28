import type { Profile } from '../../src/domain/models.ts';

/** DEV V2 metadata, never accepted from a client or copied into plan snapshots. */
export type SessionProfile = Profile & { sessionEpoch?: string };
// Migrated profiles need no write/password reset at first login. Only newly
// minted sessions carry this baseline; old stored session formats fail closed.
export const INITIAL_SESSION_EPOCH = 'v2-initial';
export const sessionEpoch = (p: SessionProfile) => p.sessionEpoch ?? INITIAL_SESSION_EPOCH;
export const publicProfile = (p: SessionProfile) => { const { pwd, probeOnly, sessionEpoch: _epoch, ...safe } = p; return safe; };
