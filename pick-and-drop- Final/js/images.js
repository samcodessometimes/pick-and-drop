// Picture helper. Every picture has descriptive alt text, a fixed size (no layout jump), lazy loading,
// and a fallback picture if the file is missing. Importing this module installs the fallback handler.
const FALLBACK = { meal: 'images/fallback/meal.svg', product: 'images/fallback/product.svg', store: 'images/fallback/store.svg' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only same-site relative paths and https links are used as picture sources.
const safe = u => (typeof u === 'string' && (/^images\/[\w./-]+$/.test(u) || /^https:\/\//.test(u))) ? u : '';

// Photographs made by tools/ingest_photos.py live at images/photos/<slot>-800.jpg with -400 and -1200 siblings.
// For those, the browser is offered all three sizes and picks the smallest that is sharp enough.
const PHOTO = /^(images\/photos\/[\w-]+)-800\.jpg$/;

export function img(src, alt, kind = 'store', { w = 400, h = 300, eager = false, sizes = '' } = {}) {
  const url = safe(src) || FALLBACK[kind], m = PHOTO.exec(url);
  const set = m ? ` srcset="${m[1]}-400.jpg 400w, ${m[1]}-800.jpg 800w, ${m[1]}-1200.jpg 1200w" sizes="${esc(sizes || `${w}px`)}"` : '';
  return `<img src="${esc(url)}"${set} alt="${esc(alt)}" width="${w}" height="${h}" data-kind="${esc(kind)}" ${eager ? '' : 'loading="lazy"'} decoding="async">`;
}

// A failed picture is replaced once by the fallback. If the fallback fails too, the picture is hidden.
document.addEventListener('error', e => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || !el.dataset.kind) return;
  const fb = FALLBACK[el.dataset.kind];
  if (fb && !el.src.endsWith(fb) && !el.dataset.failed) { el.dataset.failed = '1'; el.removeAttribute('srcset'); el.removeAttribute('sizes'); el.src = fb; }   // srcset must go or the browser keeps asking for the missing files
  else el.style.visibility = 'hidden';
}, true);

// Wording shown next to illustrated listings so a drawing is never mistaken for the real premises.
export const isIllustration = credit => /illustration/i.test(credit || '');
// Small label on a cover: a drawing says Illustration, a stock photo says Stock photo. Never implies the real premises.
export const pictureBadge = credit => (isIllustration(credit) ? 'Illustration' : /ai-generated/i.test(credit || '') ? 'AI image' : /stock photo/i.test(credit || '') ? 'Stock photo' : '');
export const isPhoto = url => PHOTO.test(url || '');
