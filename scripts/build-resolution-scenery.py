"""Repack original scenery pixels, retaining the existing normalized sprite layout."""
from pathlib import Path
from PIL import Image
import json, hashlib

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'art/resolution-v36'
OUT.mkdir(exist_ok=True)
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assets = {}

def save(name, image, source, **details):
    target = OUT / (name + '.webp')
    image.save(target, 'WEBP', quality=92, method=6)
    assets[name] = dict(path=str(target.relative_to(ROOT)), source=str(source.relative_to(ROOT)),
        sha256=sha(target), sourceSha256=sha(source), width=image.width, height=image.height,
        bytes=target.stat().st_size, decodedBytes=image.width*image.height*4, **details)

meta = json.loads((ROOT/'art/street-v26/metadata.json').read_text())
for name, key in [('foliage','foliageCells'), ('toys','toyCells')]:
    source = ROOT/meta['assets'][name]['source']
    original = Image.open(source).convert('RGBA')
    atlas = Image.new('RGBA', (1536,768))
    for cell in meta[key].values():
        sx,sy,sw,sh = cell['sourceCrop']
        x,y,w,h = cell['crop']
        atlas.paste(original.crop((sx,sy,sx+sw,sy+sh)).resize((w*3,h*3),Image.Resampling.LANCZOS),(x*3,y*3))
    save(name,atlas,source,layoutScale=3,referenceWidth=512,referenceHeight=256)

for name,source_path,size in [
    ('street-materials','art/street-v26/source/materials.png',(1024,1024)),
    ('park-path','art/park-level2/source/path-material.png',(1024,1024)),
    ('park-grass','art/park-level2/source/grass-original.png',(1024,1024)),
    ('street-obstacles','art/street-v25/source/obstacles.png',(1800,600)),
]:
    source = ROOT/source_path
    mode = 'RGBA' if name == 'street-obstacles' else 'RGB'
    save(name,Image.open(source).convert(mode).resize(size,Image.Resampling.LANCZOS),source)

for name,key in [('facades','facadeCells'),('variants','variantCells')]:
    source = ROOT/meta['assets'][name]['source']
    original = Image.open(source).convert('RGB')
    atlas = Image.new('RGB',(1238,1238))
    for cell in meta[key].values():
        x,y,_,_ = cell['crop']
        atlas.paste(original.crop(tuple(cell['sourceCrop'])),(x//512*619,y//512*619))
    save(name,atlas,source,referenceWidth=1024,referenceHeight=1024)

layout_path = ROOT/'art/street-v26/metadata.json'
manifest = dict(generator='scripts/build-resolution-scenery.py',generatorSha256=sha(Path(__file__)),
    layoutInput=dict(path=str(layout_path.relative_to(ROOT)),sha256=sha(layout_path)),
    note='Original sources repacked; source crops and normalized roots unchanged. No generated replacement artwork.',assets=assets)
(OUT/'metadata.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(bytes=sum(a['bytes'] for a in assets.values()),decodedBytes=sum(a['decodedBytes'] for a in assets.values())),indent=2))
