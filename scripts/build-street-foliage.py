"""Measure transparent sprite cells and convert/pack without creative editing."""
from pathlib import Path
from PIL import Image
import json, hashlib
root=Path(__file__).resolve().parent.parent
source=root/'art/street-v26/source/foliage.png'
out=root/'art/street-v26/foliage.webp'
im=Image.open(source).convert('RGBA')
atlas=Image.new('RGBA',(512,256))
cells={}
for i,name in enumerate(['tree','hedge']):
    cell=im.crop((i*im.width//2,0,(i+1)*im.width//2,im.height))
    box=cell.getchannel('A').point(lambda a:255 if a>=24 else 0).getbbox()
    cropped=cell.crop(box); cropped.thumbnail((240,240),Image.Resampling.LANCZOS)
    x=i*256+(256-cropped.width)//2; y=(256-cropped.height)//2
    atlas.paste(cropped,(x,y))
    cells[name]={'crop':[x,y,cropped.width,cropped.height],'sourceCrop':[box[0]+i*im.width//2,box[1],box[2]-box[0],box[3]-box[1]]}
atlas.save(out,'WEBP',quality=88,method=6)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=root/'art/street-v26/metadata.json';meta=json.loads(p.read_text())
meta['foliageGenerator']='scripts/build-street-foliage.py';meta['foliageGeneratorSha256']=sha(Path(__file__))
meta['assets']['foliage']={'path':str(out.relative_to(root)),'source':str(source.relative_to(root)),'sha256':sha(out),'sourceSha256':sha(source),'width':512,'height':256,'bytes':out.stat().st_size,'rgbaDecodedBytes':512*256*4}
meta['foliageCells']=cells;p.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(meta['assets']['foliage']));print(json.dumps(cells))
