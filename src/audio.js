import * as THREE from 'three';
import gsap from 'gsap';

const POS_DEFAULTS = {
  refDistance: 8,
  maxDistance: 14,
  rolloffFactor: 1,
  distanceModel: 'linear',
};

// Per-screen audio configuration.
//   - `kind: 'video'`  → audio comes from the HTML <video> element directly.
//     We unmute it and drive `video.volume` per frame from camera distance.
//     `baseGain` is the gain at point-blank (clamped to ≤ 1.0 for HTML media).
//     `refDist`/`maxDist` define the linear distance falloff.
//   - `kind: 'audio'`  → buffer-based positional audio (Three.js PositionalAudio).
// Screen spacing is now 11 u, so audio ranges must be tight (≈ pass-by + one
// neighbour) or every clip plays at once and you can't make any of them out.
// Distances are Euclidean from camera to plane (plane is ~8 u off-axis), so
// a screen the user is right next to has distance ≈ 8 u.
const SCREEN_AUDIO = {
  // 1 = intro vid — speech. Wide enough so user hears the intro from spawn,
  // but fades out by screen 3 so it doesn't bleed into later clips.
  1: { sources: [{ kind: 'video', baseGain: 1.0, refDist: 15, maxDist: 22 }] },

  // 2 = covid pic sequence — no audio source
  2: {},

  // 3 = zoom — speech. Loud at pass-by, silent at next screen.
  3: {
    sources: [
      { kind: 'video', baseGain: 1.0, refDist: 9, maxDist: 14 },
      { kind: 'audio', url: '/media/sugarcrash.mp3', volume: 0.3, loop: true },
    ],
  },

  // 4 = covid funny — speech + duck main when near
  4: {
    sources: [{ kind: 'video', baseGain: 1.0, refDist: 9, maxDist: 14 }],
    duck: { target: 0.25, radius: 13 },
  },

  // 5 = man image — voiceover buffer
  5: {
    sources: [{ kind: 'audio', url: '/media/man-audio.mp3', volume: 1.0, loop: true }],
    duck: { target: 0.4, radius: 13 },
  },

  // 6 = ps5/skins/blackice — mood music
  6: { sources: [{ kind: 'audio', url: '/media/mood.mp3', volume: 1.0, loop: true }] },

  // 7–12 = vibe videos. Tight pass-by audibility, silent before/after one screen.
  7:  { sources: [{ kind: 'video', baseGain: 1.0, refDist: 8, maxDist: 13 }] },
  8:  { sources: [{ kind: 'video', baseGain: 1.0, refDist: 8, maxDist: 13 }] },
  9:  { sources: [{ kind: 'video', baseGain: 1.0, refDist: 8, maxDist: 13 }] },
  10: { sources: [{ kind: 'video', baseGain: 1.0, refDist: 8, maxDist: 13 }] },
  11: { sources: [{ kind: 'video', baseGain: 1.0, refDist: 8, maxDist: 13 }] },
  12: { sources: [{ kind: 'video', baseGain: 1.0, refDist: 8, maxDist: 13 }] },
};

export const MAIN_BASE_VOL = 0.5;

const _camPos = new THREE.Vector3();
const _planePos = new THREE.Vector3();

export function createAudioManager({ listener, mainAudio, screens, loader }) {
  const audioLoader = new THREE.AudioLoader();
  const positionals = []; // buffer-based PositionalAudio entries
  const videoControls = []; // {video, plane, baseGain, refDist, maxDist}
  const ducks = [];
  let gestureFired = false;
  const track = loader ? (p) => loader.track(p) : (p) => p;

  for (const item of screens.items) {
    const cfg = SCREEN_AUDIO[item.cfg.i];
    if (!cfg) continue;

    for (const src of cfg.sources || []) {
      if (src.kind === 'video' && item.video) {
        // Direct HTML media element: unmute and let `update()` drive volume from distance.
        item.video.muted = false;
        item.video.volume = 0;
        videoControls.push({
          video: item.video,
          plane: item.plane,
          baseGain: src.baseGain ?? 1.0,
          refDist: src.refDist ?? POS_DEFAULTS.refDistance,
          maxDist: src.maxDist ?? POS_DEFAULTS.maxDistance,
        });
      } else if (src.kind === 'audio') {
        const pa = new THREE.PositionalAudio(listener);
        pa.setRefDistance(POS_DEFAULTS.refDistance);
        pa.setMaxDistance(POS_DEFAULTS.maxDistance);
        pa.setRolloffFactor(POS_DEFAULTS.rolloffFactor);
        pa.setDistanceModel(POS_DEFAULTS.distanceModel);
        pa.setVolume(src.volume ?? 1.0);
        pa.setLoop(src.loop ?? true);
        item.plane.add(pa);

        const entry = {
          plane: item.plane,
          audio: pa,
          src,
          ready: false,
          baseVolume: src.volume ?? 1.0,
        };

        track(new Promise((resolve) => {
          audioLoader.load(src.url, (buffer) => {
            pa.setBuffer(buffer);
            entry.ready = true;
            if (gestureFired && !pa.isPlaying) {
              try { pa.play(); } catch (e) { /* ignore */ }
            }
            resolve();
          }, undefined, () => resolve());
        }));

        positionals.push(entry);
      }
    }

    if (cfg.duck) {
      ducks.push({
        plane: item.plane,
        target: cfg.duck.target,
        radius: cfg.duck.radius,
      });
    }
  }

  // ----- Main audio volume controller (GSAP-tweened) -----
  const volHolder = { v: 0 };
  let currentTween = null;
  let lastTarget = -1;
  let muted = false;
  let dived = null;

  function rampMainTo(target, duration, ease = 'power1.out') {
    if (currentTween) currentTween.kill();
    lastTarget = target;
    currentTween = gsap.to(volHolder, {
      v: target,
      duration,
      ease,
      onUpdate: () => mainAudio.setVolume(volHolder.v),
    });
  }

  // Forward-bias: a screen the user is ABOUT to pass (plane is ahead, z more
  // negative than camera) gets a wider audible range than one they've already
  // gone by — they can see what's coming, but can't look back.
  const FORWARD_RANGE_MULT = 1.35;
  const BEHIND_RANGE_MULT  = 0.55;

  function applyVideoVolume(vc) {
    if (muted) {
      vc.video.volume = 0;
      return;
    }
    const dist = vc.plane.position.distanceTo(_camPos);
    // In our scene, forward = -Z. plane.z < camera.z means the plane is ahead.
    const ahead = vc.plane.position.z <= _camPos.z;
    const rangeMult = ahead ? FORWARD_RANGE_MULT : BEHIND_RANGE_MULT;
    const refD = vc.refDist * rangeMult;
    const maxD = vc.maxDist * rangeMult;

    let factor;
    if (dist <= refD) factor = 1.0;
    else if (dist >= maxD) factor = 0;
    else factor = 1 - (dist - refD) / (maxD - refD);

    let v = Math.min(1.0, vc.baseGain * factor);
    if (dived) {
      // During dive: boost the dived plane's video, duck everyone else
      v = vc.plane === dived ? 1.0 : 0.1 * v;
    }
    vc.video.volume = v;
  }

  const api = {
    positionals,
    videoControls,
    ducks,

    onUserGesture() {
      gestureFired = true;
      const ctx = listener.context;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      for (const e of positionals) {
        if (e.src.kind === 'audio' && e.ready && !e.audio.isPlaying) {
          try { e.audio.play(); } catch (err) { /* ignore */ }
        }
      }
    },

    startMainRamp(target = MAIN_BASE_VOL, duration = 2.5) {
      const tryStart = () => {
        if (!mainAudio.buffer) {
          setTimeout(tryStart, 80);
          return;
        }
        if (!mainAudio.isPlaying) {
          try { mainAudio.play(); } catch (e) { /* ignore */ }
        }
        rampMainTo(target, duration, 'sine.inOut');
      };
      tryStart();
    },

    update(camera) {
      camera.getWorldPosition(_camPos);

      // Main-audio duck target
      if (!dived) {
        let target = MAIN_BASE_VOL;
        for (const d of ducks) {
          d.plane.getWorldPosition(_planePos);
          const dist = _camPos.distanceTo(_planePos);
          if (dist < d.radius) target = Math.min(target, d.target);
        }
        if (Math.abs(target - lastTarget) > 0.001) rampMainTo(target, 1.0);
      }

      // Per-video distance volume
      for (const vc of videoControls) applyVideoVolume(vc);
    },

    setDive(plane) {
      if (dived === plane) return;
      dived = plane;
      rampMainTo(0.1, 0.4);
      // Buffer positionals: hard-set their gains
      for (const e of positionals) {
        const target = e.plane === plane ? 1.0 : 0.1;
        if (e._tween) e._tween.kill();
        e._tween = gsap.to(e.audio.gain.gain, {
          value: target,
          duration: 0.4,
          ease: 'power1.out',
        });
      }
      // Videos handled by applyVideoVolume — next update tick will pick up `dived`
    },

    clearDive() {
      if (!dived) return;
      dived = null;
      lastTarget = -1; // force update() to ramp main back to natural target
      for (const e of positionals) {
        if (e._tween) e._tween.kill();
        e._tween = gsap.to(e.audio.gain.gain, {
          value: e.baseVolume,
          duration: 0.4,
          ease: 'power1.out',
        });
      }
    },

    setMuted(m) {
      muted = !!m;
      listener.setMasterVolume(muted ? 0 : 1);
      if (muted) {
        // Immediately mute videos (they're outside Web Audio)
        for (const vc of videoControls) vc.video.volume = 0;
      }
      // When unmuted, update() will restore video volumes next frame
    },

    isMuted() { return muted; },

    setMainTarget(target, duration = 1.0, ease = 'power1.out') {
      rampMainTo(target, duration, ease);
    },
  };

  return api;
}
