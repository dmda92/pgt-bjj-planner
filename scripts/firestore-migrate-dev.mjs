import {readFile} from 'node:fs/promises';
import {inspectMigration} from '../worker/firestore-migration.ts';
const [mode,path,...rest]=process.argv.slice(2);
if(mode!=='--dry-run'||!path||rest.length)throw Error('Usage: node scripts/firestore-migrate-dev.mjs --dry-run local-synthetic-export.json');
const records=JSON.parse(await readFile(path,'utf8'));
console.log(JSON.stringify(await inspectMigration(records,'pgt-bjj-dev'),null,2));
