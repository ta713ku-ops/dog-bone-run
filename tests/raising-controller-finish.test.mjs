import assert from 'node:assert/strict';
import test from 'node:test';
import {RaisingController} from '../src/raising-controller.js';
import {createInitialSave,applyCommand} from '../src/raising-model.js';

function nodes(){const map=new Map();globalThis.document={getElementById:id=>{if(!map.has(id))map.set(id,{disabled:false,hidden:true,textContent:''});return map.get(id);}};return map;}
test('failed settlement retains its run identity and retries exactly once',async()=>{
 const els=nodes(),calls=[];const c=Object.create(RaisingController.prototype);
 c.currentRunId='run-finish-test';c.game={walkDifficulty:1,course:[],fall:null};
 c.command=async command=>{calls.push(structuredClone(command));return calls.length===1?{ok:false,error:'transaction_aborted'}:{ok:true,result:{reward:5}};};
 await c.settle({reason:'finish',normalCollected:0,goldCollected:0,completed:true,score:0,maxCombo:0,progress:1});
 assert.equal(c.currentRunId,'run-finish-test');assert.equal(c.pendingSettlement.runId,'run-finish-test');
 assert.equal(els.get('end').disabled,true);assert.equal(els.get('retry-settlement').hidden,false);
 await c.retrySettlement();assert.deepEqual(calls[0],calls[1]);assert.equal(c.currentRunId,null);assert.equal(c.pendingSettlement,null);
 assert.equal(els.get('end').disabled,false);assert.equal(els.get('retry-settlement').hidden,true);
 await c.retrySettlement();assert.equal(calls.length,2);
});
test('pending settlement blocks a new run without touching storage',async()=>{
 nodes();const c=Object.create(RaisingController.prototype);let called=0;
 c.pendingSettlement={runId:'pending'};c.ui={close(){},notice(){}};c.command=async()=>{called++;};
 assert.equal(await c.beforeRun(1),false);assert.equal(called,0);
});
test('home tick preserves a valid 2 second interval',async()=>{
 const els=nodes();els.set('settings-panel',{hidden:true});document.hidden=false;
 const c=Object.create(RaisingController.prototype);c.ready=true;c.store={owner:true,tabId:'test',epoch:1};c.game={state:'ready'};c.lastHomeTime=performance.now()-2000;c.sessionId='session-test';
 let elapsed;c.command=async cmd=>{elapsed=cmd.elapsedMs;};await c.pump();assert.ok(elapsed>=1990&&elapsed<=2050);
});
test('zero-gain pet animates without a transaction or revision change',async()=>{
 const c=Object.create(RaisingController.prototype),save=createInitialSave();save.dog.mood=100;
 c.state=save;c.ready=true;c.sequence=Promise.resolve();let pets=0,transactions=0;
 c.scene={pet(){pets++;}};c.store={transact(){transactions++;throw Error('must not transact');}};
 const r=await c.command({type:'pet'});assert.equal(r.ok,true);assert.equal(r.result.noop,true);assert.equal(c.state,save);assert.equal(save.revision,0);assert.equal(transactions,0);assert.equal(pets,1);
});
test('care is not charged or started while the dog is exiting the house',async()=>{
 const c=Object.create(RaisingController.prototype);c.state=createInitialSave();c.state.dog.energy=60;c.ready=true;c.sequence=Promise.resolve();
 let outside,closed=0,writes=0;
 c.scene={inside:false,houseTransition:{to:0},leaveHouse:()=>new Promise(resolve=>{outside=resolve;})};
 c.ui={close(){closed++;},root:{querySelector:()=>({dataset:{}})}};
 c.applySettings=()=>{};c.render=()=>{};
 c.store={tabId:'test',epoch:1,transact:async transform=>{writes++;return{ok:true,...transform(c.state)};}};
 const care=c.command({type:'rest'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,1);assert.equal(writes,0);assert.equal(c.state.activeAction,null);
 outside();await care;assert.equal(writes,1);assert.equal(c.state.activeAction.kind,'rest');
});
