import * as THREE from 'three';
import gsap from 'gsap';

const MAX_YAW = 20 * Math.PI / 180;
const MAX_PITCH = 20 * Math.PI / 180;
const LOOK_LERP_RATE = 5; // ~200ms half-life

const DIVE_DURATION = 0.8;
const EXIT_DURATION = 0.6;
const DIVE_DISTANCE = 3.2; // units in front of plane

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpQ1 = new THREE.Quaternion();
const _tmpQ2 = new THREE.Quaternion();
const _tmpObj = new THREE.Object3D();

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

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    targetYaw.v = -mouse.x * MAX_YAW;
    // mouse.y is +1 at top, -1 at bottom. With YXZ Euler, +rotation.x = look up.
    // So cursor up → mouse.y > 0 → targetPitch > 0 → camera looks up.
    targetPitch.v = mouse.y * MAX_PITCH;
  }

  function onClick() {
    if (state.phase !== 'tunnel') return;
    if (mode === 'diving' || mode === 'entering') {
      // Click during dive (anywhere) returns to tunnel
      exitDive();
      return;
    }
    if (mode === 'exiting') return;
    if (hovered) {
      enterDive(hovered);
    }
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

    // Target = plane world pos + plane forward * DIVE_DISTANCE
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

    // Glow up the dived plane
    setHoverFloat(plane, 1, 0.35);

    // Audio
    audioMgr.setDive?.(plane);

    // If the user is diving into a one-shot (e.g. the intro), replay it.
    const planeIdx = plane.userData?.index;
    if (planeIdx != null) screens?.replayOneShot?.(planeIdx);
  }

  function exitDive() {
    if (!dived || mode === 'exiting' || mode === 'idle') return;
    mode = 'exiting';
    const plane = dived.plane;
    const savedCamPos = dived.savedCamPos;
    const savedAutoScroll = dived.savedAutoScroll;

    // Capture current quaternion
    _tmpQ1.copy(camera.quaternion);

    // Compute target quaternion (mouse-look look-forward at saved position)
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
      // Smooth lerp toward mouse target
      currentYaw = THREE.MathUtils.damp(currentYaw, targetYaw.v, LOOK_LERP_RATE, dt);
      currentPitch = THREE.MathUtils.damp(currentPitch, targetPitch.v, LOOK_LERP_RATE, dt);
      camera.rotation.set(currentPitch, currentYaw, 0);

      // Hover raycast
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
      // Keep aimed at the dived plane
      if (dived) {
        dived.plane.getWorldPosition(_tmpV1);
        camera.lookAt(_tmpV1);
      }
    }
    // 'exiting' is fully driven by GSAP slerp
  }

  return {
    update,
    enterDive,
    exitDive,
    getMode() { return mode; },
  };
}
