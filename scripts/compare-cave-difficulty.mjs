import {Game} from '../src/game.js';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const models=[
  {id:'reference',delay:0,jitter:0},
  {id:'delay80',delay:80,jitter:0},
  {id:'delay160',delay:160,jitter:0},
  {id:'delay240',delay:240,jitter:0},
  {id:'jitter40',delay:0,jitter:40},
  {id:'jitter80',delay:0,jitter:80},
  {id:'bone-only'},
];
const aggregate=values=>({min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length});
const sourceHashes=Object.fromEntries(await Promise.all(['src/cave-course.js','src/mountain-course.js','src/game.js','src/config.js'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={checkedAt:new Date().toISOString(),sourceHashes,modelVersion:'cave-comparison-v1',seeds:100,parameters:models,scope:'Same models fixed before examining results; machine sensitivity is separate from human perceived difficulty.',levels:[]};
for(const level of [3,4]){
  const summaries=[];
  for(const model of models){
    const rows=[];
    for(let seed=0;seed<100;seed++){
      const g=new Game({phase:4,walkLevel:level,seed});let inputs=g.courseData.safeInputs;
      if(model.id==='bone-only'){
        inputs=[];let lane=0;
        for(const bone of g.bones){const count=Math.abs(bone.lane-lane),direction=Math.sign(bone.lane-lane);
          for(let i=0;i<count;i++)inputs.push({timeMs:bone.timeMs-(count-i)*200,direction});lane=bone.lane;}
      }
      g.start();let rejected=0;
      for(const [i,input] of inputs.entries()){
        const noise=(((Math.imul(i+1,1103515245)^Math.imul(seed+1,12345))>>>0)%2001/1000-1)*(model.jitter??0);
        const at=Math.max(g.timeMs,Math.min(29999,input.timeMs+(model.delay??0)+noise));
        g.advance(at-g.timeMs);if(!g.command(input.direction,model.id))rejected++;
      }
      g.advance(30000-g.timeMs);
      rows.push({seed,contacts:g.contactCount,contactEvents:g.contactEventCount,collected:g.collected,collectionRate:g.collected/48,rejected});
    }
    summaries.push({model:model.id,contacts:aggregate(rows.map(r=>r.contacts)),contactEvents:aggregate(rows.map(r=>r.contactEvents)),collectionRate:aggregate(rows.map(r=>r.collectionRate)),rejected:aggregate(rows.map(r=>r.rejected)),rows});
  }
  report.levels.push({level,models:summaries});
}
report.ratios=models.map((model,i)=>{const a=report.levels[0].models[i],b=report.levels[1].models[i];return {model:model.id,contactEventRatio:a.contactEvents.mean?b.contactEvents.mean/a.contactEvents.mean:null};});
await mkdir('test-results/cave-v33',{recursive:true});await writeFile('test-results/cave-v33/difficulty-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({parameters:models,levels:report.levels.map(l=>({level:l.level,models:l.models.map(({rows,...r})=>r)})),ratios:report.ratios},null,2));
