// Star display and the star picker used for ratings. Stars are text, so they scale with the page and print in any colour mode.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Read-only stars for a rating from 0 to 5 (decimals allowed). No rating yet gives grey stars and the word "New".
export function stars(rating, count) {
  const r = Number(rating), has = rating != null && Number.isFinite(r) && r > 0;
  const label = has ? `Rated ${r.toFixed(1)} out of 5${count ? ` from ${count} rating${count === 1 ? '' : 's'}` : ''}` : 'No ratings yet';
  return `<span class="stars" role="img" aria-label="${esc(label)}"><span class="stars-bg" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span><span class="stars-fg" aria-hidden="true" style="width:${has ? Math.max(0, Math.min(5, r)) * 20 : 0}%">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span>`;
}

// "4.5 (12)" or "New", shown next to the stars.
export const ratingText = (rating, count) => (rating != null && Number(rating) > 0 ? `${Number(rating).toFixed(1)}${count ? ` (${count})` : ''}` : 'New');

// Star picker: five radio buttons, keyboard and screen reader friendly. Read the choice with the "rating" radio group.
export function picker(name = 'rating') {
  return `<fieldset class="picker"><legend class="sr">Choose 1 to 5 stars</legend>${[5, 4, 3, 2, 1].map(n =>
    `<input type="radio" name="${name}" id="${name}${n}" value="${n}" class="sr"><label for="${name}${n}" title="${n} star${n === 1 ? '' : 's'}"><span aria-hidden="true">&#9733;</span><span class="sr">${n} star${n === 1 ? '' : 's'}</span></label>`).join('')}</fieldset>`;
}
