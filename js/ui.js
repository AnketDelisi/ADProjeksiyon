// ===== Shared UI helpers =====
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function el(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }

// Slider field with number + range
function sliderField(label, id, val, min, max, step, oninput){
  const wrap = el('div','field');
  wrap.appendChild(el('label',null,esc(label)));
  const num = el('span','slider-num muted fw9'); num.textContent = String(val);
  const row = el('div');
  const inp = document.createElement('input');
  inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=val;
  inp.addEventListener('input',()=>{ num.textContent = inp.value; if(oninput) oninput(parseFloat(inp.value)); });
  row.appendChild(inp);
  const holder = el('div','slider-row'); holder.appendChild(num); holder.appendChild(row);
  wrap.appendChild(holder);
  return wrap;
}

// Party bar row (used in national tab and elsewhere)
function partyBarRow({party, pct, seats, color, nameWidth=92}){
  const row = el('div','natbar-row');
  const name = el('div','natbar-name'); name.style.color = color; name.textContent = party;
  const track = el('div','natbar-track');
  const fill = el('div','natbar-fill'); fill.style.width = Math.min(100,pct)+'%'; fill.style.background = color; fill.style.opacity='0.8';
  track.appendChild(fill);
  const seatsEl = el('div','natbar-seats'); seatsEl.textContent = seats !== undefined ? String(seats) : '';
  const pctEl = el('div','natbar-pct'); pctEl.textContent = '%'+(pct).toFixed(1);
  row.appendChild(name); row.appendChild(track); row.appendChild(seatsEl); row.appendChild(pctEl);
  return row;
}

// District bar rows (drilldown list)
function districtBarRows(rows){
  const box = el('div');
  for (const r of rows){
    const item = el('div','natbar-row');
    const name = el('div','natbar-name'); name.textContent = r.label; name.style.color=r.color; name.style.fontSize='12px';
    const track = el('div','natbar-track'); track.style.height='12px';
    const fill = el('div','natbar-fill'); fill.style.width=Math.min(100,r.pct)+'%'; fill.style.background=r.color;
    track.appendChild(fill);
    const seatsEl = el('div','natbar-seats'); seatsEl.textContent = String(r.seats);
    const pctEl = el('div','natbar-pct'); pctEl.textContent = '%'+r.pct.toFixed(1);
    item.appendChild(name); item.appendChild(track); item.appendChild(seatsEl); item.appendChild(pctEl);
    box.appendChild(item);
  }
  return box;
}

function svgTooltip(title, bodyHtml){ return `<div class="tip-header">${title}<span class="tip-total">${bodyHtml}</span></div>`; }

function makeModal(inner){
  const root = document.getElementById('modal-root');
  root.innerHTML='';
  const overlay = el('div','modal-overlay');
  const modal = el('div','modal');
  const close = el('button','btn small', '✕'); close.className='btn small modal-close';
  close.onclick = ()=>{ root.innerHTML=''; };
  overlay.onclick = (e)=>{ if(e.target===overlay) root.innerHTML=''; };
  modal.appendChild(close); modal.appendChild(inner);
  overlay.appendChild(modal); root.appendChild(overlay);
}
