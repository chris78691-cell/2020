import * as THREE from 'three';

const CART_W = 1.4;
const CART_H = 0.6;
const CART_L = 1.6;
const WALL_T = 0.09;
const WHEEL_R = 0.22;
const WHEEL_W = 0.07;

/**
 * Open-top minecart built from Three.js primitives. Returns:
 *   - group:  the cart Object3D (centered on its own origin; bottom at y = -CART_H/2 - WHEEL_R)
 *   - wheels: array of 4 wheel meshes for per-frame rotation
 *   - update(speed, dt): spins the wheels proportional to motion
 */
export function createMinecart() {
  const group = new THREE.Group();
  group.name = 'minecart';

  // Pixelated metal texture so each face has some surface detail
  const metalTex = makeMetalTexture('#a8b0bc', '#7c818c', '#5a5e68');
  const innerTex = makeMetalTexture('#74798a', '#54586a', '#383d4c');
  const wheelTex = makeMetalTexture('#2a2c32', '#1a1c22', '#0a0c10');

  // -- Materials (Lambert so they pick up scene lights) --
  const bodyMatOuter = new THREE.MeshLambertMaterial({ map: metalTex });
  const bodyMatInner = new THREE.MeshLambertMaterial({ map: innerTex });
  const wheelMat = new THREE.MeshLambertMaterial({ map: wheelTex });

  function box(w, h, l) {
    return new THREE.BoxGeometry(w, h, l);
  }

  // Bottom of the cart interior
  const bottom = new THREE.Mesh(box(CART_W - WALL_T * 2, WALL_T, CART_L - WALL_T * 2), bodyMatInner);
  bottom.position.y = -CART_H / 2 + WALL_T / 2;
  group.add(bottom);

  // Side walls — outer
  const frontWall = new THREE.Mesh(box(CART_W, CART_H, WALL_T), bodyMatOuter);
  frontWall.position.set(0, 0, -CART_L / 2 + WALL_T / 2);
  group.add(frontWall);

  const backWall = new THREE.Mesh(box(CART_W, CART_H, WALL_T), bodyMatOuter);
  backWall.position.set(0, 0, CART_L / 2 - WALL_T / 2);
  group.add(backWall);

  const leftWall = new THREE.Mesh(box(WALL_T, CART_H, CART_L), bodyMatOuter);
  leftWall.position.set(-CART_W / 2 + WALL_T / 2, 0, 0);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(box(WALL_T, CART_H, CART_L), bodyMatOuter);
  rightWall.position.set(CART_W / 2 - WALL_T / 2, 0, 0);
  group.add(rightWall);

  // Rim along the top edge (slightly darker for "metal trim" feel)
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x5c606c });
  const rimT = 0.06;
  const rimY = CART_H / 2 + rimT / 2 - rimT / 2;
  const rimGeoLR = new THREE.BoxGeometry(WALL_T + 0.04, rimT, CART_L + 0.04);
  const rimGeoFB = new THREE.BoxGeometry(CART_W + 0.04, rimT, WALL_T + 0.04);
  const rimL = new THREE.Mesh(rimGeoLR, rimMat); rimL.position.set(-CART_W / 2, rimY, 0); group.add(rimL);
  const rimR = new THREE.Mesh(rimGeoLR, rimMat); rimR.position.set( CART_W / 2, rimY, 0); group.add(rimR);
  const rimF = new THREE.Mesh(rimGeoFB, rimMat); rimF.position.set(0, rimY, -CART_L / 2); group.add(rimF);
  const rimB = new THREE.Mesh(rimGeoFB, rimMat); rimB.position.set(0, rimY,  CART_L / 2); group.add(rimB);

  // Wheels — 4 corners, axles along world X
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 18);
  const wheels = [];
  const wheelOffsets = [
    [ CART_W / 2 - 0.02,  CART_L / 2 - 0.32],
    [-CART_W / 2 + 0.02,  CART_L / 2 - 0.32],
    [ CART_W / 2 - 0.02, -CART_L / 2 + 0.32],
    [-CART_W / 2 + 0.02, -CART_L / 2 + 0.32],
  ];
  for (const [x, z] of wheelOffsets) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2; // axis along X = wheel rolls around X
    // Wheel center 0.03u below the cart's bottom plate so the wheel's lower
    // tangent (wheel.y - WHEEL_R) sits on the track plane in main.js.
    wheel.position.set(x, -CART_H / 2 - 0.03, z);
    group.add(wheel);
    wheels.push(wheel);
  }

  // Subtle inner wood "plank" floor for a touch of warmth
  const plankTex = makeWoodTexture();
  const plankMat = new THREE.MeshLambertMaterial({ map: plankTex });
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(CART_W - WALL_T * 2 - 0.04, 0.02, CART_L - WALL_T * 2 - 0.04),
    plankMat,
  );
  plank.position.y = -CART_H / 2 + WALL_T + 0.011;
  group.add(plank);

  return {
    group,
    wheels,
    update(speed, dt) {
      const omega = speed / WHEEL_R;
      for (const w of wheels) w.rotation.x += omega * dt;
    },
  };
}

// ----- texture helpers (pixelated 32×32 canvas tiles) -----

function makeMetalTexture(base, mid, dark) {
  const cnv = document.createElement('canvas');
  cnv.width = 32;
  cnv.height = 32;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = mid;
  for (let y = 0; y < 32; y += 2) {
    for (let x = 0; x < 32; x += 2) {
      if (Math.random() < 0.32) ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.fillStyle = dark;
  for (let y = 0; y < 32; y += 4) {
    for (let x = 0; x < 32; x += 4) {
      if (Math.random() < 0.18) ctx.fillRect(x, y, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

function makeWoodTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 32;
  cnv.height = 32;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#3a2410';
  // Horizontal plank seams
  ctx.fillRect(0, 7, 32, 1);
  ctx.fillRect(0, 15, 32, 1);
  ctx.fillRect(0, 23, 32, 1);
  ctx.fillRect(0, 31, 32, 1);
  // Grain
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  for (let i = 0; i < 12; i++) {
    const y = Math.floor(Math.random() * 32);
    const x = Math.floor(Math.random() * 32);
    ctx.fillRect(x, y, Math.floor(Math.random() * 4) + 1, 1);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
