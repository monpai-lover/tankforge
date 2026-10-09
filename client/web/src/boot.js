import { start } from './main.js';
import { decodeAllImported } from './gfx/imported.js';
import { installI18n } from './i18n.js';

// the page in the browser's language (Chinese, or English for everyone else)
installI18n();

const splash = document.getElementById('boot-splash');
const stage = document.getElementById('boot-stage');
const bar = splash && splash.querySelector('.bar');
/** The start-up screen: a stage line and, when the amount of work is known, a filling bar. */
function progress(text, frac) {
  if (stage) stage.textContent = text;
  if (!bar) return;
  bar.classList.toggle('busy', frac == null);
  bar.firstElementChild.style.width = frac == null ? '' : `${Math.round(frac * 100)}%`;
}
/** Lets the browser paint the start-up screen before the next long step. */
const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot(saved) {
  progress('解析資料中…');
  await paint();
  const data = JSON.parse(document.getElementById('tf-data').textContent);
  // imported vehicle models are unpacked before the garage is built
  progress('解開車輛模型…', 0);
  await paint();
  await decodeAllImported(data.vehicles, (done, total) => progress(`解開車輛模型：${done}/${total}`, total ? done / total : 1)).catch(() => {});
  progress('建立場景…');
  await paint();
  try {
    const app = start(data, saved || {});
    window.claude?.hot?.snapshot?.(() => app.snapshot());
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 400);
    }
  } catch (err) {
    splash?.remove();
    document.getElementById('fatal').hidden = false;
    document.getElementById('fatal-text').textContent = '這個原型需要支援 WebGL2 的瀏覽器（Chrome、Edge、Firefox 或 Safari 的近期版本）。錯誤訊息：' + err.message;
    console.error(err);
  }
}

if (window.claude?.hot?.ready) window.claude.hot.ready(boot);
else boot(window.claude?.hot?.data ?? {});
