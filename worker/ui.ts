export const clientHtml = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PGT · Prueba OneDrive</title>
<style>body{font:17px system-ui;background:#101821;color:#ecf2f8;max-width:760px;margin:32px auto;padding:20px}section{background:#1b2936;padding:20px;margin:16px 0;border-radius:14px}input,textarea,button{font:inherit;padding:12px;border-radius:6px;box-sizing:border-box;margin:6px 0;max-width:100%}input,textarea{display:block;width:100%}button{background:#91edc1;border:0;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{display:block}small{color:#bfd1e0}</style>
<h1>PGT · Prueba de viabilidad</h1><p>Prototipo técnico, no aplicación final. Los tokens Microsoft permanecen en el servidor.</p>
<section><h2>Propietario · configuración</h2><label>Clave administrativa del prototipo<input id="admin" type="password" autocomplete="off"></label><button id="authorize">Autorizar Microsoft</button> <button id="refresh">Probar renovación</button> <button id="disconnect">Eliminar autorización local</button><small>La clave permanece solo en memoria y no se guarda. Solo el propietario usa este panel.</small>
<h3>Crear cuenta PGT de prueba</h3><label>Correo<input id="newmail" type="email"></label><label>Contraseña de prueba (12–128 caracteres)<input id="newpwd" type="password" autocomplete="new-password"></label><button id="create">Crear alumno de prueba</button></section>
<section><h2>Alumno · solo login PGT</h2><label>Correo<input id="mail" type="email" autocomplete="username"></label><label>Contraseña<input id="pwd" type="password" autocomplete="current-password"></label><button id="login">Entrar</button> <button id="logout">Salir</button><p id="identity">Sin sesión</p>
<label>Texto del JSON<textarea id="value" rows="3"></textarea></label><button id="read">Leer desde OneDrive</button> <button id="write">Crear / actualizar</button>
<label>Correo de otro alumno para comprobar rechazo<input id="other" type="email"></label><button id="cross">Probar acceso cruzado (debe devolver 403)</button><button id="conflict">Probar versión antigua (debe devolver 412)</button></section>
<pre id="result" role="status" aria-live="polite">Pendiente de autorización real del propietario.</pre>
<script>
let token='',email='',etag='',revision=0;
const el=id=>document.getElementById(id);
async function api(path,method='GET',data,admin=false,extra={}){
 const headers={...extra}; if(data)headers['Content-Type']='application/json';
 const credential=admin?el('admin').value:token;if(credential)headers.Authorization='Bearer '+credential;
 const response=await fetch(path,{method,headers,body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const value=await response.json();el('result').textContent=JSON.stringify({http:response.status,...value},null,2);
 if(!response.ok)throw Error(value.error||'Error');return value;
}
const path=()=>'/poc/users/'+encodeURIComponent(email)+'/json';
const run=action=>async()=>{try{await action()}catch(error){if(!el('result').textContent.includes('http'))el('result').textContent=error.message;}};
el('authorize').onclick=run(async()=>{const data=await api('/admin/oauth/start','POST',{},true);el('admin').value='';location.assign(data.url)});
el('refresh').onclick=run(()=>api('/admin/refresh','POST',{},true));
el('disconnect').onclick=run(()=>api('/admin/disconnect','POST',{},true));
el('create').onclick=run(async()=>{await api('/admin/test-user','POST',{mail:el('newmail').value,password:el('newpwd').value},true);el('newpwd').value=''});
el('login').onclick=run(async()=>{const data=await api('/auth/login','POST',{mail:el('mail').value,password:el('pwd').value});token=data.token;email=data.mail;etag='';revision=0;el('pwd').value='';el('identity').textContent='Sesión: '+email;el('result').textContent='Login PGT correcto; token de sesión omitido del resultado.'});
el('logout').onclick=run(async()=>{try{await api('/auth/logout','POST',{})}finally{token='';email='';etag='';revision=0;el('value').value='';el('identity').textContent='Sin sesión'}});
el('read').onclick=run(async()=>{const current=await api(path());etag=current.etag;revision=current.data.revision;el('value').value=current.data.value});
el('write').onclick=run(()=>api(path(),'PUT',{value:el('value').value,revision:revision+1},false,etag?{'If-Match':etag}:{}));
el('cross').onclick=run(()=>api('/poc/users/'+encodeURIComponent(el('other').value)+'/json'));
el('conflict').onclick=run(()=>api(path(),'PUT',{value:el('value').value,revision:revision+1},false,{'If-Match':'"stale-test-version"'}));
</script></html>`;
