/**
 * CustomGraphics — the ONE file you edit in Phase 2, and ONLY when a spoken
 * word calls for a bespoke motion graphic instead of a stock image (e.g.
 * "animações" → animated shapes, "roteiro" → a typewriter script sheet,
 * "gráfico" → a growing chart). Everything else is data in edit-data.json.
 *
 * Default: renders nothing. To add graphics, build components here (worked
 * examples below — same upper-zone card motif as the image inserts) and mount
 * them in <CustomGraphics/> with their own <Sequence from/durationInFrames>.
 *
 * Timings: get the payoff word's timestamp from the cut transcript and land
 * the animation on it. Keep 0.5–2s per accent; whoosh on entry, pop on shapes.
 */
import {
  AbsoluteFill,
  Sequence,
  Img,
  OffthreadVideo,
  Video,
  staticFile,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Poppins';
import {Sfx} from './Main';
import editData from '../public/edit-data.json';

const {fontFamily} = loadFont('normal', {weights: ['400', '600', '900']});
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ============ MOUNT POINT (edit this) ==========================================
// STYLE "TELA DIVIDIDA" (split screen) — driven by edit-data.json `splitInserts`.
// Leave the array out and this renders nothing, as before.
type SplitInsert = {
  src: string;
  start: number;
  end: number;
  fit?: 'cover' | 'contain';
  bandH?: number;
  layout?: 'top' | 'bottom';
  // Per-window override of the head framing. LAYOUT's defaults fit a head ~660px
  // tall starting at y 455; this source's head starts at y 290, so the defaults
  // push it under the caption. Measured per project, not guessed.
  zoom?: number;
  focusY?: number;
  // objectPosition for the ART. `cover` into a 1080×750 band crops a portrait
  // clip hard, and the centre is rarely where the subject is — it decapitated a
  // doctor whose face sat in the upper third. Measure the offset on a real frame
  // (scale to 1080 wide, crop 750 at N) and convert N to a percentage of the
  // leftover height.
  pos?: string;
};

// STYLE "SÓ B-ROLL" — the B-roll takes the WHOLE frame and the speaker drops out
// for a beat. Same frame-indexed windows as the split (VIDEO_LAG included), so a
// window edge lands on the cut, and same data-driven shape so the preview
// timeline can see and retime it.
type FullInsert = {
  src: string;
  start: number;
  end: number;
  fit?: 'cover' | 'contain';
  pos?: string;
};

// Two variants of one idea — both PIN THE FACE to a fixed region and give the
// rest of the frame to the image:
//   'top'    "Tela dividida"   — art on top, head raised underneath
//   'bottom' "Tela dividida 2" — head held high, art underneath
// The zoom/focus pair is what pins the face and is NOT interchangeable between
// them. `focusY` is a SOURCE y that lands at the top of the video window, so a
// point y_src renders at (y_src - focusY) * zoom.
//   top:    the head must be lifted out of the source's headroom → zoom in hard.
//   bottom: that headroom is the point — it is what puts the face under the
//           frame edge instead of in the middle.
// MEASURE THE SOURCE before trusting these numbers: ffmpeg a frame out of
// cut.mp4, read the hair-top and chin y, and set focusY so the head lands where
// the user asked. The values below fit a head ~660px tall starting at y 455.
const LAYOUT = {
  top: {zoom: 1.25, focusY: 400},
  bottom: {zoom: 1.0, focusY: 225},
} as const;

// A cut transition: a light beam whips across the frame while a short flash
// blooms, with a click on the cut. Data, not JSX — `transitions` in
// edit-data.json — so the windows stay visible to the preview timeline and
// retimeable without touching code.
type CutFlash = {at: number; intensity?: number; sfx?: string; volume?: number; type?: 'flash' | 'swipe'};
const SWIPE_COLOR = (editData as {captions?: {accent?: string}}).captions?.accent || '#d32222';

export const CustomGraphics: React.FC = () => {
  const d = editData as {
    splitInserts?: SplitInsert[];
    fullInserts?: FullInsert[];
    transitions?: CutFlash[];
  };
  const splits = d.splitInserts ?? [];
  const fulls = d.fullInserts ?? [];
  const flashes = d.transitions ?? [];
  // Full B-roll covers the frame, so it goes ABOVE the split layer; a window of
  // each must never overlap anyway (they are alternatives, not layers).
  return (
    <>
      {splits.length ? <SplitScreen items={splits} /> : null}
      {fulls.length ? <FullBroll items={fulls} /> : null}
      {flashes.length ? <CutFlashes items={flashes} /> : null}
    </>
  );
};

// ============ CUT FLASH =======================================================
// Starts BEFORE the cut and peaks on it. A transition that begins on the cut
// frame reads as a flash after the fact; leading it by two frames makes the
// light look like the thing that caused the change.
// `at` is the cut time exactly as segments.json states it — VIDEO_LAG lines it
// up with the frame the picture actually changes on, same as the split windows.
const FLASH_LEAD = 2; // frames before the cut
const FLASH_LEN = 7; // total, ~230ms at 30fps
// Measured off the file, not assumed: whoosh.mp3 peaks 220ms in (10ms RMS
// windows). The delivery mix in ffmpeg must use the SAME number.
const WHOOSH_PEAK_S = 0.22;
const WHOOSH_PEAK_FRAMES = (fps: number) => Math.round(WHOOSH_PEAK_S * fps);

const CutFlashes: React.FC<{items: CutFlash[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();

  const active = items.find((it) => {
    const c = Math.round(it.at * fps) + VIDEO_LAG;
    return frame >= c - FLASH_LEAD && frame < c - FLASH_LEAD + FLASH_LEN;
  });
  if (!active) return null;

  const c = Math.round(active.at * fps) + VIDEO_LAG;
  const k = active.intensity ?? 1;
  const p = (frame - (c - FLASH_LEAD)) / (FLASH_LEN - 1); // 0..1 pela janela

  // SWIPE: painel opaco varre a tela da esquerda p/ direita, cobrindo a emenda
  // no meio do movimento; som de whoosh no lugar do tique do flash.
  if ((active.type ?? 'flash') === 'swipe') {
    const sx = interpolate(p, [0, 1], [-1.15 * width, 1.15 * width]);
    return (
      <AbsoluteFill style={{pointerEvents: 'none', overflow: 'hidden'}}>
        <div
          style={{
            position: 'absolute',
            top: '-6%',
            left: 0,
            width: width * 0.82,
            height: '112%',
            transform: `translateX(${sx.toFixed(1)}px) skewX(-10deg)`,
            background: SWIPE_COLOR,
            boxShadow: '0 0 70px rgba(0,0,0,0.45)',
          }}
        />
        {/* ANCHOR THE PEAK, NOT THE FILE START. whoosh.mp3 is a 450ms swell whose
            energy peaks 220ms in, so starting it with the sweep put the audible
            hit ~140ms AFTER the picture had already changed — heard as a sound
            arriving late, which is exactly what it was. Start it early enough
            that the peak lands ON the cut frame. Any SFX with a slow attack
            needs this; a click (peak at 0ms) does not. */}
        <Sequence from={Math.max(0, c - WHOOSH_PEAK_FRAMES(fps))} durationInFrames={16} layout="none">
          <Sfx src={active.sfx ?? 'whoosh.mp3'} volume={active.volume ?? 0.5} />
        </Sequence>
        {/* Blend of the two: the click gives the swipe an ATTACK on the cut that
            the swell alone has no way to provide. */}
        <Sequence from={c} durationInFrames={8} layout="none">
          <Sfx src="cut-click.mp3" volume={0.55} />
        </Sequence>
      </AbsoluteFill>
    );
  }

  // beam sweeps left→right, brightest as it crosses centre
  const x = interpolate(p, [0, 1], [-1.35 * width, 1.35 * width]);
  const beam = interpolate(p, [0, 0.35, 1], [0, 1 * k, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // the bloom is short and lands ON the cut, not spread across the window
  const bloom = interpolate(frame, [c - 1, c, c + 2], [0, 0.5 * k, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{backgroundColor: '#fff', opacity: bloom, mixBlendMode: 'screen'}} />
      <AbsoluteFill style={{overflow: 'hidden'}}>
        <div
          style={{
            position: 'absolute',
            top: '-30%',
            left: 0,
            width: width * 0.46,
            height: '160%',
            transform: `translateX(${x.toFixed(1)}px) rotate(-18deg)`,
            background:
              'linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.95) 50%,rgba(255,255,255,0) 100%)',
            opacity: beam,
            mixBlendMode: 'screen',
            filter: 'blur(16px)',
          }}
        />
      </AbsoluteFill>
      <Sequence from={c} durationInFrames={10} layout="none">
        <Sfx src={active.sfx ?? 'cut-click.mp3'} volume={active.volume ?? 0.9} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ SPLIT SCREEN ("tela dividida") ==================================
// Art on top, the talking head re-drawn underneath, seam at the subject's hairline.
//
// ONE always-mounted layer, NOT a <Sequence> per window. The obvious version wraps
// each window in <Sequence from> + <OffthreadVideo startFrom>, and that samples
// cut.mp4 ONE FRAME BEHIND the base video: on the first frame of the split you
// still see the previous take, so the layout appears to change before the picture
// does. Mounted flat with no startFrom, this layer decodes the same frame the base
// layer does, and the window edges land exactly on the cut.
const SplitFrame: React.FC<{
  image: string;
  bandH: number;
  fit: 'cover' | 'contain';
  progress: number;
  layout: 'top' | 'bottom';
  startFrame: number;
  zoomOverride?: number;
  focusYOverride?: number;
  pos?: string;
}> = ({image, bandH, fit, progress, layout, startFrame, zoomOverride, focusYOverride, pos}) => {
  // slow Ken-Burns so the band is not a dead still
  const artScale = 1 + 0.03 * progress;
  const zoom = zoomOverride ?? LAYOUT[layout].zoom;
  const focusY = focusYOverride ?? LAYOUT[layout].focusY;
  const videoH = 1920 - bandH;
  const bandTop = layout === 'top' ? 0 : videoH;
  const videoTop = layout === 'top' ? bandH : 0;

  return (
    <AbsoluteFill style={{backgroundColor: '#0a0a0c'}}>
      <div style={{position: 'absolute', left: 0, top: videoTop, width: 1080, height: videoH, overflow: 'hidden'}}>
        <OffthreadVideo
          src={staticFile('cut.mp4')}
          muted
          style={{
            position: 'absolute',
            width: 1080 * zoom,
            height: 1920 * zoom,
            left: -(1080 * (zoom - 1)) / 2,
            top: -focusY * zoom,
            objectFit: 'cover',
          }}
        />
      </div>

      <div style={{position: 'absolute', left: 0, top: bandTop, width: 1080, height: bandH, overflow: 'hidden'}}>
        {/\.(mp4|mov|webm)$/i.test(image) ? (
          <Sequence from={startFrame} layout="none">
            <Video
              src={staticFile(image)}
              muted
              loop
              style={{
                width: '100%',
                height: '100%',
                objectFit: fit,
                objectPosition: pos ?? '50% 50%',
                transform: `scale(${artScale})`,
              }}
            />
          </Sequence>
        ) : (
          <Img
            src={staticFile(image)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: fit,
              objectPosition: pos ?? '50% 50%',
              scale: String(artScale),
            }}
          />
        )}
        {/* Soft falloff into the seam — 'top' ONLY. There the caption sits ON the
            seam over the art and needs the darkening to stay legible. On
            'bottom' the caption sits above the seam over the video, so the same
            gradient only smears grey across the top of the photo. */}
        {layout === 'top' ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: '100%',
              height: 110,
              background: 'linear-gradient(180deg,rgba(10,10,12,0),rgba(10,10,12,0.75))',
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// OffthreadVideo can draw the source frame one composition frame LATE: it draws
// the frame at or before frame/fps, and on an exact frame boundary that resolves
// one frame late, so the decoded picture changes after the index does. Overlays
// indexed off the cut then land a frame early unless they are delayed to match.
//
// THIS IS NOT A CONSTANT — IT IS A PER-PROJECT MEASUREMENT. It was hardcoded to 1
// and on a real 24fps project the true value was 0: compensating for a lag that
// was not there produced exactly the error the compensation exists to prevent —
// the split band left the frame one frame after the take cut, and the delivered
// voice sat one frame (41.7ms) late, heard as soft lip-sync drift. Set
// `videoLag` in edit-data.json from the measurement below; 1 stays the default
// so existing projects keep their behaviour.
//
// HOW TO MEASURE (do this once per project, before Phase 2):
//  1. A per-pixel compare between cut.mp4 and the render DOES NOT WORK — the
//     camera zoom and the gamma difference dominate it and every offset ties.
//  2. scdet on a PURE take cut (full frame either side, no overlay, no
//     transition). The picture must change on the same frame number in both:
//       ffmpeg -v info -i cut.mp4 -vf \
//         "select='between(n,F-7,F+7)',setpts=N/FPS/TB,scdet=threshold=0" \
//         -an -f null - 2>&1 | grep scd.score
//     Run it on cut.mp4 and on out/render.mp4 and compare the spike frames.
//  3. Confirm with a motion-signature correlation (frame-to-frame difference
//     energy, cross-correlated) — immune to zoom and gamma. A clean result is
//     unambiguous: ~0.95 at the true offset, ~0.3–0.5 one frame either side.
//  4. Whatever you measure here must ALSO be used for the voice delay in the
//     delivery mux and for the SFX placement, or picture and sound disagree.
const VIDEO_LAG_DEFAULT = 1;
export const VIDEO_LAG =
  (editData as {videoLag?: number}).videoLag ?? VIDEO_LAG_DEFAULT;

export const SplitScreen: React.FC<{items: SplitInsert[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // frame-indexed, not seconds: the window edges ARE cut frames
  const active = items.find((it) => {
    const a = Math.round(it.start * fps) + VIDEO_LAG;
    const b = Math.round(it.end * fps) + VIDEO_LAG;
    return frame >= a && frame < b;
  });
  if (!active) return null;
  const a = Math.round(active.start * fps) + VIDEO_LAG;
  const b = Math.round(active.end * fps) + VIDEO_LAG;
  return (
    <SplitFrame
      image={active.src}
      bandH={active.bandH ?? 750}
      fit={active.fit ?? 'cover'}
      layout={active.layout ?? 'top'}
      startFrame={a}
      zoomOverride={active.zoom}
      focusYOverride={active.focusY}
      pos={active.pos}
      progress={clamp((frame - a) / Math.max(1, b - a), 0, 1)}
    />
  );
};

// ============ FULL-FRAME B-ROLL ("só b-roll") =================================
// The speaker leaves the frame for a beat and the B-roll owns all 1080×1920.
// Same flat-mount rule as the split: ONE always-mounted layer, windows resolved
// per frame. A <Sequence> per window would sample the clip a frame late and show
// the previous window's last frame on the first frame of the new one.
//
// The clip's own <Sequence from={a}> is what makes it start from ITS first frame
// when the window opens — without it a 25s stock clip would already be seconds in.
const FullBroll: React.FC<{items: FullInsert[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const active = items.find((it) => {
    const a = Math.round(it.start * fps) + VIDEO_LAG;
    const b = Math.round(it.end * fps) + VIDEO_LAG;
    return frame >= a && frame < b;
  });
  if (!active) return null;
  const a = Math.round(active.start * fps) + VIDEO_LAG;
  const b = Math.round(active.end * fps) + VIDEO_LAG;
  const progress = clamp((frame - a) / Math.max(1, b - a), 0, 1);
  // Ken-Burns is what keeps a STILL from reading as a freeze; on a video clip it
  // is barely there and does no harm, so one rule covers both.
  const scale = 1 + 0.05 * progress;
  const isVideo = /\.(mp4|mov|webm)$/i.test(active.src);
  const fit = active.fit ?? 'cover';

  return (
    <AbsoluteFill style={{backgroundColor: '#0a0a0c', overflow: 'hidden'}}>
      {isVideo ? (
        <Sequence from={a} layout="none">
          <Video
            src={staticFile(active.src)}
            muted
            loop
            style={{
              width: '100%',
              height: '100%',
              objectFit: fit,
              objectPosition: active.pos ?? '50% 50%',
              transform: `scale(${scale})`,
            }}
          />
        </Sequence>
      ) : (
        <Img
          src={staticFile(active.src)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            objectPosition: active.pos ?? '50% 50%',
            transform: `scale(${scale})`,
          }}
        />
      )}
      {/* The karaoke caption sits in the lower third over whatever is behind it.
          Stock footage is often bright exactly there, so darken the foot of the
          frame — without this the captions dropped out over the Google shot.
          The scrim has to be DARKEST WHERE THE TEXT IS, not at the frame edge:
          the caption baseline sits ~1500px down (paddingBottom 420), and a plain
          0→max gradient over the bottom 620px is only a third of the way up its
          ramp there. Measured at ~0.23 effective opacity — invisible. So the ramp
          reaches full strength BY the caption band and holds it to the edge. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 780,
          background:
            'linear-gradient(180deg,rgba(10,10,12,0) 0%,rgba(10,10,12,0.55) 42%,rgba(10,10,12,0.82) 72%,rgba(10,10,12,0.86) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

// ============ WORKED EXAMPLE 1: editing timeline being cut + caption tracks =====
// For "os cortes, as legendas e as animações" — a mini editor UI: playhead
// sweeps and splits the video track, caption chips pop in, shapes pop last.
const TL_W = 800;
const TL_H = 378;
const PAD = 46;
const INNER = TL_W - PAD * 2;

const TimelineInner: React.FC<{totalFrames: number}> = ({totalFrames}) => {
  const f = useCurrentFrame();
  const appear = interpolate(f, [0, 9], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const exit = interpolate(f, [totalFrames - 7, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(appear, [0, 1], [26, 0]);

  // playhead sweeps, bar splits into 3
  const gap = interpolate(f, [6, 16], [0, 16], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pieceW = (INNER - gap * 2) / 3;
  const playX = interpolate(f, [0, 16], [0, INNER], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const playOp = interpolate(f, [0, 2, 15, 19], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center'}}>
      <Sfx src="whoosh.mp3" />
      <div style={{width: TL_W, height: TL_H, marginTop: 105, borderRadius: 28, background: '#15171c', border: '1px solid #262a31', boxShadow: '0 18px 50px rgba(0,0,0,0.5)', opacity: appear * exit, scale: String(interpolate(appear, [0, 1], [0.93, 1])), translate: `0px ${rise}px`, padding: PAD, boxSizing: 'border-box', position: 'relative', fontFamily}}>
        {/* window dots */}
        <div style={{display: 'flex', gap: 12}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (<div key={c} style={{width: 16, height: 16, borderRadius: 999, background: c}} />))}
        </div>

        {/* VIDEO track — being cut */}
        <div style={{position: 'absolute', left: PAD, top: 92, width: INNER, height: 62}}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{position: 'absolute', left: i * (pieceW + gap), width: pieceW, height: 62, borderRadius: 10, background: 'linear-gradient(180deg,#5b8dff,#3f6fe0)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)'}} />
          ))}
          <div style={{position: 'absolute', left: playX, top: -8, width: 3, height: 78, background: 'white', opacity: playOp, boxShadow: '0 0 8px rgba(255,255,255,0.8)'}} />
        </div>

        {/* LEGENDAS track — caption chips appear */}
        <div style={{position: 'absolute', left: PAD, top: 188, width: INNER, height: 46}}>
          {[0, 1, 2, 3].map((k) => {
            const ap = interpolate(f, [16 + k * 5, 24 + k * 5], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.5))});
            return (
              <div key={k} style={{position: 'absolute', left: k * (INNER / 4), width: INNER / 4 - 14, height: 46, borderRadius: 9, background: '#33e0a3', opacity: Math.min(1, ap), scale: String(Math.max(0.01, ap)), display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '0 12px', boxSizing: 'border-box'}}>
                <div style={{height: 6, width: '80%', borderRadius: 4, background: 'rgba(0,0,0,0.55)'}} />
                <div style={{height: 6, width: '55%', borderRadius: 4, background: 'rgba(0,0,0,0.4)'}} />
              </div>
            );
          })}
        </div>

        {/* ANIMAÇÕES track — shapes pop */}
        <div style={{position: 'absolute', left: PAD, top: 270, width: INNER, height: 60, display: 'flex', gap: 20, alignItems: 'center'}}>
          {[0, 1, 2, 3].map((k) => {
            const ap = interpolate(f, [34 + k * 4, 42 + k * 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.8))});
            const rot = Math.sin((f + k * 7) * 0.2) * 20;
            const colors = ['#ffffff', '#ffd23f', '#ff5f9e', '#5b8dff'];
            const rounds = [999, 12, 6, 999];
            return (<div key={k} style={{width: 52, height: 52, background: colors[k], borderRadius: rounds[k], opacity: Math.min(1, ap), scale: String(Math.max(0.01, ap)), rotate: `${rot}deg`}} />);
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TimelineGraphic: React.FC<{startSec: number; endSec: number}> = ({startSec, endSec}) => {
  const {fps} = useVideoConfig();
  const from = Math.round(startSec * fps);
  const duration = Math.round((endSec - startSec) * fps);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <TimelineInner totalFrames={duration} />
    </Sequence>
  );
};

// ============ WORKED EXAMPLE 2: script sheet with typewriter text ===============
// For "ela leu o roteiro" — a tilted paper card, lines typing in with a cursor.
const ScriptInner: React.FC<{totalFrames: number; lines: string[]}> = ({totalFrames, lines}) => {
  const f = useCurrentFrame();
  const appear = interpolate(f, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const exit = interpolate(f, [totalFrames - 7, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cps = 1.7; // chars per frame

  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center'}}>
      <Sfx src="whoosh.mp3" />
      <div style={{width: 640, height: 420, marginTop: 100, borderRadius: 16, background: '#f4f1e8', boxShadow: '0 22px 55px rgba(0,0,0,0.5)', opacity: appear * exit, scale: String(interpolate(appear, [0, 1], [0.94, 1])), rotate: '-2deg', translate: `0px ${interpolate(appear, [0, 1], [26, 0])}px`, padding: 46, boxSizing: 'border-box', fontFamily}}>
        <div style={{fontWeight: 900, fontSize: 26, letterSpacing: 3, color: '#c2492b'}}>ROTEIRO</div>
        <div style={{height: 4, width: 90, background: '#c2492b', borderRadius: 3, marginTop: 10, marginBottom: 30}} />
        {lines.map((line, i) => {
          const startLocal = 10 + i * 12;
          const shown = clamp(Math.floor((f - startLocal) * cps), 0, line.length);
          const isTyping = shown > 0 && shown < line.length;
          const cursor = isTyping && Math.floor(f / 6) % 2 === 0 ? '|' : '';
          return (
            <div key={i} style={{fontWeight: 400, fontSize: 32, color: '#2b2b2b', lineHeight: 1.5, minHeight: 40}}>
              {line.slice(0, shown)}
              <span style={{color: '#c2492b'}}>{cursor}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const ScriptGraphic: React.FC<{startSec: number; endSec: number; lines: string[]}> = ({startSec, endSec, lines}) => {
  const {fps} = useVideoConfig();
  const from = Math.round(startSec * fps);
  const duration = Math.round((endSec - startSec) * fps);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <ScriptInner totalFrames={duration} lines={lines} />
    </Sequence>
  );
};

// ============ WORKED EXAMPLE 3: playful shapes pop (for "animações") ============
const Shape: React.FC<{i: number; color: string; round: number}> = ({i, color, round}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [i * 3, i * 3 + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.6))});
  const pulse = 1 + 0.16 * Math.sin((frame + i * 6) * 0.28);
  const rot = Math.sin((frame + i * 8) * 0.12) * 22;
  return (
    <div
      style={{
        width: 92,
        height: 92,
        background: color,
        borderRadius: round,
        opacity: appear,
        scale: String(appear * pulse),
        rotate: `${rot}deg`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}
    />
  );
};

const ShapesInner: React.FC<{totalFrames: number}> = ({totalFrames}) => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [totalFrames - 7, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(frame, [0, 8], [24, 0], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center'}}>
      <Sfx src="pop.mp3" volume={0.12} />
      <div style={{marginTop: 210, display: 'flex', gap: 34, opacity: exit, translate: `0px ${rise}px`}}>
        <Shape i={0} color="white" round={46} />
        <Shape i={1} color="#33e0a3" round={20} />
        <Shape i={2} color="white" round={8} />
      </div>
    </AbsoluteFill>
  );
};

export const ShapesGraphic: React.FC<{startSec: number; endSec: number}> = ({startSec, endSec}) => {
  const {fps} = useVideoConfig();
  const from = Math.round(startSec * fps);
  const duration = Math.round((endSec - startSec) * fps);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <ShapesInner totalFrames={duration} />
    </Sequence>
  );
};
