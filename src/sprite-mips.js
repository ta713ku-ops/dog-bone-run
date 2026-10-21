/** Bounded source-derived crops for distant native-density sprites. */
export class SpriteMipCache {
  constructor({documentRef=globalThis.document,budgetBytes=8_000_000}={}){
    this.documentRef=documentRef;this.budgetBytes=budgetBytes;this.bytes=0;
  }
  prepare(image,frame){
    const levels=[];
    if(!this.documentRef?.createElement)return levels;
    for(let divisor=2;Math.min(frame.width,frame.height)/divisor>=16;divisor*=2){
      const width=Math.ceil(frame.width/divisor),height=Math.ceil(frame.height/divisor),bytes=width*height*4;
      if(this.bytes+bytes>this.budgetBytes)break;
      try{
        const canvas=this.documentRef.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d');if(!ctx)break;
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
        // Always sample the authored image, never an already reduced level.
        ctx.drawImage(image,frame.x,frame.y,frame.width,frame.height,0,0,width,height);
        levels.push(canvas);this.bytes+=bytes;
      }catch{break;}
    }
    return levels;
  }
}

export function selectSpriteMip(levels,ctx,width,height){
  const matrix=ctx.getTransform?.();
  if(!matrix||!levels)return null;
  const physicalW=width*Math.hypot(matrix.a,matrix.b),physicalH=height*Math.hypot(matrix.c,matrix.d);
  // Retain the original image whenever no cached level meets both physical
  // dimensions. A reverse loop also works on Safari without Array.findLast.
  for(let i=levels.length-1;i>=0;i--){
    if(levels[i].width>=physicalW&&levels[i].height>=physicalH)return levels[i];
  }
  return null;
}
