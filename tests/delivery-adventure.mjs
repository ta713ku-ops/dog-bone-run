import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CONFIG} from '../src/config.js';
const roots=['http://127.0.0.1:4174','http://192.168.1.4:4174'];
const hash=b=>createHash('sha256').update(b).digest('hex');
async function files(path){const result=[];for(const e of await readdir(path,{withFileTypes:true})){const p=`${path}/${e.name}`;if(e.isDirectory())result.push(...await files(p));else result.push(p);}return result;}
const evidence=[];
for(const file of await files('dist')){
 const expected=hash(await readFile(file));
 for(const root of roots){
  const url=`${root}/${file.slice(5)}?v=${CONFIG.buildVersion}`;
  const r=await fetch(url,{signal:AbortSignal.timeout(10000)});
  const actual=hash(Buffer.from(await r.arrayBuffer()));
  assert.equal(r.status,200,url);assert.equal(r.headers.get('cache-control'),'no-store',url);assert.equal(actual,expected,url);
  evidence.push({url,status:r.status,cache:r.headers.get('cache-control'),sha256:actual});
 }
}
const version=JSON.parse(await readFile('dist/version.json','utf8'));
assert.equal(version.buildVersion,CONFIG.buildVersion);assert.equal(version.configVersion,CONFIG.configVersion);assert.equal(version.durationMs,30000);assert.equal(version.ruleVersion,'sprint30-hard-v1');
await writeFile('test-results/adventure-delivery-results.json',JSON.stringify({version,evidence},null,2));
console.log(JSON.stringify({version,checkedFiles:evidence.length/2,successfulResponses:evidence.length,roots},null,2));
