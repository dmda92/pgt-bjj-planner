import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncPresentation} from '../src/application/sync-presentation.ts';
test('Success requires no durable/optimistic changes or blocked plans',()=>{
 assert.deepEqual(syncPresentation('Sincronizado',false),{text:'Sincronizado',success:true});
 assert.deepEqual(syncPresentation('Sincronizado',true),{text:'Datos pendientes de sincronizar',success:false});
 assert.equal(syncPresentation('Sincronizado',false,true).success,false);
 assert.deepEqual(syncPresentation('Sincronizado',false,false,true),{text:'Cambios en el perfil sin guardar',success:false});
});
test('Loading, offline, error, conflict and saved-pending statuses never appear as success',()=>{
 for(const status of ['Sincronizando…','Sin conexión · cambios conservados localmente','Sincronización incompleta: fallo','Cambios guardados en este dispositivo · pendientes de sincronizar','2 archivo(s) pendientes; revisa conflictos'])assert.deepEqual(syncPresentation(status,true),{text:status,success:false});
});
