"""Pack the generated material atlas; deterministic resize/format conversion only."""
import hashlib, json
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
source = root / 'art/street-v26/source/materials.png'
target = root / 'art/street-v26/materials.webp'
with Image.open(source) as im:
    im.convert('RGB').resize((512,512),Image.Resampling.LANCZOS).save(target,'WEBP',quality=84,method=6)
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
meta = {'generator':'scripts/build-street-materials.py','generatorSha256':sha(Path(__file__)),
        'assets':{'materials':{'path':str(target.relative_to(root)), 'source':str(source.relative_to(root)),
                              'sha256':sha(target),'sourceSha256':sha(source),'width':512,'height':512,
                              'bytes':target.stat().st_size,'rgbaDecodedBytes':512*512*4}},
        'cells':{'asphalt':[0,0,256,256],'plaster':[256,0,256,256],
                 'roof':[0,256,256,256],'concrete':[256,256,256,256]}}
(root/'art/street-v26/metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(meta,ensure_ascii=False,indent=2))

# Rebuild the full versioned atlas set and retain a single complete manifest.
import subprocess, sys
for script in ["build-street-toys.py", "build-street-facades.py", "build-street-foliage.py", "build-street-variants.py"]:
    subprocess.run([sys.executable, str(root / "scripts" / script)], check=True)
