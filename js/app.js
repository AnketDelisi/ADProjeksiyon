// ===== AD Projeksiyon — main app =====
(function(){
'use strict';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let ROOT = null;

// ---------- Global data ----------
let BASE_DATA = [];      // {d,p,base_vote_pct}
let DISTRICTS = [];      // {name,province,seats,norm}
let NATIONAL = {};       // base national (transition-weighted)
let POLLS = [];          // raw poll rows

// ---------- State ----------
const state = {
  userInputs: {...PREDEFINED_SCENARIOS['Anket Delisi Projeksiyon']},
  activeParties: null,
  threshold: 7.0,
  allocation: "D'Hondt (Varsayılan)",
  w18:10, w23:80, w24:10,
  selectedFirms: [],
  alliancesMode: 'standart',
  nie: false,            // no independent
  scenario: 'Anket Delisi Projeksiyon',
  cb: null,
  hataPayi: 0.5,
};
const STATE_CB = 1; // run format
const RUNNABLE = '1';

function setActivePartiesFromInputs(){
  const keys = Object.keys(state.userInputs).filter(p=>Math.round(state.userInputs[p]*100)/100 > 0);
  state.activeParties = OZEL_SIRA.filter(p=>keys.includes(p));
  if (state.activeParties.length===0) state.activeParties = [...OZEL_SIRA];
}

// ---------- Alliances / joint lists ----------
const ALLIANCE_PRESETS = {
  'standart': {"Cumhur İttifakı":["AKP","MHP","BBP","HUDA"],"Emek ve Özgürlük İttifakı":["DEM","TIP"]},
  'emek_ozgurluk': {"Cumhur İttifakı":["AKP","MHP","BBP","HUDA"],"Emek ve Özgürlük İttifakı":["DEM","TIP"],"Millet İttifakı":["CHP","IYI"]},
};
const JOINT_DEFAULT = {"DEM":["TIP"]};

function _alliances(){
  return ALLIANCE_PRESETS[state.alliancesMode] || {};
}
function _jointLists(){
  return state.nie ? {} : JSON.parse(JSON.stringify(JOINT_DEFAULT));
}

// ---------- Normalize user inputs to 100 ----------
function normalizeInputs(){
  const total = Object.values(state.userInputs).reduce((a,b)=>a+(b||0),0);
  if (total<=0) return {...state.userInputs};
  const out = {};
  for (const k in state.userInputs) out[k] = (state.userInputs[k]||0)/total*100;
  return out;
}

// ---------- Base object ----------
function getBaseObj(){
  const seatByNorm = {};
  for (const d of DISTRICTS) seatByNorm[d.norm] = d.seats;
  const map = {};
  for (const r of BASE_DATA) if (r.base_vote_pct!==0) map[r.d+'|'+r.p]=r.base_vote_pct;
  return { base: map, seats: seatByNorm };
}

// ---------- Poll weighting (process_polls port) ----------
const POL_MONTHS = {'Ocak':'01','Şubat':'02','Mart':'03','Nisan':'04','Mayıs':'05','Haziran':'06','Temmuz':'07','Ağustos':'08','Eylül':'09','Ekim':'10','Kasım':'11','Aralık':'12'};
function parseTurkishDate(s){
  s = String(s).split('-').pop().trim();
  for (const tr in POL_MONTHS){ if (s.includes(tr)) { s = s.replace(tr, POL_MONTHS[tr]); break; } }
  const parts = s.split(' ').filter(x=>x);
  if (parts.length===3) return new Date(parts[2], parseInt(parts[1],10)-1, parseInt(parts[0],10));
  if (parts.length===2) return new Date(parts[1], parseInt(parts[0],10)-1, 15);
  return null;
}
function processPolls(){
  if (!POLLS.length) return null;
  const firms = state.selectedFirms.length ? state.selectedFirms : POLLS.map(p=>p.Firma);
  let df = POLLS.filter(p=>firms.includes(p.Firma));
  if (!df.length) return null;
  df = df.map(p=>{ const q={...p}; q._date = parseTurkishDate(p.Tarih); q._mae = parseFloat(String(p.MAE||0).replace(',',','))||0; return q; });
  const valid = df.map(p=>p._mae).filter(m=>m>0);
  const defaultMae = valid.length ? median(valid) : 2.5;
  for (const p of df) p._hmae = (isNaN(p._mae)||p._mae<=0) ? defaultMae*1.25 : p._mae;
  for (const p of df) p._t = 1/p._hmae;
  const maxDate = df.reduce((m,p)=> p._date ? (m? (p._date>m?p._date:m) : p._date) : m, null);
  for (const p of df){
    if (!p._date) p._decay = 0.5;
    else { const days=(maxDate - p._date)/86400000; p._decay = Math.max(0.1, Math.exp(-(Math.log(2)/15.0)*Math.max(0,days))); }
    p._agirlik = p._t * p._decay;
  }
  const meanW = df.reduce((a,p)=>a+p._agirlik,0)/df.length;
  for (const p of df) p._influence = p._agirlik/meanW;
  return df;
}
function median(arr){ const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }

function weightedPollAverages(df){
  const partyCols = BASE_PARTIES.filter(p=> df.some(r=> (r[p]!==undefined && r[p]!==null)));
  const totalW = df.reduce((a,r)=>a+r._agirlik,0);
  const avg = {};
  for (const p of partyCols){
    avg[p] = df.reduce((a,r)=> a + (r[p]||0)*r._agirlik, 0)/ (totalW||1);
  }
  for (const p of BASE_PARTIES) if (avg[p]===undefined) avg[p]=0.5;
  const sum = Object.values(avg).reduce((a,b)=>a+b,0);
  for (const p in avg) avg[p] = avg[p]/sum*100;
  return avg;
}

// ---------- MC (run_mc port) ----------
// District winner by new_vote_pct (recompute per iteration)
function districtWinners(res){
  const win = {};
  for (const r of res){
    if (r.new_vote_pct<=0 && r.seats_won<=0) continue;
    if (!win[r.d] || r.new_vote_pct>win[r.d].np) win[r.d]={p:r.p, np:r.new_vote_pct};
  }
  return win;
}

function runSimulationForInputs(baseObj, userNat, alliances, jointLists){
  return run_simulation(baseObj, NATIONAL, userNat, alliances, jointLists, state.threshold, state.allocation, REGIONAL_BOOSTS_DEFAULT);
}

// ---------- Simulation results for current inputs ----------
function currentResults(){
  const baseObj = getBaseObj();
  const user = normalizeInputs();
  const res = runSimulationForInputs(baseObj, user, _alliances(), _jointLists());
  // national seats
  const nat = {};
  for (const r of res) nat[r.p]=(nat[r.p]||0)+r.seats_won;
  return {res, nat};
}

// ============================================================
// RENDERING
// ============================================================
function renderMeclis(){
  const {res, nat} = currentResults();
  const user = normalizeInputs();
  const view = $('#view'); view.innerHTML='';
  view.appendChild(el('div','kicker tcenter','ANKET DELİSİ PROJEKSİYONU'));
  view.appendChild(el('h1','big-title','MECLİS HEYECANINA'));
  view.appendChild(el('p','sub-line','Anket verilerine dayalı sandalye dağılım projeksiyonu'));

  // Controls
  const ctrl = el('div','card'); ctrl.classList.add('row');
  // scenario select
  const scenBox = el('div','field');
  scenBox.appendChild(el('label',null,'SENARYO'));
  const sel = document.createElement('select'); sel.className='btn';
  for (const name of Object.keys(PREDEFINED_SCENARIOS)){ const o=document.createElement('option'); o.value=name; o.textContent=name; if(name===state.scenario)o.selected=true; sel.appendChild(o); }
  sel.onchange=()=>{ applyScenario(sel.value); };
  scenBox.appendChild(sel); ctrl.appendChild(scenBox);

  // threshold
  const thBox = el('div','field');
  thBox.appendChild(el('label',null,'SEÇİM BARAJI (%7)'));
  thBox.appendChild(sliderField('', '', state.threshold, 1, 10, 0.5, v=>{ state.threshold=v; renderMeclis(); }));
  ctrl.appendChild(thBox);

  // allocation
  const alBox = el('div','field');
  alBox.appendChild(el('label',null,'DAĞILIM SİSTEMİ'));
  const alSel = document.createElement('select'); alSel.className='btn';
  const alOpts = ["D'Hondt (Varsayılan)","Sainte-Laguë","Modifiye Sainte-Laguë","Huntington-Hill (Eşit Orantılar)","Hare Kotası","Droop Kotası","Winner Takes All (Çoğunluk)"];
  for (const a of alOpts){ const o=document.createElement('option'); o.value=a; o.textContent=a; if(a===state.allocation)o.selected=true; alSel.appendChild(o); }
  alSel.onchange=()=>{ state.allocation=alSel.value; renderMeclis(); };
  alBox.appendChild(alSel); ctrl.appendChild(alBox);
  view.appendChild(ctrl);

  // Scenario editor (sliders) collapsed in card
  const edCard = el('div','card');
  edCard.appendChild(el('h2',null,'SENARYO DÜZENLE'));
  const order = OZEL_SIRA.filter(p=> BASE_PARTIES.includes(p));
  const sliders = el('div','two-col');
  for (const p of order){
    const val = state.userInputs[p]||0;
    const f = el('div','field');
    const lab = el('div');
    lab.appendChild(el('span','fw9', p));
    lab.appendChild(el('span','muted',`   %${val.toFixed(1)}`));
    f.appendChild(lab);
    const inp = document.createElement('input'); inp.type='range'; inp.min=0; inp.max=60; inp.step=0.1; inp.value=val;
    const sp = f.querySelector? null : null;
    const numSpan = el('span','tnum fw9 muted'); numSpan.textContent=val.toFixed(1);
    const row = el('div'); row.appendChild(numSpan); row.appendChild(inp);
    inp.oninput=()=>{ numSpan.textContent=parseFloat(inp.value).toFixed(1); };
    inp.onchange=()=>{ state.userInputs[p]=parseFloat(inp.value); renderMeclis(); };
    f.appendChild(row); sliders.appendChild(f);
  }
  edCard.appendChild(sliders);
  const resetBtn = el('button','btn small','SENARYOYU SIFIRLA');
  resetBtn.onclick=()=>{ applyScenario(state.scenario); };
  edCard.appendChild(resetBtn);
  view.appendChild(edCard);

  // Party editor (alliance membership)
  const allocCard = el('div','card');
  allocCard.appendChild(el('h2',null,'İTTİFAK VE ORTAKLIKLAR'));
  const chips = el('div','chips');
  for (const mode of Object.keys(ALLIANCE_PRESETS)){
    const c = el('button','chip', mode==='standart'?'Standart İttifaklar':'Millet+Emek');
    c.classList.toggle('active', state.alliancesMode===mode);
    c.onclick=()=>{ state.alliancesMode=mode; renderMeclis(); };
    chips.appendChild(c);
  }
  allocCard.appendChild(chips);
  const nieChip = el('button','chip','Bağımsız Ortaklıklar Yok');
  nieChip.classList.toggle('active', state.nie);
  nieChip.onclick=()=>{ state.nie=!state.nie; renderMeclis(); };
  allocCard.appendChild(nieChip);
  view.appendChild(allocCard);

  // National summary
  const natCard = el('div','card');
  natCard.appendChild(el('h2',null,'MECLİS DAĞILIMI — SANDALYE'));
  const order2 = [...natPartiesBySeats(nat)];
  for (const p of order2){
    const pct = user[p]||0;
    natCard.appendChild(partyBarRow({party:p, pct, seats:nat[p]||0, color:PARTY_COLORS[p]||'#888'}));
  }
  natCard.appendChild(el('div','tcenter fw9',`Toplam: ${Object.values(nat).reduce((a,b)=>a+b,0)} sandalye · Baraj: 7%`));
  view.appendChild(natCard);

  // District breakdown modal trigger
  const distCard = el('div','card');
  distCard.appendChild(el('h2',null,'İL/SEÇİM ÇEVRESİ KIRILIMI'));
  const provs = groupByProvince(res);
  distCard.appendChild(renderProvinceTiles(provs, nat));
  view.appendChild(distCard);
}

function natPartiesBySeats(nat){
  return Object.keys(nat).filter(p=>(nat[p]||0)>0 || (Object.values(nat).reduce((a,b)=>a+b,0)===0)).sort((a,b)=> (nat[b]||0)-(nat[a]||0));
}

function groupByProvince(res){
  const g = {};
  for (const r of res){
    if (!g[r.province]) g[r.province]={dists:{}, seatTotal:0};
    if (!g[r.province].dists[r.d]) g[r.province].dists[r.d]={rows:[], seats:r.seat_count};
    g[r.province].dists[r.d].rows.push(r);
    g[r.province].seatTotal += r.seat_count;
  }
  return g;
}

function renderProvinceTiles(provs, nat){
  const grid = el('div','two-col');
  for (const prov of Object.keys(provs).sort((a,b)=>provName(a).localeCompare(provName(b)))){
    const pd = provs[prov];
    const tile = el('div','card'); tile.style.boxShadow='var(--shadow-sm)'; tile.style.padding='14px';
    tile.appendChild(el('h2',null, esc(provName(prov))));
    const distsSorted = Object.keys(pd.dists).sort((a,b)=>normalize_id(a).localeCompare(normalize_id(b)));
    for (const d of distsSorted){
      const dd = pd.dists[d];
      const btn = el('button','btn small', esc(distName(d))+' ('+dd.seats+')');
      btn.onclick=()=> openDistrictModal(d, dd);
      tile.appendChild(btn);
      tile.appendChild(el('div',null,' '));
    }
    tile.appendChild(el('div','muted fw9','Toplam: '+Object.values(pd.dists).reduce((a,x)=>a+x.seats,0)));
    grid.appendChild(tile);
  }
  return grid;
}

function openDistrictModal(d, dd){
  const box = el('div');
  box.appendChild(el('h2',null, esc(distName(d)) + ' — '+ dd.seats + ' sandalye'));
  const rows = dd.rows.filter(r=>r.new_vote_pct>0 || r.seats_won>0)
    .sort((a,b)=>b.new_vote_pct-a.new_vote_pct)
    .map(r=>({label:r.p, pct:r.new_vote_pct, seats:r.seats_won, color:PARTY_COLORS[r.p]||'#888'}));
  box.appendChild(districtBarRows(rows));
  const margin = document.createElement('div');
  margin.className='sub-line'; margin.textContent = '';
  makeModal(box);
}

function provName(p){ return get_display_name(p); }
function distName(d){ const p=String(d).replace(/\d+$/,''); const n=String(d).slice(p.length); return get_display_name(p) + (n? ' '+n+'. Bölge':''); }

// ---------- STATE / routing ----------
function applyScenario(name){
  state.scenario=name;
  state.userInputs = {...PREDEFINED_SCENARIOS[name]};
  render();
}
// ---------- OLASILIK (MC) ----------
function renderOlasilik(){
  const view=$('#view'); view.innerHTML='';
  view.appendChild(el('div','kicker tcenter','OLASILIK MODELİ'));
  view.appendChild(el('h1','big-title','MECLİS ÇOĞUNLUĞU OLASILIĞI'));
  view.appendChild(el('p','sub-line','500 simülasyon · anket ağırlıklı Monte Carlo (Dirichlet)'));
  const ctrl=el('div','card'); ctrl.classList.add('row');
  const firmBox=el('div','field');
  firmBox.appendChild(el('label',null,'ANKET FIRMALARI'));
  const chips=el('div','chips');
  const allSelected = state.selectedFirms.length===POLLS.length;
  const aAll=el('button','chip'+(allSelected?' active':''),'TÜMÜ');
  aAll.onclick=()=>{ state.selectedFirms=POLLS.map(p=>p.Firma); renderOlasilik(); };
  chips.appendChild(aAll);
  const firms=[...new Set(POLLS.map(p=>p.Firma))];
  for (const f of firms){
    const c=el('button','chip'+ (state.selectedFirms.includes(f)?' active':''), f);
    c.onclick=()=>{ const i=state.selectedFirms.indexOf(f); if(i>=0) state.selectedFirms=state.selectedFirms.filter(x=>x!==f); else state.selectedFirms=[...state.selectedFirms,f]; renderOlasilik(); };
    chips.appendChild(c);
  }
  firmBox.appendChild(chips); ctrl.appendChild(firmBox);
  const hpBox=el('div','field');
  hpBox.appendChild(el('label',null,'HATA PAYI'));
  hpBox.appendChild(sliderField('','',state.hataPayi,0.1,3,0.1, v=>{state.hataPayi=v;}));
  ctrl.appendChild(hpBox);
  const runBtn=el('button','btn primary','SİMÜLASYONU ÇALIŞTIR');
  runBtn.onclick=()=>{ runMCView(); };
  ctrl.appendChild(runBtn);
  view.appendChild(ctrl);
  if (state.mcResult){
    const R = state.mcResult;
    const muhProb=Math.round(R.muhWins/R.iter*100), cumProb=Math.round(R.cumhurWins/R.iter*100);
    _renderFaceoff(view, muhProb, cumProb, R.muhWins, R.cumhurWins);
    const label = muhProb>=95?'KESİN FAVORİ':muhProb>=75?'GÜÇLÜ FAVORİ':muhProb>=60?'FAVORİ':'KILPAYI ÖNDE';
    const leader = muhProb>=cumProb?'MUHALEFET':'CUMHUR';
    const lcol = muhProb>=cumProb?'#E30A17':'#FF8C00';
    const title = muhProb===cumProb
      ? "MECLİS ÇOĞUNLUĞU <span style='color:#71716E'>BAŞA BAŞ</span>"
      : "MECLİS ÇOĞUNLUĞUNDA <span style='color:"+lcol+"'>"+leader+"</span> "+label;
    const t=el('div','big-title', title); t.style.marginTop='6px'; view.appendChild(t);
    const beeCard=el('div','card'); beeCard.appendChild(el('h2',null,'CUMHUR İTTİFAKI SANDALYE DAĞILIMI (500 SENARYO)'));
    beeCard.appendChild(el('div',null,buildBeeSwarm(R.scatterX, R.scatterColors)));
    view.appendChild(beeCard);
    const confCard=el('div','card'); confCard.appendChild(el('h2',null,'SANDALYE TAHMİNLERİ (95% ARALIK)'));
    confCard.appendChild(buildConfTable(R));
    view.appendChild(confCard);
    const mapMeta = buildMapMeta(R);
    view.appendChild(renderMCMapCard(mapMeta));
  } else {
    view.appendChild(el('p','tcenter muted','Simülasyonu çalıştırmak için yukarıdaki butona basın.'));
  }
}
function _renderFaceoff(view, muhProb, cumProb, muhWins, cumWins){
  const _muh=Math.max(muhProb,1), _cum=Math.max(cumProb,1), tot=_muh+_cum;
  const muhW=(_muh/tot)*100, cumW=(_cum/tot)*100;
  const leader = muhProb>=cumProb?'MUHALEFET':'CUMHUR';
  const lpct = Math.max(muhProb,cumProb);
  const wrap=el('div','faceoff');
  wrap.appendChild(el('div','faceoff-cap','MECLİS ÇOĞUNLUĞU OLASILIĞI'));
  const nums=el('div','faceoff-nums');
  nums.appendChild(el('span',null,'<span style="color:#E30A17;font-size:30px;font-weight:900;">%'+muhProb+'</span> <span style="color:#71716E;font-size:11px;font-weight:900;">MUHALEFET ÇOĞUNLUĞU</span>'));
  nums.appendChild(el('span',null,'<span style="color:#CBD5E1;font-size:20px;font-weight:900;">·</span>'));
  nums.appendChild(el('span',null,'<span style="color:#FF8C00;font-size:30px;font-weight:900;">%'+cumProb+'</span> <span style="color:#71716E;font-size:11px;font-weight:900;">CUMHUR ÇOĞUNLUĞU</span>'));
  wrap.appendChild(nums);
  const bar=el('div','faceoff-bar');
  const bw=el('div','faceoff-fill-wrap');
  const m=el('div','faceoff-fill-muh'); m.style.width=muhW.toFixed(1)+'%';
  const c=el('div','faceoff-fill-cum'); c.style.width=cumW.toFixed(1)+'%';
  bw.appendChild(m); bw.appendChild(c); bar.appendChild(bw);
  bar.appendChild(el('div','faceoff-midline'));
  wrap.appendChild(bar);
  const foot=el('div','faceoff-footer');
  foot.appendChild(el('span',null,'MUHALEFET — '+muhWins+' / 500 senaryo'));
  foot.appendChild(el('span',null,'<b style="color:#1A1A1A;">'+leader+' %'+lpct+'</b>'));
  foot.appendChild(el('span',null,'CUMHUR — '+cumWins+' / 500 senaryo'));
  wrap.appendChild(foot);
  view.appendChild(wrap);
}
function buildConfTable(R){
  const rows=[];
  for (const p of BASE_PARTIES){
    const arr=R.mcSeatsHistory[p];
    if (!arr.length) continue;
    const mean=arr.reduce((a,b)=>a+b,0)/arr.length;
    if (mean>1){
      const sorted=[...arr].sort((a,b)=>a-b);
      const lo=perc(sorted,2.5), hi=perc(sorted,97.5), avg=Math.round(mean);
      rows.push({p, lo, hi, avg, prob:Math.round((R.firstPartyWins[p]||0)/R.iter*100)});
    }
  }
  rows.sort((a,b)=>b.avg-a.avg);
  const tbl=el('table','tbl');
  const thead=document.createElement('thead');
  thead.innerHTML='<tr><th>Parti</th><th style="width:52%;">Beklenen Sandalye (95% Aralık)</th><th style="text-align:right;">1. Parti İhtimali</th></tr>';
  tbl.appendChild(thead);
  const tbody=document.createElement('tbody');
  for (const r of rows){
    const pcol=PARTY_COLORS[r.p]||'#888';
    const loF=Math.max(0,Math.min(1,r.lo/600)), hiF=Math.max(0,Math.min(1,r.hi/600)), avgF=Math.max(0,Math.min(1,r.avg/600));
    const tr=document.createElement('tr');
    const tdParty=document.createElement('td'); tdParty.innerHTML='<span style="color:'+pcol+';font-weight:900;">'+esc(r.p)+'</span>';
    const tdSeat=document.createElement('td');
    tdSeat.innerHTML='<div class="conf-seat"><div class="track"><div style="left:'+(loF*100).toFixed(1)+'%;width:'+((hiF-loF)*100).toFixed(1)+'%;background:'+pcol+';opacity:0.4;position:absolute;top:0;bottom:0;"></div><div class="ruler" style="left:'+(301/600*100).toFixed(1)+'%;"></div><div class="dot" style="left:'+(avgF*100).toFixed(1)+'%;background:'+pcol+';"></div></div><div class="nums"><span class="lo">'+r.lo+'</span><span class="mid">'+r.avg+'</span><span class="hi">'+r.hi+'</span></div></div>';
    const tdProb=document.createElement('td'); tdProb.style.textAlign='right';
    tdProb.innerHTML='<div class="conf-prob"><div class="bar"><div style="height:100%;width:'+Math.min(100,r.prob)+'%;background:'+pcol+';"></div></div><span style="font-weight:900;font-size:13px;width:46px;text-align:right;">%'+r.prob+'</span></div>';
    tr.appendChild(tdParty); tr.appendChild(tdSeat); tr.appendChild(tdProb);
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  return tbl;
}
function perc(sorted,q){ const i=Math.min(sorted.length-1, Math.floor(sorted.length*q/100)); return sorted[i]||0; }
function buildBeeSwarm(xs, colors){
  if (!xs.length) return '<div class="muted">Sonuç yok.</div>';
  const w=920,h=520;
  const xMin=Math.max(0,Math.min(...xs)-10), xMax=Math.min(600,Math.max(...xs)+10);
  const yMax=6, pl=70,pr=40,pt=72,pb=64;
  const sx=v=>pl+(v-xMin)/(xMax-xMin)*(w-pl-pr);
  const sy=v=>pt+(v+yMax)/(2*yMax)*(h-pt-pb);
  let svg='<svg viewBox="0 0 '+w+' '+h+'" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#FFF;">';
  svg+='<rect x="'+sx(0)+'" y="'+pt+'" width="'+(sx(300.5)-sx(0))+'" height="'+(h-pt-pb)+'" fill="#E30A17" opacity="0.08"/>';
  svg+='<rect x="'+sx(300.5)+'" y="'+pt+'" width="'+(sx(600)-sx(300.5))+'" height="'+(h-pt-pb)+'" fill="#FF8C00" opacity="0.08"/>';
  const x301=sx(300.5);
  svg+='<line x1="'+x301+'" y1="'+pt+'" x2="'+x301+'" y2="'+(h-pb)+'" stroke="#1A1A1A" stroke-width="2" stroke-dasharray="6,6"/>';
  svg+='<text x="'+x301+'" y="'+(pt-16)+'" text-anchor="middle" fill="#1A1A1A" font-size="13" font-weight="900">301 ÇOĞUNLUK SINIRI</text>';
  for (let gv=0;gv<=600;gv+=50){ if(gv<xMin||gv>xMax)continue; const gx=sx(gv); svg+='<line x1="'+gx+'" y1="'+pt+'" x2="'+gx+'" y2="'+(h-pb)+'" stroke="#E0E0E0" stroke-width="1" stroke-dasharray="4,4"/><text x="'+gx+'" y="'+(h-pb+22)+'" text-anchor="middle" fill="#71716E" font-size="12" font-weight="700">'+gv+'</text>'; }
  const r=6,step=12,center=sy(0);
  const placed=[];
  const occupied=(px,py)=>{ for(const q of placed){ if(Math.pow(px-q[0],2)+Math.pow(py-q[1],2)<Math.pow(2*r+1,2)) return true; } return false; };
  const order=[...xs.keys()].sort((a,b)=>xs[a]-xs[b]);
  for (const idx of order){
    const xv=xs[idx], cv=colors[idx];
    const jitter=(idx*7919)%5-2;
    const px=sx(xv)+jitter;
    let k=0, cy=center;
    while(k<300){ if(!occupied(px,cy))break; k++; cy=center+(((k+1)>>1)*step)*(k%2?1:-1); if(cy<pt||cy>h-pb){cy=cy<pt?pt:h-pb;break;} }
    cy=Math.max(pt,Math.min(h-pb,cy));
    placed.push([px,cy]);
    const majority=cv==='#FF8C00'?' Cumhur ittifakı çoğunluğu':' muhalefet çoğunluğu';
    svg+='<g><title>'+xv+' sandalye —'+majority+'</title><circle cx="'+px.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+r+'" fill="'+cv+'" stroke="rgba(255,255,255,0.9)" stroke-width="0.6"/></g>';
  }
  svg+='</svg>';
  return svg;
}
function buildMapMeta(R){
  const {distWinPct} = R;
  const heat={}, tips={};
  for (const d in distWinPct){
    const wins=distWinPct[d];
    const top=Object.keys(wins).sort((a,b)=>wins[b]-wins[a])[0];
    heat[d]=get_probability_color(top, wins[top], R.iter);
    const parts=['<div class="tip-header">'+esc(distName(d))+'<span class="tip-total">KAZANMA OLASILIĞI</span></div>'];
    for (const p of Object.keys(wins).sort((a,b)=>wins[b]-wins[a])){
      const pct=wins[p]/R.iter*100;
      if (pct>0) parts.push('<div class="tip-row"><div class="tip-party" style="width:70px;">'+esc(p)+'</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width:'+pct.toFixed(1)+'%;background:'+(PARTY_COLORS[p]||'#888')+';"></div></div><div class="tip-pct">%'+pct.toFixed(1)+'</div></div>');
    }
    tips[d]=parts.join('');
  }
  return {dWin:null, heat, tips};
}
function renderMCMapCard(meta){
  const card=el('div','card');
  card.appendChild(el('h2',null,'KAZANMA OLASILIĞI HARİTASI'));
  const wrap=el('div','map-wrap');
  if (SVG_DATA) wrap.innerHTML = paintedSVG(meta);
  else wrap.appendChild(el('p','muted','Harita yüklenemedi.'));
  card.appendChild(wrap);
  const leg=el('div','legend');
  leg.appendChild(el('span','legend-item','<span class="legend-swatch" style="background:#FDA000;"></span> Kesin (≥%95)'));
  leg.appendChild(el('span','legend-item','<span class="legend-swatch" style="background:#F3B242;"></span> Güçlü (≥%75)'));
  leg.appendChild(el('span','legend-item','<span class="legend-swatch" style="background:#EBC179;"></span> Eğilimli (≥%60)'));
  leg.appendChild(el('span','legend-item','<span class="legend-swatch" style="background:#E4CDA5;"></span> Kılpayı (&gt;%50)'));
  leg.appendChild(el('span','legend-item','<span class="legend-swatch" style="background:#D3D3D3;"></span> Başa baş'));
  card.appendChild(leg);
  return card;
}
function runMCView(){
  const baseObj=getBaseObj();
  const alliances=_alliances(), jointLists=_jointLists();
  const dfPolls=processPolls();
  if(!dfPolls||!dfPolls.length){ state.mcResult=null; renderOlasilik(); return; }
  const weighted=weightedPollAverages(dfPolls);
  const iter=500;
  let cumhurWins=0, muhWins=0;
  const mcSeatsHistory={}; for(const p of BASE_PARTIES)mcSeatsHistory[p]=[];
  const firstPartyWins={}; for(const p of BASE_PARTIES)firstPartyWins[p]=0;
  const districtWinHistory={};
  const scatterX=[],scatterColors=[];
  const seedRng=mulberry32(987654+Math.floor(Math.random()*1000000));
  for(let i=0;i<iter;i++){
    const mix=Object.keys(weighted).filter(p=>weighted[p]>0);
    let mcInputsNorm={};
    if(mix.length){
      const alphas=mix.map(p=>Math.max(weighted[p]/100,1e-6)*(1000/Math.max(0.5,state.hataPayi)));
      const pvals=dirichletSample(alphas,seedRng).map(v=>v*100);
      for(let k=0;k<mix.length;k++) mcInputsNorm[mix[k]]=pvals[k];
    }
    for(const p of BASE_PARTIES) if(mcInputsNorm[p]===undefined) mcInputsNorm[p]=0;
    const res=runSimulationForInputs(baseObj,mcInputsNorm,alliances,jointLists);
    const seats={}; for(const p of BASE_PARTIES)seats[p]=0;
    for(const r of res)seats[r.p]+=r.seats_won;
    for(const p of BASE_PARTIES)mcSeatsHistory[p].push(seats[p]);
    let top=null,tn=-1; for(const p of BASE_PARTIES)if(seats[p]>tn){tn=seats[p];top=p;}
    if(top)firstPartyWins[top]++;
    const wins=districtWinners(res);
    for(const d in wins){ if(!districtWinHistory[d])districtWinHistory[d]={}; districtWinHistory[d][wins[d].p]=(districtWinHistory[d][wins[d].p]||0)+1; }
    const iktidar=seats.AKP+seats.MHP+seats.BBP+seats.YRP+seats.HUDA;
    if(iktidar>=301){cumhurWins++;scatterColors.push('#FF8C00');} else {muhWins++;scatterColors.push('#E30A17');}
    scatterX.push(iktidar);
  }
  state.mcResult={iter,cumhurWins,muhWins,mcSeatsHistory,firstPartyWins,districtWinHistory,scatterX,scatterColors};
  renderOlasilik();
}

function render(){ const tab = currentTab(); if(tab==='meclis') renderMeclis(); else if(tab==='cb') renderCB(); else renderOlasilik(); }
function currentTab(){ const h=location.hash.replace(/^#\/?/,'').split('/')[0]; return (h==='cb'||h==='olasilik')?h:'meclis'; }
window.addEventListener('hashchange',()=>{ updateNav(); render(); });
function updateNav(){ const t=currentTab(); $$('#tabnav a').forEach(a=>a.classList.toggle('active', a.dataset.tab===t)); }

// ---------- CB ----------
function cbPartyWeights(cand){
  if (!state.cb) return {};
  const nominating = String(cand.party||"");
  const votes = cand.votes||{};
  const weights = {};
  for (const gName of Object.keys(CB_GROUPS)){
    const gParties = CB_GROUPS[gName];
    const ratio = (parseFloat(votes[gName])||0)/100.0;
    const multi = gParties.length>1;
    for (const p of gParties){
      let w=ratio;
      if (p===nominating && multi) w=Math.min(1.0, ratio+CB_NOMINATING_BONUS/100.0);
      weights[p]=w;
    }
  }
  for (const cp of customPartiesDef()) weights[cp]=Math.min(1.0,(parseFloat(votes[cp])||0)/100.0);
  return weights;
}
function customPartiesDef(){ return []; }

function cbCompute(cands){
  const userNorm = normalizeInputs();
  const displayUserNat = {...userNorm};
  for (const umbrella in JOINT_DEFAULT) for (const jp of JOINT_DEFAULT[umbrella]){
    displayUserNat[umbrella]=(displayUserNat[umbrella]||0)+(displayUserNat[jp]||0);
    displayUserNat[jp]=0;
  }
  const candData = [];
  for (const cand of cands){
    const nm=String(cand.name||"").trim();
    if (!nm) continue;
    let votes=0;
    for (const p in cbPartyWeights(cand)) votes += (displayUserNat[p]||0)*cbPartyWeights(cand)[p];
    candData.push({name:nm, party:cand.party, votes});
  }
  candData.sort((a,b)=>b.votes-a.votes);
  const cbRes={}, candColor={};
  for (const cd of candData){ cbRes[cd.name]=cd.votes; candColor[cd.name]=PARTY_COLORS[cd.party]||'#888'; }
  const totalCb = Object.values(cbRes).reduce((a,b)=>a+b,0);
  // district-level
  const {res} = currentResults();
  const pivot = {};
  for (const r of res){ if(!pivot[r.d]) pivot[r.d]={}; pivot[r.d][r.p]=r.new_vote_pct; }
  const distVotes = {};
  for (const d in pivot){
    let row={};
    for (const cd of candData){ row[cd.name]=0; }
    for (const cd of candData){
      for (const p in cbPartyWeights(cd)){ if (pivot[d][p]) row[cd.name]+=pivot[d][p]*cbPartyWeights(cd)[p]; }
    }
    distVotes[d]=row;
  }
  // winners & heatmap per district + province (mean by seats weight)
  const dWin={}, heat={}, tips={};
  const provAggr={};
  for (const d in distVotes){
    let win=null,wv=-1; const sorted=Object.entries(distVotes[d]).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]);
    for (const [c,v] of sorted){ if(v>wv){wv=v;win=c;} }
    if (win){ dWin[d]=win; heat[d]=get_heatmap_color(candColor[win]||'#888', clamp(Math.max(0.3,Math.min(1.0,wv/65.0)),0,1)); }
    // tip
    const prov = String(d).replace(/\d+$/,'');
    const tipsParts=[`<div class="tip-header">${esc(distName(d))}</div>`];
    for (const [c,v] of sorted) tipsParts.push(`<div class="tip-row"><div class="tip-party" style="width:100px;">${esc(c)}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width:${Math.min(100,v)}%;background:${candColor[c]||'#888'};"></div></div><div class="tip-pct">%${v.toFixed(1)}</div></div>`);
    tips[d]=tipsParts.join('');
    // province aggregate (mean of district pct)
    if(!provAggr[prov]) provAggr[prov]={};
    for (const c in distVotes[d]){ provAggr[prov][c]=(provAggr[prov][c]||0)+distVotes[d][c]; }
  }
  const pWin={};
  for (const prov in provAggr){ let win=null,wv=-1; const sorted=Object.entries(provAggr[prov]).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]); for(const [c,v] of sorted){if(v>wv){wv=v;win=c;}} if(win){pWin[prov]=win; heat[prov]=get_heatmap_color(candColor[win]||'#888',clamp(Math.max(0.3,Math.min(1.0,wv/65.0)),0,1));} }
  return {cbRes, totalCb, candColor, dWin, pWin, heat, tips, distVotes};
}

function renderCB(){
  const view=$('#view'); view.innerHTML='';
  initCBState();
  view.appendChild(el('div','kicker tcenter','CUMHURBAŞKANLIĞI SEÇİMİ'));
  view.appendChild(el('h1','big-title','CUMHURBAŞKANLIĞI'));
  view.appendChild(el('p','sub-line','Aday bazlı oy dağılımı ve iki turlu seçim simülasyonu'));

  // candidate controls
  const ctrl = el('div','card');
  ctrl.appendChild(el('h2',null,'ADAYLAR'));
  const picks = el('div','row');
  for (const c of state.cb.cands1){
    const box = el('div','field');
    box.appendChild(el('label',null, esc(c.name)));
    const sel = document.createElement('select'); sel.className='btn';
    for (const p of BASE_PARTIES){ const o=document.createElement('option'); o.value=p; o.textContent=p; if(p===c.party)o.selected=true; sel.appendChild(o); }
    sel.onchange=()=>{ c.party=sel.value; renderCB(); };
    box.appendChild(sel); picks.appendChild(box);
  }
  const resetCb = el('button','btn small','VARSYILAN ADAYLAR');
  resetCb.onclick=()=>{ state.cb={...defaultCB()}; renderCB(); };
  ctrl.appendChild(picks); ctrl.appendChild(resetCb);
  view.appendChild(ctrl);

  const R1 = cbCompute(state.cb.cands1);
  const total1 = R1.totalCb;
  const sorted1 = Object.entries(R1.cbRes).sort((a,b)=>b[1]-a[1]);
  const bar1 = sorted1.map(([name,v])=>[name,(v/total1)*100]);
  const max1 = bar1.length?bar1[0][1]:0;
  const winner1Pct = bar1.length?(bar1[0][1]/100)*100:0;

  const r1card = el('div','card');
  r1card.appendChild(el('h2',null,'1. TUR'));
  for (const [name,pct] of bar1){
    const row=el('div','natbar-row');
    const n=el('div','natbar-name'); n.style.color=R1.candColor[name]; n.textContent=name;
    const track=el('div','natbar-track');
    const fill=el('div','natbar-fill'); fill.style.width=Math.min(100,(pct/max1)*100)+'%'; fill.style.background=R1.candColor[name]; track.appendChild(fill);
    const pctEl=el('div','natbar-pct'); pctEl.textContent='%'+pct.toFixed(2);
    row.appendChild(n); row.appendChild(track); row.appendChild(pctEl);
    r1card.appendChild(row);
  }
  r1card.appendChild(el('p','tcenter fw9', winner1Pct>50 ? `KAZANAN: ${bar1[0][0]} — %${winner1Pct.toFixed(2)} (2. tur gerekmez)` : `2. TUR: ${bar1[0][0]} vs ${bar1[1]?bar1[1][0]:'-'}`));
  view.appendChild(r1card);
  view.appendChild(renderMapCard(R1, 'cb1'));

  // Round 2 if no majority
  if (winner1Pct<=50 && bar1.length>=2){
    const c1 = state.cb.cands1.find(c=>c.name===bar1[0][0]);
    const c2 = state.cb.cands1.find(c=>c.name===bar1[1][0]);
    if (c1 && c2){
      initCB2(c1,c2);
      const r2card = el('div','card');
      r2card.appendChild(el('h2',null,'2. TUR (RUNOFF) — '+ esc(c1.name)+' vs '+esc(c2.name)));
      for (const c of state.cb.cands2){
        const g=el('div','field');
        g.appendChild(el('label',null, esc(c.name)+' grup kazanımı'));
        const votes=c.votes||{};
        for (const grp of Object.keys(CB_GROUPS)){
          const f=el('div','field');
          const lab=el('span','fw9',grp); f.appendChild(lab);
          const inp=document.createElement('input'); inp.type='range'; inp.min=0; inp.max=100; inp.step=1; inp.value=votes[grp]||0;
          inp.onchange=()=>{ setCB2Vote(grp, parseFloat(inp.value)); renderCB(); };
          f.appendChild(inp); g.appendChild(f);
        }
        r2card.appendChild(g);
      }
      const set2 = el('button','btn primary','2. TURU HESAPLA');
      set2.onclick=()=>{ computeCB2(); };
      r2card.appendChild(set2);
      view.appendChild(r2card);
    }
  }
}
function defaultCB(){ return {cands1:JSON.parse(JSON.stringify(DEFAULT_CB_CANDS_1)), cands2:[], cb2Done:false}; }
function initCBState(){ if (!state.cb) state.cb=defaultCB(); }
function initCB2(c1,c2){
  if (state.cb.cands2 && state.cb.cands2.length===2 && state.cb.cands2[0].name===c1.name && state.cb.cands2[1].name===c2.name && state.cb.cb2Done) return;
  state.cb.cands2 = [JSON.parse(JSON.stringify(c1)), JSON.parse(JSON.stringify(c2))];
  state.cb.cb2Done=false;
}
function setCB2Vote(grp,val){
  const cands=state.cb.cands2; if(!cands||cands.length!==2) return;
  cands[0].votes[grp]=Math.max(0,Math.min(100,val));
  cands[1].votes[grp]=Math.max(0,100-val);
}
function computeCB2(){
  const R2 = cbCompute(state.cb.cands2);
  state.cb.cb2Done=true;
  const view=$('#view');
  const r2card = el('div','card');
  r2card.appendChild(el('h2',null,'2. TUR SONUCU'));
  const tot=R2.totalCb;
  const sorted=Object.entries(R2.cbRes).sort((a,b)=>b[1]-a[1]);
  for (const [name,v] of sorted){
    const row=el('div','natbar-row');
    const n=el('div','natbar-name'); n.style.color=R2.candColor[name]; n.textContent=name;
    const track=el('div','natbar-track'); const fill=el('div','natbar-fill'); fill.style.width=Math.min(100,(v/tot)*100)+'%'; fill.style.background=R2.candColor[name]; track.appendChild(fill);
    const pctEl=el('div','natbar-pct'); pctEl.textContent='%'+((v/tot)*100).toFixed(2);
    row.appendChild(n); row.appendChild(track); row.appendChild(pctEl); r2card.appendChild(row);
  }
  r2card.appendChild(el('p','tcenter fw9','KAZANAN: '+(sorted[0]?sorted[0][0]:'-')));
  view.appendChild(r2card);
  view.appendChild(renderMapCard(R2,'cb2'));
}
function renderMapCard(meta,uid){
  const card=el('div','card');
  card.appendChild(el('h2',null,'SEÇİM HARİTASI'));
  const wrap=el('div','map-wrap');
  if (SVG_DATA) wrap.innerHTML = paintedSVG(meta);
  else wrap.appendChild(el('p','muted','Harita yüklenemedi.'));
  card.appendChild(wrap);
  // legend
  const leg=el('div','legend');
  for (const [name,col] of Object.entries(meta.candColor)){
    leg.appendChild(el('span','legend-item', '<span class="legend-swatch" style="background:'+col+'"></span> '+esc(name)));
  }
  card.appendChild(leg);
  return card;
}

// ---------- SVG map painting ----------
let SVG_DATA = null;
function paintedSVG({dWin, heat, tips}){
  const doc = new DOMParser().parseFromString(SVG_DATA, 'image/svg+xml');
  const paths = doc.querySelectorAll('path[id]');
  paths.forEach(p=>{
    const id = p.getAttribute('id');
    const norm = normalize_id(id);
    let fill='#EEEEEE';
    if (heat && heat[norm]) fill = heat[norm];
    else if (dWin && dWin[norm]) fill = PARTY_COLORS[dWin[norm]]||'#EEEEEE';
    p.setAttribute('fill', fill);
    p.setAttribute('stroke', '#fff');
    p.setAttribute('stroke-width', '0.6');
    p.classList.add('map-district');
    if (tips && tips[norm]){
      // native SVG tooltip via <title>
      const t = doc.createElementNS('http://www.w3.org/2000/svg','title');
      t.textContent = plainTip(tips[norm]);
      p.appendChild(t);
    }
  });
  return new XMLSerializer().serializeToString(doc);
}
function plainTip(html){
  const holder=document.createElement('div'); holder.innerHTML=html;
  const lines=[];
  holder.querySelectorAll('.tip-title, .tip-header').forEach(e=>lines.push(String(e.textContent).trim()));
  let inHeader=true;
  holder.querySelectorAll('.tip-row').forEach(r=>{
    const name=r.querySelector('.tip-party')?.textContent||'';
    const pct=r.querySelector('.tip-pct')?.textContent||'';
    lines.push(name+'  '+pct);
  });
  return lines.join('\n');
}

// ---------- Boot ----------
async function boot(){
  updateNav();
  const [b,d,n,p,svg] = await Promise.all([
    fetch('data/base.json').then(r=>r.json()),
    fetch('data/districts.json').then(r=>r.json()),
    fetch('data/national.json').then(r=>r.json()),
    fetch('data/polls.json').then(r=>r.json()),
    fetch('data/turkiye.svg').then(r=>r.text())
  ]);
  BASE_DATA=b; DISTRICTS=d; NATIONAL=n; POLLS=p; SVG_DATA=svg;
  // expose for engine.js getters
  window.BASE_DATA=b; window.DISTRICTS=d;
  state.selectedFirms = POLLS.map(x=>x.Firma);
  setActivePartiesFromInputs();
  render();
  window.__runMC = () => runMCView();
  window.__runCB2 = () => computeCB2();
}
if (document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded', boot);

})();
