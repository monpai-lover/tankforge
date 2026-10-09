// Localisation by the browser's language: Chinese (the game's own text) or English. The game
// writes its Chinese strings as before; in English the text that reaches the page (text nodes,
// titles, labels, placeholders, dialogs) and the canvases (fillText) is translated on the way:
// whole strings and the phrases inside composed ones from i18n/en.json, then the full-width
// punctuation. ?lang=en / ?lang=zh, or the language button, overrides the browser.
import EN from './i18n/en.json';

const STORE = 'tankforge.lang';

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return /^zh/i.test(q) ? 'zh' : 'en';
    const s = localStorage.getItem(STORE);
    if (s === 'zh' || s === 'en') return s;
  } catch {
    /* no storage: the browser decides */
  }
  const l = (typeof navigator !== 'undefined' && ((navigator.languages && navigator.languages[0]) || navigator.language)) || 'zh';
  return /^zh/i.test(l) ? 'zh' : 'en';
}

export const LANG = typeof window === 'undefined' ? 'zh' : detect();
/** 0 Chinese, 1 English: the index into [zh, en] label pairs. */
export const LANG_INDEX = LANG === 'en' ? 1 : 0;

/** Switches the language (kept in the browser) and reloads the page. */
export function setLang(lang) {
  try {
    localStorage.setItem(STORE, lang);
  } catch {
    /* storage is a convenience */
  }
  location.reload();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYS = Object.keys(EN).sort((a, b) => b.length - a.length);
const RE = KEYS.length ? new RegExp(KEYS.map(esc).join('|'), 'g') : null;
const CJK = /[　-〿㐀-鿿＀-￯]/;
const PUNCT = [
  ['：', ': '], ['，', ', '], ['。', '. '], ['、', ', '], ['（', ' ('], ['）', ') '], ['「', ' "'], ['」', '" '], ['『', ' "'], ['』', '" '],
  ['！', '! '], ['？', '? '], ['；', '; '], ['　', '  '], ['／', ' / '], ['～', '~'], ['＋', '+'], ['＝', ' = '], ['｜', ' | '],
];
const cache = new Map();
/** Text tr() produced: never translated again (a result that keeps a Chinese character would
 * otherwise be translated over and over by the page observer). */
const made = new Set();

/** The text in the page's language. */
export function tr(s) {
  if (LANG !== 'en' || typeof s !== 'string' || !CJK.test(s) || made.has(s)) return s;
  let r = cache.get(s);
  if (r !== undefined) return r;
  r = EN[s];
  if (r === undefined) {
    r = RE ? s.replace(RE, (m) => ` ${EN[m]} `) : s;
    for (const [a, b] of PUNCT) r = r.split(a).join(b);
    r = r
      .replace(/[ \t]{3,}/g, '  ')
      .replace(/\( +/g, '(')
      .replace(/ +\)/g, ')')
      .replace(/ +([,.:;!?%])/g, '$1')
      .replace(/" +"/g, '""')
      .replace(/^ +| +$/g, '');
    // a string that began or ended with a space keeps it (labels glued to numbers)
    if (/^\s/.test(s)) r = ' ' + r;
    if (/\s$/.test(s)) r += ' ';
  }
  if (cache.size > 8000) {
    cache.clear();
    made.clear();
  }
  cache.set(s, r);
  made.add(r);
  return r;
}

const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

function translateNode(n) {
  if (n.nodeType === 3) {
    const v = n.nodeValue;
    if (v && CJK.test(v)) {
      const t = tr(v);
      if (t !== v) n.nodeValue = t;
    }
    return;
  }
  if (n.nodeType !== 1) return;
  if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
  for (const a of ATTRS) {
    const v = n.getAttribute(a);
    // only when it changes: setting an attribute to the same value still notifies the observer,
    // and a translation that keeps a Chinese character would otherwise loop forever
    if (v && CJK.test(v)) {
      const t = tr(v);
      if (t !== v) n.setAttribute(a, t);
    }
  }
  for (let c = n.firstChild; c; c = c.nextSibling) translateNode(c);
}

/** English pages: translate what is there and whatever the game writes later. */
export function installI18n() {
  if (LANG !== 'en' || typeof document === 'undefined') return;
  document.documentElement.lang = 'en';
  document.title = tr(document.title);
  translateNode(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') {
        const v = m.target.getAttribute(m.attributeName);
        if (v && CJK.test(v)) {
          const t = tr(v);
          if (t !== v) m.target.setAttribute(m.attributeName, t);
        }
      } else for (const n of m.addedNodes) translateNode(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // the HUD, the cards and the hit camera draw their words on canvases
  const C = CanvasRenderingContext2D.prototype;
  for (const f of ['fillText', 'strokeText', 'measureText']) {
    const orig = C[f];
    C[f] = function (text, ...rest) {
      return orig.call(this, tr(String(text)), ...rest);
    };
  }
  for (const f of ['alert', 'confirm', 'prompt']) {
    const orig = window[f];
    if (orig) window[f] = (msg, ...rest) => orig.call(window, tr(String(msg ?? '')), ...rest);
  }
}
