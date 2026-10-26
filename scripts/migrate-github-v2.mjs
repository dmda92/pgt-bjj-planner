import {readFileSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {extractGithubSnapshot,validateSnapshot} from '../tools/migration/github-source.ts';
import {convertSnapshot,verifyBundle} from '../tools/migration/convert.ts';
import {encryptPackage,decryptPackage} from '../tools/migration/private-package.ts';

const [command,...args]=process.argv.slice(2),options=new Map();
for(let i=0;i<args.length;i++){
    if(!args[i].startsWith('--'))throw Error('MIGRATION_OPTION_INVALID');
    if(options.has(args[i]))throw Error('MIGRATION_DUPLICATE_OPTION');
    options.set(args[i],args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true);
}
const option=name=>{const value=options.get('--'+name);if(typeof value!=='string'||!value)throw Error('MIGRATION_REQUIRED_OPTION');return value;};
function privatePath(value){
    const path=resolve(value),parent=realpathSync(dirname(path)),workspace=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
    const actual=existsSync(path)?realpathSync(path):resolve(parent,path.split(/[\\/]/).at(-1));
    const rel=relative(workspace,actual);
    if(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../'))throw Error('MIGRATION_PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    return path;
}
const readKey=()=>readFileSync(privatePath(option('key-file')));
const writePrivate=(path,value)=>writeFileSync(privatePath(path),JSON.stringify(value),{encoding:'utf8',mode:0o600,flag:'wx'});
const readPrivate=()=>decryptPackage(JSON.parse(readFileSync(privatePath(option('input')),'utf8')),readKey());
async function main(){
    if(!command||command==='help'||command==='--help'){
        console.log('Read-only GitHub migration; never writes GitHub or Firestore.\n'+
            'keygen --key-file <outside-repository>\n'+
            'extract --commit <40-hex-SHA> --allow-github-read --key-file <file> --output <file>\n'+
            'convert --project <pgt-bjj-dev|pgt-bjj-pro> --key-file <file> --input <file> --output <file>\n'+
            'inspect --key-file <file> --input <file>\n'+
            'extract uses PGT_MIGRATION_GITHUB_READ_TOKEN. All data packages are AES-256-GCM encrypted.\n'+
            'Conversion is offline. Activation/import are not performed by this command.');
        return;
    }
    if(command==='keygen'){
        writeFileSync(privatePath(option('key-file')),randomBytes(32),{mode:0o600,flag:'wx'});
        console.log('MIGRATION_KEY_CREATED');return;
    }
    if(command==='extract'){
        if(options.get('--allow-github-read')!==true)throw Error('MIGRATION_GITHUB_READ_NOT_ENABLED');
        const key=readKey();if(key.length!==32)throw Error('MIGRATION_KEY_MUST_BE_32_BYTES');
        const snapshot=await extractGithubSnapshot({commit:option('commit'),token:process.env.PGT_MIGRATION_GITHUB_READ_TOKEN||''});
        writePrivate(option('output'),encryptPackage(snapshot,key));
        console.log(JSON.stringify({status:'SOURCE_CAPTURED',commit:snapshot.commit,files:snapshot.files.length}));return;
    }
    if(command==='convert'){
        const source=readPrivate(),bundle=convertSnapshot(source,option('project'));
        writePrivate(option('output'),encryptPackage(bundle,readKey()));
        console.log(JSON.stringify({status:'CONVERTED_OFFLINE',target:bundle.target,users:bundle.users.length,plans:bundle.plans.length,
            ready:bundle.ready,issues:bundle.issues.map(i=>({code:i.code,blocking:i.blocking}))}));return;
    }
    if(command==='inspect'){
        const value=readPrivate();
        if(value.format==='pgt-github-source-v1'){validateSnapshot(value);console.log(JSON.stringify({format:value.format,commit:value.commit,files:value.files.length}));}
        else{verifyBundle(value);console.log(JSON.stringify({format:value.format,target:value.target,users:value.users.length,plans:value.plans.length,ready:value.ready}));}
        return;
    }
    throw Error('MIGRATION_COMMAND_INVALID');
}
main().catch(error=>{
    const code=error instanceof Error&&/^(MIGRATION_|SOURCE_)[A-Z0-9_]+$/.test(error.message)?error.message:'MIGRATION_FAILED';
    console.error(code);process.exitCode=1;
});
