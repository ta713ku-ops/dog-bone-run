const sequence=Object.freeze([
  ['idle',10000],['lookPlayer',3000],['headTilt',2500],['idle',8000],
  ['sit',4500],['sitWait',3000],['stretch',2500],['idle',8000],['walk',9000],
  ['yawn',2800],['lookFood',2500],['idle',7000],['bellyUp',5000],
  ['wake',2300],['playBow',2200],['happyJump',1800],['idle',7000],
]);
export const HOME_IDLE_PERIOD_MS=sequence.reduce((n,[,duration])=>n+duration,0);

/** Visual-only behavior; the raising clock and RNG remain canonical in the model. */
export function resolveHomeIdle(timeMs,{energy=100,hunger=0,mood=70,reducedMotion=false,petAgeMs=null}={}){
  if(reducedMotion)return{action:'idle',actionAgeMs:Math.max(0,timeMs),durationMs:4800,weight:0};
  if(petAgeMs!==null&&petAgeMs>=0&&petAgeMs<1800)return{action:'petHappy',actionAgeMs:petAgeMs,durationMs:1800,weight:Math.sin(Math.PI*petAgeMs/1800)};
  let at=Math.max(0,timeMs)%HOME_IDLE_PERIOD_MS;
  for(const [requested,duration]of sequence){if(at<duration){
    let action=requested;
    if(energy<35&&['happyJump','playBow','stretch','bellyUp','walk'].includes(action))action='sleepyRefuse';
    if(hunger>=80&&action==='happyJump')action='lookFood';
    if(mood<25&&action==='bellyUp')action='sit';
    return{action,actionAgeMs:at,durationMs:duration,weight:Math.min(1,at/450,(duration-at)/450)};
  }at-=duration;}
  return{action:'idle',actionAgeMs:0,durationMs:4800,weight:0};
}

/** Turn at rest, walk a short route, turn back, and return to the same anchor. */
export function resolveHomeStroll(ageMs,durationMs=9000){
  const p=Math.max(0,Math.min(1,ageMs/durationMs)),ease=x=>x*x*x*(x*(x*6-15)+10);
  if(p<.12)return{action:'turn',offset:0,yaw:Math.PI/2,turnFromYaw:0,ageMs,durationMs:durationMs*.12};
  if(p<.44)return{action:'walk',offset:ease((p-.12)/.32),yaw:Math.PI/2,ageMs:ageMs-durationMs*.12,durationMs:durationMs*.32};
  if(p<.56)return{action:'turn',offset:1,yaw:-Math.PI/2,turnFromYaw:Math.PI/2,ageMs:ageMs-durationMs*.44,durationMs:durationMs*.12};
  if(p<.88)return{action:'walk',offset:1-ease((p-.56)/.32),yaw:-Math.PI/2,ageMs:ageMs-durationMs*.56,durationMs:durationMs*.32};
  return{action:'turn',offset:0,yaw:0,turnFromYaw:-Math.PI/2,ageMs:ageMs-durationMs*.88,durationMs:durationMs*.12};
}
