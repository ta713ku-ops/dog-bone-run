"""Offline, local-only sprite correspondence compiler. Requires Pillow, numpy,
OpenCV headless 5.0.0 (DIS). No downloaded weights, API, or runtime inference.
Run: PYTHONPATH=/private/tmp/dog-flow-deps <python> scripts/build-home-continuity.py
"""
from pathlib import Path
import hashlib, json, math, shutil
import cv2
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent.parent
CELL=384
Y,X=np.mgrid[:CELL,:CELL].astype(np.float32)
def sha(path): return hashlib.sha256((ROOT/path).read_bytes()).hexdigest()
def smooth(v): v=np.clip(v,0,1);return v*v*(3-2*v)
def features(p,previous=None):
 mask=p[:,:,3]>160
 ys,xs=np.where(mask);top,bottom=int(ys.min()),int(ys.max())
 dark=(p[:,:,3]>220)&(p[:,:,0]<100)&(p[:,:,1]<83)&(p[:,:,2]<83)
 dark[:top+12]=False;dark[int(top+(bottom-top)*.62):]=False;dark[:,:92]=False;dark[:,273:]=False
 n,labels,stats,centers=cv2.connectedComponentsWithStats(dark.astype('uint8'),8)
 candidates=[]
 for i in range(1,n):
  x,y,w,h,m=stats[i]
  if 10<=m<=450 and w>=4 and h>=4: candidates.append([*centers[i],m,w/2,h/2])
 best=None;score=-1e9
 for a in candidates:
  for b in candidates:
   dx,dy=b[0]-a[0],b[1]-a[1]
   if not 28<=dx<=82 or abs(dy)>50 or not 132<(a[0]+b[0])/2<252: continue
   continuity=0 if previous is None else np.linalg.norm(np.array(a[:2])-previous[0,:2])+np.linalg.norm(np.array(b[:2])-previous[1,:2])
   s=100-continuity*.8-abs(dx-51)*.8-abs((a[1]+b[1])/2-(top+(bottom-top)*.31))*.8-abs(dy)*.6-abs(a[2]-b[2])*.08
   if s>score:best=np.array([a,b],np.float32);score=s
 if best is None:raise RuntimeError('Eye correspondence missing')
 return best

def premul(p):
 v=p.astype(np.float32)/255;v[:,:,:3]*=v[:,:,3:4];return v

def rgba(v):
 v=np.clip(v,0,1);a=v[:,:,3:4];rgb=np.divide(v[:,:,:3],a,out=np.zeros_like(v[:,:,:3]),where=a>1e-6)
 return np.rint(np.concatenate([rgb,a],axis=2)*255).astype('uint8')

def align(p,source,target):
 # Continuous head similarity correction, vanishing before planted feet.
 a,b=source[:,:2];u,v=target[:,:2];s=(a+b)/2;t=(u+v)/2
 d=b-a;e=v-u;den=float(d@d);re=float(e@d/den);im=float((e[1]*d[0]-e[0]*d[1])/den)
 px=X.copy();py=Y.copy()
 for _ in range(5):
  influence=1-smooth((py-(s[1]+36))/(350-(s[1]+36)))
  dx=(t[0]+re*(px-s[0])-im*(py-s[1])-px)*influence
  dy=(t[1]+im*(px-s[0])+re*(py-s[1])-py)*influence
  px=X-dx;py=Y-dy
 return rgba(cv2.remap(premul(p),px,py,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT))

def paw_centers(p):
 points=[]
 for lo,hi in [(100,185),(185,260)]:
  alpha=p[355:374,lo:hi,3].astype(np.float32)
  bright=p[355:374,lo:hi,:3].astype(np.float32).mean(axis=2)
  weights=alpha*(bright>135);yy,xx=np.mgrid[355:374,lo:hi]
  points.append(float((xx*weights).sum()/weights.sum()))
 return np.array(points,np.float32)

def plant_paws(p,target):
 # Correct each planted paw locally. The old lower-body scale also moved the
 # haunch and belly, making the sit pose swell as the paw spacing changed.
 source=paw_centers(p);mx=X.copy();vertical=smooth((Y-343)/9)
 for _ in range(6):
  displacement=np.zeros_like(X)
  for center,delta in zip(source,target-source):
   distance=np.abs(mx-center)
   local=1-smooth((distance-24)/12)
   displacement+=delta*local*vertical
  mx=X-displacement
 return rgba(cv2.remap(premul(p),mx.astype(np.float32),Y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT))

def monotone_sit_head(landmarks):
 # The authored sit eye landmarks bob up and down. Keep each frame's eye
 # vector (and therefore face scale/tilt) but move its midpoint on a monotone
 # endpoint-pinned 128px-to-161px smoothstep trajectory.
 values=np.asarray(landmarks,np.float32);result=values.copy()
 start=float(values[0,:,:2].mean(axis=0)[1]);end=float(values[-1,:,:2].mean(axis=0)[1])
 for i in range(len(values)):
  t=i/(len(values)-1);progress=t*t*(3-2*t);target_y=start+(end-start)*progress
  result[i,:,1]+=target_y-float(values[i,:,:2].mean(axis=0)[1])
 return result

def remove_candidate_specks(p):
 # The generated 2x2 sheet has a few small neighboring-pose fragments at cell
 # boundaries. Drop disconnected islands, retaining the full alpha fringe of
 # every substantial component.
 n,labels,stats,_=cv2.connectedComponentsWithStats((p[:,:,3]>32).astype('uint8'),8)
 if n<=1:return p.copy()
 largest=int(stats[1:,cv2.CC_STAT_AREA].max());minimum=max(48,int(largest*.001))
 keep=np.zeros((CELL,CELL),np.uint8)
 for i in range(1,n):
  if int(stats[i,cv2.CC_STAT_AREA])>=minimum:keep|=(labels==i).astype(np.uint8)
 # Restore a one-pixel antialias fringe around each retained component.
 keep=cv2.dilate(keep,np.ones((3,3),np.uint8),iterations=1).astype(bool)
 result=p.copy();result[~keep]=0
 return result

def register_candidate(p,target_eye_distance,target_eye_x,baseline=372):
 # Normalize with one uniform similarity scale, then translate to the authored
 # eye path and common paw baseline. Never stretch x and y independently.
 eyes=features(p);eye_distance=float(np.linalg.norm(eyes[1,:2]-eyes[0,:2]))
 if eye_distance<1:raise RuntimeError('Candidate eye distance is invalid')
 scale=float(target_eye_distance/eye_distance)
 eye_center=eyes[:,:2].mean(axis=0)
 ys,xs=np.where(p[:,:,3]>160)
 if not len(xs):raise RuntimeError('Candidate silhouette is empty')
 foot_baseline=float(ys.max())
 tx=float(target_eye_x-scale*eye_center[0]);ty=float(baseline-scale*foot_baseline)
 matrix=np.array([[scale,0,tx],[0,scale,ty]],np.float32)
 warped=cv2.warpAffine(premul(p),matrix,(CELL,CELL),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0,0))
 return rgba(warped),dict(inputEyeDistance=eye_distance,uniformScale=scale,inputEyeCenter=[float(v) for v in eye_center],targetEyeCenterX=float(target_eye_x),inputFootBaseline=foot_baseline,outputFootBaseline=float(baseline),translation=[tx,ty])

def read_lowering_candidates(path):
 sheet=np.array(Image.open(path).convert('RGBA'));height,width=sheet.shape[:2]
 if width<2 or height<2:raise RuntimeError('Candidate sheet is too small')
 cells={}
 for i,name in enumerate(['20','45','70','90']):
  x0=(i%2)*width//2;x1=(i%2+1)*width//2
  y0=(i//2)*height//2;y1=(i//2+1)*height//2
  crop=sheet[y0:y1,x0:x1]
  cells[name]=remove_candidate_specks(cv2.resize(crop,(CELL,CELL),interpolation=cv2.INTER_AREA))
 return cells,(width,height)

flow=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
flow.setUseSpatialPropagation(True)
def gray(p):
 v=premul(p);bg=np.array([1,.965,.91],np.float32);rgb=v[:,:,:3]+(1-v[:,:,3:4])*bg
 return cv2.cvtColor(np.rint(rgb*255).astype('uint8'),cv2.COLOR_RGB2GRAY)
def signed_silhouette(p):
 mask=(p[:,:,3]>128).astype('uint8')
 return cv2.distanceTransform(mask,cv2.DIST_L2,3)-cv2.distanceTransform(1-mask,cv2.DIST_L2,3)
def pair(a,b):return flow.calc(gray(a),gray(b),None),flow.calc(gray(b),gray(a),None),signed_silhouette(a),signed_silhouette(b)
def interpolate(a,b,t,fields,support_mask=None):
 if t<=1e-8:return a.copy()
 if t>=1-1e-8:return b.copy()
 t=float(t);f,bwd,shape_a,shape_b=fields;maps=[]
 for field,amount in [(f,t),(bwd,1-t)]:
  mx,my=X.copy(),Y.copy()
  for _ in range(5):
   displacement=cv2.remap(field,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
   mx=(X-amount*displacement[:,:,0]).astype(np.float32);my=(Y-amount*displacement[:,:,1]).astype(np.float32)
  maps.append((mx,my))
 va=cv2.remap(premul(a),*maps[0],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 vb=cv2.remap(premul(b),*maps[1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 value=va*(1-t)+vb*t
 if support_mask is not None:
  # Keep source-authored lower foreleg/paw pixels out of whole-body optical
  # flow, which otherwise shears these supported limbs into ghost patches.
  direct=premul(a)*(1-t)+premul(b)*t
  mask=support_mask[:,:,None]
  value=value*(1-mask)+direct*mask
 # Flow can extrapolate exposed haunch fur into a detached wing. Constrain
 # coverage to the intermediate source silhouettes, with a 2px fur allowance.
 # Only remove spill; never invent filled pixels or change their RGB/alpha ratio.
 coverage=np.clip(1+(shape_a*(1-t)+shape_b*t)/2,0,1)[:,:,None]
 alpha=value[:,:,3:4];limited=np.minimum(alpha,coverage)
 ratio=np.divide(limited,alpha,out=np.zeros_like(alpha),where=alpha>1e-6)
 value[:,:,:3]*=ratio;value[:,:,3:4]=limited
 return rgba(value)

def lower_limb_support_mask(a,b):
 # Feather a direct-source support band around both measured forepaws. It is
 # used only for the 45%-to-70% lie transition; body/haunch above the band
 # keeps the bidirectional flow.
 centers=(paw_centers(a)+paw_centers(b))/2
 left=float(centers[0]-94);right=float(centers[1]+94)
 horizontal=smooth((X-(left-8))/8)*(1-smooth((X-(right+8))/8))
 vertical=smooth((Y-300)/14)
 return np.clip(horizontal*vertical,0,1)

def forepaw_patch_mask(source):
 # Keep only the two planted paw shapes from the source lying endpoint. The
 # narrow mask excludes the changing forearm/chest so those can lower freely.
 centers=paw_centers(source);mask=np.zeros((CELL,CELL),np.float32)
 vertical=smooth((Y-330)/8)
 for center in centers:
  paw=(1-smooth((np.abs(X-center)-28)/8))*vertical
  mask=np.maximum(mask,paw)
 return np.clip(mask,0,1)

def restore_forepaws(p,source,mask):
 value=premul(p);paw=premul(source);weight=mask[:,:,None]
 result=rgba(value*(1-weight)+paw*weight)
 exact=mask>=1.0
 result[exact]=source[exact]
 return result

def stable_face(p, target, reference, reference_features, extend_chin=False):
 # Keep the identity-bearing head texture from one raster; geometry follows
 # the registered eye trajectory. Body/haunch pose remains the selected source.
 a,b=reference_features[:,:2];u,v=target[:,:2];s=(a+b)/2;t=(u+v)/2
 d=b-a;e=v-u;den=float(d@d);re=float(e@d/den);im=float((e[1]*d[0]-e[0]*d[1])/den)
 det=re*re+im*im
 mx=(re*(X-t[0])+im*(Y-t[1]))/det+s[0]
 my=(-im*(X-t[0])+re*(Y-t[1]))/det+s[1]
 head=cv2.remap(premul(reference),mx.astype(np.float32),my.astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 # Replace the central face through the mouth and chin, then taper into the
 # chest fur. Ending the solid mask above the reference tongue leaves the
 # candidate tongue visible underneath as a second pink patch.
 # No on-screen fade between unrelated faces; this is offline source repair.
 mask=((1-smooth((np.abs(X-t[0])-100)/32))*(1-smooth((Y-t[1]-66)/24)))[:,:,None]
 if extend_chin:
  # Extend the canonical mouth only down the narrow centerline. A broad
  # extension would paint seated white chest fur over the orange folded legs.
  chin=(1-smooth((np.abs(X-t[0])-24)/12))*(1-smooth((Y-t[1]-90)/24))
  mask=np.maximum(mask,chin[:,:,None])
 # Keep the target silhouette/occlusion mask exactly: the standing reference
 # does not contain newly exposed haunches. Replacing alpha here would cut
 # shoulder holes or sprout fur flaps as the head descends.
 base=premul(p);alpha=base[:,:,3:4]
 mask*=smooth((head[:,:,3:4]-.9)/.1)*smooth((alpha-.9)/.1)
 color=np.divide(head[:,:,:3],head[:,:,3:4],out=np.zeros_like(head[:,:,:3]),where=head[:,:,3:4]>1e-6)
 value=base.copy();value[:,:,:3]=color*alpha*mask+base[:,:,:3]*(1-mask)
 return rgba(value)

def restore_interpolated_faces(frames, reference, reference_features, preserve_endpoints=True, extend_chin=False):
 # Optical flow can leave a second tongue below the moving muzzle. Restore the
 # canonical face at each interpolated eye position while retaining the
 # interpolated body and its exact alpha silhouette.
 result=[p.copy() for p in frames]
 if not result:return result
 previous=features(result[0])
 start=1 if preserve_endpoints else 0
 stop=len(result)-1 if preserve_endpoints else len(result)
 for i in range(start,stop):
  target=features(result[i],previous)
  result[i]=stable_face(result[i],target,reference,reference_features,extend_chin=extend_chin)
  previous=target
 return result

SELECTED_KEYS={'sitdown':list(range(16)),'liedown':[0,3,7,11,14,15],'tiltleft':[0,4,8,12,15],'tiltright':[0,4,8,12,15],'greet':[0,3,6,10,15]}
OUTPUT_COUNTS={'sitdown':48,'liedown':48,'tiltleft':32,'tiltright':32,'greet':32}

def expand_selected(frames,selected,count,support_pairs=(),paw_support_pairs=()):
 pairs=list(zip(selected,selected[1:]));fields={(a,b):pair(frames[a],frames[b]) for a,b in pairs}
 expanded=[]
 for phase in np.linspace(0,15,count):
  segment=min(len(selected)-2,int(np.searchsorted(selected,phase,side='right'))-1)
  a,b=selected[segment:segment+2]
  if (a,b) in support_pairs:mask=lower_limb_support_mask(frames[a],frames[b])
  elif (a,b) in paw_support_pairs:mask=forepaw_patch_mask(frames[15])
  else:mask=None
  expanded.append(interpolate(frames[a],frames[b],(phase-a)/(b-a),fields[(a,b)],mask))
 return expanded,fields

def max_eye_step_px(frames):
 landmarks=[];previous=None
 for p in frames:previous=features(p,previous);landmarks.append(previous[:,:2].copy())
 return float(max(np.linalg.norm(b-a,axis=1).max() for a,b in zip(landmarks,landmarks[1:])))

def eye_midpoint_y_path(frames):
 path=[];previous=None
 for p in frames:
  previous=features(p,previous);path.append(float(previous[:,:2].mean(axis=0)[1]))
 return path

def max_eye_reverse_px(frames):
 values=eye_midpoint_y_path(frames)
 return float(max((a-b for a,b in zip(values,values[1:])),default=0.0))

def pack(key,frames,cell,path,prealigned=True):
 rows=math.ceil(len(frames)/4)
 images=[Image.fromarray(p).resize((cell,cell),Image.Resampling.LANCZOS) if cell!=CELL else Image.fromarray(p) for p in frames]
 left=top=0;right=bottom=cell
 if path.startswith('art/dog-continuous-'):
  bounds=[]
  for image in images:
   yy,xx=np.where(np.array(image)[:,:,3]>2);bounds.append((int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())))
  left=max(0,min(b[0] for b in bounds)-3);top=max(0,min(b[1] for b in bounds)-3)
  right=min(cell,max(b[2] for b in bounds)+4);bottom=min(cell,max(b[3] for b in bounds)+4)
 w,h=right-left,bottom-top
 sheet=Image.new('RGBA',(w*4,h*rows));descriptors=[]
 previous=None
 for i,(p,image) in enumerate(zip(frames,images)):
  sheet.paste(image.crop((left,top,right,bottom)),((i%4)*w,(i//4)*h))
  previous=features(p,previous)
  yy,xx=np.where(p[:,:,3]>160)
  landmark=dict(eyes=[dict(x=float(e[0]),y=float(e[1]),mass=float(e[2]),rx=float(e[3]),ry=float(e[4])) for e in previous],top=int(yy.min()),bottom=int(yy.max()),left=int(xx.min()),right=int(xx.max()))
  descriptors.append(dict(x=i%4*w,y=i//4*h,width=w,height=h,canvasWidth=cell,canvasHeight=cell,offsetX=left,offsetY=top,anchorX=cell/2-left,anchorY=372*cell/CELL-top,referenceHeight=336*cell/CELL,phase=i/(len(frames)-1),pixelSha256=hashlib.sha256(p.tobytes()).hexdigest(),landmarks=landmark))
 sheet.save(ROOT/path,'WEBP',quality=92,method=6,exact=True)
 return dict(key=key,width=w*4,height=h*rows,cell=cell,frames=descriptors,prealigned=prealigned,path=path,bytes=(ROOT/path).stat().st_size,sha256=sha(path))

old=json.loads((ROOT/'art/dog-home-motion.json').read_text());all_frames={}
for key,desc in old['atlases'].items():
 sheet=np.array(Image.open(ROOT/desc['path']).convert('RGBA'))
 frames=[sheet[f['y']:f['y']+CELL,f['x']:f['x']+CELL].copy() for f in desc['frames']]
 for p in frames:p[p[:,:,3]<3]=0
 all_frames[key]=frames
# Share the actual endpoint raster, rather than independently generated poses.
stand=all_frames['sitdown'][0].copy();planted=paw_centers(stand)
all_frames['sitdown']=[plant_paws(p,planted) if i else p.copy() for i,p in enumerate(all_frames['sitdown'])]
seat=all_frames['sitdown'][-1].copy()
for key in ['tiltleft','tiltright','greet']:all_frames[key][0]=stand.copy()
all_frames['liedown'][0]=seat.copy()
candidate_path='art/motion-repair-v15/lowering-candidate.png'
candidate_cells,candidate_sheet_size=read_lowering_candidates(ROOT/candidate_path)
metadata=dict(
 version=1,mode='continuous-home-motion',
 method='canonical face RGB with preserved source alpha + authored/candidate poses + silhouette-constrained bidirectional DIS; targeted 48/32 uniform phases',
 atlases={},sourceSheets={},
 generator=dict(path='scripts/build-home-continuity.py',sha256=sha('scripts/build-home-continuity.py')),
 opencv=cv2.__version__,baseline=sha('art/dog-home-motion.json'),
 candidateInputs=dict(
  generator='built-in image_gen',
  sheet=dict(path=candidate_path,sha256=sha(candidate_path),size=list(candidate_sheet_size)),
  references=[dict(path=p,sha256=sha(p)) for p in ['art/motion-repair-v15/seated-reference.png','art/motion-repair-v15/lying-reference.png']],
  layout=dict(grid=[2,2],rowMajorPoses=['20%','45%','70%','90%'],cellResize='cv2.INTER_AREA to 384x384'),
  processing=dict(
   alphaCleanup='8-connected components over alpha>32; retain components with area >= max(48, 0.001 * largest component), then dilate the retained mask by one pixel to preserve antialias fringe',
   registration='one uniform scale to canonical eye distance; translate eye midpoint to the seat-to-lie endpoint x trajectory and alpha>160 foot baseline to y=372; premultiplied RGBA warpAffine; locally plant candidate feet to the shared mean of the 45% and 70% source paw centers',
   face='apply stable_face after registration and to each interpolated lie pose with narrow central chin extension (24px half-width, feather 12px; through eyeY+90 then feather 24px); preserve target alpha and exact shared seat/original lie endpoint',
   pawSupport='graft original lie endpoint paw pixels to keyframes 11 and 14 in two narrow masks (x half-width 28px + 8px feather; y starts at 330 + 8px feather); preserve keyframe 15 exactly, use direct source support over transitions 11-14 and 14-15, then restore the planted patch after face graft for phases >=11',
   keyframes={'0':'exact shared seat','3':'generated 20%','7':'generated 45%','11':'generated 70%','14':'generated 90%','15':'exact original lie endpoint'})))
baseline=json.loads((ROOT/'art/local-motion/v13/metadata.json').read_text())
metrics={}
reference=stand.copy();reference_features=features(reference)
for key,frames in all_frames.items():
 print('Registering',key,flush=True)
 if key in ['tiltleft','tiltright']:
  # These no longer play automatically; retain their validated V13 rasters.
  # Canonical grafting onto a steep tilt can confuse an eye with the nose.
  desc=baseline['atlases'][key]
  source=f'art/local-motion/v13/{key}-production.webp'
  shutil.copyfile(ROOT/source,ROOT/desc['path'])
  for suffix in ['corrected16','interpolated32']:
   shutil.copyfile(ROOT/f'art/local-motion/v13/{key}-{suffix}.webp',ROOT/f'art/continuity/{key}-{suffix}.webp')
  metadata['atlases'][key]=desc
  metadata['sourceSheets'][key+'-baseline']=dict(path=source,sha256=sha(source))
  metadata['sourceSheets'][key+'-baseline-metadata']=dict(path='art/local-motion/v13/metadata.json',sha256=sha('art/local-motion/v13/metadata.json'))
  metrics[key]=dict(count=32,distinct=len({f['pixelSha256'] for f in desc['frames']}),retainedBaseline=True,sourceKeyframes=list(range(16)),replacedSourceIndices=[],endpointsPreserved=True,alphaEdgePixels=0)
  continue
 if key=='liedown':
  selected=SELECTED_KEYS[key];endpoint=frames[15].copy()
  shared_features=features(shared_seat);endpoint_features=features(endpoint)
  shared_eye_x=float(shared_features[:,:2].mean(axis=0)[0]);endpoint_eye_x=float(endpoint_features[:,:2].mean(axis=0)[0])
  eye_distance=float(np.linalg.norm(reference_features[1,:2]-reference_features[0,:2]))
  anchors=[None]*16;anchors[0]=shared_seat.copy();anchors[15]=endpoint
  candidate_poses={};registrations={}
  for index,name in zip(selected[1:-1],['20','45','70','90']):
   progress=index/15;target_eye_x=shared_eye_x+(endpoint_eye_x-shared_eye_x)*progress
   pose,registration=register_candidate(candidate_cells[name],eye_distance,target_eye_x)
   candidate_poses[name]=pose;registrations[name]=dict(keyframe=index,**registration)
  shared_paws=(paw_centers(candidate_poses['45'])+paw_centers(candidate_poses['70']))/2
  paw_mask=forepaw_patch_mask(endpoint)
  for index,name in zip(selected[1:-1],['20','45','70','90']):
   pose=plant_paws(candidate_poses[name],shared_paws)
   anchors[index]=stable_face(pose,features(pose),reference,reference_features,extend_chin=True)
   if index in [11,14]:anchors[index]=restore_forepaws(anchors[index],endpoint,paw_mask)
   registrations[name]['pawCentersBefore']=paw_centers(candidate_poses[name]).astype(float).tolist()
   registrations[name]['sharedPawTarget']=shared_paws.astype(float).tolist()
  expanded,lie_fields=expand_selected(anchors,selected,OUTPUT_COUNTS[key],support_pairs={(7,11)},paw_support_pairs={(11,14),(14,15)})
  expanded=restore_interpolated_faces(expanded,reference,reference_features,extend_chin=True)
  paw_support_start=math.ceil(11*47/15)
  for i in range(paw_support_start,len(expanded)):expanded[i]=restore_forepaws(expanded[i],endpoint,paw_mask)
  support_samples=[]
  for t in [.4,.45,.5,.55]:support_samples.append(interpolate(anchors[7],anchors[11],t,lie_fields[(7,11)],lower_limb_support_mask(anchors[7],anchors[11])))
  support_samples=restore_interpolated_faces(support_samples,reference,reference_features,preserve_endpoints=False,extend_chin=True)
  support_sheet=Image.new('RGBA',(CELL*4,CELL),(246,239,226,255));draw=ImageDraw.Draw(support_sheet)
  for i,(t,p) in enumerate(zip([.4,.45,.5,.55],support_samples)):
   support_sheet.alpha_composite(Image.fromarray(p),(i*CELL,0));draw.text((i*CELL+8,8),f'45-70 t={t:.2f}',fill=(20,20,20,255))
  support_sheet.convert('RGB').save(ROOT/'art/continuity/liedown-support-review.png')
  tail_sheet=Image.new('RGBA',(CELL*4,CELL*2),(246,239,226,255));tail_draw=ImageDraw.Draw(tail_sheet)
  for j,index in enumerate(range(40,48)):
   tail_sheet.alpha_composite(Image.fromarray(expanded[index]),((j%4)*CELL,(j//4)*CELL))
   tail_draw.text(((j%4)*CELL+8,(j//4)*CELL+8),f'frame {index} phase={index*15/47:.3f}',fill=(20,20,20,255))
  tail_sheet.convert('RGB').save(ROOT/'art/continuity/liedown-tail-review.png')
  count=OUTPUT_COUNTS[key]
  pack(key,[anchors[i] for i in selected],384,'art/continuity/liedown-keyframes6.webp')
  desc=pack(key,expanded,320,f'art/dog-continuous-{key}.webp')
  metadata['atlases'][key]=desc
  metadata['sourceSheets'][key]=dict(path=old['atlases'][key]['path'],sha256=sha(old['atlases'][key]['path']),usedFrameIndices=[15])
  metadata['sourceSheets'][key+'-candidate']=dict(path=candidate_path,sha256=sha(candidate_path),cellPoseMap=dict(zip(['20','45','70','90'],selected[1:-1])))
  metadata['sourceSheets'][key+'-candidate-seated-reference']=dict(path='art/motion-repair-v15/seated-reference.png',sha256=sha('art/motion-repair-v15/seated-reference.png'))
  metadata['sourceSheets'][key+'-candidate-lying-reference']=dict(path='art/motion-repair-v15/lying-reference.png',sha256=sha('art/motion-repair-v15/lying-reference.png'))
  metadata['candidateInputs']['processing']['registrations']=registrations
  metadata['candidateInputs']['processing']['commonPawTarget']=shared_paws.astype(float).tolist()
  pack(key,expanded,384,f'art/continuity/{key}-interpolated{count}.webp')
  metrics[key]=dict(count=count,distinct=len({hashlib.sha256(f.tobytes()).hexdigest() for f in expanded}),sourceKeyframes=selected,replacedSourceIndices=[i for i in range(16) if i not in selected],candidateRegistrations=registrations,maxEyeStepPx=max_eye_step_px(expanded),supportReview=dict(path='art/continuity/liedown-support-review.png',times=[.4,.45,.5,.55]),tailReview=dict(path='art/continuity/liedown-tail-review.png',frames=list(range(40,48))),endpointPawSupport=dict(sourceKeyframe=15,graftedTo=[11,14],supportPairs=[[11,14],[14,15]],maskBounds=dict(xHalfWidth=28,xFeather=8,yStart=330,yFeather=8),restoredAfterFaceGraftFromFrame=paw_support_start),endpointsPreserved=bool(np.array_equal(expanded[0],shared_seat) and np.array_equal(expanded[-1],endpoint)),sharedSeatExact=bool(np.array_equal(anchors[0],shared_seat)),originalLieEndpointExact=bool(np.array_equal(anchors[15],endpoint)),alphaEdgePixels=sum(int((p[[0,-1],:,3]>32).sum()+(p[:,[0,-1],3]>32).sum()) for p in expanded))
  print(key,desc['bytes'],metrics[key],flush=True)
  continue
 landmarks=[];previous=None
 for p in frames:previous=features(p,previous);landmarks.append(previous)
 head_targets=monotone_sit_head(landmarks) if key=='sitdown' else None
 corrected=[]
 for i,p in enumerate(frames):
  if key=='sitdown':
   target=head_targets[i]
  else:
   lo=max(0,i-1);hi=min(15,i+1);target=(landmarks[lo]+2*landmarks[i]+landmarks[hi])/4
   if i in [0,15]:target=landmarks[i]
  corrected.append(align(p,landmarks[i],target) if i not in [0,15] else p.copy())
 if key in SELECTED_KEYS:
  corrected=[stable_face(p,features(p),reference,reference_features) for p in corrected]
  corrected[0]=shared_seat.copy() if key=='liedown' else stand.copy()
  if key=='sitdown': shared_seat=corrected[-1].copy()
 pack(key,corrected,384,f'art/continuity/{key}-corrected16.webp')
 selected=SELECTED_KEYS.get(key,list(range(16)))
 count=OUTPUT_COUNTS[key]
 expanded,_=expand_selected(corrected,selected,count)
 if key=='sitdown':
  expanded=[plant_paws(p,planted) if i not in [0,count-1] else p for i,p in enumerate(expanded)]
 desc=pack(key,expanded,320,f'art/dog-continuous-{key}.webp')
 metadata['atlases'][key]=desc
 metadata['sourceSheets'][key]=dict(path=old['atlases'][key]['path'],sha256=sha(old['atlases'][key]['path']))
 metadata['sourceSheets'][key+'-metadata']=dict(path='art/dog-home-motion.json',sha256=sha('art/dog-home-motion.json'))
 # Full-resolution comparison sheets only live in the development workspace.
 pack(key,expanded,384,f'art/continuity/{key}-interpolated{count}.webp')
 metrics[key]=dict(frontPawDriftCss=float(np.max(np.ptp(np.array([paw_centers(p) for p in expanded]),axis=0))*232*(390/310)*.82/336) if key=='sitdown' else None,maxEyeStepPx=max_eye_step_px(expanded),count=count,sourceKeyframes=selected,replacedSourceIndices=[i for i in range(16) if i not in selected],distinct=len({hashlib.sha256(p.tobytes()).hexdigest() for p in expanded}),endpointsPreserved=bool(np.array_equal(expanded[0],corrected[0]) and np.array_equal(expanded[-1],corrected[-1])),alphaEdgePixels=sum(int((p[[0,-1],:,3]>32).sum()+(p[:,[0,-1],3]>32).sum()) for p in expanded))
 if key=='sitdown':metrics[key]['authoredHeadEyeMidY']=eye_midpoint_y_path(corrected);metrics[key]['authoredHeadMaxReversePx']=max_eye_reverse_px(corrected)
 print(key,desc['bytes'],metrics[key],flush=True)
base=json.loads((ROOT/'art/dog-image-animation.json').read_text())
metadata['textureBytes']=sum(a['width']*a['height']*4 for a in metadata['atlases'].values())
metadata['compressedBytes']=sum(a['bytes'] for a in metadata['atlases'].values())
if metadata['textureBytes']+base['textureBytes']>80_000_000:raise RuntimeError('Decoded texture budget exceeded')
if metadata['compressedBytes']+base['compressedBytes']>5_000_000:raise RuntimeError('Download budget exceeded')
(ROOT/'art/dog-home-continuity.json').write_text(json.dumps(metadata,indent=2)+'\n')
(ROOT/'art/continuity/compiler-evidence.json').write_text(json.dumps(dict(metrics=metrics,candidateInputs=metadata['candidateInputs'],motionChecks=dict(sitEyeStepPxAtMost18=metrics['sitdown']['maxEyeStepPx']<18,sitPawDriftCssAtMost2=metrics['sitdown']['frontPawDriftCss']<=2,sitAuthoredHeadReverseAtMost2=metrics['sitdown']['authoredHeadMaxReversePx']<=2,lieEyeStepPxAtMost18=metrics['liedown']['maxEyeStepPx']<18),textureBytes=metadata['textureBytes']+base['textureBytes'],compressedBytes=metadata['compressedBytes']+base['compressedBytes'],opencv=cv2.__version__),indent=2)+'\n')
print('Done',metadata['textureBytes'],metadata['compressedBytes'])
