import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render.js';

test('a paused frame stays still while changed content, assets and settings invalidate it',()=>{
  const renderer=Object.create(Renderer.prototype);
  let paints=0;
  Object.assign(renderer,{width:390,height:844,canvas:{width:390,height:844},effects:[],
    reducedMotion:false,roadDecoration:'modest',roadComfortFlags:{},
    adventure:{stats:{facades:'pending'}},drawFrame(){paints++;}});
  const game={state:'paused',timeMs:5000,distance:5,x:0,lane:0,score:10};
  renderer.draw(game);renderer.draw(game);
  assert.equal(paints,1);
  renderer.adventure.stats.facades='ready';renderer.draw(game);
  assert.equal(paints,2,'a newly decoded material is still painted while paused');
  renderer.debug=true;renderer.draw(game);
  assert.equal(paints,3,'debug/settings changes remain visible');
  game.score=0;renderer.effects.push({points:-10});renderer.draw(game);
  assert.equal(paints,4,'a changed paused fixture cannot retain stale content');
  renderer.draw(game,{force:true});assert.equal(paints,5,'verification may force a complete draw');
  game.state='running';renderer.draw(game);renderer.draw(game);
  assert.equal(paints,7,'live animation is never frozen');
  game.state='paused';renderer.draw(game);
  renderer.draw({...game});assert.equal(paints,9,'a new course object cannot reuse an earlier attempt');
});

test('the street background uses a bounded raster layer and restores the crisp foreground',()=>{
  const previous=globalThis.devicePixelRatio;globalThis.devicePixelRatio=2;
  try {
    const layer={width:0,height:0}, transforms=[], copies=[];
    const background={setTransform(...args){transforms.push(args);}};
    layer.getContext=()=>background;
    const foreground={drawImage(...args){copies.push(args);}};
    const renderer=Object.create(Renderer.prototype);
    const game=Object.freeze({state:'running',timeMs:1000});
    Object.assign(renderer,{width:390,height:844,ctx:foreground,
      canvas:{ownerDocument:{createElement(){return layer;}}},
      adventure:{draw(r,g){assert.equal(r.ctx,background);assert.equal(g,game);assert.equal(r.width,390);}}});
    renderer.drawAdventure(game,{menu:false});
    assert.equal(renderer.ctx,foreground);
    assert.equal(layer.width,390);assert.equal(layer.height,844);
    assert.equal(copies.length,1);assert.deepEqual(copies[0].slice(-4),[0,0,390,844]);
    renderer.adventure.draw=()=>{throw new Error('fixture');};
    assert.throws(()=>renderer.drawAdventure(game,{menu:false}),/fixture/);
    assert.equal(renderer.ctx,foreground,'failed scenery cannot corrupt the gameplay context');
  } finally {if(previous===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previous;}
});
