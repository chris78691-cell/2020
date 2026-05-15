import * as THREE from 'three';
import gsap from 'gsap';

const MAX_YAW = 20 * Math.PI / 180;
const MAX_PITCH = 20 * Math.PI / 180;
const LOOK_LERP_RATE = 5; // ~200ms half-life

const DIVE_DURATION = 0.8;
const EXIT_DURATION = 0.6;
const DIVE_DISTANCE = 3.2; // units in front of plane

// Touch drag sensitivity — full-screen drag covers ~1.5× the max yaw/pitch (clamped)
const TOUCH_DRAG_SENS = 1.5;
const TAP_MAX_MOVE = 10; // px — drags below this still count as a tap

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpQ1 = new THREE.Quaternion();
const _tmpQ2 = new THREE.Quaternion();
const _tmpObj = new THREE.Object3D();
const _ndc = new THREE.Vector2();

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
  let touchStartX = 0;
  let touchStartY = 0;
  let touchLastX = 0;
  let touchLastY = 0;
  let touchMovedPx = 0;
  let touchStartTime = 0;

  // Mouse handlers (desktop)
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onMouseClick);

  // Touch handlers (mobile)
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  window.addEventListener('keydown', onKeyDown);

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    targetYaw.v = -mouse.x * MAX_YAW;
    // mouse.y is +1 at top, -1 at bottom. With YXZ Euler, +rotation.x = look up.
    targetPitch.v = mouse.y * MAX_PITCH;
  }

  function onMouseClick(e) {
    handleTap(e.clientX, e.clientY);
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchActive = true;
    touchStartX = touchLastX = t.clientX;
    touchStartY = touchLastY = t.clientY;
    touchMovedPx = 0;
    touchStartTime = performance.now();
    // Don't preventDefault on start — lets quick taps through cleanly
  }

  function onTouchMove(e) {
    if (!touchActive || e.touches.length !== 1) return;
    e.preventDefault(); // block page scroll while panning the camera
    const t = e.touches[0];
    const dx = t.clientX - touchLastX;
    const dy = t.clientY - touchLastY;
    touchLastX = t.clientX;
    touchLastY = t.clientY;

    touchMovedPx += Math.abs(dx) + Math.abs(dy);

    if (mode !== 'idle') return;

    const rect = canvas.getBoundingClientRect();
    // Drag right (dx > 0) → user wants to look right → yaw must go negative (see onMouseMove)
    dragYaw -= (dx / rect.width) * MAX_YAW * 2 * TOUCH_DRAG_SENS;
    // Drag down (dy > 0) → user wants to look down → pitch must go negative
    dragPitch -= (dy / rect.height) * MAX_PITCH * 2 * TOUCH_DRAG_SENS;

    dragYaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, dragYaw));
    dragPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, dragPitch));

    targetYaw.v = dragYaw;
    targetPitch.v = dragPitch;
  }

  function onTouchEnd(e) {
    if (!touchActive) return;
    touchActive = false;
    const dt = performance.now() - touchStartTime;
    // Treat very short, low-movement touches as taps.
    if (touchMovedPx <= TAP_MAX_MOVE && dt < 500) {
      // Use the last-known touch position as the tap point.
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

    // Raycast from the tap position regardless of where the camera was looking.
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

    plane.getWorldPosition(_tmpV1);
    plane.getWorldDirection(_tmpV2);
    _tmpV2.multiplyScalar(DIVE_DISTANCE);
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

      // Hover raycast — only meaningful when a mouse is present (no hover on touch).
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
