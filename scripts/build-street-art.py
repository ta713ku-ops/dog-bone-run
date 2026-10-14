"""Pack v25 generated atlases, preserve alpha, measure ground anchors."""
from pathlib import Path
from PIL import Image
import json
import hashlib

root = Path(__file__).resolve().parents[1]
directory = root/'art/street-v25'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
assets, all_cells = {}, {}
for key, size, cols, rows, names in [
    ('buildings', (640,960), 2,3, ['convenience-left','convenience-right','shop-left','shop-right','apartment-left','apartment-right']),
    ('obstacles', (900,300), 3,1, ['litter','crow','cat']),
]:
    source = directory/'source'/f'{key}.png'
    output = directory/f'{key}.webp'
    original = Image.open(source).convert('RGBA')
    if key == 'buildings':
        # The generated rows are not equally tall; isolate their measured
        # source bands before packing into equal runtime cells, preserving roofs.
        image = Image.new('RGBA', size)
        source_bands = [(0,425), (425,895), (895,1536)]
        for row,(top,bottom) in enumerate(source_bands):
            for col in range(2):
                sprite = original.crop((col*512,top,(col+1)*512,bottom))
                bbox = sprite.getchannel('A').point(lambda v:255 if v>=24 else 0).getbbox()
                sprite = sprite.crop(bbox)
                sprite.thumbnail((300,300), Image.Resampling.LANCZOS)
                image.paste(sprite,(col*320+(320-sprite.width)//2,row*320+308-sprite.height))
    else:
        image = original.resize(size, Image.Resampling.LANCZOS)
    image.save(output,'WEBP',quality=85,method=6,exact=True)
    cw,ch=size[0]//cols,size[1]//rows
    cells={}
    for index,name in enumerate(names):
        cx,cy=index%cols,index//cols
        alpha=image.getchannel('A').crop((cx*cw,cy*ch,(cx+1)*cw,(cy+1)*ch))
        x0,y0,x1,y1=alpha.point(lambda value: 255 if value>=24 else 0).getbbox()
        cells[name]={'cell':[cx,cy],'crop':[cx*cw+x0,cy*ch+y0,x1-x0,y1-y0],
                     'rootAnchor':[cx*cw+(x0+x1)/2,cy*ch+y1-2]}
    all_cells[f'{key}Cells']=cells
    assets[key]={'path':str(output.relative_to(root)),'source':str(source.relative_to(root)),
                 'width':size[0],'height':size[1],'bytes':output.stat().st_size,
                 'decodedBytes':size[0]*size[1]*4,'sha256':digest(output),'sourceSha256':digest(source)}
metadata={'generator':'scripts/build-street-art.py','assets':assets,**all_cells,
          'totalBytes':sum(a['bytes'] for a in assets.values()),
          'totalDecodedBytes':sum(a['decodedBytes'] for a in assets.values())}
(directory/'metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
