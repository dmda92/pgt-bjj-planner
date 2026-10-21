import {test} from 'node:test';import assert from 'node:assert/strict';import {onlinePresentation} from '../src/application/online-presentation.ts';
test('Online success only follows an authoritative snapshot with no drafts or blocked projection',()=>{
 assert.equal(onlinePresentation('Actualizado',false,false,false).success,true);
 for(const flags of [[true,false,false],[false,true,false],[false,false,true]])assert.equal(onlinePresentation('Actualizado',...flags as [boolean,boolean,boolean]).success,false);
 for(const status of ['Guardando…','Sin conexión','No guardado','Reconectando'])assert.equal(onlinePresentation(status,false,false,false).success,false);
});
