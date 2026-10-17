import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render.js';
import { sampleContactReaction } from '../src/contact-feedback.js';

test('every playable obstacle gets a local impact, including balls and zero-point contacts', () => {
  for (const obstacleType of ['litter','crow','cat','puddle','ball','root','rock','log','rollingStone','stalagmite','stalactite','caveRock','bat']) {
    const renderer = { effects: [] };
    Renderer.prototype.contact.call(renderer, { type:'obstacle_contact', obstacleType, activeMs:1000, points:0 });
    assert.equal(sampleContactReaction(renderer.effects, 1000).active, true, obstacleType);
    assert.equal(renderer.effects.filter(e=>e.visualType==='streetContact').length, 1);
  }
});

test('a contact has a brief flinch and a longer readable indication on game time', () => {
  const effects = [{visualType:'streetContact',activeMs:1000,lane:-1,x:0}];
  assert.equal(sampleContactReaction(effects,999).active,false);
  assert.equal(sampleContactReaction(effects,1000).active,true);
  assert.equal(sampleContactReaction(effects,1140).flinch,1);
  assert.equal(sampleContactReaction(effects,1280).flinch,0);
  assert.equal(sampleContactReaction(effects,1519).active,true);
  assert.equal(sampleContactReaction(effects,1520).active,false);
  assert.deepEqual(sampleContactReaction(effects,1140),sampleContactReaction(effects,1140),'a paused frame never progresses');
});

test('reduced motion keeps the contact readable without flinch or fade', () => {
  const effects = [{visualType:'streetContact',activeMs:1000,lane:0}];
  const reaction = sampleContactReaction(effects,1450,true);
  assert.equal(reaction.active,true);assert.equal(reaction.flinch,0);assert.equal(reaction.alpha,1);
});

test('new contacts restart the cue, while ignored contacts and pickups do not', () => {
  const effects = [{visualType:'streetContact',activeMs:1000,lane:1,x:0},
    {type:'collect',activeMs:1100},{visualType:'streetContact',activeMs:1120,ignored:true},
    {visualType:'streetContact',activeMs:1200,lane:-1,x:0}];
  assert.equal(sampleContactReaction(effects,1150).age,150);
  assert.equal(sampleContactReaction(effects,1210).age,10);
  assert.equal(sampleContactReaction(effects,1210).side,1);
  assert.equal(sampleContactReaction(effects,1150).side,-1);
  const renderer={effects:[]};
  Renderer.prototype.contact.call(renderer,{obstacleType:'puddle',activeMs:1000,ignored:true});
  assert.equal(sampleContactReaction(renderer.effects,1000).active,false);
});
