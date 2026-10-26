import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {v2DevFixture} from '../tests/v2-dev-fixture.mjs';
import {madridDate} from '../src/domain/plan-text-updates.ts';
const {f,password,mail}=await v2DevFixture(),devOrigin='https://synthetic.test';
const compiled=await build({entryPoints:['worker/dev.ts'],bundle:true,write:false,format:'esm',target:'es2022',external:['cloudflare:workers']});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-13',
    durableObjects:{SECURITY:{className:'ProbeSecurity',useSQLite:true},DOMAIN_IO:{className:'DomainIO',useSQLite:true}},
    bindings:{...f.env,ALLOWED_ORIGINS:devOrigin},outboundService:async request=>f.transport(request.url,{method:request.method,headers:request.headers,
        ...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})})}));
const runtimeURL=await runtime.ready,connections=new Set(),errors=[];
const server=createServer(async(req,res)=>{
    try{
        const url=new URL(req.url,'http://localhost');
        if(url.pathname.startsWith('/api/')){
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v&&k!=='host')headers.set(k,Array.isArray(v)?v.join(','):v);
            headers.set('Origin',devOrigin);
            const response=await runtime.dispatchFetch(new URL(req.url,runtimeURL),{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
            res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
        }
        const root=resolve('dist'),file=url.pathname==='/'?resolve(root,'index.html'):resolve(root,'.'+decodeURIComponent(url.pathname));
        if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\'))throw Error('Invalid path');
        const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
        res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
    }catch{res.writeHead(500);res.end('Synthetic fixture error');}
});
server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
server.on('upgrade',(req,socket,head)=>{
    const upstream=connect(Number(runtimeURL.port),runtimeURL.hostname,()=>{
        const lines=[`${req.method} ${req.url} HTTP/1.1`];
        for(const[k,v]of Object.entries(req.headers))if(!['origin','host'].includes(k))lines.push(k+': '+v);
        lines.push('Host: '+runtimeURL.host,'Origin: '+devOrigin,'','');upstream.write(lines.join('\r\n'));
        if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
    const origin='http://127.0.0.1:'+server.address().port;
    const call=async(path,body,token='')=>{
        const response=await runtime.dispatchFetch('https://local/api/v2/'+path,{method:'POST',headers:{Origin:devOrigin,'Content-Type':'application/json','CF-Connecting-IP':'browser-seed',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
        const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
    };
    const pupil=await call('auth/register',{mail:'browser-v2@example.test',password,confirm:password,nombre:'Browser',apellidos:'Synthetic'});
    await call('auth/register',{mail:'ana-v2@example.test',password,confirm:password,nombre:'Ana',apellidos:'Fernández de la Torre y García'});
    await call('auth/register',{mail:'alvaro-v2@example.test',password,confirm:password,nombre:'Álvaro',apellidos:'García'});
    const trainer=await call('auth/login',{mail,password}),today=madridDate(),date=days=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
    await call('commands/competition',{competition:{fecha_comienzo:date(-5),fecha_torneo:date(30),alumnos:[pupil.profile.mail,mail],dias_de_entrenamiento:[1,2,3,4,5,6,7],
        ejercicios_por_sesion:5,tiempo_por_tecnica_segundos:180,descanso_entre_ciclos_segundos:10,descanso_entre_tecnicas_segundos:20},expected:'1',operationId:crypto.randomUUID()},trainer.token);
    const mobile=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),desktop=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const a=await mobile.newPage(),b=await desktop.newPage();for(const page of[a,b]){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());}
    async function login(page,email){await page.goto(origin);await page.getByLabel('Correo',{exact:true}).fill(email);await page.getByLabel('Contraseña',{exact:true}).fill(password);
        await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('heading',{name:'Tu repertorio'}).waitFor();await page.locator('.sync-success').waitFor();}
    await login(a,pupil.profile.mail);await login(b,pupil.profile.mail);
    await a.locator('details.repertoire-position > summary').first().click();await b.locator('details.repertoire-position > summary').first().click();
    const text='Descripción validada en dos dispositivos';
    let throttledAttempts=0;
    await a.route('**/api/v2/commands/repertoire',async route=>{
        throttledAttempts++;
        if(throttledAttempts===1)return route.fulfill({status:429,contentType:'application/json',headers:{'Retry-After':'1'},body:JSON.stringify({error:'RATE_LIMIT'})});
        return route.continue();
    });
    const throttle=a.waitForResponse(r=>r.url().endsWith('/api/v2/commands/repertoire')&&r.status()===429);
    await a.getByLabel('Descripción de técnica o enlace de vídeo').first().fill(text);
    await throttle;
    // An action awaiting flush must not silently log out and discard the draft
    // while the background editor respects Retry-After.
    await a.getByRole('button',{name:'Salir',exact:true}).click();
    await a.getByRole('heading',{name:'Tu repertorio'}).waitFor();
    await a.locator('.sync-success').waitFor();await b.getByLabel('Descripción de técnica o enlace de vídeo').first().filter({visible:true}).waitFor();
    assert.equal(await a.getByText('El guardado está esperando al servidor. Conserva la sesión hasta que se confirme.',{exact:true}).count(),0);
    await assert.doesNotReject(async()=>{for(let i=0;i<40;i++){if(await b.getByLabel('Descripción de técnica o enlace de vídeo').first().inputValue()===text)return;await new Promise(r=>setTimeout(r,100));}throw Error('Second device did not receive update');});
    assert.equal(throttledAttempts,2);await a.unroute('**/api/v2/commands/repertoire');
    await mkdir('.browser-artifacts',{recursive:true});await a.screenshot({path:'.browser-artifacts/v2-mobile.png',fullPage:true});await b.screenshot({path:'.browser-artifacts/v2-desktop.png',fullPage:true});
    await a.getByRole('button',{name:/Mis planes/}).click();await a.getByLabel('Mi plan',{exact:true}).selectOption({index:1});
    const download=a.waitForEvent('download');await a.getByRole('button',{name:'Exportar PDF',exact:true}).click();assert.ok((await download).suggestedFilename().endsWith('.pdf'));
    await a.evaluate(()=>navigator.serviceWorker.ready);
    await mobile.setOffline(true);await a.reload();await a.getByRole('button',{name:/Mis planes/}).waitFor();
    await a.getByRole('button',{name:/Mis planes/}).click();await a.getByLabel('Mi plan',{exact:true}).selectOption({index:1});
    const offlineDownload=a.waitForEvent('download');await a.getByRole('button',{name:'Exportar PDF',exact:true}).click();await offlineDownload;
    await mobile.setOffline(false);await a.locator('.sync-success').waitFor();
    const before=f.metrics();await b.bringToFront();await new Promise(r=>setTimeout(r,1000));
    assert.equal(f.metrics().estimatedReads,before.estimatedReads);assert.equal(f.metrics().attemptedWrites,before.attemptedWrites);
    const coaches = [];
    for (let n = 0; n < 2; n++) {
        const context = await browser.newContext({viewport:{width:1440,height:1000}}), page = await context.newPage();
        coaches.push(page);page.on('pageerror',e=>errors.push(e.message));
        await login(page,mail);
        await page.getByRole('button',{name:'Entrenador',exact:true}).click();
        assert.deepEqual(await page.locator('.student-grid .student-info strong').allTextContents(),
            ['Álvaro García','Ana Fernández de la Torre y García','Browser Synthetic','Trainer Synthetic']);
        await page.locator('.student-card').filter({hasText:'Browser Synthetic'}).click();
        assert.equal(await page.locator('.student-detail details[open]').count(),0);
        await page.locator('.student-detail details > summary').first().click();
        assert.equal(await page.getByLabel('Nombre de posición del alumno').first().getAttribute('readonly'),'');
        assert.equal(await page.getByLabel('Tipo de técnica del alumno').first().getAttribute('readonly'),'');
        assert.equal(await page.getByLabel('Descripción del alumno',{exact:true}).first().getAttribute('readonly'),'');
        assert.equal(await page.getByLabel('Comentario',{exact:true}).first().isEnabled(),true);
    }
    let commentRequests=0;coaches[0].on('request',r=>{if(r.url().endsWith('/api/v2/commands/comments'))commentRequests++;});
    await coaches[1].getByLabel('Comentario',{exact:true}).first().fill('Draft on another device');
    await coaches[0].getByLabel('Comentario',{exact:true}).first().fill('Confirmed remote comment');
    await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(commentRequests,0);
    let lostAck = false;
    let releaseCommentAck,commentCommitted;
    const heldCommentAck=new Promise(resolve=>{releaseCommentAck=resolve;});
    const committedComment=new Promise(resolve=>{commentCommitted=resolve;});
    await coaches[0].route('**/api/v2/commands/comments', async route => {
        const response = await route.fetch(); assert.ok(response.ok());
        commentCommitted();await heldCommentAck;
        lostAck = true; await route.abort('failed');
    }, {times:1});
    await coaches[0].getByRole('button',{name:'Guardar comentario remoto'}).first().click();
    await committedComment;
    await coaches[0].getByLabel('Comentario',{exact:true}).first().press('ControlOrMeta+A');
    await coaches[0].getByLabel('Comentario',{exact:true}).first().pressSequentially('New unsent draft while saving');
    releaseCommentAck();
    await coaches[1].getByText('Los comentarios han cambiado.',{exact:false}).waitFor();
    assert.equal(lostAck,true);
    await coaches[0].waitForFunction(()=>document.querySelector('.student-detail form button')?.disabled===false);
    assert.equal(await coaches[0].getByLabel('Comentario',{exact:true}).first().inputValue(),'New unsent draft while saving');
    assert.equal(commentRequests,2); // one save, original operationId retry after lost HTTP ACK
    await coaches[0].getByLabel('Comentario',{exact:true}).first().fill('Confirmed remote comment');
    const conflictingForm = coaches[1].locator('.student-detail form').filter({has:coaches[1].getByText('Los comentarios han cambiado.',{exact:false})});
    assert.equal(await conflictingForm.getByRole('textbox').inputValue(),'Draft on another device');
    assert.equal(await conflictingForm.getByRole('button',{name:'Guardar comentario remoto'}).isDisabled(),true);
    await coaches[1].getByRole('button',{name:'Cargar comentarios actuales'}).click();
    await coaches[1].getByText('Confirmed remote comment',{exact:true}).waitFor();
    assert.ok((await coaches[1].locator('.student-detail form textarea').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('Confirmed remote comment'));
    await coaches[0].screenshot({path:'.browser-artifacts/v2-trainer.png',fullPage:true});
    await a.getByRole('button',{name:/Mis t/}).click();
    const received = await runtime.dispatchFetch('https://local/api/v2/users/'+pupil.profile.mail+'/comments',{headers:{Origin:devOrigin,Authorization:'Bearer '+pupil.token}});
    const savedComment = (await received.json()).data.comments.find(c=>c.comment==='Confirmed remote comment');assert.ok(savedComment);
    const position = a.locator('details.repertoire-position').filter({has:a.locator('#technique-'+savedComment.techniqueId)});
    if (!await position.evaluate(n=>n.open)) await position.locator('summary').click();
    await a.locator('#technique-'+savedComment.techniqueId).getByText('Confirmed remote comment',{exact:false}).waitFor();
    await a.getByRole('button',{name:'Notificaciones, 1 pendientes',exact:true}).waitFor();
    // Belt changes are explicit, preserve a failed draft, then update both the
    // student detail and the roster. The pupil's existing session stays valid.
    const coach=coaches[0];
    await coach.getByRole('button',{name:'Administración',exact:true}).click();
    let beltRequests=0;coach.on('request',r=>{if(r.url().endsWith('/api/v2/commands/belt'))beltRequests++;});
    await coach.getByLabel('Cinturón del alumno',{exact:true}).selectOption('Azul');assert.equal(beltRequests,0);
    await coach.route('**/api/v2/commands/belt',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC_BELT_FAILURE'})}),{times:1});
    const failedBelt=coach.waitForResponse(r=>r.url().endsWith('/api/v2/commands/belt')&&r.status()===503);
    await coach.getByRole('button',{name:'Guardar cinturón',exact:true}).click();await failedBelt;
    await coach.waitForFunction(()=>!document.querySelector('.student-belt-editor button')?.disabled);
    assert.equal(await coach.getByLabel('Cinturón del alumno',{exact:true}).inputValue(),'Azul');
    const savedBelt=coach.waitForResponse(r=>r.url().endsWith('/api/v2/commands/belt')&&r.status()===200);
    await coach.getByRole('button',{name:'Guardar cinturón',exact:true}).click();await savedBelt;
    await coach.locator('.student-detail .pill').filter({hasText:'Azul'}).waitFor();
    await coach.locator('.student-card').filter({hasText:'Browser Synthetic'}).filter({hasText:'Azul'}).waitFor();
    assert.equal(beltRequests,2);
    await a.locator('.sync-success').waitFor();
    await coach.locator('.student-belt-editor').screenshot({path:'.browser-artifacts/v2-student-belt.png'});
    // Complete names and the same alphabetical order in list and creation form.
    await coach.getByRole('button',{name:'Competiciones',exact:true}).click();
    const orderedNames=['Álvaro García','Ana Fernández de la Torre y García','Browser Synthetic','Trainer Synthetic'];
    assert.deepEqual(await coach.locator('.competition-card .participant-choice strong').allTextContents(),orderedNames);
    let assignments=0;coach.on('request',r=>{if(r.url().endsWith('/api/v2/commands/assignment'))assignments++;});
    const ana=coach.locator('.competition-card .participant-choice').filter({hasText:'Ana Fernández de la Torre y García'}).getByRole('checkbox');
    await ana.check();assert.equal(assignments,0);await ana.uncheck();
    assert.equal(await coach.getByRole('button',{name:'Guardar datos',exact:true}).isDisabled(),true);
    await coach.locator('.competition-card').screenshot({path:'.browser-artifacts/v2-competitions-desktop.png'});
    await coach.setViewportSize({width:390,height:844});
    await coach.locator('.competition-card').screenshot({path:'.browser-artifacts/v2-competitions-mobile.png'});
    assert.equal(await coach.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await coach.setViewportSize({width:1440,height:1000});
    await coach.getByRole('button',{name:'Nueva competición',exact:true}).click();
    assert.deepEqual(await coach.locator('.competition-create .participant-choice strong').allTextContents(),orderedNames);
    assert.equal(await coach.locator('.competition-create .participant-choice').filter({hasText:'Trainer Synthetic'}).count(),1);
    await coach.getByRole('button',{name:'Equipo',exact:true}).click();
    await coach.getByRole('button',{name:'Técnicas',exact:true}).click();
    await coach.locator('.student-detail details > summary').first().click();
    await coach.locator('.student-detail').screenshot({path:'.browser-artifacts/v2-team-techniques-desktop.png'});
    await coach.setViewportSize({width:390,height:844});
    await coach.locator('.student-detail').screenshot({path:'.browser-artifacts/v2-team-techniques-mobile.png'});
    assert.equal(await coach.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await coach.setViewportSize({width:1440,height:1000});
    // Empty names while replacing placeholder text are incomplete editor input,
    // not failed HTTP writes. Exercise the exact reported creation sequence.
    const submittedDrafts=[];
    const trackDraft=request=>{if(request.method()==='POST'&&request.url().endsWith('/api/v2/commands/repertoire'))submittedDrafts.push(request.postDataJSON());};
    b.on('request',trackDraft);
    await b.getByRole('button',{name:'Añadir posición',exact:true}).click();
    const newPosition=b.locator('details.repertoire-position').last();
    await newPosition.getByRole('button',{name:'Añadir técnica',exact:true}).click();
    await newPosition.getByLabel('Tipo de técnica',{exact:true}).fill('');
    await b.locator('#technique-draft-validation').filter({hasText:'Completa el nombre de la técnica para guardar los cambios.'}).waitFor();
    await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(submittedDrafts.length,0);
    assert.equal(await b.getByRole('button',{name:'Reintentar guardado',exact:true}).count(),0);
    await newPosition.getByLabel('Tipo de técnica',{exact:true}).fill('Técnica nueva validada');
    await newPosition.getByLabel('Descripción de técnica o enlace de vídeo').fill('Descripción nueva conservada');
    await newPosition.getByLabel('Nombre de posición',{exact:true}).fill('');
    await b.locator('#technique-draft-validation').filter({hasText:'Completa el nombre de la posición para guardar los cambios.'}).waitFor();
    await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(submittedDrafts.length,0);
    await newPosition.screenshot({path:'.browser-artifacts/v2-draft-invalid-desktop.png'});
    await b.setViewportSize({width:390,height:844});
    await newPosition.screenshot({path:'.browser-artifacts/v2-draft-invalid-mobile.png'});
    await b.setViewportSize({width:1440,height:1000});
    const validDraft=b.waitForResponse(r=>r.url().endsWith('/api/v2/commands/repertoire')&&r.status()===200);
    await newPosition.getByLabel('Nombre de posición',{exact:true}).fill('Posición nueva validada');
    await validDraft;await b.locator('.sync-success').waitFor();
    assert.equal(submittedDrafts.length,1);
    assert.equal(submittedDrafts[0].data.positions.at(-1).tecnicas[0].descripcion_del_alumno,'Descripción nueva conservada');
    assert.equal(await b.locator('#technique-draft-validation').count(),0);
    b.off('request',trackDraft);
    assert.deepEqual(errors,[]);
    console.log('Actual PWA + DEV V2 Worker + intercepted Firestore: two-device live text, trainer concurrent comment draft/CAS conflict, screenshots, offline complete plan/PDF, focus/idle zero database operations PASS.');
}finally{await browser.close();for(const socket of connections)socket.destroy();await new Promise(r=>server.close(r));await runtime.dispose();}
