import * as THREE from 'three';
import gsap from 'gsap';

const logoVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const logoFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uChaos;
  varying vec2 vUv;

  float rand(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;

    // Horizontal-band slice glitches (frequency rises with chaos)
    float band = floor(uv.y * 32.0);
    float bandShift = (rand(vec2(band, floor(uTime * 8.0))) - 0.5) * 0.07 * uChaos;
    uv.x += bandShift;

    // Edge RGB split
    vec2 dir = uv - 0.5;
    float aber = 0.004 + uChaos * 0.045;
    vec2 off = dir * aber;

    float r = texture2D(uMap, uv + off).r;
    float g = texture2D(uMap, uv).g;
    float b = texture2D(uMap, uv - off).b;
    vec3 col = vec3(r, g, b);

    // Pixel dropout for the chaos transition
    float dropN = rand(uv * 220.0 + floor(uTime * 30.0));
    float drop = step(dropN, uChaos * 0.45);
    col *= 1.0 - drop;

    // Scanlines
    col *= 0.92 + 0.08 * sin(uv.y * 900.0 + uTime * 4.0);

    // Alpha from texture
    float a = texture2D(uMap, uv).a;
    // Slight glow when stable
    float bloom = (1.0 - uChaos) * 0.25;
    col += col * bloom;

    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

export function createEndScene({ scene, camera, endZ }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // ---- Logo ----
  const logoTex = makeLogoTexture();
  const logoMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: logoTex },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uChaos: { value: 1 },
    },
    vertexShader: logoVertex,
    fragmentShader: logoFragment,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Logo aspect 2048/768 ≈ 2.667 — big plane (was 20×7.5)
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(34, 12.75), logoMat);
  const logoBaseY = 4.4;
  logo.position.set(0, logoBaseY, endZ - 24);
  group.add(logo);

  // ----- Big man-image plane as the centerpiece at the end -----
  const manTex = new THREE.TextureLoader().load('/media/man-image.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    if (t.image && t.image.width && t.image.height) {
      const aspect = t.image.width / t.image.height;
      // Resize the plane to match the loaded image aspect (height stays at ~14u)
      const targetH = 14;
      const targetW = targetH * aspect;
      manPlane.geometry.dispose();
      manPlane.geometry = new THREE.PlaneGeometry(targetW, targetH);
    }
  });
  manTex.colorSpace = THREE.SRGBColorSpace;
  const manMat = new THREE.MeshBasicMaterial({
    map: manTex,
    transparent: true,
    opacity: 0,
    side: THREE.FrontSide,
  });
  const manPlane = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), manMat);
  // Behind the logo + coin, lower portion of view so logo "crowns" it
  manPlane.position.set(0, -2.2, endZ - 30);
  group.add(manPlane);

  // ---- Coin ----
  const coinTex = makeCoinTexture();
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x0a4848,
    metalness: 0.88,
    roughness: 0.35,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: coinTex,
    metalness: 0.55,
    roughness: 0.28,
    emissive: 0x003a30,
    emissiveIntensity: 0.5,
  });
  // CylinderGeometry materials: [side, top, bottom]
  const coinGeo = new THREE.CylinderGeometry(2.6, 2.6, 0.45, 80);
  const coin = new THREE.Mesh(coinGeo, [sideMat, faceMat, faceMat]);

  // Pivot orients the coin so its caps face the camera; then we spin coin.rotation.y
  const coinPivot = new THREE.Group();
  const coinBaseY = -2.6;
  coinPivot.position.set(0, coinBaseY, endZ - 15);
  coinPivot.rotation.x = Math.PI / 2;
  coinPivot.scale.setScalar(0.001);
  coinPivot.visible = false;
  coinPivot.add(coin);
  group.add(coinPivot);

  // ---- Lights for coin ----
  const keyLight = new THREE.PointLight(0x00ffd0, 4.0, 28);
  keyLight.position.set(2.2, 2.5, endZ - 7);
  group.add(keyLight);

  const fillLight = new THREE.PointLight(0xff3c66, 0.9, 22);
  fillLight.position.set(-3, 1, endZ - 9);
  group.add(fillLight);

  const ambient = new THREE.AmbientLight(0x2a2840, 0.55);
  group.add(ambient);

  // ---- Void particles ----
  const VOID_PARTICLES = 600;
  const pGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(VOID_PARTICLES * 3);
  for (let i = 0; i < VOID_PARTICLES; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 60;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 2] = endZ - 5 - Math.random() * 80;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0x88ddff,
    size: 0.08,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const voidParticles = new THREE.Points(pGeo, pMat);
  group.add(voidParticles);

  let active = false;
  const onStartListeners = [];

  return {
    group,
    logo,
    coin,
    coinPivot,
    voidParticles,
    manPlane,

    onStart(cb) { onStartListeners.push(cb); },

    start() {
      if (active) return;
      active = true;
      group.visible = true;

      // Reveal void particles
      gsap.to(pMat, { opacity: 0.45, duration: 1.4, ease: 'power1.out' });

      // Big man-image backdrop fades in first so it's the setting for the rest
      gsap.to(manMat, { opacity: 0.95, duration: 1.4, delay: 0.1, ease: 'power1.out' });

      // Logo materialize
      gsap.to(logoMat.uniforms.uOpacity, {
        value: 1,
        duration: 1.2,
        delay: 0.35,
        ease: 'power1.out',
      });
      gsap.to(logoMat.uniforms.uChaos, {
        value: 0.12,
        duration: 1.8,
        delay: 0.35,
        ease: 'power2.out',
      });

      // Coin enters
      gsap.delayedCall(1.6, () => {
        coinPivot.visible = true;
        gsap.to(coinPivot.scale, {
          x: 1, y: 1, z: 1,
          duration: 1.0,
          ease: 'back.out(1.7)',
        });
      });

      // Fire start hooks (used by main.js to show overlay + swell audio)
      for (const cb of onStartListeners) cb();
    },

    update(dt, time) {
      if (!active) return;
      logoMat.uniforms.uTime.value = time;
      logo.position.y = logoBaseY + Math.sin(time * 0.6) * 0.14;
      if (coinPivot.visible) {
        coin.rotation.y += dt * 1.4;
        coinPivot.position.y = coinBaseY + Math.sin(time * 0.9) * 0.22;
      }
      // Slow particle drift
      const pos = voidParticles.geometry.attributes.position.array;
      for (let i = 0; i < VOID_PARTICLES; i++) {
        pos[i * 3 + 2] += dt * 1.2;
        if (pos[i * 3 + 2] > endZ + 5) {
          pos[i * 3 + 2] = endZ - 85;
        }
      }
      voidParticles.geometry.attributes.position.needsUpdate = true;
    },

    isActive() { return active; },
  };
}

// -------- texture helpers --------

function makeLogoTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 2048;
  cnv.height = 768;
  const ctx = cnv.getContext('2d');
  ctx.clearRect(0, 0, cnv.width, cnv.height);

  ctx.fillStyle = '#e6f7ff';
  ctx.font = '560px "VT323", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 255, 208, 0.55)';
  ctx.shadowBlur = 28;
  ctx.fillText('$2020', cnv.width / 2, cnv.height / 2);

  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}

function makeCoinTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 1024;
  cnv.height = 1024;
  const ctx = cnv.getContext('2d');

  const cx = cnv.width / 2;
  const cy = cnv.height / 2;
  const R = cnv.width / 2;

  // Background radial gradient
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0, '#003a3a');
  grad.addColorStop(0.65, '#001818');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cnv.width, cnv.height);

  // Outer cyan ring
  ctx.strokeStyle = 'rgba(0, 255, 208, 0.95)';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 32, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring
  ctx.strokeStyle = 'rgba(0, 255, 208, 0.45)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 86, 0, Math.PI * 2);
  ctx.stroke();

  // Tick marks around the inner ring
  ctx.strokeStyle = 'rgba(0, 255, 208, 0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r1 = R - 95;
    const r2 = R - 110;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.stroke();
  }

  // Big "2020"
  ctx.fillStyle = '#e6f7ff';
  ctx.font = 'bold 400px "VT323", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 255, 208, 0.75)';
  ctx.shadowBlur = 24;
  ctx.fillText('2020', cx, cy);

  // Bottom label
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0, 255, 208, 0.85)';
  ctx.font = '30px "JetBrains Mono", monospace';
  ctx.fillText('SOLANA · MEMORIAL EDITION', cx, cy + 290);

  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}
