"""Prepare generated detail as temporally shared RGB, preserving approved pose alpha.
Generated originals are edited by built-in image_gen, never independently per frame.
Canonical geometry remains 384; delivery frames retain 640px detail. Offline only.
"""
from pathlib import Path
import json, hashlib, math
import numpy as np
import cv2
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
SIZE=640; CANON=384; SCALE=SIZE/CANON
Y,X=np.mgrid[:SIZE,:SIZE].astype(np.float32)
def sha(p):return hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
def smooth(v):v=np.clip(v,0,1);return v*v*(3-2*v)
def read(p):return np.array(Image.open(ROOT/p).convert('RGBA'))
def eye_pair(p,target=None):
 small=cv2.resize(p,(384,384),interpolation=cv2.INTER_AREA)
 mask=(small[:,:,3]>230)&(small[:,:,0]<105)&(small[:,:,1]<95)&(small[:,:,2]<95)
 ys,xs=np.where(small[:,:,3]>160);top=int(ys.min());bottom=int(ys.max())
 mask[:top+15]=False;mask[int(top+(bottom-top)*.66):]=False;mask[:,:85]=False;mask[:,290:]=False
 n,l,stats,centers=cv2.connectedComponentsWithStats(mask.astype('uint8'),8)
 choices=[(centers[i],stats[i]) for i in range(1,n) if 12<=stats[i,4]<=1300 and stats[i,2]>=4 and stats[i,3]>=4]
 best=None;score=-1e9
 for a,aa in choices:
  for b,bb in choices:
   dx,dy=b-a
   if not 25<dx<90 or abs(dy)>24:continue
   midpoint=(a+b)/2
   s=120-abs(dx-52)-abs(dy)*2-abs(midpoint[1]-(top+(bottom-top)*.30))*2-abs(midpoint[0]-192)*.3
   if target is not None:s-=np.linalg.norm(midpoint-np.mean(target,axis=0))*.3
   if s>score:score=s;best=np.array([a,b],np.float32)
 if best is None:raise RuntimeError('Generated restoration eye pair missing')
 return best*np.array([p.shape[1]/384,p.shape[0]/384],np.float32)
def eye_map(src,dst,x=X,y=Y):
 a,b=src;u,v=dst;s=(a+b)/2;t=(u+v)/2;d=b-a;e=v-u;den=float(d@d);re=float(e@d/den);im=float((e[1]*d[0]-e[0]*d[1])/den);det=re*re+im*im
 return ((re*(x-t[0])+im*(y-t[1]))/det+s[0]).astype(np.float32),((-im*(x-t[0])+re*(y-t[1]))/det+s[1]).astype(np.float32)
meta=json.loads((ROOT/'art/dog-home-continuity.json').read_text())
frames={}
for key in meta['atlases']:
 path=f'art/continuity/{key}-interpolated{len(meta["atlases"][key]["frames"])}.webp'
 sheet=read(path)
 frames[key]=[sheet[i//4*384:(i//4+1)*384,i%4*384:(i%4+1)*384] for i in range(len(meta['atlases'][key]['frames']))]
refs={'standing':frames['sitdown'][0],'seated':frames['sitdown'][-1],'lying':frames['liedown'][-1]}
ref_eyes={'standing':np.array([[e['x'],e['y']]for e in meta['atlases']['sitdown']['frames'][0]['landmarks']['eyes']],np.float32)*SCALE,
 'seated':np.array([[e['x'],e['y']]for e in meta['atlases']['sitdown']['frames'][-1]['landmarks']['eyes']],np.float32)*SCALE,
 'lying':np.array([[e['x'],e['y']]for e in meta['atlases']['liedown']['frames'][-1]['landmarks']['eyes']],np.float32)*SCALE}
details={};registration={}
for name,ref in refs.items():
 path=f'art/dog-hd/source/{name}-v21.png';gen=read(path);eyes=eye_pair(gen)
 mx,my=eye_map(eyes,ref_eyes[name]);aligned=cv2.remap(gen.astype(np.float32),mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
 # Preserve old low-frequency colors and identity; transfer only generated fine texture.
 rgb=aligned[:,:,:3];low=cv2.GaussianBlur(rgb,(0,0),2.0)
 coverage=smooth((aligned[:,:,3]-240)/15)
 detail=(rgb-low)*coverage[:,:,None]
 details[name]=detail
 registration[name]={'sourceEyes':eyes.tolist(),'canonicalTargetEyes':(ref_eyes[name]/SCALE).tolist(),'source':path,'sha256':sha(path)}
 descriptor=[];outdir=ROOT/'art/dog-hd/frames';outdir.mkdir(parents=True,exist_ok=True)
# Canonical face uses one restoration for all poses to prevent per-pose identity shifts.
for key,items in frames.items():
 for index,p in enumerate(items):
  desc=meta['atlases'][key]['frames'][index];eyes=np.array([[e['x'],e['y']]for e in desc['landmarks']['eyes']],np.float32)*SCALE
  center=eyes.mean(axis=0);ground=372*SCALE
  base=cv2.resize(p,(SIZE,SIZE),interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
  # Shared head texture, mapped by the authored eye vector exactly.
  mx,my=eye_map(ref_eyes['standing'],eyes)
  face=cv2.remap(details['standing'],mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
  phase=index/max(1,len(items)-1)
  if key=='sitdown':bodyrefs=[('standing',1-phase),('seated',phase)]
  elif key=='liedown':bodyrefs=[('seated',1-phase),('lying',phase)]
  else:bodyrefs=[('standing',1)]
  body=np.zeros_like(face)
  for name,weight in bodyrefs:
   refcenter=ref_eyes[name].mean(axis=0)
   body_y=refcenter[1]+(Y-center[1])*(ground-refcenter[1])/max(1,ground-center[1])
   body_x=X-center[0]+refcenter[0]
   body+=cv2.remap(details[name],body_x.astype(np.float32),body_y.astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)*weight
  headmask=(1-smooth((np.abs(X-center[0])-105*SCALE)/(30*SCALE)))*(1-smooth((Y-center[1]-68*SCALE)/(35*SCALE)))
  delta=face*headmask[:,:,None]+body*(1-headmask[:,:,None])
  # No generated alpha replaces the approved silhouette; avoid fringe contamination.
  alpha=base[:,:,3];interior=smooth((alpha-210)/45)
  base[:,:,:3]=np.clip(base[:,:,:3]+delta*1.25*interior[:,:,None],0,255)
  result=np.rint(base).astype('uint8');result[result[:,:,3]==0,:3]=0
  path=f'art/dog-hd/frames/{key}-{index:02}.webp'
  Image.fromarray(result).save(ROOT/path,'WEBP',quality=96,method=6,exact=True)
  descriptor.append({'atlas':key,'index':index,'path':path,'width':SIZE,'height':SIZE,'canvasWidth':SIZE,'canvasHeight':SIZE,'offsetX':0,'offsetY':0,'anchorX':SIZE/2,'anchorY':372*SCALE,'referenceHeight':336*SCALE,'x':0,'y':0,'sha256':sha(path),'bytes':(ROOT/path).stat().st_size})
  if (key,index) in [('sitdown',0),('sitdown',47),('liedown',47)]:Image.fromarray(result).save(ROOT/f'art/dog-hd/{key}-{index:02}-preview.png')
  if index%16==0:print(key,index,flush=True)
output={'version':1,'mode':'high-detail-home-frames','canonicalSize':CANON,'resolution':SIZE,'method':'384 master preserved; generated fine RGB residual only, shared canonical face; authored silhouette retained; 640px delivery, bounded runtime decode','sourceMetadata':{'path':'art/dog-home-continuity.json','sha256':sha('art/dog-home-continuity.json')},'generator':{'path':'scripts/build-dog-hd.py','sha256':sha('scripts/build-dog-hd.py')},'sources':registration,'masters':[{'path':f'art/continuity/{key}-interpolated{len(items)}.webp','sha256':sha(f'art/continuity/{key}-interpolated{len(items)}.webp')}for key,items in frames.items()],'frames':descriptor,'totalCompressedBytes':sum(f['bytes']for f in descriptor),'maxDecodedFrameBytes':SIZE*SIZE*4}
(ROOT/'art/dog-hd/metadata.json').write_text(json.dumps(output,ensure_ascii=False,indent=2))
print('Complete',len(descriptor),output['totalCompressedBytes'],flush=True)
