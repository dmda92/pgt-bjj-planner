import {build} from 'esbuild';
import {mkdir,rm,copyFile,writeFile} from 'node:fs/promises';
const base=process.env.VITE_API_BASE_URL||'';
if(base&&(!base.startsWith('https://')||new URL(base).origin!==base))throw Error('VITE_API_BASE_URL debe ser origen HTTPS exacto sin barra final');
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await build({entryPoints:['src/client.ts'],outfile:'dist/app.js',bundle:true,minify:true,format:'esm',target:'es2022',define:{API_BASE:JSON.stringify(base)}});
await copyFile('src/index.html','dist/index.html');await copyFile('src/style.css','dist/style.css');
await writeFile('dist/_headers',`/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${base}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n`);
console.log('Cliente de prueba compilado en dist; no es aún la PWA de entrenamiento.');
