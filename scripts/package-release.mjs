import {execFileSync} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CONFIG} from '../src/config.js';

const root='dist';
const version=JSON.parse(await readFile(`${root}/version.json`,'utf8'));
if(version.buildVersion!==CONFIG.buildVersion||version.diagnosticBuild)throw new Error('Build the current normal distribution before packaging.');
const files=[];
async function scan(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=`${directory}/${entry.name}`;
    if(entry.isDirectory())await scan(path);
    else if(entry.isFile()){
      const relative=path.slice(root.length+1);
      if(/(?:^|\/)(?:\.|reference\/|source\/|tests?\/|node_modules\/)|(?:\.env|\.pem|\.key|\.swift|Secrets\.xcconfig)$/i.test(relative))throw new Error(`Unexpected distribution entry: ${relative}`);
      const bytes=await readFile(path);
      if(/\.(?:js|html|css|json|webmanifest|txt)$/.test(relative)&&/(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{25,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})/.test(bytes.toString()))throw new Error(`Potential credential in ${relative}`);
      files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }else throw new Error(`Non-file distribution entry: ${path}`);
  }
}
await scan(root);files.sort((a,b)=>a.path.localeCompare(b.path));
await mkdir('release',{recursive:true});
const zip=`release/hone-no-osanpo-v${CONFIG.buildVersion}-web.zip`;
execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr',root,zip]);
const archive=await readFile(zip);
const manifest={version:CONFIG.buildVersion,createdAt:new Date().toISOString(),zip,archiveBytes:(await stat(zip)).size,archiveSha256:createHash('sha256').update(archive).digest('hex'),files,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),diagnosticBuild:false,physicalIPhoneVerified:false,storePaymentsConfigured:false};
await writeFile(`release/v${CONFIG.buildVersion}-manifest.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({zip,files:files.length,bytes:manifest.archiveBytes,sha256:manifest.archiveSha256}));
