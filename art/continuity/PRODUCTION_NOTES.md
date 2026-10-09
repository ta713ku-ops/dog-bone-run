# v0.13 continuity assets

Original generated V1 dog identity is retained. The newly edited imagegen sheet
`generated-sit-candidate.png` was rejected: independently changing fur/face did
not provide a dependable temporal sequence. The approved plan allows local
correspondence interpolation; no paid API/GPU or external upload was used.

The reproducible compiler is `scripts/build-home-continuity.py`. It uses Pillow,
numpy and OpenCV headless 5.0.0 (PyPI distribution installed for this work:
`opencv-python-headless==5.0.0.93`). DIS computes forward/backward pixel
correspondence; inverse sampling warps each image toward a shared intermediate
position before premultiplied-alpha composition. This is an offline process.
No runtime inference or external weights are shipped. FILM was not adopted;
TensorFlow/GPU environment was absent.

The source16 images are registered to a smooth eye trajectory. Sitdown also
registers both visible front paw contacts in the lower-leg region, leaving the
head/body above it free to lower. Lying front paws intentionally extend: these
are moving paws, not a planted contact claim. The corrected sit endpoint is
shared with lying start; standing endpoint is shared with tilts/greeting.
Exactly32 uniform phases i/31 include both endpoints; none is padded with a
copied duplicate. Interpolation does not bake playback easing.

Comparison assets retain384px cells. Production uses logical320px cells with
transparent outer margins cropped away; offsets and anchors restore their
logical384px drawing coordinates. Precomputed eye landmarks remove the startup
scan. Rendering uses `prealigned` to avoid applying facial registration twice.
The actual displayed production assets are separately inspected and tested.

Rebuild example on this host:

```sh
PYTHONPATH=/private/tmp/dog-flow-deps PATH=/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin:$PATH npm run assets:continuity
```

A fresh environment needs Pillow, numpy and the pinned OpenCV dependency.
The temporary dependency directory can be removed without affecting gameplay;
rebuilding then requires the dependency to be installed again. Asset/source/
compiler hashes are checked before `npm run build` changes dist.

Reference documentation: [OpenCV optical-flow tracking](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html).

## Image-generation candidate record

Mode: built-in imagegen edit, transparent background. Edit target:
`art/source/dog-home-sitdown-v1.png`. Output copied into the workspace as
`art/continuity/generated-sit-candidate.png`; it is not referenced by the game.

Brief summary (not a verbatim prompt): preserve the exact original Pomeranian,
face, fur, camera, framing and scale; make a transparent 4x4 sequence of16
consecutive standing-to-sitting poses with planted front paws, continuous head
motion, no bouncing, no cropped body and no newly changed face/fur. Visual
inspection found independent fur/face changes, so the candidate was rejected.
No replacement dog was adopted. The final five32-frame sequences come from
the original prepared V1 frames and the reproducible offline compiler above.
