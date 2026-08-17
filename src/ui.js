import { COPY, SOCIAL, TOKEN, UI_REVEAL_AT } from './config.js';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/** 7xKXtg2C…9vNqAo3s — enough to eyeball, never enough to retype. */
const shorten = (addr) =>
  addr.length > 18 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API needs a secure context; fall back for plain http hosts
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function createUI() {
  const root = document.getElementById('ui');
  const boot = document.getElementById('boot');
  const bootBtn = boot.querySelector('.boot-btn');
  const bootStatus = boot.querySelector('.boot-status');

  const brand = el('h1', 'wordmark reveal', COPY.wordmark);
  root.appendChild(brand);

  const bar = el('nav', 'bar reveal');

  /* -------------------------------------------------- contract address -- */
  const hasContract = !!TOKEN.contract;
  const ca = el('button', 'glass ca');
  ca.type = 'button';
  ca.innerHTML = hasContract
    ? `<span class="ca-tag">${TOKEN.label}</span><span class="ca-val">${shorten(
        TOKEN.contract
      )}</span><span class="ca-act">copy</span>`
    : `<span class="ca-tag">${TOKEN.label}</span><span class="ca-val">coming soon</span>`;
  if (!hasContract) ca.classList.add('is-idle');

  if (hasContract) ca.title = TOKEN.contract;

  let resetTimer;
  ca.addEventListener('click', async () => {
    if (!hasContract) return;
    const ok = await copyText(TOKEN.contract);
    const act = ca.querySelector('.ca-act');
    const val = ca.querySelector('.ca-val');

    ca.classList.toggle('is-copied', ok);
    ca.classList.toggle('is-failed', !ok);
    act.textContent = ok ? 'copied' : 'select all & copy';
    // If the clipboard is unavailable (insecure origin, denied permission,
    // an in-app webview), don't leave them stuck with a truncated address —
    // show the whole thing and select it so ⌘C still works.
    val.textContent = ok ? shorten(TOKEN.contract) : TOKEN.contract;
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(val);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    clearTimeout(resetTimer);
    resetTimer = setTimeout(
      () => {
        ca.classList.remove('is-copied', 'is-failed');
        act.textContent = 'copy';
        val.textContent = shorten(TOKEN.contract);
      },
      ok ? 1800 : 6000
    );
  });
  bar.appendChild(ca);

  /* ------------------------------------------------------------- socials */
  const x = el('a', 'glass icon');
  x.href = SOCIAL.x;
  x.target = '_blank';
  x.rel = 'noopener noreferrer';
  x.setAttribute('aria-label', 'Follow on X');
  x.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-7.1 8.1L23.2 22h-6.6l-5.2-6.8L5.5 22H2.4l7.6-8.7L1.2 2h6.8l4.7 6.2L18.9 2Zm-1.1 18h1.7L7.4 3.8H5.6L17.8 20Z"/></svg>`;
  bar.appendChild(x);

  /* --------------------------------------------------------------- sound */
  // The track autoplays on entry, so a way to silence it is not optional.
  const sound = el('button', 'glass icon');
  sound.type = 'button';
  sound.setAttribute('aria-label', 'Toggle sound');
  sound.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"/>
      <path class="wave" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
            d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.6a8 8 0 0 1 0 10.8"/>
      <path class="slash" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.5 9.5 21 15"/>
    </svg>`;
  bar.appendChild(sound);

  root.appendChild(bar);

  let revealed = false;
  let lastBeat = -1;
  let onSound = null;

  return {
    ready(onStart) {
      bootStatus.textContent = 'ready';
      boot.classList.add('is-ready');
      bootBtn.disabled = false;
      bootBtn.addEventListener(
        'click',
        () => {
          boot.classList.add('is-gone');
          setTimeout(() => (boot.style.display = 'none'), 900);
          onStart();
        },
        { once: true }
      );
    },

    /** main.js hands us the mute toggle so the button can drive it. */
    onSoundToggle(fn) {
      onSound = fn;
      sound.addEventListener('click', () => this.setMuted(fn()));
    },

    tick(t, g) {
      if (!revealed && t >= UI_REVEAL_AT) {
        revealed = true;
        root.classList.add('is-revealed');
      }
      if (!revealed) return;
      // one very faint bloom of light on each kick — ties the flat DOM layer
      // to the music without putting a readout on screen
      if (g.beatIndex !== lastBeat) {
        lastBeat = g.beatIndex;
        document.body.classList.remove('kick');
        void document.body.offsetWidth;
        document.body.classList.add('kick');
      }
    },

    setMuted(muted) {
      document.body.classList.toggle('is-muted', muted);
      sound.setAttribute('aria-pressed', String(muted));
    },
  };
}
