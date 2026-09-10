---
name: pmf-cut-install
description: Install the whole PMF Cut system into the current agent (Claude Code, Codex, Hermes, Openclaw, etc.) — ffmpeg + Groq for the cut, Node + Remotion for the visuals, and (optional) OmniVoice + HeyGen for Phase 0 generation — so the user can start immediately.
---

# pmf-cut install

Use this file only for first-time install or reconnect. For daily editing, read `SKILL.md`. Always read `helpers/` — that's where the scripts live.

## What you're doing

You're setting up a conversation-driven video editor for the user. After install, the user drops raw footage into any folder, runs their agent (`claude`, `codex`, etc.) there, and says "edit these into a launch video." You do the rest by reading `SKILL.md`.

pmf-cut runs in phases: **Phase 0** *(optional)* = generate the footage when there is none — script → cloned voice (**OmniVoice**, local) → talking avatar (**HeyGen**, paid); **Phase 1** = clean cut + color grade + optional voice mastering (ffmpeg + Groq), shown to the user for approval; **Phase 2** = captions, motion graphics, illustrative images, dynamic camera (**Remotion** + OpenCV); **Phase 3** = soundtrack (ffmpeg, plus the Treblo API only if the user wants AI-generated music). So the machine needs the ffmpeg + Python toolchain (Phases 1 & 3), the Node/Remotion toolchain (Phase 2), and — only for Phase 0 — OmniVoice on an Apple Silicon Mac.

**The system at a glance** — what lives where:

| Piece | Where | Needed for |
|---|---|---|
| this repo (skill + helpers + templates + apps) | `~/Developer/pmf-cut`, symlinked as the `pmf-cut` skill | everything |
| `.env` with the keys | repo root, git-ignored | everything (Groq is the only required key) |
| ffmpeg / ffprobe | `$PATH` | Phases 1 and 3 |
| Node 18+ and the `remotion` skill | `$PATH`, `~/Developer/remotion-skills` | Phase 2 |
| Remotion project per video | `<videos_dir>/edit/remotion/` — copied from `assets/`, `npm install`ed there | Phase 2 |
| OmniVoice (model ~3 GB) + `.venv` | `~/Developer/OmniVoice` (or `OMNIVOICE_DIR`) | Phase 0 voice |
| cloned voices (`*.pt` + reference `.wav`) | `<OmniVoice>/vozes/`, catalog in `vozes.json` | Phase 0 voice — **never in this repo** |
| HeyGen account with a trained avatar | HeyGen | Phase 0 video (paid) |

Must exist on this machine:

1. The `pmf-cut` repo cloned somewhere stable.
2. `ffmpeg` on `$PATH` (plus optional `yt-dlp` for online sources). — Phase 1
3. A Groq API key in `.env` at the repo root (for Whisper transcription). — Phase 1
4. **Node.js 18+ and npm** on `$PATH` (for Remotion). — Phase 2
5. The **`remotion-best-practices` skill** installed and discoverable (clone https://github.com/remotion-dev/skills and symlink `skills/remotion` into the agent's skills dir). — Phase 2
6. *(Optional, all lazy — ask only when the feature is first used, then write to `.env`)*:
   - `ELEVENLABS_API_KEY` — Phase 1 transcription of **long sources** (>5 min: YouTube videos, course lessons). With `backend=auto`, sources over 5 min transcribe via ElevenLabs Scribe (`scribe_v1`) when this key is set — Groq's free tier struggles with long/large uploads. Short clips stay on Groq; no key means long sources fall back to Groq (with chunking). Ask for it the first time a >5 min source appears. https://elevenlabs.io/app/settings/api-keys
   - `PEXELS_API_KEY` — Phase 2 illustrative images (stock photos/videos). https://www.pexels.com/api/
   - `TREBLO_API_KEY` — Phase 3 AI-generated soundtrack, only if the user picks "create with AI" (a local music file needs no key). https://sonauto.ai (Treblo)
   - `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` — Phase 2 images of **named brands/people/logos** that Pexels lacks. Optional and finicky to provision (the key and the Custom Search API must live in the same Google Cloud project). **Wikimedia Commons is the no-key fallback** (`wikimedia_images.py`) and covers most people/places, so Google is rarely required.
   - `HEYGEN_API_KEY` — Phase 0 avatar video. Only when the user wants to GENERATE footage instead of shooting it. https://app.heygen.com/settings?nav=API
7. *(Optional — Phase 0 only)* **OmniVoice** on a **Mac with Apple Silicon** (the voice worker runs the model on `mps`; on other machines Phase 0 voice does not run, and Phases 1–3 are unaffected). See step 7.

And one thing must be true about the current agent:

8. It can discover `SKILL.md` — either via a global skills directory (`~/.claude/skills/`, `~/.codex/skills/`) or via a `CLAUDE.md` / system-prompt import.

## Install prompt contract

- Do everything yourself. Only ask the user for things you cannot generate — the Groq API key, and confirmation before `brew install`.
- Prefer a stable clone path like `~/Developer/pmf-cut` (not `/tmp`, not `~/Downloads`).
- The skill references helpers by bare name (`transcribe.py`, `render.py`). That works because SKILL.md and `helpers/` ship together — keep them as siblings when you register the skill.
- After install, verify by running one real command against one real file. Don't declare success on file-existence checks alone.

## Steps

### 1. Clone to a stable path

```bash
test -d ~/Developer/pmf-cut || git clone https://github.com/pmfproducer/pmf-cut.git ~/Developer/pmf-cut
cd ~/Developer/pmf-cut
```

If the repo is already there, `git pull --ff-only` and continue.

### 2. Install Python deps

```bash
# Prefer uv if available; fall back to pip.
command -v uv >/dev/null && uv sync || pip install -e .
```

`pyproject.toml` lists `requests`, `pillow`, `numpy`, and `opencv-python-headless==4.10.0.84` (the last one powers the Phase-2 dynamic-camera face/eye tracking in `face_track.py` — keep it pinned to the 4.10 line; 5.x dropped `CascadeClassifier` and breaks Haar detection). No console scripts — helpers are invoked directly as `python helpers/<name>.py`.

Opt-in extra, only when first needed: `uv sync --extra matting` (~2 GB of torch) for the "element behind the subject" effect (`person_matte.py`). Don't install it up front.

### 3. Install ffmpeg (+ optional yt-dlp)

`ffmpeg` and `ffprobe` are hard requirements for Phase 1. `yt-dlp` is only needed if the user wants to pull sources from URLs. Phase 2 uses Remotion (Node.js) — set up in step 6.

```bash
# macOS
command -v ffmpeg >/dev/null || brew install ffmpeg
command -v yt-dlp >/dev/null || brew install yt-dlp     # optional

# Debian / Ubuntu
# sudo apt-get update && sudo apt-get install -y ffmpeg
# pip install yt-dlp

# Arch
# sudo pacman -S ffmpeg yt-dlp
```

If `brew` / `apt` / `pacman` requires a sudo prompt, tell the user the exact command and wait. Do not invent a password.

### 4. Register the skill with the current agent

Figure out which agent you are running under, and register once. A symlink of the whole repo directory is the right shape — helpers/ needs to sit next to SKILL.md.

- **Claude Code** (`~/.claude/` present):

    ```bash
    mkdir -p ~/.claude/skills
    ln -sfn ~/Developer/pmf-cut ~/.claude/skills/pmf-cut
    ```

- **Codex** (`$CODEX_HOME` set, or `~/.codex/` present):

    ```bash
    mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
    ln -sfn ~/Developer/pmf-cut "${CODEX_HOME:-$HOME/.codex}/skills/pmf-cut"
    ```

- **Hermes / Openclaw / another agent with a skills directory**: symlink `~/Developer/pmf-cut` into that agent's skills directory under the name `pmf-cut`. If the agent has no skills directory, add a line to its system prompt / config pointing at `~/Developer/pmf-cut/SKILL.md` (e.g. an `@~/Developer/pmf-cut/SKILL.md` import in a `CLAUDE.md`-equivalent).

If you can't tell which agent you're in, ask the user once: "which agent am I running under — Claude Code, Codex, or something else?" Then pick the right target.

### 5. Groq API key

Groq Whisper (`whisper-large-v3`) is the base transcription backend and handles short sources (≤5 min). Without a Groq key, nothing transcribes. (Groq does not diarize speakers or tag audio events — every word gets `speaker_id: speaker_0`.) Long sources (>5 min) prefer the optional `ELEVENLABS_API_KEY` (Scribe) when present — see requirement 6 — but fall back to Groq when it isn't, so Groq is still required.

1. Check existing state in this order and stop at the first hit:

    ```bash
    # a) env var already exported
    [ -n "$GROQ_API_KEY" ] && echo "env"
    # b) .env at repo root already has it
    grep -q '^GROQ_API_KEY=..' ~/Developer/pmf-cut/.env 2>/dev/null && echo "dotenv"
    ```

2. If neither is set, ask the user exactly once:

    > I need a Groq API key for transcription (word-level timestamps). Grab one at https://console.groq.com/keys and paste it here — I'll write it to `~/Developer/pmf-cut/.env`. Or if you already have it exported as `GROQ_API_KEY`, say "use env" and I'll skip.

    When the user pastes a key, write it to `~/Developer/pmf-cut/.env`:

    ```bash
    printf 'GROQ_API_KEY=%s\n' "$KEY" > ~/Developer/pmf-cut/.env
    chmod 600 ~/Developer/pmf-cut/.env
    ```

    Never echo the key back in tool output. Never commit `.env`.

3. Sanity check with a cheap, quota-free call:

    ```bash
    curl -s -o /dev/null -w '%{http_code}\n' \
      -H "Authorization: Bearer $(sed -n 's/^GROQ_API_KEY=//p' ~/Developer/pmf-cut/.env)" \
      https://api.groq.com/openai/v1/models
    ```

    `200` means the key works. `401` means the user pasted a wrong/expired key — ask once more and stop. Anything else (network, 5xx), move on and verify during first real transcription.

### 6. Node.js + the Remotion skill (Phase 2)

Phase 2 (captions, motion graphics, images) is built in Remotion, which needs Node.js 18+ and the `remotion-best-practices` skill.

```bash
# Node.js 18+ (install via nvm/brew if missing)
node --version

# Install the Remotion skill and symlink it next to pmf-cut
test -d ~/Developer/remotion-skills || \
  git clone --depth 1 https://github.com/remotion-dev/skills ~/Developer/remotion-skills
mkdir -p ~/.claude/skills
ln -sfn ~/Developer/remotion-skills/skills/remotion ~/.claude/skills/remotion
```

None of the optional keys (`ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, `TREBLO_API_KEY`, `GOOGLE_API_KEY`/`GOOGLE_CSE_ID` — see requirement 6) are needed at install time. Ask for each **lazily**, the first time its feature is used, and append it to `.env` next to `GROQ_API_KEY`. `ELEVENLABS_API_KEY` is the Phase-1 exception to "Phase 2/3": ask for it the first time a **>5 min source** shows up (long lessons / YouTube), since that's when the auto backend wants Scribe. Image search also works with **zero keys** via Wikimedia Commons, so Phase 2 images are never hard-blocked.

### 7. Phase 0 — OmniVoice + a voice + HeyGen (optional)

Skip this whole step unless the user will generate footage (no camera, only a
script). Ask once; it downloads ~3 GB.

**Requires a Mac with Apple Silicon** — `helpers/omnivoice_worker.py` loads the
model on `mps`. Check first and stop here otherwise:

```bash
[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] && echo "Apple Silicon: ok"
```

1. **Install OmniVoice** in its own clone and venv — pmf-cut calls
   `<OmniVoice>/.venv/bin/python`, so the venv must be at that exact path:

    ```bash
    test -d ~/Developer/OmniVoice || git clone https://github.com/k2-fsa/OmniVoice ~/Developer/OmniVoice
    cd ~/Developer/OmniVoice && uv sync          # creates .venv (Python 3.11 works)
    .venv/bin/python -c "import torch, omnivoice; print('mps:', torch.backends.mps.is_available())"
    ```

    Installed somewhere else? Put `OMNIVOICE_DIR=<path>` in pmf-cut's `.env`.
    The ~3 GB model (`k2-fsa/OmniVoice`) is fetched from Hugging Face on the first
    generation, not now.

2. **The voice.** The catalog (`<OmniVoice>/vozes/vozes.json`) starts EMPTY on a
   new machine — nobody's voice comes built in. The user clones one from the app:
   Voz → "clonar outra", pointing at a video/audio file plus a start time and
   ~9 s duration. Tell them the one rule that decides the quality: the reference
   must be a **raw camera/mic take**. Mastered audio (compressed, EQ'd, loudnormed)
   makes the clone copy the processing along with the timbre. The first voice
   becomes the default; `PMF_VOZ=<key>` in `.env` picks another.

3. **HeyGen.** Ask for `HEYGEN_API_KEY` (write it to `.env`). The account needs an
   avatar already trained there — the app lists only the account's OWN looks.
   Verify with the free endpoint (never create a video to test — it is paid):

    ```bash
    curl -s -o /dev/null -w '%{http_code}\n' \
      -H "X-Api-Key: $(sed -n 's/^HEYGEN_API_KEY=//p' ~/Developer/pmf-cut/.env)" \
      https://api.heygen.com/v3/users/me
    ```

4. **Smoke test, free:** `cd ~/Developer/pmf-cut && echo 'Teste.' > /tmp/r.txt &&
   uv run python helpers/fase0_gerar.py --roteiro /tmp/r.txt --so-voz --out /tmp/f0`
   → a `voz.wav` and "Nenhum crédito gasto". It fails with "nenhuma voz clonada
   ainda" until step 2 is done — that is expected, not a broken install.

**Never copy a `.pt` voice into this repo** — the repo is public and that file is a
clone of a real person's voice.

### 8. Verify end-to-end

Run one real thing. Prefer the lightest verification that still proves the pipeline is wired up. Use `uv run` (or activate the venv) so the helper sees its deps — after `uv sync` a bare `python` won't find `opencv`/`numpy`:

```bash
cd ~/Developer/pmf-cut
uv run python helpers/timeline_view.py --help >/dev/null && echo "helpers OK"      # or: python … after pip install -e .
uv run python -c "import cv2; print('opencv', cv2.__version__)"                    # Phase-2 face tracking
ffprobe -hide_banner -filters | grep -qE '\bdeesser\b' && echo "ffmpeg has voice-master filters"   # Phase-1 --voice-master
ffprobe -version | head -1
node --version && echo "node OK (Phase 2)"
# Phase 0, only if step 7 was done:
~/Developer/OmniVoice/.venv/bin/python -c "import omnivoice, torch; print('omnivoice OK | mps', torch.backends.mps.is_available())"
```

Full transcription test is optional at install time — it uses Groq credits. Better to wait until the user hands you their first clip.

### 9. Hand off

Tell the user, in one short message:

- Where the skill is installed (`~/Developer/pmf-cut`).
- That they should `cd` into their footage folder and start their agent there (e.g. `claude`).
- That a good first message is: *"edit these into a launch video"* or *"inventory these takes and propose a strategy."*
- That all outputs land in `<videos_dir>/edit/` — the repo stays clean.
- If Phase 0 was set up: that with no footage they can say *"quero gerar um vídeo com meu avatar"*, and that the avatar render is the one step that costs money — it only runs after they confirm.

## Keeping the skill current

- `cd ~/Developer/pmf-cut && git pull --ff-only` pulls the latest code. The symlink auto-picks it up on the next run.
- If `pyproject.toml` changed deps, re-run `uv sync` / `pip install -e .` after pulling.
- OmniVoice updates separately: `cd ~/Developer/OmniVoice && git pull --ff-only && uv sync`. The `vozes/` folder is untracked there, so pulling never touches the user's voices.

## Cold-start reminders

- Symlink the **whole directory**, not just `SKILL.md`. The helpers need to sit next to it.
- If `.env` exists but the key is empty, treat it the same as missing — don't assume existence means validity.
- `ffmpeg` from static builds works fine. Any modern (≥ 4.x) build is enough.
- `yt-dlp` is optional. Don't block install on it; install lazily the first time a user asks to pull from a URL.
- Node.js 18+ and the `remotion-best-practices` skill are required for Phase 2 (captions, motion graphics, images). Phase 1 (cut + grade) works without them, so a user who only wants a clean cut can start immediately — but set up step 6 so Phase 2 is ready when the cut is approved.
- Remotion projects are NOT created with `npx create-video`: Phase 2 copies the template from `assets/shortform/` or `assets/longform/` into `<videos_dir>/edit/remotion/` and runs `npm install` there — nothing to install globally.
- **Never `npm install` on an exFAT drive** (common on external SSDs formatted for Mac+Windows). exFAT's large allocation blocks make every tiny file cost a full block: a Remotion `node_modules` measured **33 GB on exFAT vs 264 MB on the internal disk**. When the footage lives on such a drive, build the Remotion project on the internal disk and write only the final render back. Check with `diskutil info <mount> | grep -i "file system"`.
- Never run transcription as part of install verification unless the user explicitly asks — Groq usage draws on the user's quota.
- If the user is on Linux without a package manager Claude recognizes, print the manual `ffmpeg` install URL and wait rather than guessing.
