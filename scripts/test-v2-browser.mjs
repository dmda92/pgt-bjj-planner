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
    await a.locator('.sync-success').waitFor();await b.getByLabel('Descripción de técnica o enlace de vídeo').first().filter({visible:true}).waitFor();
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
        await page.locator('.student-card').filter({hasText:'Browser Synthetic'}).click();
        await page.locator('.student-detail details > summary').first().click();
    }
    await coaches[1].getByLabel('Comentario',{exact:true}).first().fill('Draft on another device');
    await coaches[0].getByLabel('Comentario',{exact:true}).first().fill('Confirmed remote comment');
    let lostAck = false;
    await coaches[0].route('**/api/v2/commands/comments', async route => {
        const response = await route.fetch(); assert.ok(response.ok());
        lostAck = true; await route.abort('failed');
    }, {times:1});
    await coaches[0].getByRole('button',{name:'Guardar comentario remoto'}).first().click();
    await coaches[1].getByText('Los comentarios han cambiado.',{exact:false}).waitFor();
    assert.equal(lostAck,true);
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
    assert.deepEqual(errors,[]);
    console.log('Actual PWA + DEV V2 Worker + intercepted Firestore: two-device live text, trainer concurrent comment draft/CAS conflict, screenshots, offline complete plan/PDF, focus/idle zero database operations PASS.');
}finally{await browser.close();for(const socket of connections)socket.destroy();await new Promise(r=>server.close(r));await runtime.dispose();}
