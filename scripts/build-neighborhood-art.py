"""Pack the generated house atlas; retain RGBA and measured ground anchors."""
from pathlib import Path
from PIL import Image
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/neighborhood-v24/source/houses.png'
OUTPUT = ROOT / 'art/neighborhood-v24/houses.webp'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

image = Image.open(SOURCE).convert('RGBA')
image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
image.save(OUTPUT, 'WEBP', quality=86, method=6, exact=True)
width, height = image.size
cw, ch = width // 2, height // 2
cells = {}
for name, cx, cy in [('cream-left', 0, 0), ('timber-left', 1, 0), ('cream-right', 0, 1), ('brick-right', 1, 1)]:
    alpha = image.getchannel('A').crop((cx*cw, cy*ch, (cx+1)*cw, (cy+1)*ch))
    bounds = alpha.point(lambda value: 255 if value >= 24 else 0).getbbox()
    if not bounds:
        raise RuntimeError(f'Empty generated house: {name}')
    x0, y0, x1, y1 = bounds
    cells[name] = {
        'cell': [cx, cy],
        'crop': [cx*cw+x0, cy*ch+y0, x1-x0, y1-y0],
        'rootAnchor': [cx*cw+(x0+x1)/2, cy*ch+y1-3],
    }
asset = {
    'path': str(OUTPUT.relative_to(ROOT)), 'source': str(SOURCE.relative_to(ROOT)),
    'width': width, 'height': height, 'bytes': OUTPUT.stat().st_size,
    'decodedBytes': width*height*4, 'sha256': digest(OUTPUT), 'sourceSha256': digest(SOURCE),
}
asphalt_source = OUTPUT.parent / 'source/asphalt.png'
asphalt_output = OUTPUT.parent / 'asphalt.webp'
asphalt = Image.open(asphalt_source).convert('RGB')
asphalt = asphalt.resize((384, 384), Image.Resampling.LANCZOS)
asphalt.save(asphalt_output, 'WEBP', quality=80, method=6)
asphalt_asset = {
    'path': str(asphalt_output.relative_to(ROOT)), 'source': str(asphalt_source.relative_to(ROOT)),
    'width': 384, 'height': 384, 'bytes': asphalt_output.stat().st_size,
    'decodedBytes': 384*384*4, 'sha256': digest(asphalt_output), 'sourceSha256': digest(asphalt_source),
}
assets = {'houses': asset, 'asphalt': asphalt_asset}
metadata = {'generator': 'scripts/build-neighborhood-art.py', 'assets': assets,
            'houseCells': cells, 'totalBytes': sum(item['bytes'] for item in assets.values()),
            'totalDecodedBytes': sum(item['decodedBytes'] for item in assets.values())}
(OUTPUT.parent/'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
print(json.dumps(metadata, indent=2))
