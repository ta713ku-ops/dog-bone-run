"""Pack measured facade regions; only crop, resize, and format conversion."""
from pathlib import Path
from PIL import Image
import json,hashlib
root=Path(__file__).resolve().parent.parent
source=root/'art/street-v26/source/variants.png';out=root/'art/street-v26/variants.webp'
im=Image.open(source).convert('RGB');atlas=Image.new('RGB',(1024,1024))
cells={}
for i,name in enumerate(['cedar','brick','bakery','blue']):
 x=i%2; y=i//2
 box=(x*im.width//2+4,y*im.height//2+4,(x+1)*im.width//2-4,(y+1)*im.height//2-4)
 atlas.paste(im.crop(box).resize((512,512),Image.Resampling.LANCZOS),(x*512,y*512))
 cells[name]={'crop':[x*512,y*512,512,512],'sourceCrop':list(box)}
atlas.save(out,'WEBP',quality=83,method=6)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=root/'art/street-v26/metadata.json';meta=json.loads(p.read_text());meta['variantGenerator']='scripts/build-street-variants.py';meta['variantGeneratorSha256']=sha(Path(__file__))
meta['assets']['variants']={'path':str(out.relative_to(root)),'source':str(source.relative_to(root)),'sha256':sha(out),'sourceSha256':sha(source),'width':1024,'height':1024,'bytes':out.stat().st_size,'rgbaDecodedBytes':1024*1024*4}
meta['variantCells']=cells;p.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(meta['assets']['variants']))
