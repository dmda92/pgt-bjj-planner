import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Frozen business input, independently obtained from the original official file.
// Never derive the expected catalogue from the deployed app or a previous result.
const fixturePath=resolve(dirname(fileURLToPath(import.meta.url)),'../fixtures/official-template.json');
export function prepareTemplateReference(campaign){
    const raw=readFileSync(fixturePath),fixture=JSON.parse(raw.toString('utf8'));
    if(fixture.positions.length!==17||fixture.positions.flatMap(p=>p.types).length!==36)throw Error('Invalid independent template fixture');
    const path=resolve(campaign,'reference-official-template.json');
    const reference={...fixture,fixtureSha256:createHash('sha256').update(raw).digest('hex'),preparedAt:new Date().toISOString(),scope:'Independent immutable input; no previous campaign outcomes or snapshots'};
    if(existsSync(path)){
        const previous=JSON.parse(readFileSync(path,'utf8'));
        if(previous.fixtureSha256!==reference.fixtureSha256)throw Error('Campaign template reference differs from frozen fixture; review explicitly');
        return path;
    }
    writeFileSync(path,JSON.stringify(reference,null,2)+'\n');
    return path;
}
