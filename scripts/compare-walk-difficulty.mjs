import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {createParkCourse} from '../src/park-course.js';
import {createMountainCourse} from '../src/mountain-course.js';

const summary={seeds:100,scope:'Same obstacle-blind bone-following driver; this is not a human difficulty ratio.',levels:[]};
const stats=values=>({min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length});
for(const level of [2,3]){
  const rows=[];
  for(let seed=0;seed<100;seed++){
    const course=level===2?createParkCourse(seed):createMountainCourse(seed);
    const game=new Game({phase:4,walkLevel:level,seed});game.start();let lane=0;
    for(const bone of course.bones){
      const count=Math.abs(bone.lane-lane),direction=Math.sign(bone.lane-lane);
      for(let step=0;step<count;step++){
        const at=bone.timeMs-(count-step)*200;
        game.advance(at-game.timeMs);assert.ok(game.command(direction,'bone-only-comparison'));
      }
      lane=bone.lane;
    }
    game.advance(30000-game.timeMs);
    assert.equal(game.collected,48);assert.equal(game.timeMs,30000);
    rows.push({seed,safeInputs:course.safeInputs.length,contacts:game.contactCount,contactEvents:game.contactEventCount});
  }
  summary.levels.push({level,safeInputs:stats(rows.map(r=>r.safeInputs)),blindContacts:stats(rows.map(r=>r.contacts)),blindContactEvents:stats(rows.map(r=>r.contactEvents)),rows});
}
summary.blindMeanContactRatio=summary.levels[1].blindContacts.mean/summary.levels[0].blindContacts.mean;
console.log(JSON.stringify(summary,null,2));
