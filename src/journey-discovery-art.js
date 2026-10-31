// Small original in-world studies. Every keepsake has a recognisable subject;
// the same painter is used in the scene, observation and album artwork.
export function drawDistinctDiscovery(r,d,line=1.5){
  const c=r.ctx,id=d.id.split('-').slice(2).join('-');
  const ellipse=(x,y,rx,ry,fill,stroke,angle=0)=>r.ellipse(x,y,rx,ry,fill,stroke,angle);
  const path=(points,fill,stroke)=>r.path(points,fill,stroke,line);
  const stroke=(points,color,width=line)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();};
  const bird=(color,beak='#ca9857',red=false)=>{
    ellipse(-2,-3,12,8,color,'#504739');ellipse(8,-12,6,6,color,'#504739');
    path([[13,-13],[21,-10],[13,-7]],beak,'#7d6642');ellipse(10,-14,1,1,'#fff5d7');
    path([[-12,-4],[-23,-9],[-17,0]],color,'#504739');ellipse(-3,-5,7,4,red?'#e8d9b8':'#b49a75');
    stroke([[-7,4],[-8,10],[-3,10]],'#68503d');stroke([[2,4],[3,10],[8,10]],'#68503d');
    if(red)path([[3,-17],[10,-21],[14,-15]],'#a74735');
  };
  const water=(color='#7eacb2')=>{ellipse(0,0,23,11,color,'#4d8089');for(const y of [-4,1,5]){c.beginPath();c.ellipse(0,y,14,3,0,0,Math.PI);c.strokeStyle='#e0f1dd';c.lineWidth=line*.65;c.stroke();}};
  const flower=(x,y,color)=>{stroke([[x,y+12],[x,y]],'#617d48');for(let i=0;i<5;i++){const a=i*Math.PI*.4;ellipse(x+Math.cos(a)*4,y+Math.sin(a)*4,3.2,3.2,color,'#9e8257');}ellipse(x,y,2,2,'#e5b954');};
  if(id==='bakery'){
    const g=c.createLinearGradient(-17,-20,12,10);g.addColorStop(0,'#e7c58c');g.addColorStop(.45,'#c48b4f');g.addColorStop(1,'#91643d');
    ellipse(0,-3,23,14,g,'#805b3c',-.13);for(const x of [-10,0,10])stroke([[x-2,-14],[x+3,-4]],'#f7dfae',3);
    for(const x of [-8,7]){c.beginPath();c.moveTo(x,-23);c.bezierCurveTo(x+8,-30,x-6,-31,x,-39);c.strokeStyle='#c1aa80';c.lineWidth=line;c.stroke();}return true;
  }
  if(id==='sign'){
    stroke([[-13,-17],[-19,15]],'#735234',3);stroke([[11,-17],[17,15]],'#735234',3);
    c.fillStyle='#b88b59';c.fillRect(-18,-24,36,25);c.strokeStyle='#6f5239';c.lineWidth=line;c.strokeRect(-18,-24,36,25);
    stroke([[-11,-15],[10,-15]],'#fff0c7',2);stroke([[-8,-7],[7,-7]],'#efe2bc',2);return true;
  }
  if(['sparrow','crow','woodpecker'].includes(id)){bird(id==='crow'?'#414244':id==='woodpecker'?'#4e5146':'#9f7a55','#c39a61',id==='woodpecker');if(id==='woodpecker')stroke([[-20,14],[12,14]],'#8d704d',5);return true;}
  if(id==='eagle'){
    path([[-3,-7],[-27,-19],[-21,-8],[-32,-6],[-17,3],[-3,1]],'#7c6c53','#544b3b');path([[3,-7],[27,-19],[21,-8],[32,-6],[17,3],[3,1]],'#897759','#544b3b');ellipse(0,-3,5,11,'#b09b73','#64543d');ellipse(0,-15,4,4,'#d3c49c');return true;
  }
  if(id==='grass'){for(const [x,y]of[[-12,-7],[4,-17],[15,-1]])flower(x,y,x<0?'#ecd4ae':'#e8b4a4');return true;}
  if(id==='ripple'){water();for(const x of [-13,4,14])ellipse(x,-5,2,1,'#fff9d9');return true;}
  if(id==='puddle'){water('#91afb2');ellipse(-5,-3,11,3,'#e9e9dc');ellipse(4,-4,8,3,'#edf1df');return true;}
  if(id==='leaf'){
    path([[0,12],[-19,-3],[-17,-16],[-5,-12],[0,-26],[7,-13],[18,-19],[20,-5]],'#bb7149','#82543c');stroke([[0,13],[0,-18]],'#e7bd7e');stroke([[0,-4],[-11,-11]],'#d99f65');return true;
  }
  if(id==='reflection'||id==='lantern'){
    c.fillStyle='#d5b478';c.fillRect(-15,-23,30,33);c.strokeStyle='#76583e';c.lineWidth=3;c.strokeRect(-15,-23,30,33);
    c.fillStyle='#f4dfa8';c.fillRect(-11,-19,22,25);stroke([[0,-21],[0,8]],'#8b7152',2);stroke([[-13,-6],[13,-6]],'#8b7152',2);
    if(id==='lantern'){stroke([[-8,-24],[-8,-31],[8,-31],[8,-24]],'#786249',2);ellipse(0,-5,4,8,'#f3bb5f');}return true;
  }
  if(id==='sunbeam'){ellipse(0,-2,27,13,'#ead79b44');for(let i=0;i<7;i++){const a=i*Math.PI*2/7;ellipse(Math.cos(a)*16,Math.sin(a)*8-2,5,2,'#f9e5b0');}return true;}
  if(id==='reed'){
    for(const x of [-13,-3,10]){stroke([[x,14],[x+4,-25]],'#8a9a5c',1.8);ellipse(x+4,-24,2.5,10,'#a28b56','#746c46',.13);path([[x+1,0],[x-12,-10],[x-2,7]],'#8b9f67');}return true;
  }
  if(id==='moss'){
    path([[-24,9],[-19,-9],[-5,-22],[14,-18],[24,4],[17,14]],'#7b8273','#525f53');for(const [x,y]of[[-12,-8],[-4,-15],[6,-9],[14,1],[-7,5]])ellipse(x,y,8,4,d.id.startsWith('cave')?'#8cbd6b':'#7a985a','#57754b');return true;
  }
  if(id==='cicada'){
    ellipse(-7,-3,7,16,'#c3bf9d','#7a8065',-.35);ellipse(7,-3,7,16,'#c3bf9d','#7a8065',.35);ellipse(0,-2,4,14,'#6e7453','#4d573e');ellipse(0,-16,6,5,'#71805d');ellipse(-4,-17,2,2,'#514b36');ellipse(4,-17,2,2,'#514b36');return true;
  }
  if(id==='brook'||id==='spring'){
    for(const [x,y]of[[-20,-13],[17,-2],[-13,10]])ellipse(x,y,9,6,'#929185','#666e60');
    path([[-9,-25],[8,-25],[0,-8],[14,4],[4,16],[-9,13],[0,2],[-12,-9]],'#87b7bc','#5e939b');
    stroke([[0,-19],[-5,-8],[6,4],[-1,11]],'#e7f4df',2);if(id==='spring')ellipse(0,-24,5,3,'#d9f5e9');return true;
  }
  if(id==='view'){
    path([[-29,10],[-15,-22],[0,-7],[12,-29],[29,11]],'#81927b','#677960');path([[-28,10],[-9,-10],[7,2],[18,-12],[29,10]],'#b2b99a');for(const x of [-14,-4,7,16]){c.fillStyle='#c9a57d';c.fillRect(x,5,6,8);path([[x-2,5],[x+3,1],[x+8,5]],'#90735d');}return true;
  }
  if(id==='bellflower'){
    stroke([[0,14],[1,-22]],'#658550',2);for(const [x,y,side]of[[-10,-12,-1],[10,-22,1]]){stroke([[1,y-5],[x,y]],'#658550');c.beginPath();c.moveTo(x-5,y);c.bezierCurveTo(x-8,y+11,x-5,y+14,x-9,y+15);c.lineTo(x+9,y+15);c.bezierCurveTo(x+5,y+12,x+8,y+10,x+5,y);c.closePath();c.fillStyle=side<0?'#9294bd':'#a7a9d0';c.fill();c.strokeStyle='#7375a1';c.stroke();}return true;
  }
  if(id==='fern'){
    for(const side of [-1,1]){stroke([[0,14],[side*8,-16]],'#688650',2);for(let i=0;i<4;i++){const y=8-i*6;ellipse(side*(5+i),y,6-i*.7,2.4,'#8ba56b','#64824e',side*.45);}}
    c.beginPath();c.arc(5,-20,6,.6,Math.PI*2.1);c.strokeStyle='#78925a';c.lineWidth=2;c.stroke();return true;
  }
  if(id==='drop'){
    c.beginPath();c.moveTo(0,-30);c.bezierCurveTo(-6,-19,-17,-6,-9,3);c.bezierCurveTo(1,16,19,1,9,-12);c.closePath();c.fillStyle='#92c4cc';c.fill();c.strokeStyle='#5e919c';c.stroke();ellipse(-3,-5,2,5,'#e7f5e7');ellipse(0,13,20,4,'#adc5b85c');return true;
  }
  if(id==='pool'){water('#687d8c');path([[-18,-1],[-8,-8],[0,-2],[11,-9],[19,1]],'#bac9bd');return true;}
  if(id==='shell'){
    path([[-22,10],[-18,-12],[-4,-21],[18,-11],[24,11]],'#baa68b','#82715c');for(const y of [-10,-3,4])stroke([[-15,y],[-2,y-4],[17,y+1]],y===-3?'#ddccb0':'#917c63',2);return true;
  }
  if(id==='echo'||id==='bell'||id==='cricket'){
    if(id==='bell'){c.fillStyle='#bd9a5c';c.beginPath();c.moveTo(-7,-22);c.quadraticCurveTo(-13,-15,-12,-2);c.lineTo(-18,2);c.lineTo(18,2);c.lineTo(12,-2);c.quadraticCurveTo(13,-15,7,-22);c.closePath();c.fill();ellipse(0,5,3,4,'#8f744d');}
    else if(id==='cricket'){ellipse(0,-2,11,5,'#73804c','#505f3f');stroke([[-5,1],[-15,-7],[-22,5]],'#687949');stroke([[4,1],[15,-7],[22,5]],'#687949');}
    for(const side of [-1,1])for(const rr of [17,25]){c.beginPath();c.arc(0,-7,rr,side<0?2.6:-.55,side<0?3.7:.55);c.strokeStyle='#b8c5af';c.lineWidth=1.7;c.stroke();}return true;
  }
  if(id==='firefly'){ellipse(0,-2,18,18,'#e2e8942b');ellipse(0,-2,9,9,'#edf4ad44');ellipse(0,-7,3,7,'#85855a');ellipse(0,-1,4,5,'#e5eaa5','#a5b579');ellipse(-5,-9,5,3,'#c2c9a866');ellipse(5,-9,5,3,'#c2c9a866');return true;}
  if(id==='moon'){
    c.beginPath();c.arc(0,-7,21,.5,5.8);c.bezierCurveTo(-4,-21,-6,-2,18,3);c.closePath();c.fillStyle='#e7e0b7';c.fill();return true;
  }
  if(id==='sunset'){water('#ab8979');ellipse(0,-15,17,13,'#dcaa76');stroke([[-17,-4],[17,-4]],'#f3d8a4',2);return true;}
  if(id==='cloud'){for(const [x,y,rx]of[[-13,-4,12],[0,-11,15],[15,-3,12]])ellipse(x,y,rx,8,'#dfb3aa','#bd9d98');return true;}
  if(id==='star'){path([[0,-30],[6,-13],[24,-13],[10,-2],[16,15],[0,5],[-16,15],[-10,-2],[-24,-13],[-6,-13]],'#eee1ad','#b8a373');return true;}
  if(id==='breeze'){for(const y of [-16,-5,6]){c.beginPath();c.moveTo(-24,y);c.bezierCurveTo(-8,y-10,8,y+10,24,y);c.strokeStyle='#b4c4b4';c.lineWidth=2;c.stroke();}return true;}
  return false;
}
