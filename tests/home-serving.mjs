import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const version=JSON.parse(await readFile('dist/version.json'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence=[];
for(const root of ['http://127.0.0.1:4183',process.env.DOG_LAN_URL||'http://172.20.10.10:4174']){
 for(const path of ['index.html','version.json','styles.css','favicon.svg',...version.modules,...version.assets]){
  const response=await fetch(`${root}/${path}?v=${version.buildVersion}`);
  if(!response.ok)throw Error(`${root}/${path}: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(digest(bytes)!==digest(await readFile(`dist/${path}`)))throw Error(`${root}/${path}: stale bytes`);
  evidence.push({root,path,sha256:digest(bytes)});
 }
 if((await fetch(`${root}/continuity-comparison.html`)).status!==404)throw Error('Development page shipped');
}
const output=process.env.DOG_RESULTS_DIR||'test-results/motion-repair-v15';
await mkdir(output,{recursive:true});
await writeFile(`${output}/serving-results.json`,JSON.stringify({version:version.buildVersion,evidence},null,2));
console.log(`${evidence.length} served files match dist`);
