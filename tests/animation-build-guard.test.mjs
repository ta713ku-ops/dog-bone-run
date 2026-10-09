import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
test('production build rejects a modified atlas before replacing dist',async()=>{
 const root=resolve('.'),temp=await mkdtemp(join(tmpdir(),'dog-atlas-guard-'));
 try{
  await mkdir(join(temp,'art'));await mkdir(join(temp,'dist'));
  await writeFile(join(temp,'dist','keep.txt'),'previous good build');
  for(const file of ['dog-image-animation.json','dog-home-motion.json']){
   const metadata=JSON.parse(await readFile(join(root,'art',file),'utf8'));
   for(const item of [...Object.values(metadata.sourceSheets),metadata.generator,...Object.values(metadata.atlases)])item.path=join(root,item.path);
   if(file==='dog-home-motion.json'){
    const corrupted=join(temp,'corrupted.webp');await writeFile(corrupted,'broken texture');
    metadata.atlases.sitdown.path=corrupted;
   }
   await writeFile(join(temp,'art',file),JSON.stringify(metadata));
  }
  const result=spawnSync(process.execPath,[join(root,'scripts/build.mjs')],{cwd:temp,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Animation source, packing rules or output changed/);
  assert.match(result.stderr,/corrupted.webp/);await access(join(temp,'dist','keep.txt'));
 }finally{await rm(temp,{recursive:true,force:true});}
});
