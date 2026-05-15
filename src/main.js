import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { runPortal, createPortalRig } from './portal.js';
import { createTunnel, TUNNEL_SPEED, TUNNEL_END_Z } from './tunnel.js';
import { attachMedia } from './screens.js';
import { createAudioManager } from './audio.js';
import { createInteraction } from './interaction.js';
import { setupUI } from './ui.js';
import { createEndScene } from './end.js';
import { createLoader } from './loader.js';
import { createMinecart } from './minecart.js';

const canvas = document.getElementById('scene');
const entryEl = document.getElementById('entry');
const enterBtn = document.getElementById('enter-btn');
const portalOverlay = document.getElementById('portal-overlay');

// Touch / portrait detection — coarse pointers + narrow viewports get mobile treatment.
const isCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
const isMobileViewport = () => window.innerWidth < 720 || isCoarsePointer;
// Frozen at startup so all the renderer/composer setup uses the same answer
// (re-evaluating it per-tick or on resize would mean reshaping the pass list).
const IS_MOBILE = isMobileViewport();

// Pixel ratio: mobile GPUs can't afford the 4× shader work of dpr=2 through a
// full post chain. 1.25 keeps text legible without killing framerate.
function getTargetPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, IS_MOBILE ? 1.25 : 1.5);
}

// Slightly narrower FOV on portrait than the original 88° pass — still wider
// than desktop but less overdraw to fill.
function getTargetFov() {
  const aspect = window.innerWidth / window.innerHeight;
  return aspect < 1 ? 82 : (aspect < 1.4 ? 78 : 75);
}

// ---------------- Renderer ----------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(getTargetPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);

// ---------------- Scene + Camera ----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.045);

const camera = new THREE.PerspectiveCamera(getTargetFov(), window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0);

// ---------------- Audio listener ----------------
const listener = new THREE.AudioListener();
camera.add(listener);

// ---------------- Asset loader (tracks preload progress) ----------------
const loader = createLoader();

// Main audio
const mainAudio = new THREE.Audio(listener);
loader.track(new Promise((resolve) => {
  new THREE.AudioLoader().load(
    '/media/main-audio.mp3',
    (buffer) => {
      mainAudio.setBuffer(buffer);
      mainAudio.setLoop(true);
      mainAudio.setVolume(0);
      resolve();
    },
    undefined,
    () => resolve(),
  );
}));

// ---------------- Portal rig (the wormhole geometry) ----------------
const portalRig = createPortalRig();
scene.add(portalRig.group);

// ---------------- Scene lights (for Lambert/Standard materials — minecart + coin) ----------------
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(3, 6, 2);
scene.add(sun);

// ---------------- Tunnel ----------------
const tunnel = createTunnel();
scene.add(tunnel.group);

// ---------------- Minecart (the user's POV vehicle) ----------------
const minecart = createMinecart();
minecart.group.visible = false;
scene.add(minecart.group);

// ---------------- Media ----------------
const screens = attachMedia(tunnel.planes, loader);

// ---------------- Audio manager ----------------
const audioMgr = createAudioManager({ listener, mainAudio, screens, loader });

// Dev-only handle for debugging
if (import.meta.env?.DEV) {
  window.__app = { camera, listener, mainAudio, audioMgr, screens, tunnel, gsap, state: null, interaction: null };
}

// ---------------- Post-processing ----------------
// Chromatic aberration shader (slight, constant; intensifies during portal)
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.0015 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec2 off = normalize(dir + 0.0001) * uAmount * (0.6 + d * 1.4);
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      // tiny scanline tint
      float scan = 0.97 + 0.03 * sin(vUv.y * 1400.0 + uTime * 6.0);
      gl_FragColor = vec4(vec3(r, g, b) * scan, 1.0);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.setPixelRatio(getTargetPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));

const chromaPass = new ShaderPass(ChromaticAberrationShader);
composer.addPass(chromaPass);

// Mobile: keep the chromatic-aberration signature but drop the film + glitch
// passes — each saved pass is one fewer full-screen quad render per frame,
// which is the biggest GPU win on phones.
const filmPass = new FilmPass(0.25, false);
const glitchPass = new GlitchPass();
glitchPass.enabled = false;
if (!IS_MOBILE) {
  composer.addPass(filmPass);
  composer.addPass(glitchPass);
}

composer.addPass(new OutputPass());

// expose for portal control
const fx = { chromaPass, filmPass, glitchPass, composer };

// ---------------- Resize ----------------
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = getTargetPixelRatio();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // Only retarget FOV on resize if we aren't mid-portal-animation (which is
  // tweening fov itself); checking phase keeps the portal kick clean.
  if (state?.phase !== 'portal') {
    camera.fov = getTargetFov();
  }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

// ---------------- Render loop ----------------
const clock = new THREE.Clock();
const state = {
  phase: 'entry', // 'entry' | 'portal' | 'tunnel' | 'end'
  glitchTimer: 0,
  nextGlitchAt: 6 + Math.random() * 6,
  autoScroll: true,
};
if (window.__app) window.__app.state = state;

// ---------------- Interaction (mouse look + click-to-dive) ----------------
const interaction = createInteraction({
  camera,
  renderer,
  planes: tunnel.planes,
  audioMgr,
  state,
  screens,
});
if (window.__app) window.__app.interaction = interaction;

// ---------------- UI overlay ----------------
const ui = setupUI({ audioMgr });
if (window.__app) window.__app.ui = ui;

// ---------------- End reveal scene ----------------
const endScene = createEndScene({ scene, camera, endZ: TUNNEL_END_Z });
if (window.__app) window.__app.endScene = endScene;

const endOverlay = document.getElementById('end-overlay');
const endCaBtn = document.getElementById('end-ca-btn');

endCaBtn.addEventListener('click', async () => {
  const ADDR = '72Vzu6enhspZ9YPi7zZ2FD1pkWCaiyjnGGZ5k5i3pump';
  try {
    await navigator.clipboard.writeText(ADDR);
    endCaBtn.classList.add('is-copied');
    clearTimeout(endCaBtn.__copiedTimer);
    endCaBtn.__copiedTimer = setTimeout(() => endCaBtn.classList.remove('is-copied'), 1400);
  } catch (e) { /* ignore */ }
});

function startEndReveal() {
  if (state.phase === 'end') return;
  state.phase = 'end';
  state.autoScroll = false;
  minecart.group.visible = false;
  endScene.start();
  // Swell main audio
  audioMgr.setMainTarget(0.85, 2.2, 'power2.out');
  // Hide the tunnel UI (CA pill / hamburger / X link), show end overlay
  gsap.delayedCall(0.4, () => {
    ui.hide();
    endOverlay.classList.add('is-visible');
    endOverlay.setAttribute('aria-hidden', 'false');
  });
}
if (window.__app) window.__app.startEndReveal = startEndReveal;

// ---------------- Loader UI ----------------
const loaderEl = document.getElementById('loader');
const loaderBar = document.getElementById('loader-bar');
const loaderPct = document.getElementById('loader-pct');

loader.onProgress((pct) => {
  loaderBar.style.width = (pct * 100).toFixed(1) + '%';
  loaderPct.textContent = Math.round(pct * 100) + '%';
});

loader.waitAll().then(() => {
  // Brief hold so the bar settles at 100%
  setTimeout(() => {
    loaderEl.classList.add('is-done');
    entryEl.classList.add('is-ready');
    setTimeout(() => { loaderEl.style.display = 'none'; }, 700);
  }, 250);
});

// Safety net: hard cap so the loader can't hang the entry forever
setTimeout(() => {
  if (!loaderEl.classList.contains('is-done')) {
    loaderEl.classList.add('is-done');
    entryEl.classList.add('is-ready');
    setTimeout(() => { loaderEl.style.display = 'none'; }, 700);
  }
}, 20000);

// ---------------- Skip button ----------------
const skipBtn = document.getElementById('skip-btn');
skipBtn.addEventListener('click', () => {
  if (state.phase === 'tunnel') {
    startEndReveal();
  }
});

function triggerGlitchBurst() {
  if (IS_MOBILE) return; // glitchPass isn't in the composer chain on mobile
  glitchPass.enabled = true;
  glitchPass.goWild = Math.random() < 0.25;
  const dur = 140 + Math.random() * 260;
  setTimeout(() => {
    glitchPass.enabled = false;
    glitchPass.goWild = false;
  }, dur);
}

function tick() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  chromaPass.uniforms.uTime.value = t;

  if (portalRig.group.visible) {
    portalRig.update(dt, t, state.phase);
  }

  if (state.phase === 'tunnel') {
    if (state.autoScroll && camera.position.z > TUNNEL_END_Z) {
      camera.position.z -= TUNNEL_SPEED * dt;
      if (camera.position.z <= TUNNEL_END_Z) {
        camera.position.z = TUNNEL_END_Z;
        startEndReveal();
      }
    }
    tunnel.update(dt, t);
    screens.update(dt, t, camera);
    interaction.update(dt);
    audioMgr.update(camera);

    // Minecart: X is locked to the track centreline always (so it never
    // drifts off-track when the user dives into a side screen). Z+Y follow
    // the camera, but only in idle mode so the cart doesn't fly off with
    // the camera during a dive.
    minecart.group.position.x = 0;
    if (interaction.getMode() === 'idle') {
      minecart.group.position.y = camera.position.y - 1.05 + Math.sin(t * 12) * 0.012;
      minecart.group.position.z = camera.position.z - 0.55;
    }
    if (state.autoScroll) {
      minecart.update(TUNNEL_SPEED, dt);
    }

    // Occasional glitch bursts
    state.glitchTimer += dt;
    if (state.glitchTimer >= state.nextGlitchAt) {
      triggerGlitchBurst();
      state.glitchTimer = 0;
      state.nextGlitchAt = 8 + Math.random() * 7;
    }
  } else if (state.phase === 'end') {
    // Keep media planes ticking so videos behind us continue, but no auto-scroll
    screens.update(dt, t, camera);
    endScene.update(dt, t);
  }

  composer.render(dt);
  requestAnimationFrame(tick);
}
tick();

// ---------------- Entry button handler ----------------
enterBtn.addEventListener('click', () => {
  if (state.phase !== 'entry') return;
  state.phase = 'portal';

  // User gesture: resume AudioContext + play any preloaded positionals
  audioMgr.onUserGesture();

  // Fade entry UI
  entryEl.classList.add('is-hidden');
  portalOverlay.classList.add('is-active');

  // Main audio: ramp 0 -> 0.5 over the portal duration
  audioMgr.startMainRamp(0.5, 2.5);

  // Kick off video playback now that we have a user gesture
  screens.playAllVideos();

  // Run the portal animation
  runPortal({ camera, portalRig, fx, overlay: portalOverlay, settleFov: getTargetFov() }).then(() => {
    state.phase = 'tunnel';
    portalOverlay.classList.remove('is-active');

    // Reveal the tunnel + media planes + minecart
    tunnel.show(1.0);
    screens.show(tunnel.planes);
    minecart.group.visible = true;
    // Intro is a one-shot — kick it off from frame 0 right now so it
    // doesn't already be half-played by the time the user spawns in.
    screens.playOneShot(1);

    // Fade in the tunnel UI overlay
    ui.show();

    // Fade out the portal rig and hide it when done
    gsap.to(
      [portalRig.streaks.material, portalRig.codeMat, portalRig.glowMat],
      {
        opacity: 0,
        duration: 0.8,
        ease: 'power1.out',
        onComplete: () => {
          portalRig.group.visible = false;
        },
      },
    );
  });
});

