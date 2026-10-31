import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CONFIG} from '../src/config.js';
const base=process.env.PUBLISH_URL??'https://ta713ku-ops.github.io/dog-bone-run/';
const output=process.env.PUBLISH_HASH_OUTPUT??'test-results/github-publish-v39';
const files=[];async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await inventory(path);else files.push(path.slice(5));}}
await inventory('dist');files.sort();await mkdir(output,{recursive:true});
const results=[];let next=0;
await Promise.all(Array.from({length:8},async()=>{while(next<files.length){const path=files[next++],expected=createHash('sha256').update(await readFile(`dist/${path}`)).digest('hex');let result;
 for(let attempt=0;attempt<3;attempt++){
  const url=new URL(path,base);url.searchParams.set('v',CONFIG.buildVersion);url.searchParams.set('verify',process.env.PUBLISH_REVISION??'release');
  try{const response=await fetch(url,{signal:AbortSignal.timeout(30000),cache:'no-store'}),bytes=Buffer.from(await response.arrayBuffer()),actual=createHash('sha256').update(bytes).digest('hex');result={path,status:response.status,bytes:bytes.length,expected,actual,match:response.status===200&&actual===expected};}
  catch(error){result={path,expected,match:false,error:error.message};}
  if(result.match)break;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,2000));
 }
 results.push(result);
}}));
results.sort((a,b)=>a.path.localeCompare(b.path));
const excluded=[];for(const path of['device-check/index.html','tests/publish-v39.browser.mjs','src/home-real-preview.js','art/reference/dog-original-2.jpg','Secrets.xcconfig','.env']){const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(30000)});excluded.push({path,status:response.status});}
const report={base,version:CONFIG.buildVersion,files:results.length,matching:results.filter(r=>r.match).length,excluded,results};await writeFile(`${output}/public-hashes.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({base,version:report.version,files:report.files,matching:report.matching,excluded}));
assert.equal(report.matching,report.files,'public files must match the isolated build');assert.ok(excluded.every(r=>r.status===404),'diagnostics, prototypes and secrets must not be published');
