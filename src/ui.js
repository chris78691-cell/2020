const CONTRACT_ADDRESS = '72Vzu6enhspZ9YPi7zZ2FD1pkWCaiyjnGGZ5k5i3pump';

export function setupUI({ audioMgr }) {
  const root = document.getElementById('ui');
  const caPill = document.getElementById('ca-pill');
  const menuBtn = document.getElementById('menu-btn');
  const sidePanel = document.getElementById('side-panel');
  const panelClose = document.getElementById('panel-close');
  const panelCa = document.getElementById('panel-ca');
  const muteToggle = document.getElementById('mute-toggle');
  const backdrop = sidePanel.querySelector('.side-panel__backdrop');

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for older browsers / unsafe contexts
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function flashCopied(el) {
    el.classList.add('is-copied');
    clearTimeout(el.__copiedTimer);
    el.__copiedTimer = setTimeout(() => el.classList.remove('is-copied'), 1400);
  }

  // Copy on click — both pill and panel CA
  caPill.addEventListener('click', async () => {
    const ok = await copyToClipboard(CONTRACT_ADDRESS);
    if (ok) flashCopied(caPill);
  });
  panelCa.addEventListener('click', async () => {
    const ok = await copyToClipboard(CONTRACT_ADDRESS);
    if (ok) flashCopied(panelCa);
  });

  // Side panel toggle
  function openPanel() {
    sidePanel.classList.add('is-open');
    sidePanel.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closePanel() {
    sidePanel.classList.remove('is-open');
    sidePanel.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  function togglePanel() {
    if (sidePanel.classList.contains('is-open')) closePanel();
    else openPanel();
  }

  menuBtn.addEventListener('click', togglePanel);
  panelClose.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  // Escape closes panel
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidePanel.classList.contains('is-open')) {
      closePanel();
    }
  });

  // Mute toggle
  muteToggle.addEventListener('change', (e) => {
    if (audioMgr?.setMuted) audioMgr.setMuted(e.target.checked);
  });

  return {
    show() {
      root.classList.add('is-visible');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      root.classList.remove('is-visible');
      root.setAttribute('aria-hidden', 'true');
      closePanel();
    },
    openPanel,
    closePanel,
  };
}
