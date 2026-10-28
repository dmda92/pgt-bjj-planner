import {caseTest,expect,campaign} from '../helpers/case-test.mjs';
import {createLocalAcademy} from '../helpers/local-academy.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const priorPath=resolve(campaign,'results','SEC-01.json');
const previous=existsSync(priorPath)?JSON.parse(readFileSync(priorPath,'utf8')):null;
caseTest('SEC 01',{environment:'Worker real local y Firestore sintetico; suplemento de resultados anteriores de esta misma campana',users:['Alumno sintético nuevo','Entrenador sintético']},async({},r)=>{
 r.includePrevious();const a=await createLocalAcademy();try{
  const u=await a.register('rolecycle'),path='users/'+encodeURIComponent(u.profile.mail)+'/profile';
  const before=await a.call(path,undefined,a.trainer.token);
  await a.call('commands/role',{mail:u.profile.mail,perfil:'entrenador',expected:before.version,operationId:crypto.randomUUID()},a.trainer.token);
  const promoted=await a.call(path,undefined,a.trainer.token);
  await a.call('commands/role',{mail:u.profile.mail,perfil:'alumno',expected:promoted.version,operationId:crypto.randomUUID()},a.trainer.token);
  const response=await a.response(path,undefined,u.token),value=await response.json();
  await r.json('same-campaign-security',previous);await r.json('role-cycle',{oldSessionNotUsedBetweenRoleChanges:true,promotedRole:promoted.data.perfil,finalRole:'alumno',oldSessionHTTPStatus:response.status,oldSessionWasAccepted:response.status===200});
  r.result.steps.push('Crear alumno, conservar token solo en memoria, cambiar rol dos veces con CAS vigente y consultar perfil con token original sin usarlo durante promoción.');
  if(response.status===200){r.result.incident='SEC-01-ROLE-CYCLE-SESSION-REVIVAL';r.result.severity='ALTA';r.finish('FALLIDO','Token anterior al cambio de rol vuelve a ser aceptado200 después de alumno→entrenador→alumno, sin usarlo durante el cambio intermedio.','Contrato de revocación permanente incumplido: comprobación actual compara solo rol/pwdFingerprint. No se ha probado Google remoto ni se han modificado roles reales.');}
  else{expect(response.status).toBe(401);const fresh=await a.call('auth/login',{mail:u.profile.mail,password:a.password});expect((await a.response(path,undefined,fresh.token)).status).toBe(200);r.finish(previous?.status||'PARCIAL',(previous?.observed||'')+' Sesión previa permanece revocada después de dos cambios de rol; una autenticación nueva sí permite acceso.',previous?.limitation||'Suplemento de ciclo de roles; resto del contrato se ejecuta en faults/remote-security.');}
 }finally{await a.close();}
});
