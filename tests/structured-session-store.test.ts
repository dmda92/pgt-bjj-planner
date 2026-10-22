import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionReplica} from '../worker/structured/session-store.ts';
test('Private session replica isolates reads and stages final mutations without touching source state',async()=>{
 const entries:[string,unknown][]=[['app-session:z',{mail:'z@example.test'}],['app-session:a',{mail:'a@example.test'}]];
 const store=new SessionReplica(entries),value=await store.get<any>('app-session:z');value.mail='changed';
 assert.equal((await store.get<any>('app-session:z')).mail,'z@example.test');assert.equal(store.changes().length,0);
 await store.put('plan-update:a:p',{p:'confirmed'});await store.delete('plan-update:a:p');await store.put('app-session:z',{mail:'new@example.test'});
 assert.deepEqual(store.changes(),[{key:'plan-update:a:p',deleted:true},{key:'app-session:z',value:{mail:'new@example.test'}}]);
 assert.deepEqual([...await store.list({prefix:'app-session:'})].map(([key])=>key),['app-session:a','app-session:z']);assert.deepEqual(entries[0][1],{mail:'z@example.test'});
});
test('Private session replica rejects business data and unrelated SQLite state',async()=>{
 assert.throws(()=>new SessionReplica([['user_techniques/owner',{}]]),/PRIVATE_SESSION_KEY_INVALID/);
 const store=new SessionReplica([]);await assert.rejects(store.put('structured-maintenance-active',true));await assert.rejects(store.list({prefix:''}));
});
