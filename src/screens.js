import * as THREE from 'three';
import gsap from 'gsap';
import { SCREEN_W, SCREEN_H } from './tunnel.js';

const PLANE_ASPECT = SCREEN_W / SCREEN_H; // 8 / 4.5 ≈ 1.778

const SCREENS = [
  { i: 1,  type: 'video',     file: '/media/intro-vid.mp4' },
  { i: 2,  type: 'sequence',  files: ['/media/covid-pic-1.jpg', '/media/covid-pic-2.jpg', '/media/covid-pic-3.jpg'], interval: 3.0 },
  { i: 3,  type: 'video',     file: '/media/zoom-vid.mp4' },
  { i: 4,  type: 'video',     file: '/media/covid-funny-vid.mp4' },
  { i: 5,  type: 'image',     file: '/media/man-image.jpg' },
  { i: 6,  type: 'composite', files: ['/media/ps5.jpg', '/media/skins.jpg', '/media/black-ice.jpg'] },
  { i: 7,  type: 'video',     file: '/media/fn-vid.mp4' },
  { i: 8,  type: 'video',     file: '/media/victory-royale-vid.mp4' },
  { i: 9,  type: 'video',     file: '/media/addison-vid.mp4' },
  { i: 10, type: 'video',     file: '/media/coffin-dance-vid.mp4' },
  { i: 11, type: 'video',     file: '/media/doc-vid.mp4' },
  { i: 12, type: 'video',     file: '/media/walking-vid.mp4' },
];

const screenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const screenFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uMapAspect;
  uniform float uPlaneAspect;
  uniform float uHover;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // Contain-fit the texture into the plane (preserve aspect, letterbox if needed)
    vec2 newUv = uv;
    if (uMapAspect > uPlaneAspect) {
      newUv.y = 0.5 + (uv.y - 0.5) * (uMapAspect / uPlaneAspect);
    } else if (uMapAspect < uPlaneAspect) {
      newUv.x = 0.5 + (uv.x - 0.5) * (uPlaneAspect / uMapAspect);
    }
    bool oob = newUv.x < 0.0 || newUv.x > 1.0 || newUv.y < 0.0 || newUv.y > 1.0;

    // Slight edge RGB aberration (in plane space)
    vec2 dir = uv - 0.5;
    float d = length(dir);
    float aber = 0.006 * smoothstep(0.18, 0.72, d);
    vec2 off = dir * aber;

    vec3 col;
    if (oob) {
      col = vec3(0.0);
    } else {
      vec2 ur = clamp(newUv + off, 0.0, 1.0);
      vec2 ub = clamp(newUv - off, 0.0, 1.0);
      float r = texture2D(uMap, ur).r;
      float g = texture2D(uMap, newUv).g;
      float b = texture2D(uMap, ub).b;
      col = vec3(r, g, b);
    }

    // CRT scanlines
    float scan = 0.90 + 0.10 * sin(uv.y * 700.0 + uTime * 4.0);
    col *= scan;

    // Subtle vignette
    float vig = 1.0 - smoothstep(0.55, 1.05, d * 1.05);
    col *= vig;

    // Always-on faint edge fringe ("powered-on monitor")
    float edgeFar = smoothstep(0.46, 0.5, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
    col += vec3(0.0, 0.5, 0.45) * edgeFar * 0.18;

    // Hover: bright neon border ONLY — don't tint the whole image
    float bx = abs(uv.x - 0.5);
    float by = abs(uv.y - 0.5);
    float maxD = max(bx, by);
    // Outer ring band 0.46 -> 0.5 with brightest peak around 0.485
    float ringIn  = smoothstep(0.46, 0.485, maxD);
    float ringOut = 1.0 - smoothstep(0.485, 0.5, maxD);
    float ring = ringIn * ringOut;
    vec3 ringColor = vec3(0.0, 1.0, 0.82);
    col += uHover * ringColor * ring * 2.5;

    gl_FragColor = vec4(col, uOpacity);
  }
`;

// Per-direction range so we can match the forward-bias audio: the user can't
// look backwards, so a screen they've passed should pause much sooner than
// one they're approaching. Re-evaluated on viewport change.
const RANGE_DESKTOP_AHEAD  = 40;
const RANGE_DESKTOP_BEHIND = 40;
const RANGE_MOBILE_AHEAD   = 22;
const RANGE_MOBILE_BEHIND  = 10; // planes are 8u off-axis, so 10u catches "just passed" then pauses

function isMobileNow() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return window.innerWidth < 720 || coarse;
}
let mobileMode = isMobileNow();
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { mobileMode = isMobileNow(); });
  window.addEventListener('orientationchange', () => { mobileMode = isMobileNow(); });
}

export function attachMedia(planes, loader) {
  const items = [];
  const track = loader ? (p) => loader.track(p) : (p) => p;

  for (const cfg of SCREENS) {
    const plane = planes[cfg.i - 1];
    if (!plane) continue;

    const mat = createScreenMaterial();
    const item = { plane, cfg, mat, video: null, sequence: null };

    if (cfg.type === 'image') {
      track(loadImageTexture(cfg.file).then(({ texture, aspect }) => {
        mat.uniforms.uMap.value = texture;
        mat.uniforms.uMapAspect.value = aspect;
      }));
    } else if (cfg.type === 'video') {
      const isOneShot = cfg.i === 1; // intro plays once, then waits to be clicked
      const video = createVideoElement(cfg.file, { loop: !isOneShot });
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      mat.uniforms.uMap.value = tex;
      item.oneShot = isOneShot;
      if (isOneShot) {
        // Track whether the one-shot has finished its first play.
        item.played = false;
        video.addEventListener('ended', () => { item.played = true; });
      }

      // Register a promise resolved on loadedmetadata (light — just header bytes)
      track(new Promise((resolve) => {
        let settled = false;
        const settle = () => { if (!settled) { settled = true; resolve(); } };
        const onMeta = () => {
          if (video.videoWidth && video.videoHeight) {
            mat.uniforms.uMapAspect.value = video.videoWidth / video.videoHeight;
          }
          settle();
        };
        if (video.readyState >= 1) onMeta();
        else {
          video.addEventListener('loadedmetadata', onMeta, { once: true });
          video.addEventListener('error', settle, { once: true });
        }
        // Hard timeout so a slow video can't block the loader forever
        setTimeout(settle, 15000);
      }));

      item.video = video;
    } else if (cfg.type === 'sequence') {
      track(Promise.all(cfg.files.map(loadImageTexture)).then((results) => {
        const textures = results.map((r) => r.texture);
        const aspects = results.map((r) => r.aspect);
        mat.uniforms.uMap.value = textures[0];
        mat.uniforms.uMapAspect.value = aspects[0];
        item.sequence = {
          textures,
          aspects,
          interval: cfg.interval,
          idx: 0,
          accum: 0,
        };
      }));
    } else if (cfg.type === 'composite') {
      const { texture, draw } = createCompositeTexture();
      mat.uniforms.uMap.value = texture;
      mat.uniforms.uMapAspect.value = 768 / 288;
      const promises = cfg.files.map((file, idx) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { draw(idx, img); resolve(); };
        img.onerror = () => resolve();
        img.src = file;
      }));
      track(Promise.all(promises));
    }

    plane.material.map?.dispose?.();
    plane.material.dispose();
    plane.material = mat;
    items.push(item);
  }

  const api = {
    items,
    materials: items.map((it) => it.mat),
    videos: items.filter((it) => it.video).map((it) => it.video),

    playAllVideos() {
      // Don't auto-start one-shot clips here — they get explicitly played when
      // their phase begins (e.g. intro starts when the tunnel reveals).
      api.items.forEach((it) => {
        if (!it.video || it.oneShot) return;
        const p = it.video.play();
        if (p && p.catch) p.catch(() => {});
      });
    },

    /** Start a one-shot video from the beginning (intro vid on tunnel reveal,
     *  or on dive into the intro plane). */
    playOneShot(planeIndex) {
      const it = api.items.find((i) => i.cfg.i === planeIndex);
      if (!it || !it.video) return;
      try {
        it.video.currentTime = 0;
      } catch (e) { /* ignore */ }
      it.played = false;
      const p = it.video.play();
      if (p && p.catch) p.catch(() => {});
    },

    /** Re-play a one-shot from the beginning (no-op for looping videos). */
    replayOneShot(planeIndex) {
      const it = api.items.find((i) => i.cfg.i === planeIndex);
      if (!it || !it.video || !it.oneShot) return;
      try { it.video.currentTime = 0; } catch (e) { /* ignore */ }
      it.played = false;
      const p = it.video.play();
      if (p && p.catch) p.catch(() => {});
    },

    show(allPlanes) {
      allPlanes.forEach((p, i) => {
        const delay = 0.1 + i * 0.04;
        if (p.material.isShaderMaterial && p.material.uniforms?.uOpacity) {
          gsap.to(p.material.uniforms.uOpacity, {
            value: 1,
            duration: 0.9,
            delay,
            ease: 'power1.out',
          });
        } else {
          gsap.to(p.material, {
            opacity: 0.95,
            duration: 0.9,
            delay,
            ease: 'power1.out',
          });
        }
      });
    },

    update(dt, time, camera) {
      for (const it of items) {
        it.mat.uniforms.uTime.value = time;
        const seq = it.sequence;
        if (seq) {
          seq.accum += dt;
          if (seq.accum >= seq.interval) {
            seq.accum = 0;
            seq.idx = (seq.idx + 1) % seq.textures.length;
            it.mat.uniforms.uMap.value = seq.textures[seq.idx];
            it.mat.uniforms.uMapAspect.value = seq.aspects[seq.idx];
          }
        }

      }

      // Per-video play/pause selection. Desktop: each video manages itself
      // against the per-direction range. Mobile: at most ONE looping video
      // decodes at a time (the closest in range), because mobile browsers
      // only have a couple of hardware decoder slots and swapping them
      // every frame is what causes the audio dropouts after a few screens.
      if (camera) {
        if (mobileMode) {
          updateMobileVideoSelection(items, camera);
        } else {
          for (const it of items) {
            if (!it.video) continue;
            const dist = it.plane.position.distanceTo(camera.position);
            const ahead = it.plane.position.z <= camera.position.z;
            const range = ahead ? RANGE_DESKTOP_AHEAD : RANGE_DESKTOP_BEHIND;
            if (dist > range) {
              if (!it.video.paused) it.video.pause();
            } else if (!it.oneShot) {
              if (it.video.paused) {
                const p = it.video.play();
                if (p && p.catch) p.catch(() => {});
              }
            }
          }
        }
      }
    },
  };

  return api;
}

// -------- helpers --------

function createScreenMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uMapAspect: { value: PLANE_ASPECT },
      uPlaneAspect: { value: PLANE_ASPECT },
      uHover: { value: 0 },
    },
    vertexShader: screenVertex,
    fragmentShader: screenFragment,
    transparent: true,
    side: THREE.FrontSide,
  });
}

function loadImageTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.width / texture.image.height;
        resolve({ texture, aspect });
      },
      undefined,
      reject,
    );
  });
}

/**
 * Mobile picks ONE looping video at a time (the closest in range) instead of
 * letting two run concurrently. The intro one-shot is left alone — if it's
 * still on its first run, we let it finish even while a second screen
 * approaches, otherwise the welcome message gets cut off.
 */
function updateMobileVideoSelection(items, camera) {
  // Pause everything that's out of range first so we don't waste decoders on far screens.
  const inRange = [];
  for (const it of items) {
    if (!it.video || it.oneShot) continue;
    const dist = it.plane.position.distanceTo(camera.position);
    const ahead = it.plane.position.z <= camera.position.z;
    const range = ahead ? RANGE_MOBILE_AHEAD : RANGE_MOBILE_BEHIND;
    if (dist > range) {
      if (!it.video.paused) it.video.pause();
    } else {
      inRange.push({ it, dist });
    }
  }

  // Pick the closest in-range video as the single one allowed to play.
  let best = null;
  for (const cand of inRange) {
    if (!best || cand.dist < best.dist) best = cand;
  }
  for (const cand of inRange) {
    const want = cand === best;
    if (want && cand.it.video.paused) {
      const p = cand.it.video.play();
      if (p && p.catch) p.catch(() => {});
    } else if (!want && !cand.it.video.paused) {
      cand.it.video.pause();
    }
  }
}

function createVideoElement(src, { loop = true } = {}) {
  const v = document.createElement('video');
  v.src = src;
  v.muted = true;
  v.loop = loop;
  v.playsInline = true;
  // Mobile: don't eagerly download all 9 videos at boot — that competes with
  // the in-flight decoders for memory and is the second-biggest source of
  // stutter after concurrent decoding.
  v.preload = mobileMode ? 'metadata' : 'auto';
  v.style.display = 'none';
  document.body.appendChild(v);
  return v;
}

function createCompositeTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 768;
  cnv.height = 288;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  function draw(idx, img) {
    const panelW = 256;
    const panelH = 288;
    const x0 = idx * panelW;
    ctx.fillStyle = '#000';
    ctx.fillRect(x0, 0, panelW, panelH);
    const ar = img.width / img.height;
    const targetAr = panelW / panelH;
    let dw, dh, dx, dy;
    if (ar > targetAr) {
      dh = panelH;
      dw = dh * ar;
      dx = x0 + (panelW - dw) / 2;
      dy = 0;
    } else {
      dw = panelW;
      dh = dw / ar;
      dx = x0;
      dy = (panelH - dh) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.strokeStyle = 'rgba(0, 255, 208, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, 1, panelW - 2, panelH - 2);
    tex.needsUpdate = true;
  }
  return { texture: tex, draw };
}
