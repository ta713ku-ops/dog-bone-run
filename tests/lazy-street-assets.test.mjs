import test from 'node:test';
import assert from 'node:assert/strict';
import {StreetMaterials} from '../src/street-materials.js';
import {StreetFacadeArt} from '../src/street-facade-art.js';
import {StreetToyArt} from '../src/street-toy-art.js';
import {StreetObstacleArt} from '../src/street-obstacle-art.js';

for(const Constructor of[StreetMaterials,StreetFacadeArt,StreetToyArt,StreetObstacleArt]){
 test(`${Constructor.name} does not compete with home startup and starts one shared load on demand`,async()=>{
  let count=0;
  class UnavailableImage {constructor(){count++;}set src(value){queueMicrotask(()=>this.onerror?.());}}
  const art=new Constructor({ImageCtor:UnavailableImage,lazy:true});
  assert.equal(count,0);
  const first=art.ready,second=art.ready;assert.equal(first,second);assert.equal(count,1);
  await first;assert.equal(count,1);assert.ok(Object.values(art.stats).every(state=>state==='fallback'));
 });
}
