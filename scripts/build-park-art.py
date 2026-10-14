"""Encode imagegen park masters for the runtime; preserve artwork and alpha."""
from pathlib import Path
from PIL import Image
import hashlib
import json

root = Path(__file__).resolve().parents[1]
folder = root / "art/park-v23"
sizes = {"trees": (1024, 1024), "horizon": (1280, 427), "soil": (384, 384), "grass": (384, 384)}
manifest = {"generator": "scripts/build-park-art.py", "assets": {}, "treeCells": {}}
for name, size in sizes.items():
    source = folder / "source" / f"{name}.png"
    image = Image.open(source)
    image = image.convert("RGBA" if name == "trees" else "RGB")
    image = image.resize(size, Image.Resampling.LANCZOS)
    target = folder / f"{name}.webp"
    image.save(target, "WEBP", quality=82 if name == "trees" else 78, method=6)
    entry = {"path": str(target.relative_to(root)), "source": str(source.relative_to(root)),
             "width": size[0], "height": size[1], "decodedBytes": size[0]*size[1]*4,
             "bytes": target.stat().st_size,
             "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
             "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest()}
    manifest["assets"][name] = entry
    if name == "trees":
        alpha = image.getchannel("A")
        for species, column, row in [("oak",0,0),("birch",1,0),("pine",0,1),("willow",1,1)]:
            origin = (column*512, row*512)
            cell = alpha.crop((origin[0],origin[1],origin[0]+512,origin[1]+512))
            bbox = cell.point(lambda v: 255 if v > 12 else 0).getbbox()
            manifest["treeCells"][species] = {"cell": [column,row], "visibleBounds": list(bbox),
                 "crop": [origin[0]+bbox[0],origin[1]+bbox[1],bbox[2]-bbox[0],bbox[3]-bbox[1]],
                 "rootAnchor": [origin[0]+256,origin[1]+bbox[3]-2]}

manifest["totalBytes"] = sum(a["bytes"] for a in manifest["assets"].values())
manifest["totalDecodedBytes"] = sum(a["decodedBytes"] for a in manifest["assets"].values())
assert manifest["totalBytes"] <= 700*1024, "Park art exceeds transfer budget"
assert manifest["totalDecodedBytes"] <= 8*1024*1024, "Park art exceeds decode budget"
(folder / "metadata.json").write_text(json.dumps(manifest, indent=2)+"\n")
print(json.dumps(manifest, indent=2))
