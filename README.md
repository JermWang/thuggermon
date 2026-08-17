# THUGGERMON — pocket monster disco

Eleven Pikachu, a mirror ball, and four bars that never end.

```bash
npm install
npm run dev
```

Then click **ENTER THE PARTY** (the click is what lets the audio start).

---

## How it works

### One clock runs everything, and the record owns it

`Public/Waiting for Tonight.mp3` runs at a machine-steady **125 BPM**, measured by
fitting an impulse train to the kick onset envelope across the whole 4-minute
file — errors accumulate into obvious drift over that length, so the fit is sharp
to about 0.02 BPM. Its first beat is at 0.398s, which is where playback starts, so
visual `t = 0` sits exactly on a beat.

`src/config.js` sets `BPM = 125` and `LOOP_BEATS = 16` — a loop of exactly 7.68
seconds. `src/beat.js` turns a timestamp into a *groove*: the musical position
plus a set of oscillators expressed as **"one cycle every N beats."**

The music is not merely started alongside the visuals, it **steers** them.
`music.beatPhaseError(t)` reports how far the visual clock has slipped from the
record in beats, wrapped to ±half a beat, and `main.js` closes a small fraction of
that gap every frame — a software PLL. Two details matter:

- It corrects **phase, not absolute position**, so the clock stays monotonic and
  survives the track restarting.
- It corrects **gently**. `audio.currentTime` is quantised to a few milliseconds;
  pulling straight to it would visibly judder the dance.

Seeded a third of a beat out of phase, it settles to well under a millisecond in
about two seconds. With no audio the error is `0` and the whole thing degrades to
a free-running clock, so the scene still works if the file is missing or blocked.

The one rule that makes the loop seamless:

> every `per` passed to `o()` / `co()` / `pulse()` must divide `LOOP_BEATS`
> — so `0.5, 1, 2, 4, 8, 16`.

Every oscillator then completes a whole number of cycles per loop and comes back
to the same value *and the same slope*. There is no crossfade and no cut, because
there is nothing to hide. Use an odd number like `3` and you get a visible pop
every 7.5 seconds.

This is verifiable, not just claimed. Sampling all 2200 bone quaternions and body
transforms at `t` and at `t + 7.68s` gives a maximum difference of `0` (and
`1.2e-14` after three loops), against `3.27` for a deliberately off-grid offset.

### The intro hands over without a seam

The loop clock runs from `t = 0`. The intro is not a separate animation that
gets swapped out — it is authored as a set of **offsets on top of the loop** that
decay to exactly zero by `INTRO_SECONDS`. The camera lerps from its intro path to
the loop path with an ease that lands flat (zero slope) at the boundary, so the
handover has no kink in it. Because of that, the intro does not have to end on a
bar line — it can hand over at any phase.

Intro dials (`env` in `src/main.js`) — house lights, floor ignition, ball drop,
each Poké Ball spawn — all reach their final value *before* the intro ends.

### The rig

`Public/models/pikachu.glb` ships a 49-joint skin and **zero animation clips**, so
every pose in `src/dance.js` is authored in code against the bone names.

It's an FBX-derived skeleton, so each bone's local **+X runs down the bone**:
rotate about X to twist, about Y and Z to swing and bend. Poses are applied as a
delta on top of the captured bind rotation, so any bone a move doesn't touch just
stays where the artist left it.

**The skeleton is mirrored**, which is the one thing that will bite you. A bone on
the right does not take the same local rotation as its partner on the left —
feed it the same numbers and it swings the wrong way and folds the arm into the
torso. The mirror is `(x, y, z) -> (-x, y, -z)`, measured rather than guessed: pose
each left/right chain over 12 random rotations, compare the shoulder→hand
(hip→toe, ear-base→tip) vectors, and that convention scores *below the rig's own
bind-pose asymmetry* on all three pairs, while every other sign combination is
clearly worse.

So **author every pose in left-side terms** and pass `mirror` for the right:

```js
poseChain(rig, B.armL, 0, -20, -up * E, 0.7);
poseChain(rig, B.armR, 0, -20, -dn * E, 0.7, true); // <- same numbers, mirrored
```

Four styles — `BOUNCE`, `SHUFFLE`, `WAVE`, `SPIN` — plus a separate solver for the
DJ, who is planted behind the decks and works the platter. Ears get their own
lag-and-overshoot solver because the ears are the best part of the character.
`SPIN` does two full revolutions per loop so its yaw wraps exactly on the seam.

Each dancer gets a whole-beat phase offset: same grid, not lockstep.

---

## Things worth knowing if you change it

- **Ambient and hemisphere lights are flat multipliers on albedo.** At `1.0` they
  alone blow Pikachu out to pure white. They stay low (`0.18` / `0.22`) and the
  spotlights do the work. Spot intensity is candela against `1/r^decay`, so ~10
  units away at decay 1.1 costs roughly 12×.
- **Additive volumetrics are excluded from the mirror.** The `Reflector` re-renders
  the scene from a mirrored camera, and additive depth-write-free haze does not
  survive that pass — it comes back as opaque black slabs across the floor.
  `createWorld` hides everything in `haze` during the reflection render. This is
  also just correct: a light shaft is not a solid object, so it has no mirror image.
- **34 additive shafts stack fast.** Each one has to be nearly invisible on its own.
- **The jumbotron waits for `requestVideoFrameCallback`** before swapping off its
  still. Anything looser (`readyState`, `!paused`) can flip to an undecoded video
  texture, which renders as a dead black slab on the back wall.

---

## Editing it

| What | Where |
| --- | --- |
| **Contract address** | `TOKEN.contract` in `src/config.js` |
| **X / socials link** | `SOCIAL.x` in `src/config.js` |
| Enter-button label, logo alt text | `COPY` in `src/config.js` |
| Logo art | `assets/thuggermon-logo.png`, then `npm run assets` |
| Tempo, loop length, intro length, crew size | top of `src/config.js` |
| The track, where it starts, its volume | `MUSIC` in `src/config.js` |
| Which images go on the club walls | `POSTERS` in `src/config.js`, then `npm run assets` |
| Dance moves | `src/dance.js` |
| Lighting, floor, ball, posters | `src/world.js` |
| Bloom / grain / vignette | `src/main.js`, `src/grain.js` |

```bash
npm run assets
```

`scripts/build-assets.mjs` bakes everything deployable out of `assets/`:

- **Posters** — sources are 1.5–3 MB each and only ever cover a few hundred
  pixels on screen, so they're resized to 640px webp. 24 MB → 313 KB.
- **Logo** — trims the transparent margin off the source wordmark, then emits
  `logo.webp` (70 KB) and a `logo.png` fallback.
- **Share card** — a 1200×630 `og.png` with the wordmark on the club background.
  Social scrapers letterbox anything that isn't ~1.91:1, and the bare wordmark
  is 3:1 and transparent, so it lands on whatever colour the client picks.
- **Favicon** — a square crop of a character portrait, not the wordmark. The
  logo is 3:1, so every square crop of it is either two letters or mostly empty
  space. Change which image and where it crops via `FAVICON` in the script.

Re-run it after changing `POSTERS` or the logo art.

## Layout

```
assets/     source art — in the repo, NOT deployed (~91 MB)
Public/     baked output — this is what ships (~10 MB)
src/        the site
scripts/    asset baking
```

The split matters: `Public/` is Vite's `publicDir`, so everything in it is
copied verbatim into `dist/` and uploaded on every deploy. The 2–3 MB source
stills have no business being there — only the 640px bakes do.

## Deploying (Vercel)

Import the GitHub repo and it should just work — `vercel.json` pins the
framework, build command and output directory, and adds immutable cache headers
for the models, posters, video and audio.

Two things that were fixed to make that true, worth not regressing:

- **Asset URLs are absolute** (`/models/pikachu.glb`, not `models/…`). Relative
  paths resolve against the current route, so they break on any URL that isn't
  exactly `/`.
- **`publicDir` is `'Public'` with a capital P** to match the folder on disk.
  Vercel builds on a case-sensitive filesystem, so a lowercase `public` here
  builds fine on Windows and silently ships an empty site on Linux.

`.vercelignore` keeps `assets/` and `scripts/` out of the upload, and `sharp` is
an optional dependency — it's only needed for `npm run assets`, never for the
build, so a native-install failure can't take the deploy down.

## The page

Deliberately almost nothing: a wordmark, and one glass bar holding the contract
address, the X link, and a sound toggle. The party is the page.

`TOKEN.contract` ships **empty**, so the button reads "coming soon" and copying is
disabled — the page will never hand someone an address that isn't real. Paste the
address in and it starts working, showing `7xKXtg…gAsU` and copying the full
string. If the clipboard is unavailable (insecure origin, denied permission, an
in-app webview) it falls back to `execCommand`, and failing that it expands to the
full address and selects it so ⌘C still works.

Hidden controls, still live: `1`–`4` change the dance, `M` toggles sound, and
clicking a Pikachu hypes it.

## Dev harness

In dev only, `window.__party.shoot(name, atSeconds)` scrubs to an exact moment,
renders that frame, and writes it to `.shots/` — the only sane way to tune a
9-second intro. `window.__camOverride = { pos, target }` pins the camera. Both are
stripped from production builds.

## Swapping the track

Drop the file in `Public/`, point `MUSIC.src` at it, then set `BPM` and
`MUSIC.startAt`. Getting those two numbers right is the whole job — if `BPM` is
wrong the dance will slowly walk away from the music, and the PLL will not save
you, because it only corrects to the *nearest* beat of a grid you told it to use.

To measure a new track, paste the tempo-fitting snippet from the project history
into the console, or use any beat-detection tool; then check `MUSIC.startAt`
against the first audible kick.

## Credits

`pikachu.glb` and `disco_ball.glb` are Sketchfab models in `Public/models/`.
The soundtrack is a commercial recording. Check the licences on all three before
putting this anywhere public — the models and the master are separate problems.
