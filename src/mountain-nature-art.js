const PROP_NAMES = Object.freeze(['treeBeech','treeCedar','treeWoodland','treePine','mossBoulder','fernClump','fallenLog','shrub']);
const ANIMAL_FRAMES = Object.freeze({deer:0,fox:2,rabbit:4,squirrel:6});
const PROP_URL = new URL('../art/mountain-v32/nature-atlas.png', import.meta.url).href;
const ANIMAL_URL = new URL('../art/mountain-v32/wildlife-atlas.png', import.meta.url).href;
const HAZARD_URL = new URL('../art/mountain-v32/hazard-atlas.png', import.meta.url).href;
const GROUND_URL = new URL('../art/mountain-v32/ground-atlas.png', import.meta.url).href;

// The generated source is an atlas, with taller tree cells and shallower
// ground-cover cells. Explicit regions keep the tree roots out of row two.
const PROP_REGIONS = Object.freeze([
  [0,0,510,558],[510,0,850,558],[850,0,1324,558],[1324,0,1774,558],
  [0,558,480,887],[480,558,910,887],[910,558,1325,887],[1325,558,1774,887],
]);
function cells(image, documentRef, key) {
  const hazardRegions=[[0,0,705,640],[705,0,1280,640],[0,640,735,1280],[735,640,1280,1280]];
  const cellWidth = image.naturalWidth / 4, cellHeight = image.naturalHeight / 2;
  let pixels;
  try {
    const canvas=documentRef?.createElement('canvas');
    if(canvas){canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
      pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;}
  }catch { /* Full-cell rendering remains available without readable pixels. */ }
  return Object.freeze(Array.from({length:key==='hazards'?4:8},(_,i)=>{
    const region=key==='props'?PROP_REGIONS[i]:key==='hazards'?hazardRegions[i]:null;
    const refW=key==='hazards'?1280:1774,refH=key==='hazards'?1280:887;
    const left=region?Math.round(region[0]/refW*image.naturalWidth):Math.round(i%4*cellWidth);
    const right=region?Math.round(region[2]/refW*image.naturalWidth):Math.round((i%4+1)*cellWidth);
    const top=region?Math.round(region[1]/refH*image.naturalHeight):Math.floor(i/4)*Math.round(image.naturalHeight*.54);
    const bottom=region?Math.round(region[3]/refH*image.naturalHeight):i<4?Math.round(image.naturalHeight*.54):image.naturalHeight;
    if(!pixels)return Object.freeze({x:left,y:top,width:right-left,height:bottom-top});
    let minX=right,minY=bottom,maxX=left-1,maxY=top-1;
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)if(pixels[(y*image.naturalWidth+x)*4+3]>20){
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    if(maxX<minX)return Object.freeze({x:left,y:top,width:right-left,height:bottom-top});
    return Object.freeze({x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1});
  }));
}

/** Decoded, bounded atlases shared by the complete mountain scene. */
export class MountainNatureArt {
  constructor({ImageCtor=globalThis.Image,documentRef=globalThis.document,timeoutMs=4500}={}) {
    this.sheets={props:{status:'loading'},animals:{status:'loading'},ground:{status:'loading'},hazards:{status:'loading'}};
    this.documentRef=documentRef;this.patterns=new WeakMap();
    const load=(key,url)=>new Promise(resolve=>{
      const sheet=this.sheets[key];let settled=false;
      const finish=(status,reason=null)=>{
        if(settled)return;settled=true;clearTimeout(timer);sheet.status=status;sheet.reason=reason;resolve();
      };
      const timer=setTimeout(()=>finish('fallback','timeout'),timeoutMs);
      if(typeof ImageCtor!=='function'){finish('fallback','image_unavailable');return;}
      let image;
      try{image=new ImageCtor();}catch{finish('fallback','image_unavailable');return;}
      image.onload=async()=>{
        try{
          if(typeof image.decode==='function')await image.decode();
          if(settled)return;
          if(!(image.naturalWidth>0&&image.naturalHeight>0))throw Error('invalid_dimensions');
          sheet.image=image;
          if(key!=='ground')sheet.frames=cells(image,documentRef,key);
          finish('ready');
        }catch(error){finish('fallback',error.message??'decode_failed');}
      };
      image.onerror=()=>finish('fallback','image_failed');
      try{image.src=url;}catch{finish('fallback','image_failed');}
    });
    this.ready=Promise.all([load('props',PROP_URL),load('animals',ANIMAL_URL),load('ground',GROUND_URL),load('hazards',HAZARD_URL)]).then(()=>this);
  }
  get stats(){
    const entries=Object.entries(this.sheets);
    const reasons=Object.fromEntries(entries.filter(([,s])=>s.reason).map(([key,s])=>[key,s.reason]));
    return Object.freeze({props:this.sheets.props.status,animals:this.sheets.animals.status,ground:this.sheets.ground.status,hazards:this.sheets.hazards.status,
      decodedBytes:entries.reduce((sum,[,s])=>sum+(s.image?.naturalWidth??0)*(s.image?.naturalHeight??0)*4,0),
      fallbackReasons:Object.freeze(reasons)});
  }
  draw(renderer,sheetName,index,{x,y,width,height,alpha=1,reference=null}){
    const sheet=this.sheets[sheetName],frame=sheet?.frames?.[index];
    if(sheet?.status!=='ready'||!frame||![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)return false;
    const frames=reference?reference.map(i=>sheet.frames[i]):[frame];
    const scale=Math.min(width/Math.max(...frames.map(f=>f.width)),height/Math.max(...frames.map(f=>f.height)));
    const w=frame.width*scale,h=frame.height*scale;
    const ctx=renderer.ctx;ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.globalAlpha*=Math.max(0,Math.min(1,alpha));
    ctx.drawImage(sheet.image,frame.x,frame.y,frame.width,frame.height,x-w/2,y-h,w,h);ctx.restore();return true;
  }
  drawProp(renderer,key,object,distance){
    const index=PROP_NAMES.indexOf(key);if(index<0||this.sheets.props.status!=='ready')return false;
    const p=renderer.project(object.lane,distance),unit=renderer.width*.235*p.scale;
    return this.draw(renderer,'props',index,{x:p.x,y:p.y,width:object.width*unit,height:object.height*unit});
  }
  drawAnimal(renderer,kind,pose,options){
    const first=ANIMAL_FRAMES[kind];if(first===undefined)return false;
    return this.draw(renderer,'animals',first+(pose===1?1:0),{...options,reference:[first,first+1]});
  }
  drawObstacle(renderer,kind,x,y,s,timeMs=0){
    const index=['root','rock','log','rollingStone'].indexOf(kind);
    if(index<0||this.sheets.hazards.status!=='ready')return false;
    renderer.ellipse?.(x,y+Math.max(.8,s*2),25*s,Math.max(1,s*4.3),'#26352b5b');
    if(kind==='rollingStone'){
      const ctx=renderer.ctx;ctx.save();ctx.translate(x,y-20*s);
      ctx.rotate(renderer.reducedMotion?0:timeMs/1000*2.25);
      this.draw(renderer,'hazards',index,{x:0,y:21*s,width:48*s,height:43*s});ctx.restore();
    }else this.draw(renderer,'hazards',index,{x,y:y+6*s,width:58*s,height:kind==='rock'?34*s:29*s});
    return true;
  }
  material(ctx,kind){
    const sheet=this.sheets.ground;
    if(sheet.status!=='ready'||!this.documentRef?.createElement||!ctx.createPattern)return null;
    let materials=this.patterns.get(ctx);
    if(!materials){materials={};this.patterns.set(ctx,materials);}
    if(materials[kind])return materials[kind];
    // Mirrored repeats join continuously even if the generated source's outer
    // edges are not perfectly seamless. Downsample once, never each frame.
    const tile=this.documentRef.createElement('canvas'),image=sheet.image,side=384;
    tile.width=side*2;tile.height=side*2;
    const crop=tile.getContext('2d');if(!crop)return null;
    for(let y=0;y<2;y++)for(let x=0;x<2;x++){
      crop.save();crop.translate(x?side*2:0,y?side*2:0);crop.scale(x?-1:1,y?-1:1);
      crop.drawImage(image,kind==='path'?image.naturalWidth/2:0,0,image.naturalWidth/2,image.naturalHeight,0,0,side,side);
      crop.restore();
    }
    const pattern=ctx.createPattern(tile,'repeat');if(!pattern?.setTransform)return null;
    return materials[kind]={pattern,tile};
  }
  drawTerrain(renderer,travel,roadEdge=1.66){
    const ctx=renderer.ctx,w=renderer.width,h=renderer.height;
    const floor=this.material(ctx,'floor'),path=this.material(ctx,'path');
    if(!floor||!path)return false;
    // Invert the shared street camera for each thin screen row. One world
    // coordinate determines the texture phase; no large affine-strip seams,
    // sliding relative to trees, or arbitrary screen-time scrolling.
    const horizon=h*.28,groundHeight=h*.52,step=2;
    const top=Math.ceil(renderer.project(0,52).y);
    ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    for(let y=top;y<h;y+=step){
      const center=y+step/2,scale=(center-horizon)/groundHeight;
      if(scale<=0)continue;
      const distance=(1/scale-1)/.65,pxX=w*.235*scale;
      const pxZ=groundHeight*.65*scale*scale;
      const fade=Math.max(0,Math.min(1,(40-distance)/24));
      for(const [kind,cached,span,opacity] of [['floor',floor,8.4,.8],['path',path,5.2,.58]]){
        const phase=(((travel+distance)%span)+span)%span;
        cached.pattern.setTransform({a:pxX*span/cached.tile.width,b:0,c:0,d:-pxZ*span/cached.tile.height,e:w*.5,f:center+phase*pxZ});
        ctx.fillStyle=cached.pattern;ctx.globalAlpha=opacity*fade;
        const edge=roadEdge*pxX,left=Math.max(0,w*.5-edge),right=Math.min(w,w*.5+edge);
        if(kind==='floor'){
          ctx.fillRect(0,y,left,step);ctx.fillRect(right,y,w-right,step);
        }else ctx.fillRect(left,y,right-left,step);
      }
    }
    ctx.restore();return true;
  }
}
