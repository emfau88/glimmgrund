import { resources } from "../simulation/colony.js";

const $ = id => document.getElementById(id);
const art = JSON.parse($("assets").textContent);
for (const [key,data] of Object.entries(art)) {
  const bytes=Uint8Array.from(atob(data.slice(data.indexOf(",")+1)),c=>c.charCodeAt(0));
  art[key]=URL.createObjectURL(new Blob([bytes],{type:"image/webp"}));
}
const glyphs = {
  rotate:'<path d="M4 10a8 8 0 1 1 1.4 7m-2.2-5.8 1.1-5.5 4.1 3.4"/><path d="m9 12 3-1.6 3 1.6v3.5L12 17l-3-1.5Zm0 0 3 1.6 3-1.6m-3 1.6V17"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.5 1.5m11.2 11.2 1.5 1.5M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"/>',
  settings:'<path d="m9.3 4 .6-1.5h4.2l.6 1.5 1.6.9 1.7-.2 2.1 3.6-1.1 1.3v1.9l1.1 1.4-2.1 3.6-1.8-.2-1.5.9-.6 1.6H9.9l-.6-1.6-1.5-.9-1.8.2-2.1-3.6 1.1-1.4V9.6L3.9 8.3 6 4.7l1.7.2Z" transform="translate(0 1.2)"/><circle cx="12" cy="12" r="3"/>',
  pause:'<path d="M8.2 5.5v13m7.6-13v13" stroke-width="2.8"/>',
  play:'<path d="m8 5 10 7-10 7Z"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.5.5c0 2-2.8 2.4-2.8 4.3m0 3h.01"/>',
  book:'<path d="M12 6.3C8.6 4.4 5.2 4.5 2.5 5.5v13c3-.9 6.1-.8 9.5 1.1 3.4-1.9 6.5-2 9.5-1.1v-13C18.8 4.5 15.4 4.4 12 6.3Zm0 0v13"/>',
  flag:'<path d="M5 21V4m0 .7C10 1.4 13 8 19 4v10c-6 4-9-2.6-14 .6"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 19v-1a6 6 0 0 1 12 0v1m0-14a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5"/>',
  pick:'<path d="m4.2 20.1 10-12.2 1.8 1.4L6.2 21zM4 5c6.9-2.6 13.4.2 16.9 7.5-5.3-5.1-9-7.3-16.9-7.5Z"/>',
  sprout:'<path d="M12 21v-8M12 15C5.7 16 3 11 3 7c5.8-.5 9.6 2.1 9 8Zm0-3C13.1 6 17 4 21 4c0 5.3-3.1 8.5-9 8Z"/>',
  shield:'<path d="M12 3 4.5 6v5.3c0 4.8 3.2 8.2 7.5 10 4.3-1.8 7.5-5.2 7.5-10V6Z"/><path d="m8.6 11.8 2.3 2.3 4.6-4.7"/>',
  beetle:'<path d="m8.8 5.6-2-2m8.4 2 2-2M7 10 3 8m4 6H2.8m5 3.2-3.2 2.6M17 10l4-2m-4 6h4.2m-5 3.2 3.2 2.6"/><ellipse cx="12" cy="13.8" rx="5.6" ry="7"/><path d="M8.9 7.8a3.1 3.1 0 1 1 6.2 0M12 10v10.3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="2"/>',
  pointer:'<path d="m5 3 13 9-6 .9-2.3 6Z"/>',
  home:'<path d="m3 11 9-8 9 8m-15-1v10h12V10m-8 10v-6h4v6"/>',
  gem:'<path d="m8 3 8 0 5 6-9 12L3 9Zm-5 6h18m-13-6 4 18 4-18"/>',
  hammer:'<path d="m3 20 9-10 2 2-9 10ZM10 7l4-4c3-.5 5 1 6 3l-2 .2-1.5 2L19 11l-3 3Z"/>',
  eye:'<path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', check:'<path d="m4 12 5.5 5.5L20 6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sound:'<path d="M3 9h4l5-4v14l-5-4H3Zm12 .1a4 4 0 0 1 0 5.8m2.8-8.6a8 8 0 0 1 0 11.4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'
};
const icon = name => '<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(glyphs[name] || glyphs.gem)+'</svg>';
const img = (key,cls="") => '<img class="'+cls+'" src="'+art[key]+'" alt="" draggable="false">';
const escape = value => String(value).replace(/[&<>"']/g, t => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[t]));
const costHTML = amounts => '<span class="cost">'+Object.entries(amounts).map(([s,n])=>'<span>'+img(s)+'<b>'+n+'</b> '+resources[s]+'</span>').join("")+'</span>';
const signed = n => (n>0?"+":"")+n;
const fact = (label,value) => '<div class="fact"><span>'+label+'</span><b>'+value+'</b></div>';
const primary = (action, label, disabled=false) => '<button class="primary" data-action="'+action+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
const secondary = (action,label) => '<button class="secondary" data-action="'+action+'">'+label+'</button>';

export { $, art, icon, img, escape, costHTML, signed, fact, primary, secondary, glyphs };
