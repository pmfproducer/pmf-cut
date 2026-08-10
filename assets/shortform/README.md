# Short-form template (Reels / TikTok / Shorts) — DATA-DRIVEN

The proven Phase-2 Remotion composition for vertical short-form. **The code is
immutable** — everything per-video is data. Do NOT read or edit `src/Main.tsx`;
write `public/edit-data.json` instead. The only editable code file is
`src/CustomGraphics.tsx` (bespoke motion graphics, worked examples inside).

## Scaffold (one command)

```bash
cp -R <skill>/assets/shortform/. <edit>/remotion/ && cd <edit>/remotion && npm install
```

Then copy `cut.mp4` into `public/` and generate the data files below.

## Data pipeline (per video, all into `remotion/public/`)

1. `transcribe.py cut.mp4 --edit-dir <edit>` → `transcripts/cut.json`
   (times already on the output timeline — do NOT map the source EDL).
2. `captions_for_remotion.py --transcript transcripts/cut.json -o public/captions.json`
   - Stacked caption style only: also `caption_style.py --transcript
     transcripts/cut.json -o public/caption-cues.json` and set
     `captions.style:"stacked"`. Preview the two styles from
     `caption-styles/stacked.png`.
3. `face_track.py cut.mp4 -o public/track.json`
4. `public/segments.json` — cumulative cut boundaries, measured from the ENCODED
   segments' frame counts (`ffprobe -count_frames` over `clips_graded/seg_*.mp4`),
   never summed from the EDL's seconds. ffmpeg rounds each segment up to a whole
   frame, so EDL arithmetic drifts and the error accumulates across the video.
5. `pexels_search.py "<query>" --out-dir public/pexels …` for insert images.
6. **Write `public/edit-data.json`** — the whole edit in one file (schema below).

## edit-data.json schema (all times in seconds on the cut timeline)

```jsonc
{
  "width": 1080, "height": 1920, "fps": 30,  // MATCH cut.mp4 (ffprobe it): 30 for 30fps+ sources, else 24
  "durationSec": 87.5,              // EXACT cut.mp4 duration (ffprobe)
  "camera": {                        // hard zoom on cuts + push-in + eye track
    "enabled": true,
    "zooms": [1.14, 1.2, 1.12, 1.22, 1.16, 1.1, 1.18],  // per cut segment, cycles
    "pushIn": 0.04, "targetX": 0.5, "targetY": 0.4
  },
  "hook": {                          // static headline, first ~4s (always on)
    "enabled": true, "endSec": 4.0,
    "style": "card",                 // "card" (default) | "outline"
    "lines": ["A IA MAIS", "PERIGOSA DO MUNDO", "ACABOU DE SER LIBERADA"],
    "logo": "brand/logo.webp",       // card only: public/ path or null
    "sign": "brand/warning.webp"     // card only: transparent symbol or null
    // "outline" style — white text + thick black stroke, no card, sentence-case,
    // sits lower (may overlap top of head). Write lines[] in sentence case, drop
    // logo/sign, and tune: "fontSizePx": 68, "strokePx": 12, "paddingTop": 330,
    // "lineHeight": 1.06
  },
  "captions": {                      // karaoke, ≤3 words, Poppins Black
    "enabled": true, "fontSize": 76, "maxWords": 3,
    "safeWidth": 720,                // clears the platform action rail — keep 720
    "paddingBottom": 420,
    // optional: ranges where the caption sits elsewhere (split screen parks it
    // on the seam). Resolved per FRAME, so a line crossing the boundary moves.
    "windows": [{"start": 11.64, "end": 14.73, "paddingBottom": 1074}],
    "style": "karaoke"               // "karaoke" (default) | "stacked" (see below)
    // when "stacked": run caption_style.py → public/caption-cues.json, then the
    // stacked style renders (multi-font stack + pencil outline + click/scratch).
    // optional stacked overrides: "stackedOffsetY": 0.156, "fontScale": 1,
    // "sfx": {"enabled": true, "clickVolume": 0.45, "scratchVolume": 0.16}
  },
  "inserts": [                       // rounded-card images, upper zone
    {"src": "pexels/ai.jpg", "start": 1.95, "end": 3.35}
  ],
  "behind": [                        // behind-the-subject (person_matte.py first)
    {"kind": "image", "src": "ill/x.jpg", "matte": "fg_x.mov", "start": 4.15, "dur": 1.65},
    {"kind": "words", "matte": "fg_w.mov", "start": 19.55, "dur": 1.5,
     "words": [{"t": "MAS", "at": 19.55}, {"t": "POR", "at": 19.9}, {"t": "QUE", "at": 20.26}]}
  ],
  "splitInserts": [                  // STYLE "tela dividida" — see below
    {"src": "brand/logo.jpg", "start": 11.64, "end": 14.73, "fit": "cover", "bandH": 750,
     // optional per-window overrides — all MEASURED on a real frame, never guessed:
     "zoom": 1.15, "focusY": 177,    // head framing, when LAYOUT's defaults don't fit
     "pos": "50% 27%"}               // objectPosition of the ART inside the band
  ],
  "fullInserts": [                   // STYLE "só b-roll" — B-roll owns the whole frame
    {"src": "pexels/clinic.mp4", "start": 4.21, "end": 6.96, "fit": "cover", "pos": "50% 40%"}
  ],
  "videoLag": 1,                     // MEASURE IT — see "videoLag" below. Default 1.
  "soundtrack": {"enabled": false, "file": "trilha.mp3", "volume": 0.12}
  // Phase 3 flips soundtrack.enabled to true once trilha.mp3 exists
}
```

## Style: "SÓ B-ROLL" (`fullInserts[]`)

The speaker leaves the frame and the B-roll owns all 1080×1920. Mix it with
full-frame speaker and `splitInserts` to get the three-way alternation that reads
as a real edit. Same frame-indexed windows as the split, same flat-mount rule.

- **Prefer VIDEO over stills.** A photo held for 4s reads as a freeze no matter
  how much Ken-Burns you put on it. And check the clip actually MOVES: a 5s
  locked-off shot looping inside a 9s window is technically video and still reads
  as a photo — the user called one out. `YAVG` sampled across the window tells you
  in one command whether anything changes.
- **Darken the caption band, and darken it WHERE THE TEXT IS.** Stock footage is
  routinely bright in the lower third. A plain 0→max gradient over the bottom
  620px is only a third of the way up its ramp at the caption baseline (~1500px)
  — measured at ~0.23 effective opacity, i.e. invisible. Ramp to full strength BY
  the caption band. Measured effect on a white-lab-coat shot: YAVG 141 → 94.
- **`pos` (objectPosition) is not optional on portrait clips.** `cover` into a
  1080×750 band crops hard from the CENTRE, and the subject is rarely there — it
  decapitated a doctor whose face sat in the upper third. Measure the offset with
  `scale=1080:-2,crop=1080:750:0:N` at a few N, then `pos = "50% N/(H-750) %"`.
- **Scan stock clips for a broken index before rendering.** A Pexels clip with
  `nb_frames=N/A` (incomplete moov, keyframes 8s apart) hangs Chrome's decoder
  mid-render with a `delayRender()` timeout that names the file. Re-encode with a
  short GOP. One command finds them all:
  `for f in public/pexels/*.mp4; do [ "$(ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames -of default=nw=1:nk=1 "$f")" = N/A ] && echo "$f"; done`

## `videoLag` — measure it, never inherit it

OffthreadVideo *can* draw the source frame one composition frame late. It is not
universal. Hardcoded to 1, a real 24fps project whose true value was 0 got the
split band leaving one frame after the take cut and the delivered voice sitting
41.7ms late — audible as soft lip-sync drift, and the compensation itself was the
cause. Set `videoLag` from a measurement; the template defaults to 1.

1. **A per-pixel compare between cut.mp4 and the render does not work** — the
   camera zoom and gamma difference dominate and every offset ties (0.5753 vs
   0.5754 across ±2 frames on a real test).
2. **scdet on a PURE take cut** (full frame both sides, no overlay, no
   transition). Same spike frame in both files = lag 0.
3. **Confirm with a motion-signature correlation** — frame-to-frame difference
   energy, cross-correlated. Immune to zoom and gamma; a clean result reads ~0.95
   at the true offset and ~0.3–0.5 one frame either side.
4. Whatever you measure must ALSO drive the voice delay and the SFX placement in
   the delivery mux, or picture and sound disagree.

**A constant offset is not proof of sync.** "+41.7ms constant at three points"
proves there is no DRIFT; it says nothing about OFFSET. A fixed one-frame error
passes that test unchanged.

## The style (locked defaults encoded in src/)

- **1080×1920**, **30fps when the source is 30fps+** (else 24) — `fps` in
  edit-data.json must equal cut.mp4's fps; base `<OffthreadVideo src=cut.mp4>` with the dynamic
  camera (hard zoom per segment + slow push-in + clamped eye-tracking).
- **Captions**: two styles via `captions.style`. **karaoke** (default) — one
  line ≤3 words, words rise in, Poppins Black, lower third, `measureText` fit
  into `safeWidth` 720 (action-rail safe). **stacked** — multi-font vertical
  stack (Poppins bold-italic gradient / regular / Playfair serif orange #ff5200 /
  bold), solo emphasis words, green pencil ellipse, and baked click/scratch SFX;
  driven by `caption-cues.json` (from `caption_style.py`). Reference:
  `caption-styles/stacked.png`.
- **Hook**: two styles via `hook.style`. **card** (default) — uniform-size
  headline on a dark-gray rounded card, UPPERCASE, optional logo+symbol row.
  **outline** — white text + thick black stroke, no card, sentence-case, sits
  lower (may overlap the top of the head); tune `fontSizePx`/`strokePx`/
  `paddingTop`/`lineHeight`. Copy written like a virality specialist; approve a
  still first.
- **Inserts**: rounded card + shadow, upper zone, slow Ken-Burns, whoosh on entry.
- **Behind-the-subject**: elements top-anchored; matte gets the same camera via
  `frameOffset`; ProRes 4444 + `<OffthreadVideo transparent>`.
- **Audio**: whoosh ~0.09 / pop ~0.12 / music ~0.12, and ALWAYS a final loudnorm
  pass on the render (voice+music+SFX clip otherwise).

## Render

`npx remotion render Reels out/render.mp4`, loudnorm → `edit/final.mp4`.
Verify stills at cut boundaries (no black edges) before the full render.
`generate_sfx.py` regenerates the sfx pack if ever needed.


## Style: "TELA DIVIDIDA" (split screen)

Image on top, talking head re-drawn underneath. Set `splitInserts[]` in
edit-data.json; `CustomGraphics.tsx` maps over it (never hardcode the windows —
the preview timeline only shows what is in the data).

Rules that make it read as a style and not an accident:
- **The seam sits at the subject's hairline.** `bandH` is the band height in px
  (750 on a 1080×1920 frame for a medium close-up). Check a still: the top of the
  head should just touch the seam, with no dead gap and no crop.
- **Hard cut, never a fade.** A dissolve shows the full-frame take ghosting
  through the band for a beat and reads as a glitch.
- **Every window starts and ends ON a take cut**, from a `segments.json` built
  out of real frame counts (see above). With EDL-derived seconds the split flips a
  few frames BEFORE the picture cuts — small, but it reads as a mistake. Express
  the times as `frame / fps` so `Math.round(sec * fps)` lands on that exact frame.
- **No SFX on the transition.** A whoosh implies motion; this is a hard cut.
- **Mount the split as ONE flat layer, never a `<Sequence>` per window with
  `<OffthreadVideo startFrom>`.** Wrapped that way the layer samples cut.mp4 a
  frame behind the base video, so the first frame of the split still shows the
  PREVIOUS take.
- **`VIDEO_LAG = 1`.** OffthreadVideo draws the source frame at or before
  `frame/fps`; on an exact frame boundary that resolves one frame late, so the
  decoded picture changes one composition frame after the index does. Verify per
  project rather than trusting it: disable the split, render stills either side of
  a cut, and see which frame the picture actually changes on — the camera zoom
  (index-driven) steps a frame earlier than the take itself.
- **Compare window bounds in FRAMES, not seconds.** Window values are rounded in
  the JSON; an epsilon comparison on seconds lands a frame off (this is what made
  the caption move one frame after the layout).
- **Consecutive images share one window run** — leave no gap between them, or the
  split blinks off for a frame or two between pictures.
- **Captions ride the seam** while the split is up: add matching `captions.windows`
  with `paddingBottom = height - bandH - ~96`, and they drop back on their own.
- The head is re-framed by `VID_ZOOM`/`VID_FOCUS_Y` inside `HookSplitInner`;
  without it the source's headroom leaves a dead gap under the band.
