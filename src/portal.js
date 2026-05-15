import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Portal rig: a long tube of streaks/matrix code rushing past the camera.
 * In 'entry' phase it idles (hidden / very dim). During 'portal' it rushes forward.
 */
export function createPortalRig() {
  const group = new THREE.Group();

  // ---- Streak tunnel (instanced thin planes flying past camera) ----
  const STREAKS = 1200;
  const streakGeo = new THREE.PlaneGeometry(0.04, 1.6);
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0x9be7ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const streaks = new THREE.InstancedMesh(streakGeo, streakMat, STREAKS);
  streaks.frustumCulled = false;

  const TUBE_RADIUS_MIN = 1.4;
  const TUBE_RADIUS_MAX = 6.0;
  const TUBE_LENGTH = 220;

  const streakState = new Array(STREAKS);
  const tmpObj = new THREE.Object3D();
  for (let i = 0; i < STREAKS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = THREE.MathUtils.lerp(TUBE_RADIUS_MIN, TUBE_RADIUS_MAX, Math.random());
    const z = -Math.random() * TUBE_LENGTH;
    const speed = THREE.MathUtils.lerp(40, 110, Math.random());
    const len = THREE.MathUtils.lerp(0.8, 3.0, Math.random());
    streakState[i] = { angle, radius, z, speed, len };

    tmpObj.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    tmpObj.rotation.set(0, 0, angle + Math.PI / 2);
    tmpObj.scale.set(1, len, 1);
    tmpObj.updateMatrix();
    streaks.setMatrixAt(i, tmpObj.matrix);
  }
  streaks.instanceMatrix.needsUpdate = true;
  group.add(streaks);

  // ---- Matrix-code rain on a cylindrical band ----
  const matrixTex = makeMatrixTexture();
  const codeMat = new THREE.MeshBasicMaterial({
    map: matrixTex,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const codeGeo = new THREE.CylinderGeometry(7.5, 7.5, TUBE_LENGTH, 32, 1, true);
  codeGeo.rotateX(Math.PI / 2);
  const codeCylinder = new THREE.Mesh(codeGeo, codeMat);
  codeCylinder.position.z = -TUBE_LENGTH / 2;
  group.add(codeCylinder);

  // ---- Far glow disc (the "end of the tunnel") ----
  const glowGeo = new THREE.PlaneGeometry(40, 40);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x00ffd0,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.z = -TUBE_LENGTH + 5;
  group.add(glow);

  // ---- State driven by phase ----
  const rig = {
    group,
    streaks,
    codeMat,
    glowMat,
    speedMultiplier: { v: 0.0 }, // 0 = idle, 1+ = rushing
    codeScroll: 0,
    update(dt, time, phase) {
      const mult = this.speedMultiplier.v;

      // Update streaks
      for (let i = 0; i < STREAKS; i++) {
        const s = streakState[i];
        s.z += s.speed * mult * dt;
        if (s.z > 3) {
          s.z = -TUBE_LENGTH + Math.random() * 4;
          s.angle = Math.random() * Math.PI * 2;
          s.radius = THREE.MathUtils.lerp(TUBE_RADIUS_MIN, TUBE_RADIUS_MAX, Math.random());
        }
        // streak length scales with speed
        const stretch = s.len * (1 + mult * 1.5);
        tmpObj.position.set(Math.cos(s.angle) * s.radius, Math.sin(s.angle) * s.radius, s.z);
        tmpObj.rotation.set(0, 0, s.angle + Math.PI / 2);
        tmpObj.scale.set(1, stretch, 1);
        tmpObj.updateMatrix();
        streaks.setMatrixAt(i, tmpObj.matrix);
      }
      streaks.instanceMatrix.needsUpdate = true;

      // Scroll matrix code
      this.codeScroll += dt * (0.05 + mult * 0.6);
      codeMat.map.offset.y = this.codeScroll;

      // Idle pulsing of streak opacity
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.5);
      streakMat.opacity = phase === 'entry' ? 0.35 + 0.1 * pulse : Math.min(1, 0.55 + mult * 0.5);
      codeMat.opacity = phase === 'entry' ? 0.06 + 0.04 * pulse : 0.15 + mult * 0.25;
    },
  };

  return rig;
}

/**
 * Run the portal "ENTER" animation. Returns a Promise resolved when the trip ends.
 */
export function runPortal({ camera, portalRig, fx, overlay, settleFov = 75 }) {
  return new Promise((resolve) => {
    const tl = gsap.timeline({ onComplete: resolve });

    // Camera kick forward + slight roll for the wormhole feel
    tl.fromTo(
      camera.position,
      { z: 0 },
      { z: -40, duration: 2.5, ease: 'power3.in' },
      0
    );
    tl.fromTo(
      camera.rotation,
      { z: 0 },
      { z: Math.PI * 0.25, duration: 2.5, ease: 'sine.inOut' },
      0
    );
    tl.to(camera, { fov: 110, duration: 2.5, ease: 'power3.in', onUpdate: () => camera.updateProjectionMatrix() }, 0);

    // Ramp portal speed
    tl.to(portalRig.speedMultiplier, { v: 1.6, duration: 2.5, ease: 'power2.in' }, 0);

    // Chromatic aberration intensifies
    tl.to(
      fx.chromaPass.uniforms.uAmount,
      { value: 0.018, duration: 2.0, ease: 'power2.in' },
      0
    );
    // Then settles for the tunnel phase
    tl.to(fx.chromaPass.uniforms.uAmount, { value: 0.0035, duration: 0.6, ease: 'power2.out' }, '>');

    // Tunnel "glow" at the end becomes visible mid-trip
    tl.to(portalRig.glowMat, { opacity: 0.7, duration: 1.2, ease: 'power2.in' }, 1.2);
    tl.to(portalRig.glowMat, { opacity: 0.0, duration: 0.5, ease: 'power2.out' }, '>');

    // Camera settles for tunnel phase: reset roll, fov, and bring position to a comfortable spot
    tl.to(camera.rotation, { z: 0, duration: 0.6, ease: 'power2.out' }, 2.5);
    tl.to(camera, { fov: settleFov, duration: 0.6, ease: 'power2.out', onUpdate: () => camera.updateProjectionMatrix() }, 2.5);
    tl.to(camera.position, { z: 0, duration: 0.01 }, 2.5);

    // Ease portal speed back down (tunnel will take over)
    tl.to(portalRig.speedMultiplier, { v: 0.35, duration: 0.6, ease: 'power2.out' }, 2.5);

    // Overlay flash + fade
    tl.to(overlay, { opacity: 1, duration: 0.15, ease: 'power1.in' }, 2.35);
    tl.to(overlay, { opacity: 0, duration: 0.5, ease: 'power2.out' }, 2.6);
  });
}

// -------- helpers --------
function makeMatrixTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 512;
  cnv.height = 1024;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  ctx.font = "20px 'VT323', monospace";
  ctx.textBaseline = 'top';
  const chars = '01アイウエオカキクケコｱｲｳｴｵﾊﾋﾌﾍﾎ#@%&*+=-/<>$2020';
  const cols = 32;
  const colW = cnv.width / cols;
  for (let c = 0; c < cols; c++) {
    const rows = 60 + Math.floor(Math.random() * 60);
    for (let r = 0; r < rows; r++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      // gradient from bright head to dim tail
      const k = r / rows;
      const green = Math.floor(255 * (1 - k * 0.85));
      ctx.fillStyle = `rgba(${Math.floor(green * 0.2)}, ${green}, ${Math.floor(green * 0.7)}, ${1 - k * 0.7})`;
      ctx.fillText(ch, c * colW + 2, r * 18 + Math.random() * 4);
    }
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
