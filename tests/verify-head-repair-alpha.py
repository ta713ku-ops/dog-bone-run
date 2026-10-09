"""Actual-source regression for shoulder holes caused by replacing head alpha.
Run with the same Pillow/numpy/OpenCV environment as assets:continuity.
"""
from pathlib import Path
import json
namespace={'__file__':str(Path('scripts/build-home-continuity.py').resolve())}
source=Path(namespace['__file__']).read_text()
exec(source[:source.index('old=json.loads')],namespace)
np=namespace['np'];Image=namespace['Image'];CELL=namespace['CELL']
meta=json.loads(Path('art/dog-home-motion.json').read_text())
ref=np.array(Image.open(meta['atlases']['sitdown']['path']).convert('RGBA'))[:CELL,:CELL].copy()
ref[ref[:,:,3]<3]=0;ref_features=namespace['features'](ref)
checks=0
for key,desc in meta['atlases'].items():
 sheet=np.array(Image.open(desc['path']).convert('RGBA'))
 previous=None
 for f in desc['frames']:
  p=sheet[f['y']:f['y']+CELL,f['x']:f['x']+CELL].copy();p[p[:,:,3]<3]=0
  previous=namespace['features'](p,previous)
  repaired=namespace['stable_face'](p,previous,ref,ref_features)
  assert np.array_equal(repaired[:,:,3],p[:,:,3]),(key,checks,'head repair changed source silhouette alpha')
  checks+=1
print(f'{checks} actual source poses: head texture repair preserves target alpha exactly')
