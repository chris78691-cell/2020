import * as THREE from 'three';
import gsap from 'gsap';

export const TUNNEL_SPEED = 1.5; // u/s — slower so each screen gets more screen-time
export const SCREEN_SPACING = 11;
export const SCREEN_COUNT = 12;
export const SCREEN_W = 12;
export const SCREEN_H = 6.75; // 16:9 aspect
export const SCREEN_X = 8; // off-center on each side
export const SCREEN_ROT = Math.PI * 0.17; // ~31° toward center
export const FIRST_SCREEN_Z = -12; // screen 1 visible immediately from spawn
export const TUNNEL_END_Z = FIRST_SCREEN_Z - (SCREEN_COUNT - 1) * SCREEN_SPACING - 12;
// = -12 - 11*11 - 12 = -145

export function createTunnel() {
  const group = new THREE.Group();

  const TUNNEL_LEN = 220;
  const TUNNEL_W = 28;
  const TUNNEL_H = 14;
  const WALL_CENTER_Z = -TUNNEL_LEN / 2 + 25;

  // ----- Dirt block walls/floor/ceiling — each tile = 1u (one Minecraft block) -----
  const dirtTex = makeDirtTexture();
  const dirtCeilTex = makeDirtTexture(); // separate instance so it can have its own offset

  function tileDirt(tex, repeatU, repeatV) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatU, repeatV);
  }

  // Left/right walls: shared dirt texture cloned for independent UV repeats.
  const dirtWallL = dirtTex.clone();
  dirtWallL.needsUpdate = true;
  tileDirt(dirtWallL, TUNNEL_LEN, TUNNEL_H);

  const dirtWallR = dirtTex.clone();
  dirtWallR.needsUpdate = true;
  tileDirt(dirtWallR, TUNNEL_LEN, TUNNEL_H);
  dirtWallR.offset.set(0.31, 0.17); // shift so left and right don't look identical

  const leftMat = new THREE.MeshBasicMaterial({
    map: dirtWallL,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const rightMat = new THREE.MeshBasicMaterial({
    map: dirtWallR,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL_LEN, TUNNEL_H), leftMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-TUNNEL_W / 2, 0, WALL_CENTER_Z);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL_LEN, TUNNEL_H), rightMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(TUNNEL_W / 2, 0, WALL_CENTER_Z);
  group.add(rightWall);

  // Floor — dirt blocks
  const dirtFloor = dirtTex.clone();
  dirtFloor.needsUpdate = true;
  tileDirt(dirtFloor, TUNNEL_W, TUNNEL_LEN);
  dirtFloor.offset.set(0.13, 0.47);
  const floorBaseMat = new THREE.MeshBasicMaterial({
    map: dirtFloor,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const floorBase = new THREE.Mesh(
    new THREE.PlaneGeometry(TUNNEL_W, TUNNEL_LEN),
    floorBaseMat,
  );
  floorBase.rotation.x = -Math.PI / 2;
  floorBase.position.set(0, -TUNNEL_H / 2, WALL_CENTER_Z);
  group.add(floorBase);

  // Ceiling — dirt blocks, slightly darker via opacity multiplier in update
  tileDirt(dirtCeilTex, TUNNEL_W, TUNNEL_LEN);
  dirtCeilTex.offset.set(0.55, 0.21);
  const ceilMat = new THREE.MeshBasicMaterial({
    map: dirtCeilTex,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL_W, TUNNEL_LEN), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, TUNNEL_H / 2, WALL_CENTER_Z);
  group.add(ceiling);

  // ----- Minecart-style track strip running down the center, raised so it sits
  //       just below the cart wheels (visible foreground, not buried at floor) -----
  const trackTex = makeTrackTexture();
  trackTex.wrapS = THREE.RepeatWrapping;
  trackTex.wrapT = THREE.RepeatWrapping;
  trackTex.repeat.set(1, TUNNEL_LEN / 1.6);
  const trackMat = new THREE.MeshBasicMaterial({
    map: trackTex,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const track = new THREE.Mesh(new THREE.PlaneGeometry(2.0, TUNNEL_LEN), trackMat);
  track.rotation.x = -Math.PI / 2;
  // Raised so the rails appear right under the cart's wheels, not 7u below it.
  track.position.set(0, -1.55, WALL_CENTER_Z);
  group.add(track);

  // ----- Screen placeholder planes (all to the side, alternating L/R) -----
  const planes = [];
  for (let i = 1; i <= SCREEN_COUNT; i++) {
    const z = FIRST_SCREEN_Z - (i - 1) * SCREEN_SPACING;
    const isLeft = i % 2 === 1; // 1, 3, 5… on the left
    const x = isLeft ? -SCREEN_X : SCREEN_X;
    const rotY = isLeft ? SCREEN_ROT : -SCREEN_ROT;
    const side = isLeft ? 'left' : 'right';

    const tex = makePlaceholderTexture(i, side);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), mat);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotY;
    mesh.userData = { index: i, side, basePos: mesh.position.clone(), baseRotY: rotY };
    group.add(mesh);
    planes.push(mesh);
  }

  group.visible = false;

  const api = {
    group,
    planes,
    leftMat,
    rightMat,
    floorBaseMat,
    trackMat,
    ceilMat,
    reveal: { v: 0 },

    show(duration = 1.0) {
      group.visible = true;
      gsap.to(api.reveal, { v: 1, duration, ease: 'power1.out' });
    },

    update(dt, time) {
      const r = api.reveal.v;
      leftMat.opacity = r;
      rightMat.opacity = r;
      floorBaseMat.opacity = r;
      ceilMat.opacity = r * 0.85;
      trackMat.opacity = r;
    },
  };

  return api;
}

// -------------------- texture helpers --------------------

// One Minecraft-style dirt block, 16×16 pixels.
function makeDirtTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 16;
  cnv.height = 16;
  const ctx = cnv.getContext('2d');

  // Base brown
  ctx.fillStyle = '#8a6238';
  ctx.fillRect(0, 0, 16, 16);

  // Mid-tone variations — fill ~45% of pixels with assorted browns
  const browns = ['#704a25', '#5d3d1c', '#a07b48', '#7e5630', '#a17b50', '#6f4d2a'];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (Math.random() < 0.55) {
        ctx.fillStyle = browns[Math.floor(Math.random() * browns.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Sprinkle a handful of darker pebbles
  ctx.fillStyle = '#3a2614';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16), 1, 1);
  }

  // A few grey rock pixels — the iconic dirt-block grey flecks
  const greys = ['#7d7d7d', '#969696', '#5a5a5a'];
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = greys[Math.floor(Math.random() * greys.length)];
    ctx.fillRect(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16), 1, 1);
  }

  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeTrackTexture() {
  // 128 wide × 128 tall = one tile representing 2u (X) × 1.6u (Z) of track
  const cnv = document.createElement('canvas');
  cnv.width = 128;
  cnv.height = 128;
  const ctx = cnv.getContext('2d');

  // Dark gravel base
  ctx.fillStyle = '#1a1812';
  ctx.fillRect(0, 0, 128, 128);

  // Gravel sprinkles
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const g = 50 + Math.random() * 60;
    ctx.fillStyle = `rgba(${g}, ${g - 10}, ${g - 20}, 0.55)`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Wood tie (Minecraft-style brown plank) — one tie per tile, centered along V
  const TIE_Y = 32;
  const TIE_H = 40;
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(8, TIE_Y, 112, TIE_H);
  // Top highlight
  ctx.fillStyle = '#7a5026';
  ctx.fillRect(8, TIE_Y, 112, 4);
  // Bottom shadow
  ctx.fillStyle = '#3a2410';
  ctx.fillRect(8, TIE_Y + TIE_H - 4, 112, 4);
  // Wood grain darker lines
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (let y = TIE_Y + 8; y < TIE_Y + TIE_H - 4; y += 10) {
    ctx.fillRect(8, y, 112, 1);
  }

  // Iron rails — two vertical strips. Cart wheels are ~1.4u apart; plane is 2u wide;
  // so rails near canvas x ≈ 22 and ≈ 100 to roughly line up with wheel positions.
  const RAIL_W = 8;
  const RAIL_L = 22;
  const RAIL_R = 128 - RAIL_W - 22; // = 98
  ctx.fillStyle = '#5e6168';
  ctx.fillRect(RAIL_L, 0, RAIL_W, 128);
  ctx.fillRect(RAIL_R, 0, RAIL_W, 128);
  // Rail highlight
  ctx.fillStyle = '#9094a0';
  ctx.fillRect(RAIL_L + 2, 0, 2, 128);
  ctx.fillRect(RAIL_R + 2, 0, 2, 128);
  // Rail shadow
  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(RAIL_L + RAIL_W - 2, 0, 2, 128);
  ctx.fillRect(RAIL_R + RAIL_W - 2, 0, 2, 128);

  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter; // pixelated minecraft look
  return tex;
}

function makePlaceholderTexture(num, side) {
  const cnv = document.createElement('canvas');
  cnv.width = 512;
  cnv.height = 288;
  const ctx = cnv.getContext('2d');

  ctx.fillStyle = 'rgba(6, 10, 18, 0.96)';
  ctx.fillRect(0, 0, cnv.width, cnv.height);

  ctx.fillStyle = 'rgba(0, 255, 208, 0.04)';
  for (let y = 0; y < cnv.height; y += 3) {
    ctx.fillRect(0, y, cnv.width, 1);
  }

  ctx.strokeStyle = 'rgba(0, 255, 208, 0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, cnv.width - 6, cnv.height - 6);

  ctx.strokeStyle = 'rgba(0, 255, 208, 1)';
  ctx.lineWidth = 6;
  const t = 28;
  const corners = [
    [0, 0, 1, 1],
    [cnv.width, 0, -1, 1],
    [0, cnv.height, 1, -1],
    [cnv.width, cnv.height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + t * dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + t * dx, cy);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(230, 247, 255, 0.95)';
  ctx.font = "bold 160px 'VT323', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num).padStart(2, '0'), cnv.width / 2, cnv.height / 2 - 12);

  ctx.fillStyle = 'rgba(0, 255, 208, 0.85)';
  ctx.font = "22px 'JetBrains Mono', monospace";
  ctx.fillText('SIGNAL ' + String(num).padStart(2, '0'), cnv.width / 2, cnv.height / 2 + 84);

  ctx.fillStyle = 'rgba(255, 0, 60, 0.8)';
  ctx.font = "16px 'JetBrains Mono', monospace";
  ctx.textAlign = 'left';
  ctx.fillText(`>> ${side.toUpperCase()}`, 18, 28);

  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
