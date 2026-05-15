import * as THREE from 'three';
import gsap from 'gsap';
import { SCREEN_W, SCREEN_H } from './tunnel.js';

const IS_COARSE = typeof window !== 'undefined'
  && (window.matchMedia?.('(pointer: coarse)')?.matches ?? false);
const IS_MOBILE = typeof window !== 'undefined'
  && (window.innerWidth < 720 || IS_COARSE);

// Mobile gets a much wider look range — screens are at ±31° off-axis so the
// desktop 20° cap meant the user could never actually face a passing screen.
const MAX_YAW   = (IS_MOBILE ? 38 : 20) * Math.PI / 180;
const MAX_PITCH = (IS_MOBILE ? 32 : 20) * Math.PI / 180;
const LOOK_LERP_RATE = 5;

const DIVE_DURATION = 0.8;
const EXIT_DURATION = 0.6;

// Mobile sensitivity: full-screen swipe = ~1× the new max yaw, so the
// extra range doesn't feel sluggish.
const TOUCH_DRAG_SENS = 1.2;
const TAP_MAX_MOVE = 18;  // px — finger taps naturally drift more than mouse clicks
const TAP_MAX_MS   = 500;

// Suppress mouse events that fire synthetically right after a touchend.
const TOUCH_SUPPRESS_MS = 450;

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpQ1 = new THREE.Quaternion();
const _tmpQ2 = new THREE.Quaternion();
const _tmpObj = new THREE.Object3D();
const _ndc = new THREE.Vector2();

/**
 * Compute the cover-fit dive distance so the plane fills the viewport
 * regardless of aspect. On desktop landscape this is ~4.6u; on portrait
 * mobile it's ~3.9u (and the plane is heavily cropped horizontally — but
 * that's the point: cinematic fullscreen feel).
 */
function computeDiveDistance(camera, renderer) {
  const fovRad = camera.fov * Math.PI / 180;
  const aspect = renderer.domElement.clientWidth / renderer.domElement.clientHeight;
  const hFov = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
  const dForH = SCREEN_H / (2 * Math.tan(fovRad / 2));
  const dForW = SCREEN_W / (2 * Math.tan(hFov / 2));
  // Cover fit = use the SMALLER distance so the plane fills viewport
  // (the longer dimension crops off the edges).
  return Math.min(dForW, dForH) * 1.02;
}

export function createInteraction({ camera, renderer, planes, audioMgr, state, screens }) {
  camera.rotation.order = 'YXZ';

  const mouse = new THREE.Vector2(0, 0);
  const targetYaw = { v: 0 };
  const targetPitch = { v: 0 };
  let currentYaw = 0;
  let currentPitch = 0;
  let hovered = null;

  const raycaster = new THREE.Raycaster();
  const canvas = renderer.domElement;

  /** dive state machine: 'idle' | 'entering' | 'diving' | 'exiting' */
  let mode = 'idle';
  let dived = null;

  // Touch drag state — cumulative yaw/pitch the user has dragged into.
  let dragYaw = 0;
  let dragPitch = 0;
  let touchActive = false;
  let touchLastX = 0;
  let touchLastY = 0;
  let touchMovedPx = 0;
  let touchStartTime = 0;
  let lastTouchEndAt = 0; // for synthetic-click suppression

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onMouseClick);

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd);

  window.addEventListener('keydown', onKeyDown);

  function onMouseMove(e) {
    // Don't fight touch drag on hybrid devices
    if (performance.now() - lastTouchEndAt < TOUCH_SUPPRESS_MS) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    targetYaw.v = -mouse.x * MAX_YAW;
    targetPitch.v = mouse.y * MAX_PITCH;
  }

  function onMouseClick(e) {
    // Synthetic click after touchend — drop it; touchend already handled the tap.
    if (performance.now() - lastTouchEndAt < TOUCH_SUPPRESS_MS) return;
    handleTap(e.clientX, e.clientY);
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchActive = true;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
    touchMovedPx = 0;
    touchStartTime = performance.now();
  }

  function onTouchMove(e) {
    if (!touchActive || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - touchLastX;
    const dy = t.clientY - touchLastY;
    touchLastX = t.clientX;
    touchLastY = t.clientY;

    touchMovedPx += Math.abs(dx) + Math.abs(dy);

    if (mode !== 'idle') return;

    const rect = canvas.getBoundingClientRect();
    dragYaw   -= (dx / rect.width) * MAX_YAW * 2 * TOUCH_DRAG_SENS;
    dragPitch -= (dy / rect.height) * MAX_PITCH * 2 * TOUCH_DRAG_SENS;

    dragYaw   = Math.max(-MAX_YAW,   Math.min(MAX_YAW,   dragYaw));
    dragPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, dragPitch));

    targetYaw.v = dragYaw;
    targetPitch.v = dragPitch;
  }

  function onTouchEnd(e) {
    if (!touchActive) return;
    touchActive = false;
    lastTouchEndAt = performance.now();
    const dt = lastTouchEndAt - touchStartTime;
    if (touchMovedPx <= TAP_MAX_MOVE && dt < TAP_MAX_MS) {
      // Block the synthetic click that would otherwise fire on this touch.
      if (e.cancelable) e.preventDefault();
      handleTap(touchLastX, touchLastY);
    }
  }

  function handleTap(clientX, clientY) {
    if (state.phase !== 'tunnel') return;
    if (mode === 'diving' || mode === 'entering') {
      exitDive();
      return;
    }
    if (mode === 'exiting') return;

    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(_ndc, camera);
    const hits = raycaster.intersectObjects(planes, false);
    if (hits.length > 0) enterDive(hits[0].object);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && (mode === 'diving' || mode === 'entering')) {
      exitDive();
    }
  }

  function enterDive(plane) {
    if (mode !== 'idle') return;
    mode = 'entering';

    dived = {
      plane,
      savedCamPos: camera.position.clone(),
      savedAutoScroll: state.autoScroll,
    };
    state.autoScroll = false;

    // Reset drag state so when we exit the dive, the camera lerps back to
    // straight-forward instead of returning to whatever side-angle the user
    // happened to be drag-looking at when they tapped.
    dragYaw = 0;
    dragPitch = 0;
    targetYaw.v = 0;
    targetPitch.v = 0;

    plane.getWorldPosition(_tmpV1);
    plane.getWorldDirection(_tmpV2);
    const dist = computeDiveDistance(camera, renderer);
    _tmpV2.multiplyScalar(dist);
    const targetX = _tmpV1.x + _tmpV2.x;
    const targetY = _tmpV1.y + _tmpV2.y;
    const targetZ = _tmpV1.z + _tmpV2.z;

    gsap.to(camera.position, {
      x: targetX,
      y: targetY,
      z: targetZ,
      duration: DIVE_DURATION,
      ease: 'power2.inOut',
      onComplete: () => {
        if (mode === 'entering') mode = 'diving';
      },
    });

    setHoverFloat(plane, 1, 0.35);
    audioMgr.setDive?.(plane);

    const planeIdx = plane.userData?.index;
    if (planeIdx != null) screens?.replayOneShot?.(planeIdx);
  }

  function exitDive() {
    if (!dived || mode === 'exiting' || mode === 'idle') return;
    mode = 'exiting';
    const plane = dived.plane;
    const savedCamPos = dived.savedCamPos;
    const savedAutoScroll = dived.savedAutoScroll;

    _tmpQ1.copy(camera.quaternion);

    _tmpObj.position.copy(savedCamPos);
    _tmpObj.rotation.order = 'YXZ';
    _tmpObj.rotation.set(currentPitch, currentYaw, 0);
    _tmpQ2.copy(_tmpObj.quaternion);

    gsap.to(camera.position, {
      x: savedCamPos.x,
      y: savedCamPos.y,
      z: savedCamPos.z,
      duration: EXIT_DURATION,
      ease: 'power2.inOut',
    });

    const t = { v: 0 };
    gsap.to(t, {
      v: 1,
      duration: EXIT_DURATION,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.quaternion.slerpQuaternions(_tmpQ1, _tmpQ2, t.v);
      },
      onComplete: () => {
        mode = 'idle';
        state.autoScroll = savedAutoScroll;
        dived = null;
      },
    });

    setHoverFloat(plane, 0, 0.35);
    audioMgr.clearDive?.();
  }

  function setHoverFloat(plane, value, duration) {
    const u = plane.material?.uniforms?.uHover;
    if (!u) return;
    gsap.to(u, { value, duration, ease: 'power1.out' });
  }

  function update(dt) {
    if (state.phase !== 'tunnel') return;

    if (mode === 'idle') {
      currentYaw = THREE.MathUtils.damp(currentYaw, targetYaw.v, LOOK_LERP_RATE, dt);
      currentPitch = THREE.MathUtils.damp(currentPitch, targetPitch.v, LOOK_LERP_RATE, dt);
      camera.rotation.set(currentPitch, currentYaw, 0);

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(planes, false);
      const newHover = hits.length > 0 ? hits[0].object : null;
      if (newHover !== hovered) {
        if (hovered) setHoverFloat(hovered, 0, 0.25);
        hovered = newHover;
        if (hovered) setHoverFloat(hovered, 1, 0.25);
        canvas.style.cursor = hovered ? 'pointer' : 'default';
      }
    } else if (mode === 'entering' || mode === 'diving') {
      if (dived) {
        dived.plane.getWorldPosition(_tmpV1);
        camera.lookAt(_tmpV1);
      }
    }
  }

  return {
    update,
    enterDive,
    exitDive,
    getMode() { return mode; },
  };
}
