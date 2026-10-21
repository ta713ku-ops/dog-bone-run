// Crop/package image_gen's unchanged RGBA direction anchors for runtime use.
// Run with sharp available to Node's module resolver; no network/API is used.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),sharp=require('sharp');
const root=new URL('../',import.meta.url),folder=new URL('art/dog-direction/',root);
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(folder,{recursive:true});
const inputs=['left','right'];const buffers=[];
for(const side of inputs){
 const source=new URL(`source/${side}-v1.png`,folder);
 buffers.push(await sharp(await readFile(source)).extract({left:200,top:side==='left'?40:3,width:840,height:800}).resize(224,224,{fit:'fill'}).png().toBuffer());
}
await sharp({create:{width:448,height:224,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(buffers.map((input,i)=>({input,left:i*224,top:0}))).webp({lossless:true,effort:6}).toFile(fileURLToPath(new URL('heads.webp',folder)));
const front=[[60,18],[183,18],[312,18],[312,128],[312,258],[183,258],[60,258],[60,128],[139,37],[234,38],[183,91],[110,110],[260,110],[158,128],[208,127],[125,163],[242,163],[183,149],[183,175],[183,199],[183,240]];
const left=front.map(p=>p.slice()),right=front.map(p=>p.slice());
const points={left:{8:[135,39],9:[217,44],10:[158,100],11:[105,109],12:[248,111],13:[131,125],14:[167,131],15:[111,151],16:[224,167],17:[132,146],18:[137,169],19:[153,195]},right:{8:[167,42],9:[247,44],10:[214,97],11:[120,115],12:[271,112],13:[192,126.5],14:[230,124],15:[145,165],16:[252,158],17:[225,142],18:[219,163.5],19:[211,190]}};
for(const [side,target] of [['left',left],['right',right]])for(const [index,p] of Object.entries(points[side]))target[Number(index)]=p;
// Bowyer–Watson triangulation, used only for static numerical control geometry.
function triangulate(points){
 const p=[...points,[-2000,-2000],[2200,-2000],[192,2500]],n=points.length;let triangles=[[n,n+1,n+2]];
 function circle(t,q){const [a,b,c]=t.map(i=>p[i]);const d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));if(Math.abs(d)<1e-9)return false;
 const sq=v=>v[0]*v[0]+v[1]*v[1],x=(sq(a)*(b[1]-c[1])+sq(b)*(c[1]-a[1])+sq(c)*(a[1]-b[1]))/d,y=(sq(a)*(c[0]-b[0])+sq(b)*(a[0]-c[0])+sq(c)*(b[0]-a[0]))/d;return(q[0]-x)**2+(q[1]-y)**2<(a[0]-x)**2+(a[1]-y)**2+1e-6;}
 for(let i=0;i<n;i++){const bad=triangles.filter(t=>circle(t,p[i])),edges=new Map();for(const t of bad)for(let j=0;j<3;j++){const edge=[t[j],t[(j+1)%3]],key=[...edge].sort((a,b)=>a-b).join(':');if(edges.has(key))edges.delete(key);else edges.set(key,edge);}triangles=triangles.filter(t=>!bad.includes(t));for(const edge of edges.values())triangles.push([...edge,i]);}
 return triangles.filter(t=>t.every(i=>i<n)).map(t=>{const[a,b,c]=t.map(i=>p[i]);return((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<0?[t[0],t[2],t[1]]:t;});
}
const controls={front,left,right,triangles:triangulate(front)};
for(const side of ['left','right'])for(let i=0;i<=100;i++){const p=front.map((v,j)=>v.map((x,k)=>x+(controls[side][j][k]-x)*i/100));for(const t of controls.triangles){const[a,b,c]=t.map(j=>p[j]);if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<=0)throw Error(`Inverted ${side} triangle at ${i}%`);}}
const metadata={version:1,canonicalSize:384,referenceHeight:336,ground:372,rect:{left:60,top:18,width:252,height:240},sheet:{url:'./heads.webp',width:448,height:224,cells:{left:{x:0,y:0,width:224,height:224},right:{x:224,y:0,width:224,height:224}},sha256:sha(await readFile(new URL('heads.webp',folder)))},controls,decodedBytes:448*224*4,sources:await Promise.all(inputs.map(async side=>({path:`art/dog-direction/source/${side}-v1.png`,sha256:sha(await readFile(new URL(`source/${side}-v1.png`,folder)))}))),generator:{path:'scripts/pack-dog-direction.mjs',sha256:sha(await readFile(new URL('scripts/pack-dog-direction.mjs',root)))}};
await writeFile(new URL('metadata.json',folder),JSON.stringify(metadata,null,2)+'\n');
console.log('Packaged two direction anchors:',metadata.decodedBytes,'decoded bytes,',controls.triangles.length,'triangles');
