// ===== AD Projeksiyon — static main app (full-fidelity port of app.py MECLİS) =====
(function(){
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ---------------- data holders ----------------
let YEARS = [];                 // base_years.json rows {d,p,v18,v23,v24}
let DISTRICTS = [];             // districts.json rows {name,province,seats,norm}
let SVG_TURKIYE = "";           // turkiye.svg raw
let POLLS_RAW = [];             // polls.json rows {Firma,Tarih,MAE,<party cols>}
let FIRM_NAMES_JS = [];         // unique sorted Firma list from polls
let ILCE_NAMES = null;          // ilce_names.json {provinces:{p|i:name}, global:{i:name}}
let SVG_TURKIYE2 = "";          // turkiye2.svg raw (province-level map)
let YEREL_2024 = null;          // yerel_2024.json {provinces:{p:{party:pct}}, nat, winners}
let BUYUKSEHIR = {};            // set of büyükşehir province norm ids
let YEREL_TARGETS = null;       // yerel_targets.json: alias (YENI->CHP) winner scoring; defections baked into base at generation
let BELEDIYE_MECLIS = null;     // belediye_meclis.json {provNorm: councilSeats}
const ILCE_CACHE = {};          // prov -> {norm:{name,parties:{P:{v18,v23,v24}}}}
const ILCE_SVG_CACHE = {};      // prov -> raw svg

// Accented ilçe display name for a normalized ilçe id within a province.
function getIlceName(provNorm, ilceNorm){
  if (ILCE_NAMES && ILCE_NAMES.provinces){
    const pk = (provNorm||'') + '|' + (ilceNorm||'');
    if (ILCE_NAMES.provinces[pk]) return ILCE_NAMES.provinces[pk];
  }
  if (ILCE_NAMES && ILCE_NAMES.global && ILCE_NAMES.global[ilceNorm]) return ILCE_NAMES.global[ilceNorm];
  return to_tr_title(ilceNorm);
}

window.BASE_YEARS = [] ; window.DISTRICTS = [];

// 538 / OLASILIK constants (mirror app.py POLL_NON_PARTY)
const POLL_NON_PARTY_LABELS = ['Firma','Tarih','Tarih_Formatli','MAE','Hesaplanan_MAE','Temel_Agirlik','Decay_Carpani','Ağırlık','Influence'];
const POLL_MONTHS = { 'Ocak':'01','Şubat':'02','Mart':'03','Nisan':'04','Mayıs':'05','Haziran':'06','Temmuz':'07','Ağustos':'08','Eylül':'09','Ekim':'10','Kasım':'11','Aralık':'12' };
const POLL_MONTH_SHORT_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];



// ---------------- state (mirror ElectionState) ----------------
const state = {
  activeParties: [...OZEL_SIRA],
  userInputs: {...PREDEFINED_SCENARIOS['Anket Delisi Projeksiyon']},
  scenario: 'Anket Delisi Projeksiyon',
  w18:10, w23:80, w24:10,
  threshold:7.0,
  allocation:"D'Hondt (Varsayılan)",
  allianceList:[
    {id:'aly_1', name:'Cumhur İttifakı', parties:['AKP','MHP','BBP','HUDA'], sel:''},
    {id:'aly_2', name:'Emek ve Özgürlük İttifakı', parties:['DEM','TIP'], sel:''}
  ],
  nextAlyId:3,
  jointList:[{id:'jl_0', parties:['AKP','HUDA'], sel:''}],
  nextJlId:1,
  customPartiesDef:{},
  customPartyName:"",
  customPartyColor:"#610030",
  customPartyBasePcts:{},
  customPartyBaseSel:"AKP",
  mapMode:"1. Partiler (Varsayılan)",
  targetPartySwing:"AKP",
  swingOpps:[], swingRisks:[],
  detailProv:"",               // normalized province selected
  detailIlce:"",               // normalized ilce selected
  collapse:{ittifak:true, ortak:true, yeni:true, firsat:true},
  cb:null,
  selectedFirms:[],
  hataPayi:2.0,
  mc:{running:false, titleHtml:"", faceoffHtml:"", confTableHtml:"", beeSvg:"", mapHtml:"", provRatings:[], tierFilter:"TÜMÜ"},
  yerelW24:0, yerelFlow:10, yerelPopBoost:0, yerelAlliances:null, yerelMatrix:null, yerelResults:null, yerelProv:"", yerelOverrides:{}, yerelPop:{},
  pollTableHtml:"",
  trendSvg:"",
  // computed after each run
  simResults:[],   // [{party, seats_won}]
  fullResults:[],  // [{d,p,new_vote_pct,seats_won,province,seat_count}]
  baseNat:{},      // national base (this sim)
  mapHtml:"",
  parliamentHtml:"",
  summaryRows:[],
  provResultsHtml:"",
  // detail
  detailProvSummary:[], detailTabLabels:[], detailBarsMap:{}, detailActiveTab:"İl Geneli (Toplam)",
  detailCityMapHtml:"", detailIlceBars:[], detailDistTableHeaders:[], detailDistTableData:[], detailIlSvg:""
};

function allParties(){ return _allParties(state.customPartiesDef); }
function alliancesObj(){ return _alliances();
}
function _alliances(){
  const allP = allParties();
  const out = {};
  for (const a of state.allianceList){ if (a.name.trim() && a.parties.length) out[a.name] = a.parties.filter(p=>allP.includes(p)); }
  return out;
}
function jointListsObj(){
  const allP = allParties();
  const out = {};
  for (const jl of state.jointList){ if (jl.parties.length>1) out[jl.parties[0]] = jl.parties.slice(1).filter(p=>allP.includes(p)); }
  return out;
}
function userNorm(){
  const total = Object.values(state.userInputs).reduce((a,b)=>a+(b||0),0);
  if (total<=0) return {};
  const out = {};
  for (const p of allParties()) out[p] = (state.userInputs[p]||0)/total*100;
  return out;
}
function displayUserNat(){
  const un = userNorm(); const jl = jointListsObj();
  const out = {...un};
  for (const um of Object.keys(jl)) for (const jp of jl[um]){ out[um]=(out[um]||0)+(out[jp]||0); out[jp]=0; }
  return out;
}
function baseRowsFromObj(baseObj){
  // rebuild base_df rows {district, party, base_vote_pct, seat_count}
  const rows = [];
  for (const key of Object.keys(baseObj.base)){
    const parts = key.split('|');
    rows.push({district:parts[0], party:parts[1], base_vote_pct: baseObj.base[key], seat_count: baseObj.seats[parts[0]]||0});
  }
  return rows;
}

// ---------------- logo helper ----------------
function logoURL(p){ return 'data/logos/'+encodeURIComponent(p)+'.svg'; }
function logoImg32(p, altClass){
  return `<div class="final-logo" style="background:${PARTY_COLORS[p]||'#888'}"><img src="${logoURL(p)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><span style="display:none;${altClass||''}">${esc(p)}</span></div>`;
}

// ---------------- run simulation (national) ----------------
function runSimulation(){
  const un = userNorm();
  if (Object.values(un).reduce((a,b)=>a+b,0)<=0) return;
  const baseObj = _weightedBase(state.w18, state.w23, state.w24, state.customPartiesDef);
  const allP = allParties();
  state.baseNat = baseObj.nat;
  const res = run_simulation(baseObj, baseObj.nat, un, alliancesObj(), jointListsObj(), state.threshold, state.allocation, REGIONAL_BOOSTS_DEFAULT, allP);
  state.fullResults = res;
  const seats = {};
  for (const r of res) seats[r.p]=(seats[r.p]||0)+r.seats_won;
  state.simResults = allP.filter(p=>(seats[p]||0)>0 || (un[p]||0)>0).map(p=>({party:p, seats_won:seats[p]||0}));
  state.simResults.sort((a,b)=>b.seats_won-a.seats_won);

  // map
  state.mapHtml = buildMapHtml(res, 'genel', 'hidden_prov_input', 'prov_detail_section');

  // swing analysis
  computeSwing(baseObj, un);

  // summary
  state.summaryRows = nationalSummaryRows();

  // parliament
  state.parliamentHtml = parliamentSvg();

  // province results table
  state.provResultsHtml = buildProvinceResultsHtml();

  if (state.detailProv) setDetailProvince(state.detailProv);
  renderCurrentTab();
}
function renderCurrentTab(){
  const t=currentTab();
  if (t==='tab_cb') renderCB();
  else if (t==='tab_538') renderOlasilik();
  else renderMeclis();
}

function computeSwing(baseObj, un){
  const mult = {};
  for (const p of allParties()) mult[p] = baseObj.nat[p] ? (un[p]||0)/baseObj.nat[p] : 0;
  const jl = jointListsObj();
  const qual = _get_qualified_parties(displayUserNat(), alliancesObj(), state.threshold, allParties());
  const opps = [], risks = [];
  const seatMap = {};
  for (const d of Object.keys(baseObj.seats)) seatMap[d] = baseObj.seats[d];
  const byDist = {};
  for (const r of state.fullResults){ if (!byDist[r.d]) byDist[r.d]={}; byDist[r.d][r.p]=r.new_vote_pct; }
  const baseByDist = {};
  for (const r of baseRowsFromObj(baseObj)){ if (!baseByDist[r.district]) baseByDist[r.district]={}; baseByDist[r.district][r.party]=r.base_vote_pct; }
  for (const d of Object.keys(baseByDist)){
    const seatCount = seatMap[d]||0;
    if (seatCount<=0) continue;
    const b = baseByDist[d];
    const nv = {};
    for (const p of Object.keys(b)) nv[p] = b[p]*(mult[p]||1);
    let tot = Object.values(nv).reduce((a,v)=>a+v,0)||1;
    for (const p of Object.keys(nv)) nv[p] = nv[p]/tot*100;
    for (const um of Object.keys(jl)) if (nv[um]!==undefined) for (const jp of jl[um]) if (nv[jp]!==undefined){ nv[um]+=nv[jp]; nv[jp]=0; }
    const eligible = {};
    for (const p of Object.keys(nv)) if (qual.has(p) && nv[p]>0) eligible[p]=nv[p];
    if (!Object.keys(eligible).length) continue;
    const quotients = [];
    for (const p of Object.keys(eligible)) for (let i=1;i<=seatCount+1;i++) quotients.push({party:p, quotient: eligible[p]/i});
    quotients.sort((a,b)=>b.quotient-a.quotient);
    if (quotients.length >= seatCount+1){
      const lastW = quotients[seatCount-1], firstL = quotients[seatCount];
      const margin = lastW.quotient-firstL.quotient;
      if (lastW.party===state.targetPartySwing){
        risks.push({district:get_display_label(d), rakip:firstL.party, desc:`${firstL.party}'den %${margin.toFixed(2)} farkla kurtarıldı.`, margin});
      } else if (firstL.party===state.targetPartySwing){
        opps.push({district:get_display_label(d), rakip:lastW.party, desc:`${lastW.party}'ye %${margin.toFixed(2)} farkla kaybedildi.`, margin});
      }
    }
  }
  opps.sort((a,b)=>a.margin-b.margin);
  risks.sort((a,b)=>a.margin-b.margin);
  state.swingOpps = opps.slice(0,8);
  state.swingRisks = risks.slice(0,8);
}

// ---------------- national summary (port national_summary var) ----------------
const BASE_VOTES_2023 = {'AKP':35.6,'CHP':25.3,'MHP':10.1,'IYI':9.7,'DEM':8.8,'YRP':2.8,'ZAFER':2.2,'TIP':1.8,'BBP':1.0};
const BASE_SEATS_2023 = {'AKP':268,'CHP':169,'DEM':61,'MHP':50,'IYI':43,'YRP':5,'TIP':4};

function nationalSummaryRows(){
  if (!state.simResults.length) return [];
  const dUn = displayUserNat();
  const jl = jointListsObj();
  const adjBaseV = {...BASE_VOTES_2023}, adjBaseS = {...BASE_SEATS_2023};
  for (const um of Object.keys(jl)) for (const jp of jl[um]){
    adjBaseV[um]=(adjBaseV[um]||0)+(adjBaseV[jp]||0);
    adjBaseS[um]=(adjBaseS[um]||0)+(adjBaseS[jp]||0);
  }
  const seatMap = {}; for (const r of state.simResults) seatMap[r.party]=r.seats_won;
  let entities = null;
  if (state.mapMode==="İttifak Renklendirmesi"){
    const keyset = new Set([...Object.keys(dUn), ...Object.keys(seatMap)]);
    const badges = partyAbbrevColor(keyset, p=>dUn[p]||0);
    // zeroed joint-adjusted bases so alliance sums don't double-count joiners
    const baseV0={...BASE_VOTES_2023}, baseS0={...BASE_SEATS_2023};
    for (const um of Object.keys(jl)) for (const jp of jl[um]){
      baseV0[um]=(baseV0[um]||0)+(baseV0[jp]||0); baseV0[jp]=0;
      baseS0[um]=(baseS0[um]||0)+(baseS0[jp]||0); baseS0[jp]=0;
    }
    const gv={},gs={},gc={},grep={},gBaseV={},gBaseS={};
    for (const p of keyset){
      const [ab,col] = badges.get(p) || [p, PARTY_COLORS[p]||'#888'];
      const v = dUn[p]||0, s = seatMap[p]||0;
      if (v<=0 && s<=0) continue;
      gv[ab]=(gv[ab]||0)+v; gs[ab]=(gs[ab]||0)+s; gc[ab]=col;
      gBaseV[ab]=(gBaseV[ab]||0)+(baseV0[p]||0);
      gBaseS[ab]=(gBaseS[ab]||0)+(baseS0[p]||0);
      if (!badges.has(p)) grep[ab]=p;
      else if (grep[ab]===undefined || (dUn[p]||0)>(dUn[grep[ab]]||0)) grep[ab]=p;
    }
    entities = Object.keys(gv);
    const rows = entities.map(ab=>{
      const votePct=gv[ab], seats=gs[ab], col=gc[ab];
      return summaryItem(ab, seats, votePct, col, gBaseV[ab]||0, gBaseS[ab]||0, dUn, grep[ab]||ab);
    });
    return rankize(rows);
  }
  const rows = [];
  for (const r of state.simResults){
    const p=r.party, seats=r.seats_won;
    const v = dUn[p]||0;
    if (v<=0 && seats===0) continue;
    rows.push(summaryItem(p, seats, v, PARTY_COLORS[p]||'#888', adjBaseV[p]||0, adjBaseS[p]||0, dUn, p));
  }
  return rankize(rows);
}
function summaryItem(party, seats, votePct, color, bV, bS, dUn, logoParty){
  const voteDiff = votePct-bV, seatDiff = seats-bS;
  const diffColor = seatDiff>0 ? "#10B981" : seatDiff<0 ? c_accent_static() : "#64748B";
  const diffText = seatDiff>0 ? `▲ ${seatDiff}` : seatDiff<0 ? `▼ ${Math.abs(seatDiff)}` : "-";
  const vdText = voteDiff>0 ? `(+${voteDiff.toFixed(1)})` : voteDiff<0 ? `(${voteDiff.toFixed(1)})` : "";
  const maxUser = Math.max(1, ...Object.values(dUn));
  return {
    party, seats:String(seats), seat_diff_text:diffText, seat_diff_color:diffColor,
    vote_text:`%${votePct.toFixed(1)}`, vote_diff_text:vdText,
    color, width:`${Math.min(100,(votePct/maxUser)*100)}%`,
    logo: logoURL(logoParty), logoParty
  };
}
function c_accent_static(){ return "#FE474E"; }
function rankize(rows){
  rows.sort((a,b)=>parseFloat(a.vote_text.replace('%',''))-parseFloat(b.vote_text.replace('%',''))).reverse();
  rows.forEach((r,i)=>r.rank=i+1);
  return rows;
}

// ---------------- parliament SVG (port parliament_svg_html) ----------------
function parliamentSvg(){
  if (!state.simResults.length) return "<div style='color:#64748B;padding:20px;text-align:center;'></div>";
  const total = state.simResults.reduce((a,r)=>a+r.seats_won,0);
  if (total<=0) return "";
  const resultsDict = {}; for (const r of state.simResults) resultsDict[r.party]=r.seats_won;
  let assigned=[], groupCol=null;
  if (state.mapMode==="İttifak Renklendirmesi"){
    const badges = partyAbbrevColor(Object.keys(resultsDict), p=>resultsDict[p]);
    const gs={},gc={};
    for (const p of Object.keys(resultsDict)){
      const [ab,col] = badges.get(p)||[p, PARTY_COLORS[p]||'#888'];
      gs[ab]=(gs[ab]||0)+resultsDict[p]; gc[ab]=col;
    }
    const ordered = Object.keys(gs).sort((a,b)=> gs[b]-gs[a] || (PARLIAMENT_ORDER.indexOf(a)>=0?PARLIAMENT_ORDER.indexOf(a):999)-(PARLIAMENT_ORDER.indexOf(b)>=0?PARLIAMENT_ORDER.indexOf(b):999));
    assigned=[]; for (const g of ordered) for(let i=0;i<gs[g];i++) assigned.push(g);
    groupCol=gc;
  } else {
    const order=[...PARLIAMENT_ORDER];
    for (const p of Object.keys(resultsDict)) if (!order.includes(p)) order.push(p);
    assigned=[]; for (const p of order) for (let i=0;i<(resultsDict[p]||0);i++) assigned.push(p);
  }
  const radii=[]; for(let r=130;r<265;r+=10) radii.push(r);
  const sumR = radii.reduce((a,b)=>a+b,0);
  const seatsPerRow = radii.map(r=>Math.round(total*(r/sumR)));
  let spSum = seatsPerRow.reduce((a,b)=>a+b,0);
  if (spSum!==total) seatsPerRow[seatsPerRow.length-1]+= (total-spSum);
  const points=[];
  for (let i=0;i<radii.length;i++){
    const r=radii[i], s=seatsPerRow[i];
    if (s<=0) continue;
    for (let j=0;j<s;j++){
      const angle = Math.PI - (Math.PI*j)/Math.max(1,(s-1));
      points.push({x:r*Math.cos(angle), y:r*Math.sin(angle), angle, r});
    }
  }
  points.sort((a,b)=> (a.angle-b.angle) || (b.r-a.r)).reverse();
  let svg='<svg viewBox="-10 -26 540 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="overflow: visible; margin: auto; display: block;">';
  for (let i=0;i<assigned.length;i++){
    if (i<points.length){
      const party=assigned[i];
      const col = groupCol ? (groupCol[party]||'#888') : (PARTY_COLORS[party]||'#888');
      svg += `<circle cx="${250+points[i].x}" cy="${250-points[i].y}" r="5.0" fill="${col}" />`;
    }
  }
  svg += `<text x="250" y="-16" text-anchor="middle" font-size="12" font-weight="900" fill="#111827">ÇOĞUNLUK</text>`;
  svg += `<line x1="250" y1="-12" x2="250" y2="130" stroke="#E2E8F0" stroke-width="2" stroke-dasharray="4,4"/>`;
  svg += `<text x="250" y="240" text-anchor="middle" font-size="46" font-weight="900" fill="#111827">${total}</text></svg>`;
  return `<div style="width:100%;height:100%;display:flex;justify-content:center;align-items:center;">${svg}</div>`;
}

// ---------------- party abbrev/color (port _party_abbrev_color) ----------------
function partyAbbrevColor(partyKeys, weightFn){
  const badges = new Map();
  const keyset = new Set(partyKeys);
  for (const aly of Object.keys(alliancesObj())){
    const parts = alliancesObj()[aly];
    const live = parts.filter(p=>keyset.has(p));
    if (!live.length) continue;
    let rep=live[0]; for (const p of live) if (weightFn(p)>weightFn(rep)) rep=p;
    const ab = abbreviate_alliance(aly);
    const col = PARTY_COLORS[rep]||'#888';
    for (const p of parts) badges.set(p,[ab,col]);
  }
  return badges;
}

// ---------------- tooltip helpers (port) ----------------
function tooltipGroupRows(aggRows){
  // aggRows: [{party, new_vote_pct, seats_won}]
  if (state.mapMode==="İttifak Renklendirmesi"){
    const badges = partyAbbrevColor(aggRows.map(r=>r.party), p=>{ const r=aggRows.find(x=>x.party===p); return r?r.new_vote_pct:0; });
    const grp = {};
    for (const r of aggRows){
      const vote=parseFloat(r.new_vote_pct), seats=parseInt(r.seats_won,10)||0;
      if (vote<=0 && seats<=0) continue;
      const [ab,col] = badges.get(r.party)||[r.party, PARTY_COLORS[r.party]||'#888'];
      if (grp[ab]){ grp[ab][0]+=vote; grp[ab][1]+=seats; grp[ab][2]=col; }
      else grp[ab]=[vote,seats,col];
    }
    return Object.entries(grp).map(([label,[vote,seats,col]])=>({label,vote,seats,col})).sort((a,b)=>b.vote-a.vote);
  }
  return aggRows.filter(r=>r.new_vote_pct>0).sort((a,b)=>b.new_vote_pct-a.new_vote_pct).map(r=>({label:r.party, vote:parseFloat(r.new_vote_pct), seats:parseInt(r.seats_won,10)||0, col:PARTY_COLORS[r.party]||'#888'}));
}
function tooltipHtmlFromRows(title, rows, hideSeats){
  let html = `<div class="tip-header">${title}</div>`;
  for (const r of rows.slice(0,5)){
    html += `<div class="tip-row"><div class="tip-party">${esc(r.label)}</div>${hideSeats?'':`<div class="tip-seat">${r.seats}</div>`}<div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${Math.min(r.vote,100).toFixed(1)}%; background-color: ${r.col};"></div></div><div class="tip-pct">%${r.vote.toFixed(1)}</div></div>`;
  }
  return html;
}

// ---------------- map building (port _build_map_data + _build_entity_map_data) ----------------
function buildMapHtml(res, uid, hiddenInput, detailSection){
  const df = res;
  let provWinners={}, distWinners={}, customColors={}, tooltipDict={};
  if (state.mapMode==="İttifak Renklendirmesi" || state.mapMode==="Milletvekili Sayısı"){
    buildEntityMapData(df, provWinners, distWinners, customColors, tooltipDict);
  } else if (state.mapMode!=="1. Partiler (Varsayılan)"){
    // party heatmap
    const party = state.mapMode;
    const baseHex = PARTY_COLORS[party]||'#3485fd';
    const provVotes = {}, distVotes = {};
    for (const r of df){ if (r.p===party){ provVotes[r.province]=(provVotes[r.province]||[]).concat([r.new_vote_pct]); distVotes[r.d]=r.new_vote_pct; } }
    const provMean = {}; for (const pr of Object.keys(provVotes)) provMean[pr]=provVotes[pr].reduce((a,b)=>a+b,0)/provVotes[pr].length;
    const allVals = Object.values(provMean).concat(Object.values(distVotes));
    const minV = allVals.length?Math.min(...allVals):0;
    const maxV = allVals.length?Math.max(...allVals):100;
    const vRange = (maxV-minV)||1;
    for (const r of df){
      const nrm = normalize_id(r.province);
      provWinners[nrm]=party;
      const ratio = clamp((((provMean[r.province]||0)-minV)/vRange),0,1);
      customColors[nrm]=get_heatmap_color(baseHex, ratio);
      if (['istanbul','ankara','izmir','bursa'].includes(nrm)){
        for (const sub of [nrm+'1',nrm+'2',nrm+'3']) customColors[sub]=customColors[nrm];
      }
    }
    for (const d of Object.keys(distVotes)){
      const nd = normalize_id(d);
      distWinners[nd]=party;
      customColors[nd]=get_heatmap_color(baseHex, clamp(((distVotes[d]-minV)/vRange),0,1));
    }
    // tooltips
    const byDist={}, byProv={};
    for (const r of df){ (byDist[r.d]=byDist[r.d]||[]).push(r); (byProv[r.province]=byProv[r.province]||[]).push(r); }
    for (const dist of Object.keys(byDist)){
      const group=byDist[dist];
      const seatSum=group.reduce((a,r)=>a+r.seats_won,0);
      const tooltip = districtTooltip(dist, group, party, seatSum);
      tooltipDict[normalize_id(dist)] = tooltip;
    }
    for (const pr of Object.keys(byProv)){
      const group=byProv[pr];
      tooltipDict[normalize_id(pr)] = provinceTooltip(pr, group, party);
    }
    for (const r of df){
      const nrm = normalize_id(r.province);
      if (!tooltipDict[nrm]){
        const base = nrm.replace(/\d+$/,'');
        if (['istanbul','ankara','izmir','bursa'].includes(base) && tooltipDict[base]) tooltipDict[nrm]=tooltipDict[base];
      }
    }
  } else {
    // 1. Partiler (Varsayılan)
    const byProv={}, byDist={};
    for (const r of df){ (byProv[r.province]=byProv[r.province]||[]).push(r); (byDist[r.d]=byDist[r.d]||[]).push(r); }
    for (const prov of Object.keys(byProv)){
      const group=byProv[prov];
      const nrm = normalize_id(prov);
      const agg=aggRows(group);
      const top5=agg.filter(r=>r.pct>0).sort((a,b)=>b.pct-a.pct).slice(0,5);
      const seatSum=group.reduce((a,r)=>a+r.seats_won,0);
      let html=`<div class="tip-header">${to_tr_upper(get_display_label(prov))}<span class="tip-total">${seatSum} MİLLETVEKİLİ</span></div>`;
      for (const r of top5){ html+=tipRowHtml(r.party, r.seats, r.pct); }
      tooltipDict[nrm]=html;
      const winner=top5.length?top5[0].party:null;
      if (winner){
        provWinners[nrm]=winner;
        customColors[nrm]=get_heatmap_color(PARTY_COLORS[winner]||'#888888', clamp(Math.max(0.3,Math.min(1.0,top5[0].pct/65)),0,1));
        const base=nrm.replace(/\d+$/,'');
        if (['istanbul','ankara','izmir','bursa'].includes(base)){
          provWinners[base]=winner; customColors[base]=customColors[nrm];
          for (let i=1;i<=3;i++){ provWinners[base+i]=winner; customColors[base+i]=customColors[nrm]; tooltipDict[base+i]=html; }
        }
      }
    }
    // district winners
    const dWinners = {};
    for (const r of df){
      if (!dWinners[r.d] || r.new_vote_pct>dWinners[r.d].vote) dWinners[r.d]={p:r.p,vote:r.new_vote_pct};
    }
    for (const d of Object.keys(dWinners)){
      const nd=normalize_id(d);
      distWinners[nd]=dWinners[d].p;
      customColors[nd]=get_heatmap_color(PARTY_COLORS[dWinners[d].p]||'#888888', clamp(Math.max(0.3,Math.min(1.0,dWinners[d].vote/65)),0,1));
    }
    for (const dist of Object.keys(byDist)){
      const group=byDist[dist];
      const seatSum=group.reduce((a,r)=>a+r.seats_won,0);
      const seatSpan=seatSum>0?`<span class="tip-total">${seatSum} MİLLETVEKİLİ</span>`:"";
      let html=`<div class="tip-header">${get_display_label(dist)}${seatSpan}</div>`;
      const top5=[...group].sort((a,b)=>b.new_vote_pct-a.new_vote_pct).slice(0,5);
      for (const r of top5){ if (r.new_vote_pct>0) html+=tipRowHtml(r.p, r.seats_won, r.new_vote_pct); }
      tooltipDict[normalize_id(dist)]=html;
    }
  }
  const seatsData = {};
  for (const r of df){ const k=[r.d,r.p].join('\u0000'); seatsData[k]=r.seats_won; }
  const allianceBadges = state.mapMode==="İttifak Renklendirmesi" ? buildAllianceBadges(df) : null;
  const showBadges = ["1. Partiler (Varsayılan)","İttifak Renklendirmesi","Milletvekili Sayısı"].includes(state.mapMode);
  return renderColoredSvg(SVG_TURKIYE, {provWinners, distWinners, colorsDict:PARTY_COLORS, tooltipDict, seatsData, showBadges, customColors, uid, allianceBadges, svgFile:'turkiye.svg'});
}
function tipRowHtml(p, seats, pct){
  return `<div class="tip-row"><div class="tip-party">${esc(p)}</div><div class="tip-seat">${seats}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${pct}%; background-color: ${PARTY_COLORS[p]||'#888888'};"></div></div><div class="tip-pct">%${pct.toFixed(1)}</div></div>`;
}
function districtTooltip(dist, group, party, seatSum){
  const seatSpan=seatSum>0?`<span class="tip-total">${seatSum} MİLLETVEKİLİ</span>`:"";
  let html=`<div class="tip-header">${get_display_label(dist)}${seatSpan}</div>`;
  for (const r of group){ if (r.p===party && r.new_vote_pct>0) html+=tipRowHtml(r.p, r.seats_won, r.new_vote_pct); }
  return html;
}
function provinceTooltip(prov, group, party){
  let html=`<div class="tip-header">${get_display_label(prov)}</div>`;
  for (const r of group){ if (r.p===party && r.new_vote_pct>0) html+=tipRowHtml(r.p, r.seats_won, r.new_vote_pct); }
  return html;
}
function aggRows(group){
  const m={};
  for (const r of group){ if(!m[r.p]) m[r.p]={party:r.p, pct:0, seats:0}; m[r.p].pct+=r.new_vote_pct; m[r.p].seats+=r.seats_won; }
  return Object.values(m).map(o=>({party:o.party,pct:o.pct,seats:o.seats}));
}
function buildAllianceBadges(df){
  const badges={};
  const natVotes={}; for (const r of df) natVotes[r.p]=(natVotes[r.p]||0)+r.new_vote_pct;
  for (const aly of Object.keys(alliancesObj())){
    const parties=alliancesObj()[aly];
    if (parties.length<2) continue;
    const live=parties.filter(p=>df.some(r=>r.p===p));
    if (!live.length) continue;
    let rep=live[0]; for (const p of live) if ((natVotes[p]||0)>(natVotes[rep]||0)) rep=p;
    const ab=abbreviate_alliance(aly), col=PARTY_COLORS[rep]||'#333333';
    for (const p of parties) badges[p]=[ab,col];
  }
  return badges;
}
function buildEntityMapData(df, provWinners, distWinners, customColors, tooltipDict){
  const mp = state.mapMode==="Milletvekili Sayısı";
  const alliances = alliancesObj();
  const entities={}, entityOf={};
  for (const aly of Object.keys(alliances)){
    const parties=alliances[aly];
    if (parties.length>=1){ entities[aly]=[...parties]; for (const p of parties) entityOf[p]=aly; }
  }
  for (const p of allParties()){ if (!entityOf[p]){ entities[p]=[p]; entityOf[p]=p; } }
  // One representative color per entity, chosen globally (nationwide leader party),
  // so each alliance has a single consistent color across the whole map.
  const natVotesAll={};
  for (const r of df) natVotesAll[r.p]=(natVotesAll[r.p]||0)+r.new_vote_pct;
  const globalReps={};
  for (const e of Object.keys(entities)){
    let rep=null;
    for (const p of entities[e]){ if (!rep || (natVotesAll[p]||0)>(natVotesAll[rep]||0)) rep=p; }
    globalReps[e]=rep;
  }
  const refMin = mp?0:65;
  const byProv={}, byDist={};
  for (const r of df){ (byProv[r.province]=byProv[r.province]||[]).push(r); (byDist[r.d]=byDist[r.d]||[]).push(r); }
  for (const prov of Object.keys(byProv)){
    const group=byProv[prov]; const nrm=normalize_id(prov);
    const agg=aggRows(group);
    const seatSum=group.reduce((a,r)=>a+r.seats_won,0);
    const title=`${to_tr_upper(prov)}<span class="tip-total">${seatSum} MİLLETVEKİLİ</span>`;
    tooltipDict[nrm]=tooltipHtmlFromRows(title, tooltipGroupRows(agg.map(o=>({party:o.party,new_vote_pct:o.pct,seats_won:o.seats}))));
    let colorKey, col;
    if (mp){ const [fp,c]=mpRegionColor(agg); colorKey=fp; col=c; customColors[nrm]=col; }
    else {
      const regVotes={}; for (const o of agg) regVotes[o.party]=o.pct;
      const winEnt=entityWin(entities, regVotes);
      const winCount=winEnt?entitySum(winEnt, entities, regVotes):0;
      colorKey=winEnt?globalReps[winEnt]:'#888';
      const intensity=winCount?clamp(Math.max(0.25,Math.min(1.0,winCount/refMin)),0,1):0.25;
      col=get_heatmap_color(PARTY_COLORS[colorKey]||'#888888', intensity);
      customColors[nrm]=col;
    }
    provWinners[nrm]=colorKey;
    const base=nrm.replace(/\d+$/,'');
    if (['istanbul','ankara','izmir','bursa'].includes(base)){
      provWinners[base]=colorKey; customColors[base]=customColors[nrm];
      for (let i=1;i<=3;i++){ provWinners[base+i]=colorKey; customColors[base+i]=customColors[nrm]; tooltipDict[base+i]=tooltipDict[nrm]; }
    }
  }
  for (const dist of Object.keys(byDist)){
    const group=byDist[dist]; const nd=normalize_id(dist);
    const agg=aggRows(group);
    let colorKey, col;
    if (mp){
      const [fp,c]=mpRegionColor(agg); colorKey=fp; col=c;
      distWinners[nd]=colorKey; customColors[nd]=col;
    } else {
      const regVotes={}; for (const o of agg) regVotes[o.party]=o.pct;
      const winEnt=entityWin(entities, regVotes);
      const winCount=winEnt?entitySum(winEnt, entities, regVotes):0;
      colorKey=winEnt?globalReps[winEnt]:'#888';
      const intensity=winCount?clamp(Math.max(0.25,Math.min(1.0,winCount/refMin)),0,1):0.25;
      const col2=get_heatmap_color(PARTY_COLORS[colorKey]||'#888888', intensity);
      distWinners[nd]=colorKey; customColors[nd]=col2;
    }
    const seatSum=group.reduce((a,r)=>a+r.seats_won,0);
    const seatSpan=seatSum>0?`<span class="tip-total">${seatSum} MİLLETVEKİLİ</span>`:"";
    const dagg=agg.map(o=>({party:o.party,new_vote_pct:o.pct,seats_won:o.seats}));
    tooltipDict[nd]=tooltipHtmlFromRows(`${dist}${seatSpan}`, tooltipGroupRows(dagg));
  }
}
function entityWin(entities, votes){
  let best=null,bsum=-1;
  for (const e of Object.keys(entities)){ const s=entitySum(e, entities, votes); if (s>bsum){bsum=s;best=e;} }
  return best;
}
function entitySum(e, entities, votes){ return (entities[e]||[]).reduce((a,p)=>a+(votes[p]||0),0); }
function colorKeyForEntity(entity, votes, entities, alliances){
  if (!entity) return '#888';
  if (entity in alliances){
    const parts=entities[entity];
    let rep=parts[0]; for (const p of parts) if ((votes[p]||0)>(votes[rep]||0)) rep=p;
    return rep;
  }
  return entity;
}
function mpRegionColor(agg){
  const sig=[...agg].sort((a,b)=> (b.seats-a.seats)||(b.pct-a.pct));
  const first=sig[0]; const fp=first.party, fseats=first.seats;
  const total=agg.reduce((a,o)=>a+o.seats,0);
  let full=fseats*2>total;
  if (!full){
    const partySet=new Set(agg.map(o=>o.party));
    for (const aly of Object.keys(alliancesObj())){
      const parts=alliancesObj()[aly];
      if (parts.includes(fp)){
        let alySeats=0; for (const p of parts) if (partySet.has(p)){ const o=agg.find(x=>x.party===p); if (o) alySeats+=o.seats; }
        if (alySeats*2>total) full=true;
        break;
      }
    }
  }
  const col=PARTY_COLORS[fp]||'#888';
  if (full || total<=0) return [fp, col];
  const intensity=clamp(Math.max(0.25,Math.min(0.8,(fseats/Math.max(total,1))*1.2)),0,1);
  return [fp, get_heatmap_color(col, intensity)];
}

// ---------------- render_colored_svg (port) ----------------
function cleanSvgString(svgText){
  try{
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (root && root.tagName.toLowerCase()==='svg') return root.outerHTML;
  }catch(e){}
  return String(svgText)
    .replace(/^<\?xml[\s\S]*?\?>\s*/, '')
    .replace(/<!DOCTYPE[\s\S]*?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}
function renderColoredSvg(rawSvg, o){
  const uid=o.uid||'genel';
  let svgContent = rawSvg || "";
  if (svgContent.indexOf('<svg')<0) return "<div style='color:red;'>Geçersiz SVG dosyası.</div>";

  // fix header
  const RE_HEADER_VB=/viewBox=["']([\-\d\.\s,]+)["']/i;
  const RE_HEADER_CLEAN_G=/\b(width|height|style)=["'][^"']*["']/g;
  svgContent = svgContent.replace(/<svg\b[^>]*>/, function(m){
    let header=m;
    if (header.indexOf('viewBox')<0 && /width=["']([\d\.]+)px["']/.test(header) && /height=["']([\d\.]+)px["']/.test(header)){
      const wm=/width=["']([\d\.]+)px["']/.exec(header), hm=/height=["']([\d\.]+)px["']/.exec(header);
      header=header.replace(/width=["']([\d\.]+)px["']/,'').replace(/height=["']([\d\.]+)px["']/,'');
      header=header.replace('>',` viewBox="0 0 ${wm[1]} ${hm[1]}">`);
    }
    const vbm=RE_HEADER_VB.exec(header);
    if (vbm){
      const parts=vbm[1].trim().split(/[, \t]+/);
      if (parts.length===4){
        const vx=parseFloat(parts[0]),vy=parseFloat(parts[1]),vw=parseFloat(parts[2]),vh=parseFloat(parts[3]);
        const pad=15.0;
        header=header.replace(vbm[0],`viewBox="${vx-pad} ${vy-pad} ${vw+pad*2} ${vh+pad*2}"`);
      }
    }
    header=header.replace(RE_HEADER_CLEAN_G,'');
    const suffix=' width="100%" height="100%" overflow="visible" style="max-width: 100%; max-height: 100%; object-fit: contain;">';
    return header.endsWith('/>') ? header.slice(0,-2)+suffix : header.slice(0,-1)+suffix;
  });

  const badges=[];
  const placedBadges=new Set();
  const RE_PATH_ID=/\b(id|name|data-name|title)=["']([^"']+)["']/g;
  const RE_PATH_CLEAN=/\b(style|fill|stroke|stroke-width|stroke-linejoin|class|data-tooltip|data-norm-id)=["'][^"']*["']/g;

  svgContent = svgContent.replace(/<path\b[^>]*>/g, function(pathTag){
    RE_PATH_ID.lastIndex=0;
    const idm=RE_PATH_ID.exec(pathTag);
    if (!idm) return pathTag;
    const svgNorm=normalize_id(idm[2]);
    if (!svgNorm) return pathTag;
    const winner=(o.distWinners&&o.distWinners[svgNorm])||(o.provWinners&&o.provWinners[svgNorm]);
    if (winner){
      const color=(o.customColors&&o.customColors[svgNorm])||((o.colorsDict||{})[winner]||'#CCCCCC');
      const sWid = (o.svgFile==='turkiye.svg'||o.svgFile==='turkiye2.svg') ? '8':'3';
      const clean=pathTag.replace(RE_PATH_CLEAN,'');
      const newAttrs=`style="fill: ${color}; stroke: #181720; stroke-width: ${sWid}; stroke-linejoin: round; paint-order: stroke fill;" data-norm-id="${svgNorm}" class="map-path"`;
      if (o.showBadges && o.seatsData && !placedBadges.has(svgNorm)){
        placedBadges.add(svgNorm);
        const partiesWon={};
        for (const key of Object.keys(o.seatsData)){
          const i0=key.indexOf('\u0000');
          const dt=key.slice(0,i0), party=key.slice(i0+1);
          const seats=o.seatsData[key];
          const distNorm=normalize_id(dt.split('-')[0]);
          if ((distNorm===svgNorm || normalize_id(dt)===svgNorm) && seats>0){
            partiesWon[party]=(partiesWon[party]||0)+parseInt(seats,10);
          }
        }
        const winnerItems=[];
        if (o.allianceBadges){
          const groupsWon={};
          for (const p of Object.keys(partiesWon)){
            const [ab,gcolor]=o.allianceBadges[p]||[p,(o.colorsDict||{})[p]||'#333333'];
            if (groupsWon[ab]) groupsWon[ab]=[groupsWon[ab][0]+partiesWon[p], gcolor];
            else groupsWon[ab]=[partiesWon[p], gcolor];
          }
          const entries=Object.entries(groupsWon).sort((a,b)=>b[1][0]-a[1][0]);
          for (const [ab,[seatNum,gcolor]] of entries) winnerItems.push([ab,seatNum,gcolor]);
        } else {
          const entries=Object.entries(partiesWon).sort((a,b)=>b[1]-a[1]);
          for (const [p,seatNum] of entries) winnerItems.push([p,seatNum,(o.colorsDict||{})[p]||'#333333']);
        }
        if (winnerItems.length){
          const manual=(ALL_PROVINCE_COORDS[svgNorm]||["",""]);
          const manX=manual[0], manY=manual[1];
          const isMetro=svgNorm.indexOf('istanbul')>=0;
          const rVal=isMetro?'12':'17', fSize=isMetro?'12px':'16px', yOff=isMetro?4:5.5, spacing=isMetro?30:40;
          const cols=winnerItems.length>2?2:winnerItems.length;
          const rows=Math.ceil(winnerItems.length/cols);
          const baseStartY=-((rows-1)*spacing)/2;
          let bStr=`<g class="badge-group" data-path-id="${svgNorm}" data-manual-x="${manX}" data-manual-y="${manY}" style="visibility: hidden;">`;
          for (let i=0;i<winnerItems.length;i++){
            const [gName,seatNum,gColor]=winnerItems[i];
            const rowIdx=Math.floor(i/cols), colIdx=i%cols;
            const itemsInRow=(rowIdx<rows-1)?cols:(winnerItems.length-(rows-1)*cols);
            const cx=(-((itemsInRow-1)*spacing)/2)+(colIdx*spacing), cy=baseStartY+(rowIdx*spacing);
            bStr+=`<circle cx="${cx}" cy="${cy}" r="${rVal}" fill="${gColor}" stroke="#ffffff" stroke-width="1.5"/><text x="${cx}" y="${cy+yOff}" text-anchor="middle" fill="#ffffff" font-size="${fSize}" font-family="'Nunito Sans','Inter',Helvetica,Arial,sans-serif" font-weight="900" pointer-events="none">${seatNum}</text>`;
          }
          bStr+='</g>';
          badges.push(bStr);
        }
      }
      const needle=`${clean}`;
      return needle.replace(/\/>$/,'').replace(/[> ]*$/,'')+' '+newAttrs+'/>';
    }
    return pathTag;
  });

  if (o.showBadges && badges.length){
    svgContent=svgContent.replace('</svg>',`<g id="district-badges-${uid}">${badges.join('')}</g></svg>`);
  }

  const tooltipJson=JSON.stringify(o.tooltipDict||{});
  const hiddenInput=o.hiddenInputId||'hidden_prov_input';
  const detailSection=o.detailSectionId||'prov_detail_section';
  return `
  <div class="map-wrapper" id="map-wrapper-${uid}" data-hidden-input="${hiddenInput}" data-detail-section="${detailSection}" style="width: 100%; height: 100%; position: relative;">
    <script type="application/json" class="map-tooltip-data" id="map-tooltip-data-${uid}">${tooltipJson}</script>
    <div class="map-tooltip" id="svg-tooltip-${uid}" style="position: absolute; display: none; background: #FFFFFF; border: 2px solid #111827; border-top: 3px solid #E00000; padding: 8px 10px; box-shadow: 4px 4px 0 rgba(17,24,39,0.85); border-radius: 2px; pointer-events: none; z-index: 99999; font-family: 'Nunito Sans', 'Inter', Helvetica, Arial, sans-serif; font-size: 12px; color: #1A1A1A; min-width: 210px; max-width: 300px; line-height: 1.25;"></div>
    ${svgContent}
  </div>`;
}

// ---------- map binding: tooltips, badge positioning, click ----------
function bindMapWrapper(uid, onClickPath){
  const wrap=document.getElementById('map-wrapper-'+uid);
  if (!wrap) return;
  const tip=wrap.querySelector('.map-tooltip');
  const jsonEl=wrap.querySelector('.map-tooltip-data');
  let tooltipDict={};
  if (jsonEl) { try{ tooltipDict=JSON.parse(jsonEl.textContent); }catch(e){} }
  const svg=wrap.querySelector('svg');

  // position badges via path bbox or manual coords
  const setBadgePos=(bg)=>{
    const pid=bg.getAttribute('data-path-id');
    const mx=bg.getAttribute('data-manual-x'), my=bg.getAttribute('data-manual-y');
    let x=null,y=null;
    if (mx!=='' && my!==''){ x=parseFloat(mx); y=parseFloat(my); }
    else {
      const path=svg.querySelector(`[data-norm-id="${pid}"]`);
      if (path){
        const bb=path.getBBox();
        if (bb && bb.width>0 && bb.height>0){ x=bb.x+bb.width/2; y=bb.y+bb.height/2; }
      }
    }
    if (x!==null&&y!==null){
      bg.setAttribute('transform',`translate(${x},${y})`);
      bg.style.visibility='visible';
    }
  };
  if (svg) svg.querySelectorAll('.badge-group').forEach(setBadgePos);

  // path hover
  if (svg && tip){
    svg.querySelectorAll('.map-path').forEach(path=>{
      path.style.cursor='pointer';
      path.addEventListener('mousemove',(ev)=>{
        const n=path.getAttribute('data-norm-id');
        const html=tooltipDict[n];
        if (html){
          tip.style.display='block';
          let isHeader=true;
          // split header line + rows by replacing tip-header structure
          const hdrM=/<div class="tip-header">(.*?)<\/div>/.exec(html);
          let body='';
          if (hdrM){
            const headerContent=hdrM[1];
            const totalM=/<span class="tip-total">([\s\S]*?)<\/span>/;
            const tm=totalM.exec(headerContent);
            const title=tm?headerContent.replace(totalM,'').trim():headerContent.replace(/<span class="tip-total">[\s\S]*?<\/span>/,'').trim();
            const total=tm?tm[1]:'';
            body=`<div class="tip-header">${title}${total?`<span class="tip-total">${total}</span>`:''}</div>`;
            body+=html.replace(hdrM[0],'');
          }
          tip.innerHTML=body;
          const r=wrap.getBoundingClientRect();
          let lx=ev.clientX-r.left+14, ly=ev.clientY-r.top+14;
          const tw=tip.offsetWidth, th=tip.offsetHeight;
          if (lx+tw>r.width-20) lx=ev.clientX-r.left-tw-14;
          if (ly+th>r.height-20) ly=ev.clientY-r.top-th-14;
          tip.style.left=lx+'px'; tip.style.top=ly+'px';
        } else {
          tip.style.display='none';
        }
      });
      path.addEventListener('mouseleave',()=>{ tip.style.display='none'; });
      if (onClickPath){
        path.addEventListener('click',()=>{ onClickPath(path.getAttribute('data-norm-id')); });
      }
    });
  }
}



// ================= MLIS main rendering =================
function renderMeclis(){
  const pane=$('#pane_genel');
  if (!pane) return;
  const simOk = state.simResults.length>0;
  let html = `<div class="tab-pane-inner">`;

  // 1) dual header: OY ORANLARI + MECLİS
  html += `<div class="dual">
    <div class="half"><div class="colstack">
      <div class="sb-kicker"><div class="bar"></div><div class="t">OY ORANLARI TABLOSU</div></div>
      <div class="scroll">${summaryRowsHtml()}</div>
    </div></div>
    <div class="half"><div class="colstack">
      <div class="sb-kicker"><div class="bar"></div><div class="t">MECLİS GRAFİĞİ</div></div>
      <div class="parliament-box">${state.parliamentHtml||''}</div>
    </div></div>
  </div>`;

  // 2) map
  html += `<div class="map-card">
    <div class="map-card-head">
      <div class="sb-kicker" style="margin-bottom:0"><div class="bar"></div><div class="t">SEÇİM HARİTASI</div></div>
      <div class="view-ctl"><label>Görünüm</label>
        <select id="map-mode-select">${mapModeOptionsHtml()}</select>
      </div>
    </div>
    <div class="map-frame">${state.mapHtml||emptyMap()}</div>
    <div class="map-hint">İl üzerine gelin: oy ve vekil dağılımı · İle tıklayın: il ve ilçe düzeyinde detaylı analiz</div>
  </div>`;

  // 3) detail
  html += detailSectionHtml();

  // 4) infographic card
  html += `<div class="sb-card shadow section-card" style="margin-top:16px">
    <button class="btn-download" id="btn-infographic">İNFOGRAFİK İNDİR (PNG)</button>
    <div class="big-note">İnfografik, simülasyon çalıştırıldığında otomatik oluşturulur.</div>
  </div>`;

  // 5) province results table
  html += `<div class="sb-card shadow section-card">${state.provResultsHtml||`<div class="big-note">Simülasyon çalıştırıldığında il bazlı sonuç tablosu (oy oranı + vekil) oluşturulur.</div>`}</div>`;

  // 6) firsat/risk
  html += `<div class="sb-collapse" data-open="${state.collapse.firsat?'true':'false'}" style="margin-top:12px">
    <div class="sb-collapse-head" data-key="firsat">
      <div class="ttl"><div class="bar"></div><div class="t">FIRSAT VE RİSK ANALİZİ</div></div>
      <div class="sb-collapse-arrow">▾</div>
    </div>
    <div class="sb-collapse-body"><div class="sb-collapse-body-inner">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:12px">
        <label style="font-weight:900;color:var(--c-text-muted);font-size:10px;letter-spacing:1px;flex-shrink:0">HEDEF PARTİ</label>
        <div class="sim-select-wrap" style="flex:1;margin-left:10px">
          <select id="swing-target">${allParties().map(p=>`<option value="${esc(p)}" ${p===state.targetPartySwing?'selected':''}>${esc(p)}</option>`).join('')}</select>
        </div>
      </div>
      ${swingHtml()}
    </div></div>
  </div>`;

  html += `</div>`;
  pane.innerHTML=html;
  renderSidebar();

  // bind map
  const mw=$('#map-wrapper-genel');
  if (mw) bindMapWrapper('genel', norm=>selectProvince(norm));

  // map mode select
  const mmSel=$('#map-mode-select');
  if (mmSel) mmSel.addEventListener('change',()=>{ state.mapMode=mmSel.value; runSimulation(); });

  // swing target + collapse
  const st=$('#swing-target');
  if (st) st.addEventListener('change',()=>{ state.targetPartySwing=st.value; runSimulation(); });
  $$('.sb-collapse-head').forEach(h=>h.addEventListener('click',()=>{
    const k=h.getAttribute('data-key');
    state.collapse[k]=!state.collapse[k];
    renderMeclis();
  }));

  if (simOk){
    window.setTimeout(()=>{
      if ($('#map-wrapper-genel')) bindMapWrapper('genel', norm=>selectProvince(norm));
    }, 30);
  }
  const infBtn=$('#btn-infographic');
  if (infBtn) infBtn.onclick=()=>downloadNationalInfographic();
  const mecIlBtn=$('#btn-mec-il-info');
  if (mecIlBtn) mecIlBtn.onclick=()=>downloadMecIlInfographic();
  $$('#pane_genel .dist-nav-trigger').forEach(b=>b.addEventListener('click',()=>{
    state.detailActiveTab=b.getAttribute('data-tab');
    renderMeclis();
  }));
}

function summaryRowsHtml(){
  const rows=state.summaryRows;
  if (!rows.length) return `<div class="big-note">Sol menüden simülasyonu çalıştırın.</div>`;
  return rows.map(r=>`
    <div class="final-row">
      ${logoImg32(r.logoParty,'')}
      <div class="final-name">${esc(r.party)}</div>
      <div class="final-seats-col">
        <div class="final-seats"><span>${r.seats}</span></div>
        <div class="final-seat-diff" style="color:${r.seat_diff_color}">${esc(r.seat_diff_text)}</div>
      </div>
      <div class="final-bar"><div class="fill" style="width:${r.width};background:${r.color}"></div></div>
      <div class="final-vote-col">
        <div class="final-vote">${r.vote_text}</div>
        <div class="final-vote-diff">${esc(r.vote_diff_text)}</div>
      </div>
    </div>`).join('');
}
function mapModeOptionsHtml(){
  const modes=["1. Partiler (Varsayılan)","İttifak Renklendirmesi","Milletvekili Sayısı"].concat(allParties().filter(p=>p!==""));
  return modes.map(m=>`<option value="${esc(m)}" ${m===state.mapMode?'selected':''}>${esc(m)}</option>`).join('');
}
function emptyMap(){ return `<div style="color:#64748B;padding:40px;font-weight:bold;text-align:center;">Haritayı görmek için simülasyonu çalıştırın.</div>`; }
function swingHtml(){
  if (!state.swingOpps.length && !state.swingRisks.length) return `<div class="big-note">Analiz için sol menüden simülasyonu çalıştırın.</div>`;
  return `<div class="swing-wrap">
    <div class="swing-col"><h4 class="green">Fırsat Olan Yerler (Kıl Payı Kaçanlar)</h4>
      ${state.swingOpps.map(o=>oppCard(o,true)).join('')||'<div class="big-note">Fırsat yok.</div>'}
    </div>
    <div class="swing-col"><h4 class="red">Riskli Yerler (Kıl Payı Alınanlar)</h4>
      ${state.swingRisks.map(o=>oppCard(o,false)).join('')||'<div class="big-note">Risk yok.</div>'}
    </div>
  </div>`;
}
function oppCard(o,isOpp){
  return `<div class="${isOpp?'opp-card':'risk-card'}">
    <div class="${isOpp?'opp-ttl':'risk-ttl'}">
      <div class="d">${esc(o.district)}</div>
      <span class="${isOpp?'badge-opp':'badge-risk'}">${isOpp?'FIRSAT':'RİSK'}</span>
    </div>
    <div class="opp-rakip">Rakip: ${esc(o.rakip)}</div>
    <div class="opp-desc">${esc(o.desc)}</div>
  </div>`;
}

// ================= Sidebar =================
function renderSidebar(){
  const sb=$('#sidebar');
  if (!sb) return;
  const allP=allParties();
  const tot=Object.values(state.userInputs).reduce((a,b)=>a+(b||0),0);
  const rem=100-tot;
  const gecerli=()=>{ let s=state.w18+state.w23+state.w24; if (!s) return ''; const f=w=>`%${Math.round(w/s*100)}`; return `${f(state.w18)} · ${f(state.w23)} · ${f(state.w24)}`; };
  let html=`<div class="sidebar-logo"><img src="logo.svg" alt="AD Projeksiyon" style="display:block;width:100%;max-width:220px;height:auto;margin:0 auto;" onerror="this.style.display='none';document.getElementById('sidebar-logo-fallback').style.display='block';"/><div id="sidebar-logo-fallback" style="display:none;font-weight:900;font-size:20px;letter-spacing:1px;text-align:center;">AD PROJEKSİYON</div></div>`;
  html+=`<div class="sb-card shadow"><button class="btn-calc" id="btn-run">SİMÜLASYONU ÇALIŞTIR</button>
    <div style="margin-top:16px"><div class="sim-select-wrap">
      <select id="scenario-select">${Object.keys(PREDEFINED_SCENARIOS).map(s=>`<option ${s===state.scenario?'selected':''}>${esc(s)}</option>`).join('')}</select>
    </div></div>
    <div class="btn-row">
      <button class="btn-side" id="btn-export" style="width:49%;margin:0">Dışa Aktar</button>
      <label class="btn-side" style="width:49%;margin:0;display:flex;align-items:center;justify-content:center;cursor:pointer">İçe Aktar
        <input type="file" id="file-import" accept=".json,application/json" style="display:none">
      </label>
    </div>
  </div>`;

  // HARİTA RENKLENDİRME (modes only)
  html+=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">HARİTA RENKLENDİRME</div></div>
    <label class="sb-label">MECLİS HARİTASI</label>
    <div class="sim-select-wrap"><select id="map-mode-side">
      ${["1. Partiler (Varsayılan)","İttifak Renklendirmesi","Milletvekili Sayısı"].map(m=>`<option ${m===state.mapMode?'selected':''}>${esc(m)}</option>`).join('')}
    </select></div>
  </div>`;

  // OY ORANLARI
  html+=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">OY ORANLARI (%)</div></div>
    ${state.activeParties.map(p=>voteRowHtml(p)).join('')}
    ${state.activeParties.length<allP.length?`<button class="btn-side big" id="btn-restore">Çıkarılan Partileri Geri Getir</button>`:''}
    <div class="sb-divider"></div>
    <div class="sb-kicker"><div class="bar"></div><div class="t">VERİ SETİ AĞIRLIKLARI</div></div>
    ${weightRowHtml('2018', state.w18, 'w18')}
    ${weightRowHtml('2023', state.w23, 'w23')}
    ${weightRowHtml('2024', state.w24, 'w24')}
    <div class="sb-divider" style="margin:12px 0"></div>
    <div class="tot-row"><label class="sb-label" style="margin:0">TOPLAM OY</label><div class="tot-amt ${tot<=100.0001?'ok':'bad'}">${tot.toFixed(1)}%</div></div>
    ${rem>0.0001?`<div class="tot-note green">Kalan Oy: ${rem.toFixed(1)} / 100</div>`: rem<-0.0001?`<div class="tot-note red">Fazla Oy: ${(-rem).toFixed(1)} / 100</div>`:`<div class="tot-note gray">Toplam %100 tamamlandı</div>`}
    <div class="tot-row" style="margin-top:8px"><label class="sb-label" style="margin:0">GEÇERLİ TABAN</label><div class="tot-note" style="color:var(--c-text-main);font-size:12px">${gecerli()}</div></div>
  </div>`;

  // VEKİL DAĞITIM
  html+=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">VEKİL DAĞITIM</div></div>
    <div class="sim-select-wrap"><select id="alloc-select">
      ${["D'Hondt (Varsayılan)","Sainte-Laguë","Modifiye Sainte-Laguë","Huntington-Hill (Eşit Orantılar)","Hare Kotası","Droop Kotası","Winner Takes All (Çoğunluk)"].map(a=>`<option ${a===state.allocation?'selected':''}>${esc(a)}</option>`).join('')}
    </select></div>
    <div class="input-row" style="margin-top:12px"><label class="sb-label" style="margin:0">SEÇİM BARAJI</label>
      <div style="display:flex;align-items:center;gap:4px"><input class="sb-in" type="number" id="threshold-input" min="0" max="15" step="0.5" value="${state.threshold}"><span style="font-weight:900;color:var(--c-text-muted);font-size:12px">%</span></div>
    </div>
  </div>`;

  // ITTIFAKLAR
  html+=collapseOpen('ittifak','İTTİFAKLAR · '+state.allianceList.length,
    state.allianceList.map((a,i)=>allianceEditorHtml(a,i)).join('')+
    `<button class="btn-add" id="btn-add-ally">Yeni İttifak Ekle</button>`);
  // ORTAK LİSTELER
  html+=collapseOpen('ortak','ORTAK LİSTELER · '+state.jointList.length,
    state.jointList.map((jl,i)=>jointEditorHtml(jl,i)).join('')+
    `<button class="btn-add" id="btn-add-joint">Ortak Liste Ekle</button>`);
  // YENİ PARTİ
  html+=collapseOpen('yeni','YENİ PARTİ EKLE', newPartyHtml());

  // PROJE HAKKINDA
  html+=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">PROJE HAKKINDA</div></div>
    <div style="font-size:10px;color:var(--c-text-muted)">2018, 2023 ve 2024 seçim verilerini kullanan parti karşılaştırma, sandalye dağılımı, seçim barajı ve olasılık simülasyonları üreten bir projeksiyon aracıdır. 538 modelinden ilham alınmıştır.</div>
  </div>`;

  sb.innerHTML=html;

  // events
  const run=$('#btn-run'); if (run) run.onclick=()=>runSimulation();
  const scen=$('#scenario-select'); if (scen) scen.onchange=()=>{ applyScenario(scen.value); };
  const exp=$('#btn-export'); if (exp) exp.onclick=()=>exportScenario();
  const imp=$('#file-import'); if (imp) imp.onchange=e=>{ const f=e.target.files[0]; if (f) f.text().then(t=>importScenario(t)); };
  const mms=$('#map-mode-side'); if (mms) mms.onchange=()=>{ state.mapMode=mms.value; runSimulation(); };
  const restore=$('#btn-restore'); if (restore) restore.onclick=()=>{ state.activeParties=[...allP]; for (const p of allP) if (state.userInputs[p]===undefined) state.userInputs[p]=0; renderSidebar(); };
  const alloc=$('#alloc-select'); if (alloc) alloc.onchange=()=>{ state.allocation=alloc.value; runSimulation(); };
  const th=$('#threshold-input'); if (th) th.onchange=()=>{ state.threshold=parseFloat(th.value)||0; runSimulation(); };
  // vote rows
  state.activeParties.forEach(p=>{
    const inp=$(`#vote-${cssSafe(p)}`);
    if (inp) inp.onchange=()=>{ state.userInputs[p]=parseFloat(inp.value); renderSidebar(); if (state.tab==='tab_cb') renderCB(); };
    const del=$(`#vdel-${cssSafe(p)}`);
    if (del) del.onclick=()=>{ removeParty(p); };
  });
  // weights
  ['w18','w23','w24'].forEach(k=>{
    const inp=$(`#${k}-input`);
    if (inp) inp.onchange=()=>{ state[k]=parseFloat(inp.value)||0; };
  });
  // alliances / joints editors + add buttons
  const addAly=$('#btn-add-ally'); if (addAly) addAly.onclick=()=>{ state.allianceList.push({id:'aly_'+state.nextAlyId++, name:'', parties:[], sel:''}); renderSidebar(); };
  const addJl=$('#btn-add-joint'); if (addJl) addJl.onclick=()=>{ state.jointList.push({id:'jl_'+state.nextJlId++, parties:[], sel:''}); renderSidebar(); };
  state.allianceList.forEach((a,i)=>{
    const nameIn=$(`#aname-${i}`); if (nameIn) nameIn.onchange=()=>{ a.name=nameIn.value; };
    const del=$(`#adel-${i}`); if (del) del.onclick=()=>{ state.allianceList=state.allianceList.filter(x=>x.id!==a.id); renderSidebar(); };
    const sel=$(`#asel-${i}`); if (sel) sel.onchange=()=>{ if (sel.value) a.parties.push(sel.value); sel.value=''; renderSidebar(); };
    a.parties.forEach(p=>{
      const b=$(`#arm-${i}-${cssSafe(p)}`); if (b) b.onclick=()=>{ a.parties=a.parties.filter(x=>x!==p); renderSidebar(); };
    });
  });
  state.jointList.forEach((jl,i)=>{
    const del=$(`#jdel-${i}`); if (del) del.onclick=()=>{ state.jointList=state.jointList.filter(x=>x.id!==jl.id); renderSidebar(); };
    const sel=$(`#jsel-${i}`); if (sel) sel.onchange=()=>{ if (sel.value) jl.parties.push(sel.value); sel.value=''; renderSidebar(); };
    jl.parties.forEach(p=>{
      const b=$(`#jrm-${i}-${cssSafe(p)}`); if (b) b.onclick=()=>{ jl.parties=jl.parties.filter(x=>x!==p); renderSidebar(); };
    });
  });
  // custom party
  const cpName=$('#cp-name'); if (cpName) cpName.oninput=()=>{ state.customPartyName=cpName.value; };
  const cpColor=$('#cp-color'); if (cpColor) cpColor.oninput=()=>{ state.customPartyColor=cpColor.value; };
  const cpSrcSel=$('#cp-src'); if (cpSrcSel) cpSrcSel.onchange=()=>{ state.customPartyBaseSel=cpSrcSel.value; };
  const cpSlider=$('#cp-slider'); if (cpSlider) cpSlider.oninput=()=>{ state.customPartyBasePcts[state.customPartyBaseSel]=parseFloat(cpSlider.value); };
  const cpBtn=$('#btn-add-cp'); if (cpBtn) cpBtn.onclick=()=>addCustomParty();
  Object.keys(state.customPartiesDef).forEach(n=>{
    const b=$(`#cpdel-${cssSafe(n)}`); if (b) b.onclick=()=>{ delete state.customPartiesDef[n]; delete state.userInputs[n]; state.activeParties=state.activeParties.filter(x=>x!==n); renderSidebar(); runSimulation(); };
  });
}

function voteRowHtml(p){
  const col=PARTY_COLORS[p]||'#888';
  const val=state.userInputs[p]||0;
  return `<div class="vote-row">
    <div class="vote-logo" style="background:${col}"><img src="${logoURL(p)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><span style="display:none">${esc(p)}</span></div>
    <div class="vote-name">${esc(p)}</div>
    <input class="vote-input" id="vote-${cssSafe(p)}" type="number" min="0" max="100" step="0.1" value="${val}" style="color:${col}">
    <button class="vote-del" id="vdel-${cssSafe(p)}" title="Kaldır">✕</button>
  </div>`;
}
function weightRowHtml(label, val, key){
  return `<div class="input-row" style="margin-top:4px"><span style="font-weight:900;color:var(--c-text-main);font-size:11px;width:40px">${label}</span>
    <input class="sb-in" id="${key}-input" type="number" min="0" max="100" step="1" value="${val}" style="width:64px;padding:0 6px;font-size:14px;font-weight:900;text-align:center"><span style="font-weight:900;color:var(--c-text-muted);font-size:12px">%</span></div>`;
}
function collapseOpen(key,title,inner){
  return `<div class="sb-collapse" data-open="${state.collapse[key]?'true':'false'}">
    <div class="sb-collapse-head" data-key="${key}">
      <div class="ttl"><div class="bar"></div><div class="t">${esc(title)}</div></div>
      <div class="sb-collapse-arrow">▾</div>
    </div>
    <div class="sb-collapse-body"><div class="sb-collapse-body-inner">${inner}</div></div>
  </div>`;
}
function allianceEditorHtml(a,i){
  const allP=allParties();
  const selRev=allP.filter(p=>!a.parties.includes(p));
  return `<div class="editor-box">
    <div class="editor-head">
      <input type="text" id="aname-${i}" value="${esc(a.name)}" placeholder="İttifak adı">
      <button class="editor-del" id="adel-${i}">✕</button>
    </div>
    <div class="chip-row">${a.parties.map(p=>memberChip(p,`arm-${i}-${cssSafe(p)}`)).join('')||`<div class="editor-empty">Parti seçilmedi — aşağıdaki menüden ekleyin.</div>`}</div>
    <div class="editor-add"><select id="asel-${i}"><option value="">+ Parti ekle</option>${selRev.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
  </div>`;
}
function jointEditorHtml(jl,i){
  const allP=allParties();
  const selRev=allP.filter(p=>!jl.parties.includes(p));
  const title=jl.parties.length?`${jl.parties[0]} Listesi`:'ORTAK LİSTE';
  return `<div class="editor-box">
    <div class="editor-head"><div class="editor-title">${esc(title)}</div><button class="editor-del" id="jdel-${i}">✕</button></div>
    <div class="chip-row">${jl.parties.map(p=>memberChip(p,`jrm-${i}-${cssSafe(p)}`)).join('')||`<div class="editor-empty">Liste boş — aşağıdaki menüden parti ekleyin.</div>`}</div>
    <div class="editor-add"><select id="jsel-${i}"><option value="">+ Parti ekle</option>${selRev.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
  </div>`;
}
function memberChip(p,id){
  const col=PARTY_COLORS[p]||'#888';
  return `<div class="member-chip"><span class="dot" style="background:${col}"></span><span class="t">${esc(p)}</span><button id="${id}">✕</button></div>`;
}
function newPartyHtml(){
  const allP=allParties();
  const sel=state.customPartyBaseSel;
  const pct=state.customPartyBasePcts[sel]||0;
  return `<input class="cp-name" id="cp-name" placeholder="Kısaltma (örn: VKP)" value="${esc(state.customPartyName)}">
  <input class="cp-color" id="cp-color" type="color" value="${esc(state.customPartyColor)}">
  <div class="sb-kicker"><div class="bar"></div><div class="t">TABAN KAYNAKLARI</div></div>
  <div class="cp-source"><select id="cp-src">${allP.map(p=>`<option ${p===sel?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
  <div class="cp-slider-row"><span class="name" style="color:${PARTY_COLORS[sel]||'#111827'}">${esc(sel)}</span>
    <input type="range" id="cp-slider" min="0" max="100" step="1" value="${pct}">
    <span class="val" style="color:${pct>0?(PARTY_COLORS[sel]||'#111827'):'#64748B'}">${pct}%</span>
  </div>
  <button class="btn-add" id="btn-add-cp" style="margin-top:0">Partiyi Ekle</button>
  <div style="width:100%;margin-top:6px">${Object.keys(state.customPartiesDef).map(n=>`<div class="cp-list-row"><span class="name" style="color:${PARTY_COLORS[n]||'#111827'}">${esc(n)}</span><button id="cpdel-${cssSafe(n)}">✕</button></div>`).join('')}</div>
  <div class="cp-hint">Tabandaki partilere ulaşanın şu yüzdeleri verilir; verilen sayı o partinin oyundan küçülür.</div>`;
}

function addCustomParty(){
  const name=state.customPartyName.trim().toUpperCase();
  if (!name) return;
  const bases={};
  for (const p of Object.keys(state.customPartyBasePcts)){
    const v=state.customPartyBasePcts[p];
    if (v>0) bases[p]=v;
  }
  if (!Object.keys(bases).length) return;
  state.customPartiesDef[name]={bases};
  PARTY_COLORS[name]=state.customPartyColor;
  if (state.userInputs[name]===undefined) state.userInputs[name]=0;
  state.activeParties=[...OZEL_SIRA, name];
  state.customPartyName="";
  state.customPartyBasePcts={};
  runSimulation();
}

function removeParty(p){
  state.activeParties=state.activeParties.filter(x=>x!==p);
  delete state.userInputs[p];
  if (state.customPartiesDef[p]){ delete state.customPartiesDef[p]; }
  renderSidebar();
  runSimulation();
}

function applyScenario(name){
  state.scenario=name;
  const sc=PREDEFINED_SCENARIOS[name];
  for (const p of allParties()) state.userInputs[p]=sc[p]!==undefined?sc[p]:0;
  runSimulation();
}
function exportScenario(){
  const data={
    active_parties: state.activeParties,
    votes: Object.fromEntries(state.activeParties.map(p=>[p,state.userInputs[p]||0])),
    custom_parties: state.customPartiesDef,
    alliances: state.allianceList.map(a=>({...a, parties:a.parties.filter(p=>allParties().includes(p))})),
    joints: state.jointList,
    weights: [state.w18,state.w23,state.w24]
  };
  const blob=new Blob([JSON.stringify(data,null,4)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='ad_projeksiyon_senaryo.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importScenario(text){
  try{
    const d=JSON.parse(text);
    if (d.votes) state.userInputs={...d.votes};
    if (d.alliances) state.allianceList=d.alliances.map(a=>({id:a.id||'a',name:a.name||'',parties:a.parties||[],sel:a.sel||''}));
    if (d.joints) state.jointList=d.joints.map(j=>({id:j.id||'j',parties:j.parties||[],sel:j.sel||''}));
    if (d.custom_parties){ state.customPartiesDef={...d.custom_parties}; for (const n of Object.keys(state.customPartiesDef)) PARTY_COLORS[n]=state.customPartyColor; }
    if (d.weights && d.weights.length===3){ state.w18=+d.weights[0]; state.w23=+d.weights[1]; state.w24=+d.weights[2]; }
    runSimulation();
  }catch(e){ console.error('import error', e); }
}

// ================= Detail (İL VE İLÇE) =================
function selectProvince(norm){
  const base=String(norm).replace(/\d+$/,'');
  state.detailProv=base;
  state.detailIlce="";
  setDetailProvince(base);
  renderMeclis();
  window.setTimeout(()=>{
    const sec=document.getElementById('prov_detail_section');
    if (sec) sec.scrollIntoView({behavior:'smooth', block:'start'});
  },60);
}
async function loadIlceData(prov){
  if (ILCE_CACHE[prov]) return ILCE_CACHE[prov];
  try{
    const r=await fetch(`data/ilce/${prov}.json`);
    const j=await r.json();
    ILCE_CACHE[prov]=j;
    return j;
  }catch(e){ return null; }
}
async function loadIlceSvg(prov){
  if (ILCE_SVG_CACHE[prov]) return ILCE_SVG_CACHE[prov];
  try{
    const r=await fetch(`data/harita/${prov}.svg`);
    const t=await r.text();
    ILCE_SVG_CACHE[prov]=cleanSvgString(t);
    return ILCE_SVG_CACHE[prov];
  }catch(e){ return ""; }
}

function setDetailProvince(prov){
  // synchronous part
  const full=state.fullResults;
  if (!full.length) return;
  const provDf=full.filter(r=>String(r.province).replace(/\d+$/,'').startsWith(prov) || normalize_id(r.province).startsWith(prov));
  if (!provDf.length) return;
  const dName=get_display_label(prov);
  // aggregate
  const agg=aggRows(provDf);
  const topParties=[...agg].filter(o=>o.pct>0).sort((a,b)=>(b.seats-a.seats)||(b.pct-a.pct));
  state.detailProvSummary=topParties.filter(o=>o.pct>0.5||o.seats>0).map(o=>({party:o.party, seats:String(o.seats), vote:`%${o.pct.toFixed(1)}`, color:PARTY_COLORS[o.party]||'#888'}));
  const provDistricts=[...new Set(provDf.map(r=>r.d))].sort();
  // bars
  const b23=`dummy`;
  // 2023 base per district from session merged CSV -- use baked base_2023 via fetch? Use nationalBase approximate fallback.
  // We'll load base_2023 per-province from torough data (data/base_2023.json) lazily once.
  ensureBase2023().then(()=>{
    const info=base2023ForProv(prov);
    const bVotes=info.bVotes, bSeats=info.bSeats;
    let barGroups=null;
    if (state.mapMode==="İttifak Renklendirmesi"){
      const keys=new Set(agg.map(o=>o.party));
      const bdg=partyAbbrevColor(keys, p=>{ const o=agg.find(x=>x.party===p); return o?o.pct:0; });
      barGroups=new Map([...keys].map(p=>[p, bdg.get(p)||[p, PARTY_COLORS[p]||'#888']]));
    }
    const labels=[];
    const barsMap={};
    if (provDistricts.length>1){
      labels.push("İl Geneli (Toplam)");
      barsMap["İl Geneli (Toplam)"]=buildDistrictBarRows(agg.map(o=>({party:o.party,new_vote_pct:o.pct,seats_won:o.seats})), bVotes, bSeats, true, barGroups);
      for (const dist of provDistricts){
        const dm=String(dist).match(/(\d+)$/);
        const label=`${dm?dm[1]:dist}. Bölge`;
        const dRes=provDf.filter(r=>r.d===dist).map(r=>({party:r.p, new_vote_pct:r.new_vote_pct, seats_won:r.seats_won}));
        const d23=info.byDist[dist];
        const dBV=d23?d23.votes:{}, dBS=d23?d23.seats:{};
        barsMap[label]=buildDistrictBarRows(dRes, dBV, dBS, true, barGroups);
        labels.push(label);
      }
    } else {
      barsMap["İl Geneli (Toplam)"]=buildDistrictBarRows(agg.map(o=>({party:o.party,new_vote_pct:o.pct,seats_won:o.seats})), bVotes, bSeats, true, barGroups);
    }
    state.detailTabLabels=labels;
    state.detailBarsMap=barsMap;
    if (!barsMap[state.detailActiveTab]) state.detailActiveTab="İl Geneli (Toplam)";
    renderDetailProvince(prov, provDf, provDistricts, barsMap);
  });
  state.detailProvName = dName;
}
let BASE2023=null;
async function ensureBase2023(){
  if (BASE2023) return BASE2023;
  try{ const r=await fetch('data/base_2023.json'); BASE2023=await r.json(); }catch(e){ BASE2023=[]; }
  return BASE2023;
}
function base2023ForProv(prov){
  const rows=BASE2023||[];
  const bVotes={}, bSeats={}, byDist={};
  for (const r of rows){
    if (String(r.prov)===prov){
      bVotes[r.p]=(bVotes[r.p]||0)+r.pct;
      bSeats[r.p]=(bSeats[r.p]||0)+r.seats;
    }
  }
  for (const r of rows){
    if (String(r.prov)===prov){
      if (!byDist[r.d]) byDist[r.d]={votes:{},seats:{}};
      byDist[r.d].votes[r.p]=r.pct;
      byDist[r.d].seats[r.p]=r.seats;
    }
  }
  return {bVotes, bSeats, byDist};
}
function buildDistrictBarRows(dataRows, bVotes, bSeats, showSeats, groups){
  let filtered;
  if (showSeats) filtered=dataRows.filter(r=>(r.new_vote_pct||0)>0||(r.seats_won||0)>0).sort((a,b)=>(b.new_vote_pct-b.new_vote_pct));
  else filtered=dataRows.filter(r=>r.new_vote_pct>0);
  filtered=[...filtered].sort((a,b)=>(b.new_vote_pct||0)-(a.new_vote_pct||0)||(b.seats_won||0)-(a.seats_won||0));
  let mMax=Math.max(1, ...filtered.map(r=>r.new_vote_pct||0));
  if (groups && groups.size){
    const gv={},gs={},gkey={};
    for (const r of filtered){
      const [lab,col]=groups.get(r.party)||[r.party, PARTY_COLORS[r.party]||'#888'];
      const vote=parseFloat(r.new_vote_pct)||0, seats=r.seats_won||0;
      gv[lab]=(gv[lab]||0)+vote; gs[lab]=(gs[lab]||0)+seats; gkey[lab]=col;
    }
    const bv={},bs={};
    for (const lab of Object.keys(gv)){
      bv[lab]=0; bs[lab]=0;
      for (const r of filtered){ const l2=(groups.get(r.party)||[r.party])[0]; if (l2===lab){ bv[lab]+=(bVotes[r.party]||0); bs[lab]+=(bSeats[r.party]||0); } }
    }
    const items=Object.keys(gv).map(lab=>[lab,gv[lab],gs[lab],gkey[lab]]).sort((a,b)=>b[1]-a[1]);
    return items.map(([lab,vote,seats,color])=>barFields(lab,vote,seats,showSeats,bv[lab]||0,bs[lab]||0,color,mMax));
  }
  return filtered.map(r=>barFields(r.party, parseFloat(r.new_vote_pct)||0, r.seats_won||0, showSeats, bVotes[r.party]||0, bSeats[r.party]||0, PARTY_COLORS[r.party]||'#888', mMax));
}
function barFields(party, vote, seats, showSeats, bV, bS, color, mMax){
  const vd=vote-bV, sd=seats-bS;
  let seatDelta, sdColor;
  if (showSeats){
    if (sd>0){ seatDelta=`▲${sd}`; sdColor='#00E676'; }
    else if (sd<0){ seatDelta=`▼${Math.abs(sd)}`; sdColor='#FF3D00'; }
    else { seatDelta='–'; sdColor='#9E9E9E'; }
  } else { seatDelta=''; sdColor='#9E9E9E'; }
  let voteDelta, vdColor;
  if (vd>0.05){ voteDelta=`(+${vd.toFixed(1)})`; vdColor='#0B9E17'; }
  else if (vd<-0.05){ voteDelta=`(${vd.toFixed(1)})`; vdColor='#FE474E'; }
  else { voteDelta=''; vdColor='#9E9E9E'; }
  return {
    party, seats:String(seats), seat_delta:seatDelta, seat_delta_color:sdColor,
    width:`${Math.min(100,Math.max(0,(vote/mMax)*100)).toFixed(2)}%`,
    vote_text:`%${vote.toFixed(1)}`, vote_delta:voteDelta, vote_delta_color:vdColor,
    color, no_seat:!showSeats, logo:logoURL(party)
  };
}

function renderDetailProvince(prov, provDf, provDistricts, barsMap){
  const active=state.detailActiveTab in barsMap?state.detailActiveTab:"İl Geneli (Toplam)";
  state.detailActiveTab=active;
  // city map
  loadIlceData(prov).then(cityData=>{
    if (!cityData) return;
    loadIlceSvg(prov).then(svgText=>{
      if (!svgText) return;
      renderCityMap(prov, cityData, svgText);
    });
  });
  // bars section HTML rendered in renderMeclis via detailSectionHtml using state
  renderMeclis();
}

function renderCityMap(prov, cityData, svgText){
  // run ilce simulation
  const un=userNorm();
  const baseObjN=_weightedBase(state.w18,state.w23,state.w24,state.customPartiesDef);
  const allP=allParties();
  const yearData={}, seats0={};
  for (const n of Object.keys(cityData)){
    const pMap={};
    for (const P of Object.keys(cityData[n].parties)){
      const v=cityData[n].parties[P];
      pMap[P]={v18:v.v18||0,v23:v.v23||0,v24:v.v24||0};
    }
    yearData[n]=pMap; seats0[n]=0;
  }
  const baseRes=applyCustomPartiesJS(yearData, seats0, state.w18, state.w23, state.w24, state.customPartiesDef);
  const cityRes=run_simulation({base:baseRes.base, seats:seats0}, baseObjN.nat, un, alliancesObj(), jointListsObj(), state.threshold, state.allocation, REGIONAL_BOOSTS_DEFAULT, allP, Object.keys(yearData));
  const distWinners={}, distColors={}, distTips={}, ilceBars={};
  const ilsAlliances=alliancesObj();
  const workingNat=displayUserNat();
  const qualNat=_get_qualified_parties(workingNat, ilsAlliances, state.threshold, allP);
  const byDist={};
  for (const r of cityRes){ (byDist[r.d]=byDist[r.d]||[]).push(r); }
  for (const dist of Object.keys(byDist)){
    const nDist=normalize_id(dist);
    const grp=byDist[dist];
    const top=[...grp].sort((a,b)=>b.new_vote_pct-a.new_vote_pct);
    if (!top.length) continue;
    let wParty, dCol;
    if (state.mapMode==="Milletvekili Sayısı"){
      let dQual=grp.filter(r=>r.seats_won>0);
      if (!dQual.length) dQual=grp.filter(r=>qualNat.has(r.p));
      if (!dQual.length) continue;
      const wr=[...dQual].sort((a,b)=>(b.seats_won-a.seats_won)||(b.new_vote_pct-a.new_vote_pct))[0];
      wParty=wr.p; dCol=PARTY_COLORS[wParty]||'#888';
    } else if (state.mapMode==="İttifak Renklendirmesi"){
      const dpcts={}; for (const r of grp) dpcts[r.p]=(dpcts[r.p]||0)+r.new_vote_pct;
      const ents={},entOf={};
      for (const aly of Object.keys(ilsAlliances)){
        const live=ilsAlliances[aly].filter(p=>dpcts[p]!==undefined);
        if (live.length>=1){ ents[aly]=live; for (const p of live) entOf[p]=aly; }
      }
      for (const p of allP){ if (!entOf[p]){ ents[p]=[p]; entOf[p]=p; } }
      const natVotesAll={};
      for (const r of cityRes) natVotesAll[r.p]=(natVotesAll[r.p]||0)+r.new_vote_pct;
      const cityReps={};
      for (const e of Object.keys(ents)){
        let rep=null;
        for (const p of ents[e]){ if (!rep || (natVotesAll[p]||0)>(natVotesAll[rep]||0)) rep=p; }
        cityReps[e]=rep;
      }
      const winEnt=Object.keys(ents).length?Object.keys(ents).sort((a,b)=>entitySum(b,ents,dpcts)-entitySum(a,ents,dpcts))[0]:null;
      const colorKey=winEnt?cityReps[winEnt]:'#888';
      wParty=colorKey; dCol=PARTY_COLORS[colorKey]||'#888';
    } else {
      wParty=top[0].p;
      dCol=get_heatmap_color(PARTY_COLORS[wParty]||'#888888', clamp(Math.max(0.3,Math.min(1.0,top[0].new_vote_pct/65)),0,1));
    }
    distWinners[nDist]=wParty; distColors[nDist]=dCol;
    const seatSum=grp.reduce((a,r)=>a+r.seats_won,0);
    const seatSpan=seatSum>0?`<span class="tip-total">${seatSum} MİLLETVEKİLİ</span>`:"";
    const dagg=aggRows(grp);
    distTips[nDist]=tooltipHtmlFromRows(`${getIlceName(prov, nDist)}${seatSpan}`, tooltipGroupRows(dagg.map(o=>({party:o.party,new_vote_pct:o.pct,seats_won:o.seats}))), true);
    // ilce bars (2023 base from baked per-year data)
    const ilceBase=cityData[nDist]; 
    const b23=ilceBase&&ilceBase.parties?Object.fromEntries(Object.entries(ilceBase.parties).map(([p,v])=>[p,v.v23||0])):{};
    ilceBars[nDist]=buildDistrictBarRows(grp.map(r=>({party:r.p,new_vote_pct:r.new_vote_pct,seats_won:0})), b23, {}, false, null);
  }
  state.detailIlceBarsMap=ilceBars;
  const barsGroup=state.mapMode==="İttifak Renklendirmesi";
  const mapHtml=renderColoredSvg(svgText, {provWinners:{}, distWinners, colorsDict:PARTY_COLORS, tooltipDict:distTips, seatsData:{}, showBadges:false, customColors:distColors, uid:'city', svgFile:prov+'.svg', hiddenInputId:'hidden_city_input', detailSectionId:'prov_detail_section'});
  state.detailCityMapHtml=mapHtml;
  const box=document.getElementById('city-map-box');
  if (box){
    box.innerHTML=mapHtml;
    bindMapWrapper('city', norm=>selectIlce(norm));
  }
}
function selectIlce(norm){
  state.detailIlce=norm;
  renderMeclis();
}
function clearDetailIlce(){
  state.detailIlce="";
  renderMeclis();
}
function clearDetailProv(){
  state.detailProv="";
  state.detailIlce="";
  renderMeclis();
}

function detailSectionHtml(){
  if (!state.detailProv) return `<div class="sb-card shadow section-card" style="padding:14px"><div style="font-weight:900;font-size:12px;color:#64748B;">Dinamik il detayı: Haritada bir ile tıklayın.</div></div>`;
  const pName=get_display_label(state.detailProv);
  const bars=getActiveBars();
  const labels=state.detailTabLabels||[];
  let inner=``;
  inner+=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">${pName} İLİ DETAYLI ANALİZİ</div></div>
    <div style="padding:0 14px">
    <div class="city-map-box" id="city-map-box"><div style="display:flex;justify-content:center;align-items:center;height:100%;color:#777;font-weight:bold;">${state.detailProv? 'İlçe haritası yükleniyor...':''}</div></div>
    ${state.detailIlce?`
      <div class="detail-translate">
        <div class="di-name">${getIlceName(state.detailProv, state.detailIlce)}</div>
        <button id="btn-back-prov" onclick="__clearIlce()">← İl Geneli</button>
      </div>
      ${ilceBarsHtml()}
      `:`
      ${labels.length?`<div class="dist-nav">${labels.map((l,i)=>`<button class="dist-nav-trigger" data-tab="${esc(l)}" ${l===state.detailActiveTab?'data-active="true"':''}>${esc(l)}</button>`).join('')}</div>`:''}
      <div class="detail-bars">${bars.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>
      `}
    </div>
    <div style="display:flex;justify-content:center;margin-top:14px;width:100%">
      <button class="btn-download" id="btn-mec-il-info" style="margin:0 auto">İL İNFOGRAFİĞİNİ İNDİR (PNG)</button>
    </div>
  </div>`;
  // trigger city map render
  renderCityMapAsync();
  return `<div id="prov_detail_section">${inner}</div>`;
}
function getActiveBars(){
  const barsMap=state.detailBarsMap||{};
  return barsMap[state.detailActiveTab||'İl Geneli (Toplam)']||[];
}
function ilceBarsHtml(){
  const rows=state.detailIlceBarsMap&&state.detailIlceBarsMap[state.detailIlce]||[];
  return `<div class="detail-bars">${rows.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>`;
}
function geoBarHtml(b){
  const logoBox=`<div class="geo-logo" style="background:${b.color}"><img src="${b.logo}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><span style="display:none">${esc(b.party)}</span></div>`;
  const seats=b.no_seat?`<div class="geo-spacer"></div>`:`<div class="geo-seats-col"><div class="geo-seats"><span>${b.seats}</span></div><div class="geo-seat-delta" style="color:${b.seat_delta_color}">${esc(b.seat_delta)}</div></div>`;
  const votes=`<div class="geo-vote-col"><div class="geo-vote">${b.vote_text}</div><div class="geo-vote-delta" style="color:${b.vote_delta_color}">${esc(b.vote_delta)}</div></div>`;
  return `<div class="geo-row">${logoBox}<div class="geo-name" style="margin-left:8px">${esc(b.party)}</div>${seats}<div class="geo-bar"><div class="fill" style="width:${b.width};background:${b.color}"></div></div>${votes}</div>`;
}

function renderCityMapAsync(){
  const prov=state.detailProv;
  if (!prov) return;
  loadIlceData(prov).then(cityData=>{
    if (!cityData) return;
    loadIlceSvg(prov).then(svgText=>{
      if (!svgText) return;
      renderCityMap(prov, cityData, svgText);
    });
  });
}

// ---------------- province results table (port) ----------------
function buildProvinceResultsHtml(){
  if (!state.simResults.length || !state.fullResults.length) return "";
  const full=state.fullResults;
  const partyOrder=[];
  {
    const du=displayUserNat(); const seats={}; for (const r of state.simResults) seats[r.party]=r.seats_won;
    const pool=[];
    for (const p of Object.keys(du)) if ((du[p]||0)>0 || (seats[p]||0)>0) pool.push(p);
    partyOrder.push(...pool.sort((a,b)=>(du[b]||0)-(du[a]||0)||(seats[b]||0)-(seats[a]||0)));
  }
  const trAlphabet='abcçdefgğhıijklmnoöprsştuüvyz';
  const trIdx={}; for (let i=0;i<trAlphabet.length;i++) trIdx[trAlphabet[i]]=i;
  const splitCities=['istanbul','ankara','izmir','bursa'];
  const trSort=(name)=>[...name.toLowerCase()].map(ch=>trIdx[ch]!==undefined?trIdx[ch]:100+Math.min((ch||'').charCodeAt(0),999));
  const regionLabel=(region)=>{
    const base=String(region).split('-')[0];
    if (String(region).indexOf('-')>=0 && splitCities.includes(normalize_id(base)) ) return region;
    return PROVINCE_NAMES[normalize_id(base)]||to_tr_title(String(region));
  };
  const regWseat={}, regSeats={};
  for (const r of full){
    const region=r.d||r.province||'';
    const p=r.p;
    if (!region||!p) continue;
    const pct=parseFloat(r.new_vote_pct)||0, se=parseInt(r.seats_won,10)||0, sc=parseInt(r.seat_count,10)||1;
    if (!regWseat[region]) regWseat[region]={};
    const w=regWseat[region][p]=regWseat[region][p]||[0,0];
    w[0]+=pct*sc; w[1]+=sc;
    regSeats[region]=regSeats[region]||{};
    regSeats[region][p]=(regSeats[region][p]||0)+se;
  }
  const regRows=[];
  for (const region of Object.keys(regWseat)){
    const wseats=regWseat[region];
    const totalW=Object.values(wseats).reduce((a,v)=>a+v[0],0);
    const pctNorm={};
    for (const p of Object.keys(wseats)) pctNorm[p]=totalW>0?(wseats[p][0]/totalW*100):0;
    regRows.push({label:regionLabel(region), pct:pctNorm, seats:regSeats[region]||{}, totalMps:Object.values(regSeats[region]||{}).reduce((a,b)=>a+b,0)});
  }
  regRows.sort((a,b)=>{ const ka=trSort(a.label), kb=trSort(b.label); for (let i=0;i<Math.max(ka.length,kb.length);i++){ const d=(ka[i]||0)-(kb[i]||0); if (d) return d; } return 0; });
  const ordered=partyOrder.filter(p=>p!=='' && regRows.some(row=>row.pct[p]!==undefined));
  const colors=PARTY_COLORS;
  const logoHtml={};
  for (const p of ordered){
    logoHtml[p]=`<img src="${logoURL(p)}" style='width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:4px;'/>`;
  }
  const thead=`<tr><th style='left:0;z-index:3;min-width:110px;text-align:left;'>İL / SEÇİM BÖLGESİ</th>`+
    ordered.map(p=>`<th style='min-width:78px;text-align:center;'><div style='display:flex;align-items:center;justify-content:center;gap:3px;'>${logoHtml[p]||''}${esc(p)}</div></th>`).join('')+`</tr>`;
  let body='';
  for (const row of regRows){
    let leaderVal=0;
    for (const p of ordered){ const c=row.pct[p]||0; if (c>leaderVal) leaderVal=c; }
    let firstTd=`<td style='position:sticky;left:0;background:#fffffe;z-index:2;font-weight:900;font-size:12px;color:#111827;border:1px solid #E4DFD7;padding:7px 10px;'>${esc(row.label)}<div style='font-weight:700;font-size:10px;color:#999;'>${row.totalMps} MV</div></td>`;
    let tds=[firstTd];
    for (const p of ordered){
      const cellPct=row.pct[p]||0;
      if (cellPct>0){
        const isLeader=cellPct>=leaderVal&&leaderVal>0;
        const bgc=isLeader?(colors[p]||'#888888'):'#F7F7F5';
        const fgc=isLeader?'#FFFFFF':'#111827';
        const bdr=isLeader?`border:2px solid ${colors[p]||'#111827'};`:'border:1px solid #E4DFD7;';
        tds.push(`<td style='${bdr}background:${bgc};text-align:center;padding:6px 6px;color:${fgc};'><div style='font-weight:900;font-size:13px;line-height:1.1;font-variant-numeric:tabular-nums;'>${cellPct.toFixed(1)}%</div><div style='font-weight:700;font-size:10px;opacity:.8;'>${row.seats[p]||0}</div></td>`);
      } else {
        tds.push(`<td style='border:1px solid #E4DFD7;background:#FBFBFA;'>&nbsp;</td>`);
      }
    }
    body+=`<tr>${tds.join('')}</tr>`;
  }
  return `<div class='prov-wrap'><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}

// ================= tabs / boot =================
function currentTab(){ return state.tab||'tab_genel'; }
function setTab(t){
  state.tab=t;
  $$('.tab-trigger').forEach(b=>b.setAttribute('data-active', String(b.getAttribute('data-tab')===t)));
  $$('.tab-pane').forEach(p=>p.style.display=(p.id==='pane_'+t.replace('tab_',''))?'block':'none');
  if (t==='tab_cb') renderCB();
  else if (t==='tab_yerel') renderYerel();
  else if (t==='tab_538') renderOlasilik();
  else renderMeclis();
}
function bindSegNav(){
  $$('.tab-trigger').forEach(b=>b.addEventListener('click',()=>setTab(b.getAttribute('data-tab'))));
  $$('.sb-collapse-head').forEach(h=>h.addEventListener('click',()=>{
    const k=h.getAttribute('data-key');
    state.collapse[k]=!state.collapse[k];
    h.parentElement.setAttribute('data-open', String(state.collapse[k]));
  }));
}

function cssSafe(s){ return s.replace(/[^A-Za-z0-9_-]/g,'_'); }
window.__clearIlce = ()=>clearDetailIlce();
window.__clearProv = ()=>clearDetailProv();

// ---------------- CB (CUMHURBAŞKANLIĞI) full port ----------------
function cbDetailBlank(){ return {prov:"",name:"",summary:[],mapHtml:"",tabLabels:[],barsMap:{},activeTab:"",activeBars:[],ilceSelected:"",ilceName:"",ilceBarsMap:{}}; }
function cbState(){
  if (!state.cb) state.cb={cands1:JSON.parse(JSON.stringify(DEFAULT_CB_CANDS_1)), nextC1Id:9, cands2:[], res1:[], res2:[], r1WinnerPct:0, r1WinnerText:"", r1Top1:"", r1Top2:"", mapHtml1:"", mapHtml2:"", pickerOpenId:"", r1:cbDetailBlank(), r2:cbDetailBlank()};
  return state.cb;
}
function cbPartyWeights(cand){
  const nominating=String(cand.party||"");
  const votes=cand.votes||{};
  const weights={};
  for (const g of CB_GROUP_LIST){
    const gParties=CB_GROUPS[g];
    const ratio=(parseFloat(votes[g])||0)/100;
    const multi=gParties.length>1;
    for (const p of gParties){
      let w=ratio;
      if (p===nominating && multi) w=Math.min(1, ratio+CB_NOMINATING_BONUS/100);
      weights[p]=w;
    }
  }
  for (const cp of Object.keys(state.customPartiesDef||{})) weights[cp]=Math.min(1,(parseFloat(votes[cp])||0)/100);
  return weights;
}
function cbBlockColors(){
  const result={};
  for (const g of CB_GROUP_LIST){
    let gVote=0; for (const p of CB_GROUPS[g]) gVote+=(state.userInputs[p]||0);
    let color="#888888";
    if (gVote>0){
      let leader=null;
      for (const p of CB_GROUPS[g]){ const v=state.userInputs[p]||0; if (!leader||v>leader[1]) leader=[p,v]; }
      if (leader) color=PARTY_COLORS[leader[0]]||'#888888';
    }
    result[g]=color;
  }
  for (const cp of Object.keys(state.customPartiesDef||{})) result[cp]=PARTY_COLORS[cp]||'#888888';
  return result;
}
function cbBlockTotals(){
  const result={};
  const total=state.activeParties.reduce((a,p)=>a+(state.userInputs[p]||0),0);
  const fmt=v=>`%${total>0?(v/total*100).toFixed(1):(0).toFixed(1)}`;
  for (const g of CB_GROUP_LIST){
    let gVote=0; for (const p of CB_GROUPS[g]) gVote+=(state.userInputs[p]||0);
    result[g]=fmt(gVote);
  }
  for (const cp of Object.keys(state.customPartiesDef||{})) result[cp]=fmt(state.userInputs[cp]||0);
  return result;
}
function cbVoteKeys(){ return CB_GROUP_LIST.concat(Object.keys(state.customPartiesDef||{})); }
function cbCardVotes(c){
  const v=Object.assign({}, c.votes||{});
  for (const k of cbVoteKeys()) if (v[k]===undefined) v[k]=0;
  return v;
}
function cbPartyBtnHtml(c){
  const col=PARTY_COLORS[c.party]||'#888';
  return `<div class="cb-party-btn" id="cb-party-${c.id}" style="background:${col}" title="Nominin partisini seç"><img src="${logoURL(c.party)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><span style="display:none">${esc(c.party)}</span></div>`;
}
function cbPickerHtml(c){
  const open=cbState().pickerOpenId===c.id;
  return `<div class="cb-picker" ${open?'':'style="display:none"'} data-cand="${c.id}">
    <div class="cb-picker-head"><div>NOMİNİN PARTİSİNİ SEÇ</div><button class="cb-picker-close">✕</button></div>
    ${allParties().map(p=>`<div class="cb-picker-row" data-cand="${c.id}" data-party="${esc(p)}">
      <div class="cb-picker-logo" style="background:${PARTY_COLORS[p]||'#888'}"><img src="${logoURL(p)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><span style="display:none">${esc(p)}</span></div>
      <div class="cb-picker-name">${esc(p)}</div>
      ${c.party===p?'<div class="cb-picker-check">✓</div>':''}
    </div>`).join('')}
  </div>`;
}
function cbBlockGridHtml(votes, candId, isR2){
  const bcols=cbBlockColors(), btot=cbBlockTotals();
  return cbVoteKeys().map(g=>{
    const members=(CB_GROUPS[g]||[]).filter(p=>p!==g).join(' · ');
    return `
    <div class="cb-block">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%"><div class="cb-block-lbl" style="color:${bcols[g]||'#111827'}">${esc(g)}</div><div class="cb-block-tot">${btot[g]||'%0.0'}</div></div>
      ${members?`<div class="cb-block-members">${esc(members)}</div>`:''}
      <input class="cb-num ${isR2?'cb-r2-num':''}" type="number" min="0" max="100" step="1" ${isR2?'':`data-cand="${candId}" `}data-group="${esc(g)}" value="${votes[g]}" style="--cb-focus:${bcols[g]||'#CBD5E1'}" />
    </div>`;
  }).join('');
}
function cbCandidateCardHtml(c){
  const votes=cbCardVotes(c);
  return `<div class="cand-card" id="cand-card-${c.id}">
    <div class="head">
      <div class="cb-name-in">
        <div class="cb-mini-label">ADAY</div>
        <input class="cb-name-input" data-cand="${c.id}" value="${esc(c.name)}" placeholder="Aday adı" />
      </div>
      ${cbPartyBtnHtml(c)}
      ${cbState().cands1.length>1?`<button class="cb-del" data-cand="${c.id}" title="Adayı kaldır">✕</button>`:''}
    </div>
    <div class="cb-grid">${cbBlockGridHtml(votes, c.id, false)}</div>
    ${cbPickerHtml(c)}
  </div>`;
}
function cbR2CardHtml(c){
  const votes=cbCardVotes(c);
  const idx=cbState().cands2.indexOf(c);
  return `<div class="cand-card cb-r2-card">
    <div class="head">
      <div class="cb-mini-label" style="margin-right:8px">2. TUR ADAYI</div>
      ${cbPartyBtnHtml(c)}
      <div class="cb-name-in" style="margin-left:8px"><input class="cb-name-input cb-r2-name-input" data-r2-idx="${idx}" value="${esc(c.name)}" /></div>
    </div>
    <div class="cb-grid">${cbBlockGridHtml(votes, null, true)}</div>
  </div>`;
}
function cbBarRowHtml(item){
  return `<div class="cb-bar"><div class="cb-name">${esc(item.name)}</div><div class="cb-track"><div class="fill" style="width:${item.width};background:${item.party_color}"></div></div><div class="cb-vote">${esc(item.vote_text)}</div></div>`;
}
function cbBarItemsDetail(ser, candColors, candPP){
  const items=Object.entries(ser).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  const out=[];
  if (!items.length) return out;
  const maxV=items[0][1];
  for (const [cand,v] of items){
    const cname=String(cand);
    out.push({
      party:cname,
      logo:logoURL(candPP[cname]||''),
      sq_text:candPP[cname]||cname,
      color:candColors[cname]||'#888888',
      width:Math.min(100,(v/maxV)*100).toFixed(0)+'%',
      vote_text:'%'+v.toFixed(1),
      vote_delta:'', seat_delta:'–', seat_delta_color:'#9E9E9E', no_seat:true
    });
  }
  return out;
}
function cbNationalVotes(candsList){
  const display=displayUserNat();
  const candData=[];
  for (const cand of candsList){
    const nm=String(cand.name||'').trim();
    if (!nm) continue;
    let votes=0;
    const w=cbPartyWeights(cand);
    for (const p of Object.keys(w)) votes+=(display[p]||0)*w[p];
    candData.push({name:nm, party:cand.party, votes});
  }
  return candData.sort((a,b)=>b.votes-a.votes);
}
function cbCandDistPcts(rows, candsList, displayNat){
  const weights={};
  for (const cand of candsList){
    const nm=String(cand.name||'').trim();
    if (!nm) continue;
    weights[nm]=cbPartyWeights(cand);
  }
  if (!Object.keys(weights).length) return {};
  const cbParties=allParties().filter(p=>(displayNat[p]||0)>0);
  const distMap={};
  for (const r of rows){ if (!distMap[r.d]) distMap[r.d]={}; distMap[r.d][r.p]=(distMap[r.d][r.p]||0)+r.new_vote_pct; }
  const out={};
  for (const d of Object.keys(distMap)){
    const votes=distMap[d];
    const raw={};
    for (const nm of Object.keys(weights)){
      let s=0;
      for (const p of cbParties){
        const v=votes[p];
        if (v===undefined) continue;
        const w=weights[nm][p];
        if (!w) continue;
        s+=v*w;
      }
      if (s>0) raw[nm]=s;
    }
    const rowSum=Object.values(raw).reduce((a,b)=>a+b,0)||1;
    const norm={};
    for (const nm of Object.keys(raw)) norm[nm]=raw[nm]/rowSum*100;
    out[d]=norm;
  }
  return out;
}
function cbTipHtml(title, entries, candColors, wide){
  let tip=`<div class="tip-header">${to_tr_title(title)}</div>`;
  for (const [c,v] of entries){
    tip+=`<div class="tip-row"><div class="tip-party" ${wide?'style="width:100px;"':''}>${esc(c)}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${v}%; background-color: ${candColors[c]||'#888888'};"></div></div><div class="tip-pct">%${v.toFixed(1)}</div></div>`;
  }
  return tip;
}
function cbMapData(out, candColors){
  const provWinners={}, distWinners={}, heatColors={}, tooltips={};
  for (const d of Object.keys(out)){
    const entries=Object.entries(out[d]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
    if (!entries.length) continue;
    const win=entries[0];
    const nd=normalize_id(d);
    distWinners[nd]=win[0];
    heatColors[nd]=get_heatmap_color(candColors[win[0]]||'#888888', clamp(Math.max(0.3,Math.min(1.0,win[1]/65)),0,1));
    tooltips[nd]=cbTipHtml(get_display_label(d), entries, candColors, true);
  }
  const provMeans={}, provCnt={};
  for (const d of Object.keys(out)){
    const prov=String(d).replace(/\d+$/,'');
    provCnt[prov]=(provCnt[prov]||0)+1;
    if (!provMeans[prov]) provMeans[prov]={};
    const norms=out[d];
    for (const c of Object.keys(norms)) provMeans[prov][c]=(provMeans[prov][c]||0)+norms[c];
  }
  for (const prov of Object.keys(provMeans)){
    const cnt=provCnt[prov]||1;
    for (const c of Object.keys(provMeans[prov])) provMeans[prov][c]/=cnt;
    const entries=Object.entries(provMeans[prov]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
    if (!entries.length) continue;
    const win=entries[0];
    const nprov=normalize_id(prov);
    provWinners[nprov]=win[0];
    heatColors[nprov]=get_heatmap_color(candColors[win[0]]||'#888888', clamp(Math.max(0.3,Math.min(1.0,win[1]/65)),0,1));
    tooltips[nprov]=cbTipHtml(get_display_label(prov), entries, candColors, true);
  }
  return {provWinners, distWinners, heatColors, tooltips};
}
function cbComputeMaps(candsList, rn){
  const candData=cbNationalVotes(candsList);
  const cbRes={}, candColors={};
  for (const cd of candData){ cbRes[cd.name]=cd.votes; candColors[cd.name]=PARTY_COLORS[cd.party]||'#888888'; }
  const total=Object.values(cbRes).reduce((a,b)=>a+b,0);
  if (total<=0) return {cbRes, mapHtml:''};
  const out=cbCandDistPcts(state.fullResults, candsList, displayUserNat());
  let mapHtml='';
  if (Object.keys(out).length){
    const md=cbMapData(out, candColors);
    mapHtml=renderColoredSvg(SVG_TURKIYE, {provWinners:md.provWinners, distWinners:md.distWinners, colorsDict:candColors, tooltipDict:md.tooltips, seatsData:{}, showBadges:false, customColors:md.heatColors, uid:'cb'+rn, svgFile:'turkiye.svg', hiddenInputId:'hidden_prov_input_cb'+rn, detailSectionId:'cb_d'+rn+'_detail_section'});
  }
  return {cbRes, mapHtml};
}
function computeCbRound1(){
  const cb=cbState();
  const un=userNorm();
  if (Object.values(un).reduce((a,b)=>a+b,0)<=0) return;
  runSimulation();
  const {cbRes, mapHtml}=cbComputeMaps(cb.cands1, 1);
  const total=Object.values(cbRes).reduce((a,b)=>a+b,0);
  if (total<=0) return;
  const sorted1=Object.entries(cbRes).sort((a,b)=>b[1]-a[1]);
  const barData=sorted1.map(([aday,votes])=>[aday,(votes/total)*100]);
  const maxPct=barData.length?barData[0][1]:0;
  cb.res1=barData.map(([aday,pct])=>{
    const c=cb.cands1.find(x=>String(x.name).trim()===aday);
    return {name:aday, party_color:c?PARTY_COLORS[c.party]||'#888':'#888', vote_text:'%'+pct.toFixed(2), width:(maxPct>0?Math.min(100,(pct/maxPct)*100):0)+'%'};
  });
  cb.mapHtml1=mapHtml;
  const kazananOr=sorted1.length?sorted1[0][1]/total*100:0;
  cb.r1WinnerPct=kazananOr;
  cb.r1WinnerText='%'+kazananOr.toFixed(2);
  cb.r1Top1=sorted1[0]?sorted1[0][0]:'';
  cb.r1Top2=sorted1[1]?sorted1[1][0]:'';
  if (kazananOr>50){
    cb.cands2=[];
  } else {
    const findFork=n=>cb.cands1.find(c=>String(c.name).trim()===n);
    const c1=findFork(cb.r1Top1), c2=findFork(cb.r1Top2);
    cb.cands2=c1&&c2?[JSON.parse(JSON.stringify(c1)), JSON.parse(JSON.stringify(c2))]:[];
  }
  if (cb.r1.prov) setCbDetailProvince(1, cb.r1.prov);
  renderCB();
}
function computeCbRound2(){
  const cb=cbState();
  if (!cb.cands2 || cb.cands2.length<2) return;
  const un=userNorm();
  if (Object.values(un).reduce((a,b)=>a+b,0)<=0) return;
  runSimulation();
  const {cbRes, mapHtml}=cbComputeMaps(cb.cands2, 2);
  const total=Object.values(cbRes).reduce((a,b)=>a+b,0);
  if (total<=0) return;
  const sorted2=Object.entries(cbRes).sort((a,b)=>b[1]-a[1]);
  const barData=sorted2.map(([aday,votes])=>[aday,(votes/total)*100]);
  const maxPct=barData.length?barData[0][1]:0;
  const candColor2={}; for (const c of cb.cands2) candColor2[String(c.name).trim()]=PARTY_COLORS[c.party]||'#888';
  cb.res2=barData.map(([aday,pct])=>({name:aday, party_color:candColor2[aday]||'#888', vote_text:'%'+pct.toFixed(2), width:(maxPct>0?Math.min(100,(pct/maxPct)*100):0)+'%'}));
  cb.mapHtml2=mapHtml;
  if (cb.r2.prov) setCbDetailProvince(2, cb.r2.prov);
  renderCB();
}
function cbR1WinnerLine(cb){
  if (cb.r1WinnerPct>50) return `<div style="color:#1A8917;font-weight:900;font-size:14px;margin:4px 0">Seçim 1. Turda Bitti! ${esc(cb.r1Top1)} ${esc(cb.r1WinnerText)}</div>`;
  return `<div style="color:#B0540A;font-weight:900;font-size:14px;margin:4px 0">Hiçbir aday %50+1'e ulaşamadı. 2. tura kalındı.</div>`;
}
function cbDetailSectionHtml(rn){
  const det=rn===1?cbState().r1:cbState().r2;
  if (!det.prov) return `<div class="sb-card shadow section-card"><div style="font-weight:900;font-size:12px;color:var(--c-text-muted)">Dinamik il detayı: Haritada bir ile tıklayın.</div></div>`;
  const bars=det.activeBars||[];
  const labels=det.tabLabels||[];
  const ilceBars=det.ilceBarsMap&&det.ilceBarsMap[det.ilceSelected]||[];
  let inner=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">${esc(det.name)} İLİ DETAYLI ANALİZİ</div></div>
    <div style="font-weight:900;font-size:10px;color:var(--c-text-muted);letter-spacing:1.2px;margin:0 0 10px 12px">CUMHURBAŞKANLIĞI SEÇİMİ ${rn}. TUR</div>
    <div style="padding:0 14px">
      <div class="city-map-box" id="cb-city-map-${rn}"><div style="display:flex;justify-content:center;align-items:center;height:100%;color:#777;font-weight:bold;">İlçe haritası yükleniyor...</div></div>
      ${det.ilceSelected?`
        <div class="detail-translate">
          <div class="di-name">${getIlceName(String(det.prov).replace(/\d+$/,''), det.ilceSelected)}</div>
          <button data-act="cb-clear-ilce" data-rn="${rn}">← İl Geneli</button>
        </div>
        <div class="detail-bars">${ilceBars.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>
        `:`
        ${labels.length?`<div class="dist-nav">${labels.map((l,i)=>`<button class="dist-nav-trigger cb-dist-trigger" data-rn="${rn}" data-tab="${esc(l)}" ${l===det.activeTab?'data-active="true"':''}>${esc(l)}</button>`).join('')}</div>`:''}
        <div class="detail-bars">${bars.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>
        `}
    </div>
    <div style="display:flex;justify-content:center;margin-top:14px;width:100%">
      <button class="btn-download" id="btn-cb-il-info" data-rn="${rn}" style="margin:0 auto">İL İNFOGRAFİĞİNİ İNDİR (PNG)</button>
    </div>
  </div>`;
  return `<div id="cb_d${rn}_detail_section">${inner}</div>`;
}
function setCbDetailProvince(rn, prov){
  if (!prov) return;
  const cb=cbState();
  const det=rn===1?cb.r1:cb.r2;
  const cands=rn===1?cb.cands1:cb.cands2;
  const candColors={}, candPP={};
  for (const c of cands){ const nm=String(c.name||'').trim(); if (nm){ candColors[nm]=PARTY_COLORS[c.party]||'#888888'; candPP[nm]=c.party; } }
  det.prov=prov; det.name=get_display_label(prov);
  det.summary=[]; det.mapHtml=''; det.tabLabels=[]; det.barsMap={}; det.activeTab=''; det.activeBars=[];
  det.ilceSelected=''; det.ilceName=''; det.ilceBarsMap={};
  const normProv=String(prov).replace(/\d+$/,'');
  const display=displayUserNat();
  let candPcts=null, tabs={}, labels=[];
  const provDf=state.fullResults.filter(r=>normalize_id(r.province).startsWith(normProv)||String(r.province).replace(/\d+$/,'').startsWith(normProv));
  if (provDf.length){
    const out=cbCandDistPcts(provDf, cands, display);
    if (Object.keys(out).length){
      candPcts=out;
      const provDists=Object.keys(out);
      if (provDists.length>1){
        const means={}; let cnt=0;
        for (const d of provDists){ cnt++; for (const c of Object.keys(out[d])) means[c]=(means[c]||0)+out[d][c]; }
        for (const c of Object.keys(means)) means[c]/=cnt;
        labels.push('İl Geneli (Toplam)');
        tabs['İl Geneli (Toplam)']=cbBarItemsDetail(means, candColors, candPP);
        for (const d of provDists){
          const m=String(d).match(/(\d+)$/);
          const label=`${m?m[1]:d}. Bölge`;
          const items=cbBarItemsDetail(out[d], candColors, candPP);
          if (items.length){ labels.push(label); tabs[label]=items; }
        }
      } else if (provDists.length===1){
        tabs['']=cbBarItemsDetail(out[provDists[0]], candColors, candPP);
      }
    }
  }
  det.tabLabels=labels; det.barsMap=tabs; det.activeTab=labels[0]||''; det.activeBars=tabs[labels[0]||'']||tabs['']||[];
  if (candPcts){
    const means={}; let cnt=0;
    for (const d of Object.keys(candPcts)){ cnt++; for (const c of Object.keys(candPcts[d])) means[c]=(means[c]||0)+candPcts[d][c]; }
    for (const c of Object.keys(means)) means[c]/=cnt;
    const sorted=Object.entries(means).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
    det.summary=sorted.map(([c,v])=>({name:c, party:candPP[c]||'', color:candColors[c]||'#888888', pct:'%'+v.toFixed(1), logo:logoURL(candPP[c]||'')}));
  }
}
function selectCbProvince(rn, norm){
  setCbDetailProvince(rn, norm);
  renderCB();
  window.setTimeout(()=>{
    const sec=document.getElementById('cb_d'+rn+'_detail_section');
    if (sec) sec.scrollIntoView({behavior:'smooth', block:'start'});
  },60);
}
function setCbDetailDistTab(rn, tab){
  const det=rn===1?cbState().r1:cbState().r2;
  const m=det.barsMap||{};
  if (!(tab in m)) return;
  det.activeTab=tab; det.activeBars=m[tab];
  renderCB();
}
function setCbDetailIlce(rn, ilceId){
  if (!ilceId) return;
  const det=rn===1?cbState().r1:cbState().r2;
  if (ilceId===det.ilceSelected) return;
  det.ilceSelected=ilceId; det.ilceName=getIlceName(String(det.prov).replace(/\d+$/,''), String(ilceId));
  renderCB();
}
function clearCbDetailIlce(rn){
  const det=rn===1?cbState().r1:cbState().r2;
  det.ilceSelected=''; det.ilceName='';
  renderCB();
}
async function renderCbCityMap(rn, det){
  const normProv=String(det.prov).replace(/\d+$/,'');
  const cityData=await loadIlceData(normProv);
  if (!cityData) return;
  const svgText=await loadIlceSvg(normProv);
  if (!svgText) return;
  const cands=rn===1?cbState().cands1:cbState().cands2;
  const candColors={}, candPP={};
  for (const c of cands){ const nm=String(c.name||'').trim(); if (nm){ candColors[nm]=PARTY_COLORS[c.party]||'#888888'; candPP[nm]=c.party; } }
  const un=userNorm();
  if (!Object.keys(un).length) return;
  const yearData={}, seats0={};
  for (const n of Object.keys(cityData)){
    const pMap={};
    for (const P of Object.keys(cityData[n].parties)){ const v=cityData[n].parties[P]; pMap[P]={v18:v.v18||0,v23:v.v23||0,v24:v.v24||0}; }
    yearData[n]=pMap; seats0[n]=0;
  }
  const baseRes=applyCustomPartiesJS(yearData, seats0, state.w18, state.w23, state.w24, state.customPartiesDef);
  const baseObjN=_weightedBase(state.w18,state.w23,state.w24,state.customPartiesDef);
  let cityRes;
  try{ cityRes=run_simulation({base:baseRes.base, seats:seats0}, baseObjN.nat, un, alliancesObj(), jointListsObj(), state.threshold, state.allocation, REGIONAL_BOOSTS_DEFAULT, allParties(), Object.keys(yearData)); }
  catch(e){ return; }
  const cityCand=cbCandDistPcts(cityRes, cands, displayUserNat());
  const candDistWinners={}, candDistColors={}, cbTooltips={}, ilceBarsMap={};
  for (const d of Object.keys(cityCand)){
    const entries=Object.entries(cityCand[d]).map(x=>[x[0],parseFloat(x[1])]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
    if (!entries.length) continue;
    const nDist=normalize_id(d);
    candDistWinners[nDist]=entries[0][0];
    candDistColors[nDist]=get_heatmap_color(candColors[entries[0][0]]||'#888888', clamp(Math.max(0.3,Math.min(1.0,entries[0][1]/50)),0,1));
    const maxV=entries[0][1]||1;
    let tipH=`<div class="tip-header">${getIlceName(normProv, nDist)}</div>`;
    for (const [c,v] of entries.slice(0,5)){
      tipH+=`<div class="tip-row"><div class="tip-party">${esc(c)}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${Math.min(100,(v/maxV)*100).toFixed(1)}%; background-color: ${candColors[c]||'#888888'};"></div></div><div class="tip-pct">%${v.toFixed(1)}</div></div>`;
    }
    cbTooltips[nDist]=tipH;
    ilceBarsMap[nDist]=cbBarItemsDetail(cityCand[d], candColors, candPP);
  }
  if (!Object.keys(candDistWinners).length) return;
  det.ilceBarsMap=ilceBarsMap;
  const mapHtml=renderColoredSvg(svgText, {provWinners:{}, distWinners:candDistWinners, colorsDict:candColors, tooltipDict:cbTooltips, seatsData:{}, showBadges:false, customColors:candDistColors, uid:'cbi'+rn, svgFile:normProv+'.svg', hiddenInputId:'hidden_cb_city_r'+rn, detailSectionId:'cb_d'+rn+'_detail_section'});
  det.mapHtml=mapHtml;
  const box=$('#cb-city-map-'+rn);
  if (box){ box.innerHTML=mapHtml; bindMapWrapper('cbi'+rn, norm=>setCbDetailIlce(rn, norm)); }
}
function renderCbCityMapAsync(rn){
  const det=rn===1?cbState().r1:cbState().r2;
  if (!det.prov) return;
  renderCbCityMap(rn, det);
}
function setCbCandidateVote(candId, group, value){
  let val; try{ val=parseFloat(value); }catch(e){ return; }
  if (isNaN(val)) return;
  val=Math.max(0,Math.min(100,val));
  for (const c of cbState().cands1){ if (c.id===candId){ c.votes[group]=val; break; } }
}
function setCbCandidateName(candId, name){
  for (const c of cbState().cands1){ if (c.id===candId){ c.name=name; break; } }
}
function toggleCbPicker(id){
  const cb=cbState();
  cb.pickerOpenId=cb.pickerOpenId===id?'':id;
  renderCB();
}
function closeCbPicker(){ cbState().pickerOpenId=''; renderCB(); }
function selectCbParty(candId, party){
  for (const c of cbState().cands1){ if (c.id===candId){ c.party=party; break; } }
  cbState().pickerOpenId='';
  renderCB();
}
function addCbCandidate(){
  const cb=cbState();
  const v={}; for (const k of cbVoteKeys()) v[k]=0;
  cb.cands1.push({id:'c1_'+cb.nextC1Id, name:'Aday '+(cb.cands1.length+1), party:'YENI', votes:v});
  cb.nextC1Id++;
  renderCB();
}
function removeCbCandidate(candId){
  const cb=cbState();
  if (cb.cands1.length>1) cb.cands1=cb.cands1.filter(c=>c.id!==candId);
  renderCB();
}
function resetCbCandidates(){ cbState().cands1=JSON.parse(JSON.stringify(DEFAULT_CB_CANDS_1)); renderCB(); }
function setCb2Vote(group, value){
  const cb=cbState();
  if (!cb.cands2 || cb.cands2.length<2) return;
  let val; try{ val=parseFloat(value); }catch(e){ return; }
  if (isNaN(val)) return;
  val=Math.max(0,Math.min(100,val));
  cb.cands2[0].votes[group]=val;
  cb.cands2[1].votes[group]=Math.max(0,100-val);
  renderCB();
}
function setCb2Name(idx, value){
  const cb=cbState();
  if (!cb.cands2 || !cb.cands2[idx]) return;
  const nm=String(value||'').trim();
  if (!nm) return;
  cb.cands2[idx].name=nm;
  renderCB();
}
function bindCBEvents(){
  const on=(id,fn)=>{ const e=$('#pane_cb #'+id); if (e) e.onclick=fn; };
  on('cb-add-cand',()=>addCbCandidate());
  on('cb-reset-cands',()=>resetCbCandidates());
  on('cb-round1-btn',()=>computeCbRound1());
  on('cb-round2-btn',()=>computeCbRound2());
  on('cb-dl-1',()=>downloadCbInfographic(1));
  on('cb-dl-2',()=>downloadCbInfographic(2));
  $$('#pane_cb .cb-name-input:not(.cb-r2-name-input)').forEach(inp=>{ inp.onchange=()=>{ setCbCandidateName(inp.getAttribute('data-cand'), inp.value); }; });
  $$('#pane_cb .cb-r2-name-input').forEach(inp=>{ inp.onchange=()=>{ setCb2Name(parseInt(inp.getAttribute('data-r2-idx'),10), inp.value); }; });
  $$('#pane_cb .cb-num:not(.cb-r2-num)').forEach(inp=>{ inp.onchange=()=>{ setCbCandidateVote(inp.getAttribute('data-cand'), inp.getAttribute('data-group'), inp.value); }; });
  $$('#pane_cb .cb-r2-num').forEach(inp=>{ inp.onchange=()=>{ setCb2Vote(inp.getAttribute('data-group'), inp.value); }; });
  $$('#pane_cb .cb-party-btn').forEach(btn=>{ btn.onclick=()=>{ toggleCbPicker(btn.id.replace('cb-party-','')); }; });
  $$('#pane_cb .cb-picker-close').forEach(btn=>{ btn.onclick=()=>closeCbPicker(); });
  $$('#pane_cb .cb-picker-row').forEach(row=>{ row.onclick=()=>{ selectCbParty(row.getAttribute('data-cand'), row.getAttribute('data-party')); }; });
  $$('#pane_cb .cb-del').forEach(btn=>{ btn.onclick=()=>removeCbCandidate(btn.getAttribute('data-cand')); });
  $$('#pane_cb [data-act="cb-clear-ilce"]').forEach(btn=>{ btn.onclick=()=>clearCbDetailIlce(parseInt(btn.getAttribute('data-rn'),10)); });
  $$('#pane_cb .cb-dist-trigger').forEach(b=>{ b.addEventListener('click',()=>{ setCbDetailDistTab(parseInt(b.getAttribute('data-rn'),10), b.getAttribute('data-tab')); }); });
  $$('#pane_cb #btn-cb-il-info').forEach(b=>{ b.onclick=()=>downloadCbIlInfographic(parseInt(b.getAttribute('data-rn'),10)); });
}
function renderCB(){
  const pane=$('#pane_cb');
  if (!pane) return;
  const cb=cbState();
  const simOk=cb.res1.length>0;
  const r2Ok=cb.cands2&&cb.cands2.length>1;
  const r2resOk=cb.res2.length>0;
  let html=`<div class="tab-pane-inner">`;

  html+=`<div class="dual">
    <div class="half"><div class="colstack">
      <div class="sb-kicker"><div class="bar"></div><div class="t">1. TUR ADAYLARI</div></div>
      <div class="cb-topbar"><button class="btn-side" id="cb-add-cand">Yeni Aday Ekle</button><button class="btn-side" id="cb-reset-cands">Sıfırla</button></div>
      <div class="cb-hint">Adayların ideolojik bloklardan alacağı destek oranlarını (%) düzenleyin. Sonucu görmek için alttaki butona basın.</div>
      <div class="cand-list">${cb.cands1.map(c=>cbCandidateCardHtml(c)).join('')}</div>
      <button class="btn-calc" id="cb-round1-btn">1. TUR SONUÇLARINI &amp; HARİTASINI HESAPLA</button>
    </div></div>
    <div class="half"><div class="colstack">
      <div class="sb-kicker"><div class="bar"></div><div class="t">1. TUR SONUÇLARI</div></div>
      ${simOk?cbR1WinnerLine(cb)+`<div class="scroll" style="flex:1;min-height:0;overflow-y:auto">${cb.res1.map(cbBarRowHtml).join('')}</div>`:`<div class="big-note">Aday desteklerini düzenleyip hesapladığınızda 1. tur sonuçları burada görünür.</div>`}
    </div></div>
  </div>`;

  if (simOk){
    html+=`<div class="map-card">
      <div class="map-card-head">
        <div class="sb-kicker" style="margin-bottom:0"><div class="bar"></div><div class="t">1. TUR HARİTASI</div></div>
        <div class="map-hint" style="margin:0">İle tıklayın: ilçe bazlı CB sonuçları</div>
      </div>
      <div class="map-frame">${cb.mapHtml1||emptyMap()}</div>
    </div>`;
    html+=cbDetailSectionHtml(1);
    html+=`<div class="sb-card shadow section-card">
      <button class="btn-download" id="cb-dl-1">İNFOGRAFİK İNDİR (PNG)</button>
      <div class="big-note">İnfografik, simülasyon çalıştırıldığında otomatik oluşturulur.</div>
    </div>`;
  }

  if (r2Ok){
    html+=`<div class="sb-card shadow" style="margin-top:16px">
      <div class="sb-kicker"><div class="bar"></div><div class="t">2. TUR SENARYOSU</div></div>
      <div style="font-weight:900;color:var(--c-accent-2);font-size:16px;margin:2px 0 2px 0">${esc(cb.r1Top1)} vs ${esc(cb.r1Top2)}</div>
      <div class="cb-hint">1. Adayın oyunu girdiğinizde, 2. adayın oyu 100'e tamamlanacak şekilde otomatik belirlenir.</div>
      <div class="cand-list">${cb.cands2.map(c=>cbR2CardHtml(c)).join('')}</div>
      <button class="btn-calc" id="cb-round2-btn">2. TUR SONUÇLARINI &amp; HARİTASINI HESAPLA</button>
      ${r2resOk?cbR2ResultsHtml(cb):''}
    </div>`;
  }

  html+=`<div class="sb-card shadow section-card" style="margin-top:16px">
    <div style="font-size:13px;color:var(--c-text-muted)">CB haritalarından bir ile tıklayın; o ilin ilçe bazlı cumhurbaşkanlığı sonuçlarını o turun altında görürsünüz.</div>
  </div>`;

  html+=`</div>`;
  pane.innerHTML=html;

  renderSidebar();
  bindCBEvents();

  if (simOk){ window.setTimeout(()=>{ if ($('#map-wrapper-cb1')) bindMapWrapper('cb1', norm=>selectCbProvince(1, norm)); },30); }
  if (r2resOk){ window.setTimeout(()=>{ if ($('#map-wrapper-cb2')) bindMapWrapper('cb2', norm=>selectCbProvince(2, norm)); },30); }
  if (cb.r1.prov) renderCbCityMapAsync(1);
  if (cb.r2.prov && r2resOk) renderCbCityMapAsync(2);
}
function cbR2ResultsHtml(cb){
  return `<div class="sb-card shadow" style="margin-top:12px">
    <div class="sb-kicker"><div class="bar"></div><div class="t">2. TUR SONUÇLARI</div></div>
    ${cb.res2.map(cbBarRowHtml).join('')}
    <div style="color:#1A8917;font-weight:900;font-size:14px;margin-top:10px">Türkiye'nin Cumhurbaşkanı: ${esc(cb.res2[0]?cb.res2[0].name:'')} (${cb.res2[0]?esc(cb.res2[0].vote_text):''})</div>
  </div>
  <div class="map-card">
    <div class="map-card-head">
      <div class="sb-kicker" style="margin-bottom:0"><div class="bar"></div><div class="t">CUMHURBAŞKANLIĞI HARİTASI (2. TUR)</div></div>
      <div class="map-hint" style="margin:0">İle tıklayın: ilçe bazlı CB sonuçları</div>
    </div>
    <div class="map-frame">${cb.mapHtml2||emptyMap()}</div>
  </div>
  ${cbDetailSectionHtml(2)}
  <div class="sb-card shadow section-card">
    <button class="btn-download" id="cb-dl-2">İNFOGRAFİK İNDİR (PNG)</button>
    <div class="big-note">İnfografik, simülasyon çalıştırıldığında otomatik oluşturulur.</div>
  </div>`;
}

// ---------------- İNFOGRAFİK (port of app.py generators + downloadSvgAsPng) ----------------
const INFO_BASE_SEATS_2023 = {AKP:268,CHP:169,DEM:61,MHP:50,IYI:43,YRP:5,TIP:4,ZAFER:0,YENI:0,A:0,BBP:0,SAADET:0,HUDA:0,TKP:0,DEVA:0,DP:0,BTP:0};
const LOGO_INNER_CACHE = {};
async function fetchLogoInner(party){
  if (LOGO_INNER_CACHE[party]!==undefined) return LOGO_INNER_CACHE[party];
  try{
    const txt = await fetch(logoURL(party)).then(r=>r.ok?r.text():'');
    const m = /<svg\b[^>]*>([\s\S]*?)<\/svg>/i.exec(txt);
    if (!m){ LOGO_INNER_CACHE[party]=''; return ''; }
    let inner = m[1]
      .replace(/<sodipodi:namedview\b[^>]*>[\s\S]*?<\/sodipodi:namedview>/g,'')
      .replace(/<sodipodi:[^>]*\/?>/g,'')
      .replace(/\s(?:inkscape|sodipodi):[a-zA-Z-]+="[^"]*"/g,'');
    const vbm = /viewBox\s*=\s*"([^"]+)"/.exec(txt);
    const res = {inner, vb: vbm?vbm[1]:'0 0 64 64'};
    LOGO_INNER_CACHE[party]=res;
    return res;
  }catch(e){ LOGO_INNER_CACHE[party]=''; return ''; }
}
function inlineLogoSvg(li, x, y, size){
  if (!li || !li.inner) return '';
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${li.vb}" preserveAspectRatio="xMidYMid meet" overflow="visible" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">${li.inner}</svg>`;
}
function cleanMapForInfographic(html){
  let m = String(html).replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'');
  const im = /<svg\b[^>]*>[\s\S]*?<\/svg>/i.exec(m);
  if (!im) return m;
  return im[0].replace(/<svg\b[^>]*>/, function(tag){
    return tag
      .replace(/\b(width|height)=["'][^"']*["']/g,'')
      .replace(/\bstyle=(["'])[^"']*\1/, '')
      .replace(/\boverflow=(["'])[^"']*\1/, '')
      .replace(/\s*\/?>$/, ' overflow="visible">');
  });
}
async function appLogoInline(x, y, width, height){
  try{
    const txt = await fetch('logo.svg').then(r=>r.ok?r.text():'').catch(()=> '');
    if (!txt) return '';
    const m = /<svg\b[^>]*>([\s\S]*?)<\/svg>/i.exec(txt);
    if (!m) return '';
    let inner = m[1]
      .replace(/<sodipodi:namedview\b[^>]*>[\s\S]*?<\/sodipodi:namedview>/g,'')
      .replace(/<sodipodi:[^>]*\/?>/g,'')
      .replace(/\s(?:inkscape|sodipodi):[a-zA-Z-]+="[^"]*"/g,'');
    const vbm = /viewBox\s*=\s*"([^"]+)"/.exec(txt);
    const vb = vbm?vbm[1]:'0 0 300 34';
    return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" overflow="visible" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">${inner}</svg>`;
  }catch(e){ return ''; }
}
// renders the colored Turkey map used inside infographics (no tooltips/badges)
function infoTurkeyMapHtml(){
  const df=state.fullResults;
  const provWinners={}, distWinners={}, customColors={};
  const byProv={};
  for (const r of df) (byProv[r.province]=byProv[r.province]||[]).push(r);
  for (const prov of Object.keys(byProv)){
    const nrm=normalize_id(prov);
    const agg=aggRows(byProv[prov]);
    const top=agg.filter(o=>o.pct>0).sort((a,b)=>b.pct-a.pct)[0];
    if (!top) continue;
    provWinners[nrm]=top.party;
    customColors[nrm]=get_heatmap_color(PARTY_COLORS[top.party]||'#888888', clamp(Math.max(0.3,Math.min(1.0,top.pct/65)),0,1));
    const base=nrm.replace(/\d+$/,'');
    if (['istanbul','ankara','izmir','bursa'].includes(base)){
      provWinners[base]=top.party; customColors[base]=customColors[nrm];
      for (let i=1;i<=3;i++){ provWinners[base+i]=top.party; customColors[base+i]=customColors[nrm]; }
    }
  }
  const dWinners={};
  for (const r of df){ if (!dWinners[r.d] || r.new_vote_pct>dWinners[r.d].vote) dWinners[r.d]={p:r.p,vote:r.new_vote_pct}; }
  for (const d of Object.keys(dWinners)){
    const nd=normalize_id(d);
    distWinners[nd]=dWinners[d].p;
    customColors[nd]=get_heatmap_color(PARTY_COLORS[dWinners[d].p]||'#888888', clamp(Math.max(0.3,Math.min(1.0,dWinners[d].vote/65)),0,1));
  }
  const seatsData={};
  for (const r of df) seatsData[[r.d,r.p].join('\u0000')]=r.seats_won;
  return renderColoredSvg(SVG_TURKIYE, {provWinners, distWinners, colorsDict:PARTY_COLORS, tooltipDict:{}, seatsData, showBadges:false, customColors, uid:'infogen', svgFile:'turkiye.svg'});
}
async function generateInfographicSvg(summaryRows, mapSvgClean, totalSeats, assignedParties, colors, alliances){
  const partyToAly={};
  for (const aly of Object.keys(alliances)) for (const p of alliances[aly]) partyToAly[p]=aly;
  const winning=summaryRows.filter(r=>r.Vekil>0);
  const blocks={};
  for (const row of winning){ const k=partyToAly[row.Parti]||row.Parti; (blocks[k]=blocks[k]||[]).push(row); }
  const sortedBlocks=Object.entries(blocks).sort((a,b)=>sumRows(b[1])-sumRows(a[1]));
  function sumRows(rows){ return rows.reduce((a,r)=>a+r['Normalize Oy (%)'],0); }
  const sortedPartyRows=[], blockSpans=[];
  for (const [alyName,pRows] of sortedBlocks){
    const startIdx=sortedPartyRows.length;
    sortedPartyRows.push(...pRows.slice().sort((a,b)=>b['Normalize Oy (%)']-a['Normalize Oy (%)']));
    if (sortedPartyRows.length-1>=startIdx && alyName in alliances && pRows.length>1) blockSpans.push([alyName,startIdx,sortedPartyRows.length-1]);
  }
  if (!sortedPartyRows.length) sortedPartyRows.push(...summaryRows.slice(0,4));
  const cardSize=80, cardSpacing=22;
  const startX=(1200-(sortedPartyRows.length*cardSize+(sortedPartyRows.length-1)*cardSpacing))/2;
  let svg='<svg width="1200" height="980" viewBox="0 0 1200 980" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="background-color: #FFFFFF; font-family: \'Helvetica Neue\', Helvetica, Arial, sans-serif;"><rect width="100%" height="100%" fill="#FFFFFF" />';
  for (const [alyName,sIdx,eIdx] of blockSpans){
    const bx1=startX+sIdx*(cardSize+cardSpacing), bx2=startX+eIdx*(cardSize+cardSpacing)+cardSize;
    let displayAly=alyName;
    if (eIdx-sIdx===0 && alyName.length>15) displayAly=alyName.replace(' İttifakı',' İtt.');
    const fSize=displayAly.length>15?'10':'12';
    svg+=`<line x1="${bx1}" y1="36" x2="${bx2}" y2="36" stroke="#CCCCCC" stroke-width="2"/><text x="${(bx1+bx2)/2}" y="25" text-anchor="middle" font-size="${fSize}" font-weight="800" fill="#1A1A1A">${esc(displayAly)}</text>`;
  }
  for (let idx=0; idx<sortedPartyRows.length; idx++){
    const row=sortedPartyRows[idx];
    const pName=row.Parti, seats=Math.round(row.Vekil), vote=parseFloat(row['Normalize Oy (%)']);
    const color=colors[pName]||'#888888', cx=startX+idx*(cardSize+cardSpacing);
    svg+=`<rect x="${cx+3}" y="55" width="${cardSize}" height="${cardSize}" fill="#111827" rx="2"/><rect x="${cx}" y="52" width="${cardSize}" height="${cardSize}" fill="${color}" stroke="#111827" stroke-width="1.5" rx="2"/>`;
    const li=await fetchLogoInner(pName);
    if (li) svg+=inlineLogoSvg(li, cx+10, 62, cardSize-20);
    else svg+=`<text x="${cx+cardSize/2}" y="${52+cardSize/2+7}" text-anchor="middle" fill="#FFFFFF" font-weight="900" font-size="18">${esc(pName)}</text>`;
    svg+=`<text x="${cx+cardSize/2}" y="160" text-anchor="middle" fill="#1A1A1A" font-weight="900" font-size="24">${seats}</text><text x="${cx+cardSize/2}" y="180" text-anchor="middle" fill="#71716E" font-weight="700" font-size="13">% ${vote.toFixed(2)}</text>`;
  }
  svg+=`<svg x="30" y="190" width="1120" height="475">${mapSvgClean}</svg>`;
  const radii=[]; for (let r=130;r<265;r+=10) radii.push(r);
  let seatsPerRow=radii.map(r=>Math.round(totalSeats*(r/radii.reduce((a,b)=>a+b,0))));
  const spSum=seatsPerRow.reduce((a,b)=>a+b,0);
  if (spSum!==totalSeats) seatsPerRow[seatsPerRow.length-1]+=(totalSeats-spSum);
  const points=[];
  for (let ri=0;ri<radii.length;ri++){
    const r=radii[ri], s=seatsPerRow[ri];
    if (s<=0) continue;
    for (let j=0;j<s;j++){
      const angle=Math.PI-(Math.PI*j)/Math.max(1,(s-1));
      points.push({x:r*Math.cos(angle), y:r*Math.sin(angle), angle, r});
    }
  }
  points.sort((a,b)=> (b.angle-a.angle) || (a.r-b.r));
  svg+='<g transform="translate(930, 960)">';
  for (let i=0;i<assignedParties.length;i++){
    if (i<points.length) svg+=`<circle cx="${points[i].x}" cy="${-points[i].y}" r="5.0" fill="${colors[assignedParties[i]]||'#888'}" />`;
  }
  svg+=`<text x="0" y="-272" text-anchor="middle" font-size="14" font-weight="900" fill="#1A1A1A">Çoğunluk</text><line x1="0" y1="-262" x2="0" y2="-118" stroke="#1A1A1A" stroke-width="2" stroke-dasharray="5,5"/><text x="0" y="-12" text-anchor="middle" font-size="44" font-weight="900" fill="#1A1A1A">${totalSeats}</text></g>`;
  svg+=await appLogoInline(40,932,280,32);
  svg+='</svg>';
  return svg;
}
async function generateRegionalInfographicSvg(provinceName, topParties, mapSvgClean, colors){
  const cardSize=80, cardSpacing=22;
  const rows=topParties.slice();
  const startX=(1200-(rows.length*cardSize+(rows.length-1)*cardSpacing))/2;
  let svg='<svg width="1200" height="980" viewBox="0 0 1200 980" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="background-color: #FFFFFF; font-family: \'Helvetica Neue\', Helvetica, Arial, sans-serif;"><rect width="100%" height="100%" fill="#FFFFFF" />';
  svg+=`<text x="600" y="30" text-anchor="middle" font-size="20" font-weight="900" fill="#1A1A1A" letter-spacing="1px">${esc(provinceName)} İLİ SEÇİM SONUÇLARI</text>`;
  for (let idx=0; idx<rows.length; idx++){
    const row=rows[idx];
    const pName=row.party, votePct=parseFloat(row.new_vote_pct), seats=Math.round(row.seats_won||0);
    const color=colors[pName]||'#888888', cx=startX+idx*(cardSize+cardSpacing);
    svg+=`<rect x="${cx+3}" y="55" width="${cardSize}" height="${cardSize}" fill="#111827" rx="2"/><rect x="${cx}" y="52" width="${cardSize}" height="${cardSize}" fill="${color}" stroke="#111827" stroke-width="1.5" rx="2"/>`;
    const li=await fetchLogoInner(pName);
    if (li) svg+=inlineLogoSvg(li, cx+10, 62, cardSize-20);
    else svg+=`<text x="${cx+cardSize/2}" y="${52+cardSize/2+7}" text-anchor="middle" fill="#FFFFFF" font-weight="900" font-size="18">${esc(pName)}</text>`;
    svg+=`<text x="${cx+cardSize/2}" y="160" text-anchor="middle" fill="#1A1A1A" font-weight="900" font-size="24">${seats}</text><text x="${cx+cardSize/2}" y="180" text-anchor="middle" fill="#71716E" font-weight="700" font-size="13">% ${votePct.toFixed(2)}</text>`;
  }
  svg+=`<svg x="20" y="205" width="1160" height="685">${mapSvgClean}</svg>`;
  svg+=await appLogoInline(40,932,280,32);
  svg+='</svg>';
  return svg;
}
async function generateCbInfographicSvg(title, candsData, mapSvgClean, candColors){
  const cardWidth=170, cardHeight=65, cardSpacing=25;
  const topCands=candsData.slice().sort((a,b)=>b[1]-a[1]).filter(c=>c[1]>0).slice(0,5);
  if (!topCands.length) topCands.push(...candsData.slice(0,2));
  const startX=(1200-(topCands.length*cardWidth+(topCands.length-1)*cardSpacing))/2;
  let svg='<svg width="1200" height="980" viewBox="0 0 1200 980" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="background-color: #FFFFFF; font-family: \'Helvetica Neue\', Helvetica, Arial, sans-serif;"><rect width="100%" height="100%" fill="#FFFFFF" />';
  svg+=`<text x="600" y="45" text-anchor="middle" font-size="24" font-weight="900" fill="#1A1A1A" letter-spacing="1px">${esc(title)}</text>`;
  for (let idx=0; idx<topCands.length; idx++){
    const [candName,pct]=topCands[idx];
    const color=candColors[candName]||'#888888', cx=startX+idx*(cardWidth+cardSpacing);
    svg+=`<rect x="${cx+3}" y="73" width="${cardWidth}" height="${cardHeight}" fill="#111827" rx="2"/><rect x="${cx}" y="70" width="${cardWidth}" height="${cardHeight}" fill="${color}" stroke="#111827" stroke-width="1.5" rx="2"/>`;
    const lastWord=String(candName).split(' ').pop();
    let candShort=lastWord.length>15?lastWord.toUpperCase().slice(0,14)+'.':lastWord.toUpperCase();
    svg+=`<text x="${cx+cardWidth/2}" y="${70+cardHeight/2+6}" text-anchor="middle" fill="#FFFFFF" font-weight="900" font-size="18">${esc(candShort)}</text><text x="${cx+cardWidth/2}" y="180" text-anchor="middle" fill="#1A1A1A" font-weight="900" font-size="28">% ${pct.toFixed(2)}</text>`;
  }
  svg+=`<svg x="20" y="205" width="1160" height="685">${mapSvgClean}</svg>`;
  svg+=await appLogoInline(40,932,280,32);
  svg+='</svg>';
  return svg;
}
function downloadSvgAsPng(containerId, filename){
  const container=document.getElementById(containerId);
  if (!container) return;
  const svg=container.querySelector('svg');
  if (!svg) return;
  const canvas=document.createElement('canvas');
  const scale=2;
  canvas.width=1200*scale; canvas.height=980*scale;
  const ctx=canvas.getContext('2d');
  ctx.scale(scale,scale);
  const img=new Image();
  img.onload=function(){
    ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
    const a=document.createElement('a');
    a.download=filename; a.href=canvas.toDataURL('image/png'); a.click();
  };
  img.src=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml;charset=utf-8'}));
}
async function downloadNationalInfographic(){
  if (!state.fullResults.length) return;
  const total=Object.values(state.userInputs).reduce((a,b)=>a+(b||0),0);
  const display=displayUserNat();
  const jointL=jointListsObj();
  const katilanPartiler=[].concat(...Object.values(jointL));
  const seatMap={}; for (const r of state.simResults) seatMap[r.party]=r.seats_won;
  const adjBase=Object.assign({}, INFO_BASE_SEATS_2023);
  for (const umbrella of Object.keys(jointL)) for (const jp of jointL[umbrella]) adjBase[umbrella]=(adjBase[umbrella]||0)+(adjBase[jp]||0);
  const summaryRows=[];
  for (const p of state.activeParties){
    if (katilanPartiler.indexOf(p)>=0) continue;
    const seats=seatMap[p]||0;
    summaryRows.push({Parti:p, 'Normalize Oy (%)':Math.round((display[p]||0)*100)/100, Vekil:seats, 'Vekil Değişimi':seats-(adjBase[p]||0)});
  }
  summaryRows.sort((a,b)=>(b['Normalize Oy (%)']-a['Normalize Oy (%)'])||(b.Vekil-a.Vekil));
  const toplamVekil=summaryRows.reduce((a,r)=>a+r.Vekil,0);
  const sirali=[...PARLIAMENT_ORDER].filter(p=>summaryRows.some(r=>r.Parti===p)).concat(summaryRows.filter(r=>PARLIAMENT_ORDER.indexOf(r.Parti)<0).map(r=>r.Parti));
  const assignedParties=[];
  for (const p of sirali){ const v=summaryRows.find(r=>r.Parti===p); if (v) for (let i=0;i<v.Vekil;i++) assignedParties.push(p); }
  const mapHtml=infoTurkeyMapHtml();
  const svg=await generateInfographicSvg(summaryRows, cleanMapForInfographic(mapHtml), toplamVekil, assignedParties, PARTY_COLORS, alliancesObj());
  let cont=document.getElementById('info-cont-general');
  if (!cont){ cont=document.createElement('div'); cont.id='info-cont-general'; cont.style.cssText='position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;'; document.body.appendChild(cont); }
  cont.innerHTML=svg;
  downloadSvgAsPng('info-cont-general','turkiye_secim_infografik.png');
}
async function downloadMecIlInfographic(){
  if (!state.detailProv) return;
  const df=state.fullResults;
  const provDf=df.filter(r=>normalize_id(r.province)===state.detailProv||String(r.province).replace(/\d+$/,'')===state.detailProv);
  if (!provDf.length) return;
  const agg=aggRows(provDf);
  const topByVote=[...agg].sort((a,b)=>b.pct-a.pct).slice(0,5).map(o=>o.party);
  const seatWinners=agg.filter(o=>o.seats>0).map(o=>o.party);
  const keep=[]; for (const p of topByVote.concat(seatWinners)) if (keep.indexOf(p)<0) keep.push(p);
  const topRows=keep.map(p=>{ const o=agg.find(x=>x.party===p); return {party:p, new_vote_pct:o?o.pct:0, seats_won:o?o.seats:0}; });
  const cityHtml=state.detailCityMapHtml;
  const mapClean=cityHtml?cleanMapForInfographic(cityHtml):'';
  const svg=await generateRegionalInfographicSvg(get_display_label(state.detailProv), topRows, mapClean, PARTY_COLORS);
  let cont=document.getElementById('info-cont-mec-il');
  if (!cont){ cont=document.createElement('div'); cont.id='info-cont-mec-il'; cont.style.cssText='position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;'; document.body.appendChild(cont); }
  cont.innerHTML=svg;
  downloadSvgAsPng('info-cont-mec-il', get_display_label(state.detailProv).replace(/ /g,'_')+'_mec_infografik.png');
}
async function downloadCbInfographic(rn){
  const cb=cbState();
  const res=rn===1?cb.res1:cb.res2;
  const mapHtml=rn===1?cb.mapHtml1:cb.mapHtml2;
  if (!res.length || !mapHtml) return;
  const candsData=res.map(r=>[r.name, parseFloat(r.vote_text.replace('%',''))]);
  const candColors={}; for (const r of res) candColors[r.name]=r.party_color;
  const title=rn===1?'CUMHURBAŞKANLIĞI 1. TUR SONUÇLARI':'CUMHURBAŞKANLIĞI 2. TUR SONUÇLARI';
  const svg=await generateCbInfographicSvg(title, candsData, cleanMapForInfographic(mapHtml), candColors);
  let cont=document.getElementById('info-cont-cb'+rn);
  if (!cont){ cont=document.createElement('div'); cont.id='info-cont-cb'+rn; cont.style.cssText='position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;'; document.body.appendChild(cont); }
  cont.innerHTML=svg;
  downloadSvgAsPng('info-cont-cb'+rn, 'cb_'+rn+'_tur.png');
}
async function downloadCbIlInfographic(rn){
  const det=rn===1?cbState().r1:cbState().r2;
  if (!det.summary.length || !det.mapHtml) return;
  const candsData=det.summary.map(s=>[s.name, parseFloat(s.pct.replace('%',''))]);
  const candColors={}; for (const s of det.summary) candColors[s.name]=s.color;
  const title=String(det.name)+' İLİ CUMHURBAŞKANLIĞI '+rn+'. TUR SONUÇLARI';
  const svg=await generateCbInfographicSvg(title, candsData, cleanMapForInfographic(det.mapHtml), candColors);
  let cont=document.getElementById('info-cont-cb-il-'+rn);
  if (!cont){ cont=document.createElement('div'); cont.id='info-cont-cb-il-'+rn; cont.style.cssText='position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;'; document.body.appendChild(cont); }
  cont.innerHTML=svg;
  downloadSvgAsPng('info-cont-cb-il-'+rn, det.name.replace(/ /g,'_')+'_cb_infografik.png');
}

// ---------------- YEREL SEÇİM (il bazlı yerel model) ----------------
// 2024 tabanı + ulusal senaryo girdisi üzerinden logit swing, il bazlı büyük/minör
// ayrımı ve blok çekim akışı (CB mekaniğine benzer) ile belediye başkanı tahmini.
// Parti güç ayarı: 2024 geri testinde doğruluğu düşürdüğü için kaldırıldı (kazanan %85->%88).
const YEREL_NERF = {};
const YEREL_MATRIX_DEFAULTS = {
  'AKP':   {'AKP':1.0,'YENI':0.0,'DEM':0.0,'Cumhur':0.85,'Milliyetçi Muh.':0.30,'Sol Muh.':0.0,'Muhafazakar Muh.':0.60},
  'YENI':  {'AKP':0.0,'YENI':1.0,'DEM':0.35,'Cumhur':0.0,'Milliyetçi Muh.':0.25,'Sol Muh.':0.65,'Muhafazakar Muh.':0.10},
  'DEM':   {'AKP':0.0,'YENI':0.45,'DEM':1.0,'Cumhur':0.0,'Milliyetçi Muh.':0.10,'Sol Muh.':0.55,'Muhafazakar Muh.':0.0},
  'MHP':   {'AKP':0.80,'YENI':0.0,'DEM':0.0,'Cumhur':1.0,'Milliyetçi Muh.':0.35,'Sol Muh.':0.0,'Muhafazakar Muh.':0.55},
  'BBP':   {'AKP':0.85,'YENI':0.0,'DEM':0.0,'Cumhur':0.90,'Milliyetçi Muh.':0.20,'Sol Muh.':0.0,'Muhafazakar Muh.':0.50},
  'HUDA':  {'AKP':0.80,'YENI':0.0,'DEM':0.0,'Cumhur':0.90,'Milliyetçi Muh.':0.15,'Sol Muh.':0.0,'Muhafazakar Muh.':0.45},
  'IYI':   {'AKP':0.25,'YENI':0.35,'DEM':0.15,'Cumhur':0.20,'Milliyetçi Muh.':1.0,'Sol Muh.':0.20,'Muhafazakar Muh.':0.10},
  'ZAFER': {'AKP':0.30,'YENI':0.20,'DEM':0.0,'Cumhur':0.30,'Milliyetçi Muh.':0.90,'Sol Muh.':0.0,'Muhafazakar Muh.':0.15},
  'A':     {'AKP':0.20,'YENI':0.40,'DEM':0.15,'Cumhur':0.10,'Milliyetçi Muh.':0.85,'Sol Muh.':0.20,'Muhafazakar Muh.':0.10},
  'BTP':   {'AKP':0.20,'YENI':0.30,'DEM':0.10,'Cumhur':0.15,'Milliyetçi Muh.':0.70,'Sol Muh.':0.15,'Muhafazakar Muh.':0.20},
  'DP':    {'AKP':0.25,'YENI':0.30,'DEM':0.10,'Cumhur':0.20,'Milliyetçi Muh.':0.75,'Sol Muh.':0.10,'Muhafazakar Muh.':0.20},
  'TIP':   {'AKP':0.0,'YENI':0.70,'DEM':0.50,'Cumhur':0.0,'Milliyetçi Muh.':0.05,'Sol Muh.':1.0,'Muhafazakar Muh.':0.0},
  'TKP':   {'AKP':0.0,'YENI':0.70,'DEM':0.50,'Cumhur':0.0,'Milliyetçi Muh.':0.05,'Sol Muh.':1.0,'Muhafazakar Muh.':0.0},
  'CHP':   {'AKP':0.0,'YENI':0.70,'DEM':0.55,'Cumhur':0.0,'Milliyetçi Muh.':0.10,'Sol Muh.':1.0,'Muhafazakar Muh.':0.0},
  'SAADET':{'AKP':0.50,'YENI':0.10,'DEM':0.0,'Cumhur':0.35,'Milliyetçi Muh.':0.10,'Sol Muh.':0.0,'Muhafazakar Muh.':1.0},
  'YRP':   {'AKP':0.45,'YENI':0.10,'DEM':0.0,'Cumhur':0.45,'Milliyetçi Muh.':0.15,'Sol Muh.':0.0,'Muhafazakar Muh.':1.0},
  'DEVA':  {'AKP':0.35,'YENI':0.30,'DEM':0.10,'Cumhur':0.25,'Milliyetçi Muh.':0.30,'Sol Muh.':0.15,'Muhafazakar Muh.':0.85}
};
function yerelBlocs(){
  const out={};
  const used=CB_GROUP_LIST.slice();
  for (const p of Object.keys(state.customPartiesDef||{})) if (used.indexOf(p)<0) used.push(p);
  for (const b of used){
    const members=(CB_GROUPS[b]||[b]);
    for (const p of members) out[p]=b;
  }
  return out;
}
function yerelMatrix(){
  if (!state.yerelMatrix) state.yerelMatrix=JSON.parse(JSON.stringify(YEREL_MATRIX_DEFAULTS));
  return state.yerelMatrix;
}
// yerel-tab'a özel ittifak listesi (varsayılan: genel ittifak editöründen)
function yerelAlliancesObj(){
  if (!state.yerelAlliances) state.yerelAlliances=JSON.parse(JSON.stringify(state.allianceList||[]));
  const allP=allParties();
  const out={};
  for (const a of state.yerelAlliances){
    if (a && a.name && String(a.name).trim() && a.parties && a.parties.length){
      out[String(a.name).trim()]=a.parties.filter(p=>allP.includes(p));
    }
  }
  return out;
}
function runLocal(){
  if (!YEREL_2024) return;
  const un=userNorm();
  const w24=clamp(Number.isFinite(parseFloat(state.yerelW24))?parseFloat(state.yerelW24):30,0,100)/100;
  const flowRate=clamp(Number.isFinite(parseFloat(state.yerelFlow))?parseFloat(state.yerelFlow):25,0,80)/100;
  const matrix=yerelMatrix();
  const blocs=yerelBlocs();
  // synthesized national reference: breakoffs added on top of official 2024 (no deduction)
  const synthNat=(()=>{
    const n=Object.assign({}, YEREL_2024.nat||{});
    const mk=(p)=>{ const row=DEFAULT_TRANSITIONS[p]||{}; let g=0; for (const s of Object.keys(row)){ if (s===p) continue; g+=(n[s]||0)*row[s]/100; } n[p]=(n[p]||0)+g; };
    mk('YENI'); mk('A');
    const t=Object.values(n).reduce((a,b)=>a+b,0);
    for (const k of Object.keys(n)) n[k]=t>0?n[k]/t*100:0;
    return n;
  })();
  const out={};
  state._yerelMajorUnion = {};
  for (const prov of Object.keys(YEREL_2024.provinces)){
    // synthesized per-province base: 2024 results + breakoff parties added on top (no deduction)
    const base=Object.assign({}, YEREL_2024.provinces[prov]);
    const mkB=(p)=>{ const row=DEFAULT_TRANSITIONS[p]||{}; let g=0; for (const s of Object.keys(row)){ if (s===p) continue; g+=(base[s]||0)*row[s]/100; } base[p]=(base[p]||0)+g; };
    mkB('YENI'); mkB('A');
    const bT=Object.values(base).reduce((a,b)=>a+b,0);
    for (const k of Object.keys(base)) base[k]=bT>0?base[k]/bT*100:0;
    const allP={};
    for (const p of Object.keys(base)) allP[p]=1;
    for (const p of Object.keys(un)) allP[p]=1;
    const keys=Object.keys(allP);
    // logit swing from user national input vs synthesized 2024 national
    const swinged={};
    for (const p of keys){
      const R=base[p]||0, Bc=synthNat[p]||0, Pc=un[p]||0;
      if (Pc<=0){ swinged[p]=0; continue; }
      const Rc=clamp(R,0.001,99.999), Bcc=clamp(Bc,0.005,99.999), Pcc=clamp(Pc,0.001,99.999);
      const logitDiff=clamp(Math.log(Pcc/(100-Pcc))-Math.log(Bcc/(100-Bcc)),-5,5);
      const Pprop=sig(Math.log(Rc/(100-Rc))+logitDiff);
      const Puni=Math.max(R*0.05, R+(Pc-Bc));
      swinged[p]=Math.sqrt(Math.max(0.001,Pprop)*Math.max(0.001,Puni));
    }
    const tS=Object.values(swinged).reduce((a,b)=>a+b,0);
    for (const p of keys) swinged[p]=tS>0?swinged[p]/tS*100:0;
    // blend with 2024 base (default taban ağırlığı %30)
    const final0={};
    for (const p of keys) final0[p]=w24*(base[p]||0)+(1-w24)*(swinged[p]||0);
    const tF=Object.values(final0).reduce((a,b)=>a+b,0);
    for (const p of keys) final0[p]=tF>0?final0[p]/tF*100:0;
    // per-province popularity multiplier (user picks party + boost amount)
    const pop=(state.yerelPop&&state.yerelPop[prov])||{};
    let anyPop=false;
    for (const p of Object.keys(pop)){
      const m=parseFloat(pop[p]);
      if (m>0 && m!==1 && final0[p]!==undefined){ final0[p]*=m; anyPop=true; }
    }
    if (anyPop){
      const tP=Object.values(final0).reduce((a,b)=>a+b,0);
      for (const p of keys) final0[p]=tP>0?final0[p]/tP*100:0;
    }
    // majors: top 3 + any party >10pp (max 4 — 4'lü yarışlar nadirleşir)
    const ranked=Object.entries(final0).sort((a,b)=>b[1]-a[1]);
    const majors=[];
    for (let i=0;i<Math.min(3,ranked.length);i++) majors.push(ranked[i][0]);
    for (const [p,v] of ranked.slice(3)){ if (v>10 && majors.length<4) majors.push(p); }
    for (const p of majors) state._yerelMajorUnion[p]=1;
    // alliance dropout: minor alliance members fully support their qualifying partners.
    // Per-province overrides: state.yerelOverrides[prov][party] = 'drop' | 'stay' | auto
    const allyMap={};
    const allysObj=yerelAlliancesObj();
    for (const aly of Object.keys(allysObj)){
      for (const p of allysObj[aly]){ allyMap[p]=aly; }
    }
    const over=(state.yerelOverrides&&state.yerelOverrides[prov])||{};
    const running=new Set(majors);
    for (const p of keys){ if (over[p]==='stay') running.add(p); }
    const dropSet=new Set();
    for (const p of keys){
      if (over[p]==='drop'){ dropSet.add(p); continue; }
      if (over[p]==='stay' || majors.indexOf(p)>=0) continue;
      const aly=allyMap[p];
      if (!aly) continue;
      if (allysObj[aly].some(x=>x!==p && running.has(x))) dropSet.add(p);
    }
    const flows={};
    const dropped=[];
    for (const p of dropSet){
      const aly=allyMap[p];
      if (!aly) continue;
      const partners=allysObj[aly].filter(x=>x!==p && running.has(x) && !dropSet.has(x));
      if (!partners.length) continue;
      const v=final0[p]||0;
      if (v<=0) continue;
      const wSum=partners.reduce((a,x)=>a+(final0[x]||0),0);
      for (const x of partners){
        const add=wSum>0?v*(final0[x]||0)/wSum:v/partners.length;
        final0[x]+=add;
        (flows[x]=flows[x]||[]).push({from:p, amount:add, ally:true});
      }
      final0[p]=0;
      dropped.push(p);
    }
    // bloc attraction: minors' votes flow partly to majors
    const final=Object.assign({},final0);
    for (const [p,v] of Object.entries(final0)){
      if (majors.indexOf(p)>=0) continue;
      if (v<=0) continue;
      const bloc=blocs[p]||p;
      const row=matrix[bloc]||matrix[p]||{};
      const flowed=v*flowRate;
      const wts=majors.map(m=>parseFloat(row[m])||0);
      const wSum=wts.reduce((a,b)=>a+b,0);
      if (wSum>0 && flowed>0){
        for (let i=0;i<majors.length;i++){
          if (wts[i]<=0) continue;
          const add=flowed*wts[i]/wSum;
          final[majors[i]]+=add;
          (flows[majors[i]]=flows[majors[i]]||[]).push({from:p, amount:add});
        }
      }
      final[p]=Math.max(0,v-flowed);
    }
    // party strength adjustments (nerf): CHP ve A hafifçe zayıflatılır
    const nerf=YEREL_NERF||{};
    let anyN=false;
    for (const p of Object.keys(final)){ const f=nerf[p]; if (f!==undefined && f!==1){ final[p]=(final[p]||0)*f; anyN=true; } }
    if (anyN){
      const tN=Object.values(final).reduce((a,b)=>a+b,0);
      for (const p of Object.keys(final)) final[p]=tN>0?final[p]/tN*100:0;
    }
    // popularity boost: 2024 kazananının yerel popülarite desteği (puan)
    const pb=clamp(parseFloat(state.yerelPopBoost)||0,0,10);
    if (pb>0){
      const inc=YEREL_2024.winners[prov]||'';
      if (inc && (final[inc]||0)>0){
        final[inc]+=pb;
        const tB=Object.values(final).reduce((a,b)=>a+b,0);
        for (const p of Object.keys(final)) final[p]=tB>0?final[p]/tB*100:0;
      }
    }
    // municipal council: her partiden 10 puan düş, D'Hondt
    const council={};
    const councilTotal=BELEDIYE_MECLIS&&BELEDIYE_MECLIS[prov]?BELEDIYE_MECLIS[prov]:0;
    if (councilTotal>0){
      const cP=Object.keys(final);
      const votes=cP.map(p=>Math.max(0,(final[p]||0)-10));
      const alloc=_alloc_divisor(votes, councilTotal, "D'Hondt (Varsayılan)");
      for (let i=0;i<cP.length;i++) if (alloc[i]>0) council[cP[i]]=alloc[i];
    }
    const sortedF=Object.entries(final).sort((a,b)=>b[1]-a[1]);
    out[prov]={prov, winner:sortedF[0][0], winnerPct:sortedF[0][1],
      margin:sortedF.length>1?sortedF[0][1]-sortedF[1][1]:sortedF[0][1],
      second:sortedF.length>1?sortedF[1][0]:'',
      shares:final, base, majors, flows, council, councilTotal, dropped, popApplied:Object.keys(pop).length?pop:null, big:BUYUKSEHIR[prov]?1:0,
      incumbent:YEREL_2024.winners[prov]||''};
  }
  const counts={}, bigCounts={};
  const alias=(YEREL_TARGETS&&YEREL_TARGETS.alias)||{};
  for (const prov of Object.keys(out)){
    const w=alias[out[prov].winner]||out[prov].winner;
    counts[w]=(counts[w]||0)+1;
    if (out[prov].big) bigCounts[w]=(bigCounts[w]||0)+1;
  }
  state.yerelResults={provs:out, counts, bigCounts, ts:Date.now()};
}
function yerelTierChip(tier){
  const col=tier==='KESİN'?'#1A8917':tier==='GÜÇLÜ'?'#4CAF50':tier==='EĞİLİMLİ'?'#F5A623':tier==='HAFİF EĞİLİMLİ'?'#F97316':'#E00000';
  return `<span style="display:inline-block;padding:2px 8px;border:2px solid #111827;background:${col};color:#FFFFFF;font-weight:900;font-size:10px;letter-spacing:1px;">${tier}</span>`;
}
function yerelTooltipHtml(r){
  const tier=provTier(r.margin);
  let html=`<div class="tip-header">${esc(get_display_label(r.prov))}${r.big?'<span class="tip-total">BÜYÜKŞEHİR</span>':''}</div>`;
  const entries=Object.entries(r.shares).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
  for (const [p,v] of entries){
    const maj=r.majors.indexOf(p)>=0;
    html+=`<div class="tip-row"><div class="tip-party" style="${maj?'font-weight:900;':'font-weight:700;'}">${esc(p)}${maj?' ★':''}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${v.toFixed(1)}%; background-color: ${PARTY_COLORS[p]||'#888888'};"></div></div><div class="tip-pct">%${v.toFixed(1)}</div></div>`;
  }
  html+=`<div class="tip-tier" style="display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:4px 0;border:2px solid #111827;background:${PARTY_COLORS[r.winner]||'#888'};color:#FFFFFF;font-weight:900;font-size:11px;letter-spacing:1px;text-align:center;">${tier} · FARK %${r.margin.toFixed(1)}</div>`;
  return html;
}
function yerelMapHtml(){
  const res=state.yerelResults;
  const provWinners={}, customColors={}, tooltipDict={};
  for (const prov of Object.keys(res.provs)){
    const r=res.provs[prov];
    provWinners[prov]=r.winner;
    customColors[prov]=PARTY_COLORS[r.winner]||'#888888';
    tooltipDict[prov]=yerelTooltipHtml(r);
  }
  return renderColoredSvg(SVG_TURKIYE2, {provWinners, distWinners:{}, colorsDict:PARTY_COLORS, tooltipDict, seatsData:{}, showBadges:false, customColors, uid:'yerel', svgFile:'turkiye2.svg'});
}
function yerelSummaryHtml(){
  const res=state.yerelResults;
  const rows=Object.entries(res.counts).sort((a,b)=>b[1]-a[1]);
  const bigRows=Object.entries(res.bigCounts).sort((a,b)=>b[1]-a[1]);
  const bar=(party,n,total)=>{
    const pct=total>0?Math.round(n/total*100):0;
    return `<div style="display:flex;align-items:center;gap:10px;width:100%;margin-bottom:6px;">
      <div style="width:70px;font-weight:900;font-size:12px;color:${PARTY_COLORS[party]||'#111827'};white-space:nowrap;">${esc(party)}</div>
      <div style="flex:1;height:16px;border:2px solid #111827;background:#F0EFED;box-shadow:2px 2px 0 rgba(17,24,39,1);">
        <div style="height:100%;width:${pct}%;background:${PARTY_COLORS[party]||'#888'};"></div>
      </div>
      <div style="width:44px;text-align:right;font-weight:900;font-size:13px;font-variant-numeric:tabular-nums;">${n}</div>
    </div>`;
  };
  return `<div style="display:flex;flex-wrap:wrap;gap:16px;width:100%;">
    <div style="flex:1;min-width:280px;">
      <div class="sb-kicker"><div class="bar"></div><div class="t">KAZANILAN İL (81)</div></div>
      ${rows.map(([p,n])=>bar(p,n,81)).join('')}
    </div>
    <div style="flex:1;min-width:280px;">
      <div class="sb-kicker"><div class="bar"></div><div class="t">BÜYÜKŞEHİR (30)</div></div>
      ${bigRows.map(([p,n])=>bar(p,n,30)).join('')}
    </div>
  </div>`;
}
function yerelDetailHtml(){
  const r=state.yerelResults.provs[state.yerelProv];
  if (!r) return `<div class="sb-card shadow section-card"><div style="font-weight:900;font-size:12px;color:var(--c-text-muted)">Haritada bir ile tıklayın: il detayı.</div></div>`;
  const rows=Object.entries(r.shares).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  const maxV=rows.length?rows[0][1]:1;
  const inc=PARTY_COLORS[r.incumbent]||'#888';
  let html=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">${esc(get_display_label(r.prov))} ${r.big?'— BÜYÜKŞEHİR':''} BELEDİYE BAŞKANLIĞI</div></div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:4px 0 10px 0;font-size:12px;font-weight:900;">
      <span style="color:#1A1A1A;">Kazanan: <span style="color:${PARTY_COLORS[r.winner]||'#888'}">${esc(r.winner)}</span> (%${r.winnerPct.toFixed(1)})</span>
      <span style="color:#71716E;">Fark: %${r.margin.toFixed(1)}</span>
      ${yerelTierChip(provTier(r.margin))}
      <span style="margin-left:auto;color:#71716E;">2024 kazananı: <span style="color:${inc}">${esc(r.incumbent)}</span></span>
    </div>
    <div style="padding:0 2px">
      ${rows.map(([p,v])=>{
        const maj=r.majors.indexOf(p)>=0;
        const boost=r.popApplied&&r.popApplied[p];
        const flowIn=r.flows[p];
        const subLines=[];
        if (boost) subLines.push(`<div style="font-size:10px;color:${PARTY_COLORS[p]||'#888'};font-weight:900;margin-top:2px;">POPÜLERLİK ÇARPANI ×${parseFloat(boost).toFixed(1)}</div>`);
        if (flowIn&&flowIn.length) subLines.push(`<div style="font-size:10px;color:#71716E;font-weight:700;margin-top:2px;">${flowIn.map(f=>`${esc(f.from)}'den +${f.amount.toFixed(1)}${f.ally?' (ittifak)':''}`).join(' · ')}</div>`);
        return `<div style="display:flex;align-items:center;gap:10px;width:100%;margin-bottom:8px;">
          <div style="width:86px;font-weight:${maj?900:700};font-size:12px;color:${maj?(PARTY_COLORS[p]||'#111827'):'#64748B'};white-space:nowrap;">${esc(p)}${maj?' ★':''}</div>
          <div style="flex:1;">
            <div style="height:14px;border:2px solid #111827;background:#F0EFED;"><div style="height:100%;width:${Math.min(100,(v/maxV)*100).toFixed(1)}%;background:${PARTY_COLORS[p]||'#888'};"></div></div>
            ${subLines.join('')}
          </div>
          <div style="width:60px;text-align:right;font-weight:900;font-size:12px;font-variant-numeric:tabular-nums;">%${v.toFixed(1)}</div>
        </div>`;
      }).join('')}
    </div>
    ${r.dropped&&r.dropped.length?`<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;padding-top:10px;border-top:2px dashed #111827;">
      <span style="font-weight:900;font-size:10px;color:var(--c-text-muted);letter-spacing:1px;">ÇEKİLEN:</span>
      ${r.dropped.map(p=>`<span style="display:inline-block;padding:2px 8px;border:2px solid #111827;background:${PARTY_COLORS[p]||'#888'};color:#FFF;font-weight:900;font-size:10px;">${esc(p)}</span>`).join('')}
    </div>`:''}
  </div>`;
  html+=`<div style="display:flex;gap:12px;flex-wrap:wrap;width:100%;margin-top:12px;">`;
  html+=yerelAllyOverridesHtml(r.prov);
  html+=yerelPopHtml(r.prov, rows.map(x=>x[0]));
  html+=`</div>`;
  html+=yerelCouncilHtml(r);
  return html;
}
function yerelAllyOverridesHtml(prov){
  const allysObj=yerelAlliancesObj();
  const over=(state.yerelOverrides&&state.yerelOverrides[prov])||{};
  const groups=[];
  for (const aly of Object.keys(allysObj)){
    const parts=allysObj[aly];
    if (parts.length<2) continue;
    const chips=parts.map(p=>{
      const cur=over[p]||'auto';
      return `<div style="display:flex;align-items:stretch;border:2px solid #111827;background:${PARTY_COLORS[p]||'#888'};box-shadow:2px 2px 0 rgba(17,24,39,1);">
        <span style="display:flex;align-items:center;color:#FFF;font-weight:900;font-size:10px;padding:0 7px;white-space:nowrap;">${esc(p)}</span>
        <select class="yerel-ally-ovr" data-prov="${esc(prov)}" data-party="${esc(p)}" style="height:26px;border:none;border-left:2px solid #111827;font-weight:900;font-size:10px;padding:0 4px;background:#fff;color:#1A1A1A;">
          <option value="auto" ${cur==='auto'?'selected':''}>Otomatik</option>
          <option value="drop" ${cur==='drop'?'selected':''}>Çekil</option>
          <option value="stay" ${cur==='stay'?'selected':''}>Yarış</option>
        </select>
      </div>`;
    }).join('');
    groups.push(`<div style="border:2px solid var(--c-edge);background:#F7F7F5;padding:8px;margin-bottom:8px;">
      <div style="font-weight:900;font-size:11px;color:#1A1A1A;margin-bottom:6px;letter-spacing:0.5px;">${esc(aly)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${chips}</div>
    </div>`);
  }
  if (!groups.length) return '';
  return `<div class="sb-card shadow" style="flex:1;min-width:300px;width:100%;margin:0;">
    <div class="sb-kicker"><div class="bar"></div><div class="t">ADAY ÇEKİLME AYARLARI (İL)</div></div>
    <div style="font-size:11px;color:var(--c-text-muted);margin:6px 0 8px 0;">İttifak üyesinin bu ilde çekilip çekilmeyeceğini seçin. 'Otomatik': ana aday olamazsa ittifak ortağına tam destek verir.</div>
    ${groups.join('')}
  </div>`;
}
function yerelPopHtml(prov, parties){
  const pop=(state.yerelPop&&state.yerelPop[prov])||{};
  const curEntry=Object.entries(pop).find(([p,m])=>m>0)||[];
  const curParty=curEntry[0]||'';
  const curMult=curEntry[1]||1;
  return `<div class="sb-card shadow" style="flex:1;min-width:300px;width:100%;margin:0;">
    <div class="sb-kicker"><div class="bar"></div><div class="t">POPÜLERLİK ÇARPANI (İL)</div></div>
    <div style="font-size:11px;color:var(--c-text-muted);margin:6px 0 8px 0;">Adayın yerel popülaritesi: seçtiğiniz partinin bu ildeki oyu çarpanla artırılır.</div>
    ${curParty?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px;border:2px solid #111827;background:#F7F7F5;box-shadow:2px 2px 0 rgba(17,24,39,1);">
      <span style="font-weight:900;font-size:10px;color:var(--c-text-muted);letter-spacing:1px;">AKTİF ÇARPAN</span>
      <span style="display:inline-block;padding:2px 8px;border:2px solid #111827;background:${PARTY_COLORS[curParty]||'#888'};color:#FFF;font-weight:900;font-size:11px;">${esc(curParty)} ×${parseFloat(curMult).toFixed(1)}</span>
    </div>`:''}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <select id="yerel-pop-party" data-prov="${esc(prov)}" style="height:32px;border:2px solid var(--c-edge);font-weight:900;font-size:12px;padding:0 6px;background:#fff;">
        <option value="">— Parti seç —</option>
        ${parties.map(p=>`<option value="${esc(p)}" ${p===curParty?'selected':''}>${esc(p)}</option>`).join('')}
      </select>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-weight:900;font-size:11px;color:var(--c-text-muted);">ÇARPAN</span>
        <input id="yerel-pop-mult" type="number" min="0.5" max="3" step="0.1" value="${curMult}" style="width:70px;height:32px;border:2px solid var(--c-edge);font-weight:900;font-size:12px;text-align:center;background:#fff;">
      </div>
      <button class="btn-side" id="yerel-pop-clear" data-prov="${esc(prov)}" style="height:32px;">Temizle</button>
    </div>
  </div>`;
}
function yerelCouncilHtml(r){
  const c=r.council||{};
  const tot=r.councilTotal||0;
  if (!tot) return '';
  const entries=Object.entries(c).sort((a,b)=>b[1]-a[1]);
  const dots=entries.map(([p,n])=>{
    const col=PARTY_COLORS[p]||'#888';
    return ('<span style="display:inline-block;width:12px;height:12px;background:'+col+';border:1px solid #111827;"></span>').repeat(n);
  }).join('');
  const maj=Math.floor(tot/2)+1;
  const allyMap={};
  const allysObj=yerelAlliancesObj();
  for (const aly of Object.keys(allysObj)) for (const p of allysObj[aly]) allyMap[p]=aly;
  let majorityHolder='';
  for (const [p,n] of entries){ if (n>=maj){ majorityHolder=p; break; } }
  if (!majorityHolder){
    for (const aly of Object.keys(allysObj)){
      const sum=allysObj[aly].reduce((a,p)=>a+(c[p]||0),0);
      if (sum>=maj){ majorityHolder=aly; break; }
    }
  }
  const legend=entries.map(([p,n])=>{
    const pct=tot>0?Math.round(n/tot*100):0;
    const isMaj=majorityHolder===p;
    const inMajBloc=majorityHolder&&allyMap[p]===majorityHolder;
    return `<div style="display:flex;align-items:center;gap:8px;width:100%;margin-bottom:5px;${isMaj||inMajBloc?'border-left:3px solid #1A8917;padding-left:8px;':''}">
      <span style="display:inline-block;width:12px;height:12px;background:${PARTY_COLORS[p]||'#888'};border:2px solid #111827;"></span>
      <div style="flex:1;font-weight:900;font-size:11px;color:${PARTY_COLORS[p]||'#111827'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p)}</div>
      ${isMaj?`<span style="display:inline-block;padding:1px 6px;border:2px solid #111827;background:#1A8917;color:#FFF;font-weight:900;font-size:9px;letter-spacing:0.5px;">ÇOĞUNLUK</span>`:''}
      <div style="width:44px;text-align:right;font-weight:900;font-size:12px;font-variant-numeric:tabular-nums;">${n}</div>
      <div style="width:38px;text-align:right;font-size:10px;font-weight:700;color:#71716E;font-variant-numeric:tabular-nums;">%${pct}</div>
    </div>`;
  }).join('');
  return `<div class="sb-card shadow" style="margin-top:12px">
    <div class="sb-kicker"><div class="bar"></div><div class="t">BELEDİYE MECLİSİ — ${tot} SANDALYE</div></div>
    <div style="font-size:11px;color:var(--c-text-muted);margin:6px 0 8px 0;">Her partinin oyundan 10 puan düşülür, kalan oylar D'Hondt yöntemiyle dağıtılır.</div>
    <div style="display:flex;flex-wrap:wrap;gap:2px;width:100%;margin-bottom:10px;">${dots}</div>
    <div style="border-top:2px dashed #111827;margin-bottom:8px;"></div>
    ${legend}
    <div style="border-top:2px dashed #111827;margin-top:8px;padding-top:6px;font-size:10px;font-weight:900;color:#71716E;letter-spacing:1px;">ÇOĞUNLUK SINIRI: ${maj} SANDALYE ${majorityHolder?` · ÇOĞUNLUK: ${esc(majorityHolder)}`:''}</div>
  </div>`;
}
function yerelSettingsHtml(){
  return `<div class="sb-card shadow" style="margin-bottom:12px">
    <div class="sb-kicker"><div class="bar"></div><div class="t">YEREL MODEL AYARLARI</div></div>
    <div style="font-size:11px;color:var(--c-text-muted);margin-bottom:12px;">Parti girdileri sol menüdeki senaryo ile ortaktır. Model her ilde en güçlü 3 partiyi (4. parti %5 üzerindeyse onu da) ana aday yapar; diğer partilerin oylarının bir kısmı blok çekim matrisine göre ana adaylara akar.</div>
    <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin-bottom:6px;">
      <div style="min-width:220px;flex:1;">
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:11px;color:var(--c-text-muted);margin-bottom:4px;"><span>2024 TABAN AĞIRLIĞI</span><span style="color:#1A1A1A;">%${state.yerelW24}</span></div>
        <input id="yerel-w24" type="range" min="0" max="100" step="1" value="${state.yerelW24}" style="width:100%;accent-color:#111827;">
      </div>
      <div style="min-width:220px;flex:1;">
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:11px;color:var(--c-text-muted);margin-bottom:4px;"><span>MİNOR AKIŞ ORANI</span><span style="color:#1A1A1A;">%${state.yerelFlow}</span></div>
        <input id="yerel-flow" type="range" min="0" max="80" step="1" value="${state.yerelFlow}" style="width:100%;accent-color:#111827;">
      </div>
      <div style="min-width:220px;flex:1;">
        <div style="display:flex;justify-content:space-between;font-weight:900;font-size:11px;color:var(--c-text-muted);margin-bottom:4px;"><span>POPÜLERLİK DESTEĞİ (2024 KAZANANI)</span><span style="color:#1A1A1A;">+${state.yerelPopBoost} puan</span></div>
        <input id="yerel-pop" type="range" min="0" max="10" step="0.5" value="${state.yerelPopBoost}" style="width:100%;accent-color:#111827;">
      </div>
      <button class="btn-calc" id="yerel-run" style="flex-shrink:0;">YEREL SONUÇLARI HESAPLA</button>
    </div>
    <div style="font-size:11px;color:#71716E;font-weight:700;margin-top:6px;">Taban: 2024 belediye başkanı + il meclis sonuçları karışımı (%80 başkan / %20 meclis; büyükşehir: il geneli, diğer: merkez ilçe). Geri test (2024): %90 kazanan il (varsayılan ayar), taban %100'de %97; ortalama oy payı hatası ~1.4 puan. İttifak mekanizması: ana aday olamayan ittifak partisi, ittifak ortağına tam destek verir.</div>
  </div>`;
}
function yerelAlliancesHtml(){
  const list=state.yerelAlliances||JSON.parse(JSON.stringify(state.allianceList||[]));
  state.yerelAlliances=list;
  const allP=allParties();
  let html=`<div class="sb-card shadow" style="margin-bottom:12px">
    <div class="sb-kicker"><div class="bar"></div><div class="t">İTTİFAKLAR (YEREL)</div></div>
    <div style="font-size:11px;color:var(--c-text-muted);margin-bottom:8px;">Ana aday olamayan ittifak üyesi, ittifak ortağına tam destek verir (aday çekilme mekanizması).</div>
    <div id="yerel-ally-list">
      ${list.map((a,i)=>`
        <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;padding:8px;border:2px solid var(--c-edge);background:#F7F7F5;">
          <input class="yerel-ally-name" data-i="${i}" value="${esc(a.name||'')}" placeholder="İttifak adı" style="width:170px;height:30px;border:2px solid var(--c-edge);font-weight:900;font-size:11px;padding:0 8px;background:#fff;flex-shrink:0;">
          <div style="flex:1;display:flex;flex-wrap:wrap;gap:4px;">
            ${allP.map(p=>`<label style="display:flex;align-items:center;gap:3px;font-size:10px;font-weight:800;padding:2px 6px;border:2px solid var(--c-edge);background:${(a.parties||[]).includes(p)?(PARTY_COLORS[p]||'#888'):'#fff'};color:${(a.parties||[]).includes(p)?'#fff':'#1A1A1A'};cursor:pointer;white-space:nowrap;"><input type="checkbox" class="yerel-ally-p" data-i="${i}" data-party="${esc(p)}" ${(a.parties||[]).includes(p)?'checked':''} style="display:none;">${esc(p)}</label>`).join('')}
          </div>
          <button class="yerel-ally-rm" data-i="${i}" style="height:30px;width:30px;border:2px solid var(--c-edge);background:#fff;font-weight:900;cursor:pointer;flex-shrink:0;">✕</button>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:4px;">
      <button class="btn-side" id="yerel-ally-add" style="flex:1;">İttifak Ekle</button>
      <button class="btn-side" id="yerel-ally-reset" style="flex:1;">Varsayılana Dön</button>
    </div>
  </div>`;
  return html;
}
function yerelMajorParties(){
  const n=Object.assign({}, YEREL_2024.nat||{});
  const mk=(p)=>{ const row=DEFAULT_TRANSITIONS[p]||{}; let g=0; for (const s of Object.keys(row)){ if (s===p) continue; g+=(n[s]||0)*row[s]/100; } n[p]=(n[p]||0)+g; };
  mk('YENI'); mk('A');
  const t=Object.values(n).reduce((a,b)=>a+b,0);
  const byNat=(p)=>{ const s=n[p]||0; return t>0?s/t*100:s; };
  const u=state._yerelMajorUnion||null;
  const base=u?Object.keys(u):Object.keys(n).filter((p)=>byNat(p)>=3);
  return base.slice().sort((a,b)=>byNat(b)-byNat(a));
}
function yerelMatrixHtml(){
  const matrix=yerelMatrix();
  const major=yerelMajorParties();
  const blocs=CB_GROUP_LIST.slice();
  for (const p of Object.keys(state.customPartiesDef||{})) if (blocs.indexOf(p)<0) blocs.push(p);
  const parties=Object.keys(matrix).filter(p=>major.includes(p));
  let html=`<div class="sb-card shadow" style="margin-bottom:12px">
    <div class="sb-collapse-head" data-key="yerelMatrix">
      <div class="ttl"><div class="bar"></div><div class="t">BLOK ÇEKİM MATRİSİ</div></div>
      <div class="sb-collapse-arrow">▾</div>
    </div>
    <div class="sb-collapse-body"><div class="sb-collapse-body-inner">
      <div style="font-size:11px;color:var(--c-text-muted);margin-bottom:8px;">Her bloktan (satır) ana adaylara (sütun) akan oy ağırlıkları (%). Sütunlar herhangi bir ilde ana aday olan büyük partilerdir; çalışma anında blok başına normalize edilir.</div>
      <div style="overflow-x:auto;"><table class="conf-table" style="min-width:720px;"><thead><tr><th>Blok</th>${parties.map(p=>`<th style="text-align:center;color:${PARTY_COLORS[p]||'#888'};">${esc(p)}</th>`).join('')}</tr></thead><tbody>
        ${blocs.map(b=>`<tr><td style="font-weight:900;font-size:11px;color:#1A1A1A;">${esc(b)}</td>${parties.map(p=>{
          const v=(matrix[p]&&matrix[p][b])||0;
          return `<td style="text-align:center;"><input class="yerel-mx" data-party="${esc(p)}" data-bloc="${esc(b)}" type="number" min="0" max="100" step="1" value="${Math.round(v*100)}" style="width:56px;height:28px;border:2px solid var(--c-edge);font-weight:900;font-size:11px;text-align:center;background:#fff;"></td>`;
        }).join('')}</tr>`).join('')}
      </tbody></table></div>
    </div></div>
  </div>`;
  return html;
}
function renderYerel(){
  const pane=$('#pane_yerel');
  if (!pane) return;
  if (!YEREL_2024) { pane.innerHTML=`<div class="sb-card shadow"><div class="big-note">Yerel seçim verisi yüklenemedi.</div></div>`; return; }
  runLocal();
  let html=`<div class="tab-pane-inner"><div class="tab-pane-538">`;
  html+=yerelSettingsHtml();
  html+=yerelAlliancesHtml();
  html+=yerelMatrixHtml();
  html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;margin-bottom:12px;box-shadow:5px 5px 0 rgba(17,24,39,1);">${yerelSummaryHtml()}</div>`;
  html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
    <div class="sb-kicker"><div class="bar"></div><div class="t">İL HARİTASI</div></div>
    <div style="font-size:12px;color:var(--c-text-muted);margin:6px 0 8px 0;">Renk = önde giden parti · Yoğunluk = fark · Yıldız (★) = ildeki ana adaylar · İle tıklayın: detay</div>
    <div class="map-frame">${state.yerelResults?yerelMapHtml():emptyMap()}</div>
  </div>`;
  html+=`<div style="margin-top:12px;">${yerelDetailHtml()}</div>`;
  html+=`</div></div>`;
  pane.innerHTML=html;
  const w24=$('#yerel-w24'); if (w24) w24.onchange=()=>{ state.yerelW24=parseFloat(w24.value); renderYerel(); };
  const flow=$('#yerel-flow'); if (flow) flow.onchange=()=>{ state.yerelFlow=parseFloat(flow.value); renderYerel(); };
  const run=$('#yerel-run'); if (run) run.onclick=()=>{ runLocal(); renderYerel(); };
  const pop=$('#yerel-pop'); if (pop) pop.onchange=()=>{ state.yerelPopBoost=parseFloat(pop.value); renderYerel(); };
  $$('#pane_yerel .yerel-ally-name').forEach(inp=>{
    inp.onchange=()=>{ state.yerelAlliances[parseInt(inp.getAttribute('data-i'),10)].name=inp.value; };
  });
  $$('#pane_yerel .yerel-ally-p').forEach(cb=>{
    cb.onchange=()=>{
      const i=parseInt(cb.getAttribute('data-i'),10), p=cb.getAttribute('data-party');
      const a=state.yerelAlliances[i];
      if (!a.parties) a.parties=[];
      const idx=a.parties.indexOf(p);
      if (cb.checked && idx<0) a.parties.push(p);
      if (!cb.checked && idx>=0) a.parties.splice(idx,1);
      renderYerel();
    };
  });
  $$('#pane_yerel .yerel-ally-rm').forEach(btn=>{
    btn.onclick=()=>{ state.yerelAlliances.splice(parseInt(btn.getAttribute('data-i'),10),1); renderYerel(); };
  });
  const allyAdd=$('#yerel-ally-add');
  if (allyAdd) allyAdd.onclick=()=>{ state.yerelAlliances.push({id:'yaly_'+(state.yerelAlliances.length+1), name:'Yeni Blok '+(state.yerelAlliances.length+1), parties:[], sel:''}); renderYerel(); };
  const allyReset=$('#yerel-ally-reset');
  if (allyReset) allyReset.onclick=()=>{ state.yerelAlliances=JSON.parse(JSON.stringify(state.allianceList||[])); renderYerel(); };
  $$('#pane_yerel .yerel-mx').forEach(inp=>{
    inp.onchange=()=>{
      const m=yerelMatrix();
      const p=inp.getAttribute('data-party'), b=inp.getAttribute('data-bloc');
      if (!m[p]) m[p]={};
      m[p][b]=clamp(parseFloat(inp.value)||0,0,100)/100;
      state.yerelMatrix=m;
    };
  });
  const mw=$('#map-wrapper-yerel');
  if (mw) bindMapWrapper('yerel', norm=>{ state.yerelProv=norm; renderYerel(); });
  $$('#pane_yerel .yerel-ally-ovr').forEach(sel=>{
    sel.onchange=()=>{
      const prov=sel.getAttribute('data-prov'), p=sel.getAttribute('data-party'), v=sel.value;
      if (!state.yerelOverrides) state.yerelOverrides={};
      if (!state.yerelOverrides[prov]) state.yerelOverrides[prov]={};
      if (v==='auto') delete state.yerelOverrides[prov][p];
      else state.yerelOverrides[prov][p]=v;
      renderYerel();
    };
  });
  const popParty=$('#yerel-pop-party'), popMult=$('#yerel-pop-mult');
  const setPop=()=>{
    const prov=popParty.getAttribute('data-prov');
    if (!state.yerelPop) state.yerelPop={};
    if (!state.yerelPop[prov]) state.yerelPop[prov]={};
    const party=popParty.value;
    if (!party){ delete state.yerelPop[prov]; return; }
    state.yerelPop[prov][party]=parseFloat(popMult.value)||1;
  };
  if (popParty) popParty.onchange=()=>{ setPop(); renderYerel(); };
  if (popMult) popMult.onchange=()=>{ setPop(); renderYerel(); };
  const popClear=$('#yerel-pop-clear');
  if (popClear) popClear.onclick=()=>{
    const prov=popClear.getAttribute('data-prov');
    if (state.yerelPop) delete state.yerelPop[prov];
    renderYerel();
  };
  $$('#pane_yerel .sb-collapse-head').forEach(h=>{
    h.addEventListener('click',()=>{ h.parentElement.setAttribute('data-open', String(h.parentElement.getAttribute('data-open')!=='true')); });
  });
}

// ---------------- OLASILIK (Monte Carlo — port of app.py run_mc) ----------------
function parseTurkishDate(dateStr){
  let s = String(dateStr==null?'':dateStr).split('-').pop().trim();
  for (const tr of Object.keys(POLL_MONTHS)){ if (s.indexOf(tr)>=0){ s = s.replace(tr, POLL_MONTHS[tr]); break; } }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 3) return new Date(+parts[2], +parts[1]-1, +parts[0]);
  if (parts.length === 2) return new Date(+parts[1], +parts[0]-1, 15);
  return null;
}
function arrMedian(a){ a=[...a].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2? a[m] : (a[m-1]+a[m])/2; }
function arrMean(a){ return a.length? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function arrPercentile(a,q){
  const s=[...a].sort((x,y)=>x-y);
  if (!s.length) return 0;
  const rank=(q/100)*(s.length-1), lo=Math.floor(rank), hi=Math.ceil(rank), frac=rank-lo;
  if (lo===hi) return s[lo];
  return s[lo]+(s[hi]-s[lo])*frac;
}
function lowessSmooth(pyX, pyY, frac){
  frac = (frac===undefined)?0.4:frac;
  const xa=pyX.map(Number), ya=pyY.map(Number);
  const n=xa.length;
  if (!n) return {xs:[], ys:[]};
  if (ya.every(v=>isNaN(v))) return {xs:[], ys:[]};
  let xmin=Infinity, xmax=-Infinity;
  for (const v of xa){ if (v<xmin) xmin=v; if (v>xmax) xmax=v; }
  if (xmax-xmin < 1e-9){
    const valid=ya.filter(v=>!isNaN(v));
    return {xs:[xmin,xmin], ys:[arrMean(valid), arrMean(valid)]};
  }
  const span=Math.max(3, Math.min(Math.floor(frac*n), n));
  const xs=[]; for (let i=0;i<60;i++) xs.push(xmin+(xmax-xmin)*i/59);
  const ys=new Array(60).fill(NaN);
  for (let i=0;i<xs.length;i++){
    const xi=xs[i];
    const idxs=xa.map((v,j)=>[Math.abs(v-xi),j]).sort((a,b)=>a[0]-b[0]).slice(0,span).map(p=>p[1]);
    const dist=idxs.map(j=>Math.abs(xa[j]-xi));
    const h=Math.max(dist[dist.length-1],1e-9);
    const w=dist.map(d=>Math.pow(Math.max(0,1-Math.pow(d/h,3)),3));
    const sw=w.reduce((a,b)=>a+b,0);
    if (sw<=1e-9) continue;
    let sx=0,sy_=0,sxx=0,sxy=0;
    for (let k=0;k<idxs.length;k++){
      const j=idxs[k], ww=w[k];
      sx+=ww*xa[j]; sy_+=ww*ya[j]; sxx+=ww*xa[j]*xa[j]; sxy+=ww*xa[j]*ya[j];
    }
    const denom=sw*sxx-sx*sx;
    if (Math.abs(denom)<1e-12) ys[i]=sy_/sw;
    else { const slope=(sw*sxy-sx*sy_)/denom; ys[i]=slope*xi+(sy_-slope*sx)/sw; }
  }
  return {xs, ys};
}
function processPolls(selectedFirms){
  const src=POLLS_RAW;
  if (!src || !selectedFirms || !selectedFirms.length) return null;
  const raw=src.filter(r=>selectedFirms.indexOf(String(r.Firma))>=0);
  if (!raw.length) return null;
  // party columns present in the raw source rows (all numeric keys except metadata labels)
  const partyCols=[];
  {
    const seen={};
    for (const r of raw) for (const k of Object.keys(r)){ if (POLL_NON_PARTY_LABELS.indexOf(k)>=0) continue; seen[k]=1; }
    for (const k of Object.keys(seen)) partyCols.push(k);
  }
  let df=raw.map(r=>{
    const o=Object.assign({},r);
    o.Tarih_Formatli=parseTurkishDate(r.Tarih);
    const mae=parseFloat(String(r.MAE==null?'':r.MAE).replace(',','.').trim());
    o.MAE=isNaN(mae)?0:mae;
    return o;
  });
  const validMaes=df.filter(r=>r.MAE>0).map(r=>r.MAE);
  const defaultMae=validMaes.length?arrMedian(validMaes):2.5;
  for (const r of df){ r.Hesaplanan_MAE=(r.MAE<=0)?defaultMae*1.25:r.MAE; r.Temel_Agirlik=1/r.Hesaplanan_MAE; }
  const dateMs=df.filter(r=>r.Tarih_Formatli instanceof Date && !isNaN(r.Tarih_Formatli.getTime())).map(r=>r.Tarih_Formatli.getTime());
  const enGuncelMs=dateMs.length?Math.max.apply(null,dateMs):null;
  const B=Math.log(2)/15.0;
  const msOf = r => (r.Tarih_Formatli instanceof Date && !isNaN(r.Tarih_Formatli.getTime())) ? r.Tarih_Formatli.getTime() : null;
  for (const r of df){
    let decay=0.5;
    if (enGuncelMs!==null && msOf(r)!==null){
      decay=Math.max(0.1, Math.exp(-B*Math.max(0,(enGuncelMs-msOf(r))/86400000)));
    }
    r.Decay_Carpani=decay;
  }
  // frequency damping: 1/sqrt(n) — polls by the same firm inside a 28-day window
  const WINDOW_MS=14*86400000;
  for (const r of df){
    let n=1;
    const t=msOf(r);
    if (t!==null){
      for (const o of df){
        if (o===r) continue;
        const to=msOf(o);
        if (to!==null && Math.abs(t-to)<=WINDOW_MS) n++;
      }
    }
    r.Frekans_Carpani=1/Math.sqrt(n);
  }
  // outlier damping: smooth penalty vs leave-one-out local mean (any firm, same window)
  for (const r of df){
    let dev=0;
    const t=msOf(r);
    if (t!==null){
      const neigh=df.filter(o=>o!==r && msOf(o)!==null && Math.abs(t-msOf(o))<=WINDOW_MS);
      if (neigh.length){
        for (const p of partyCols){
          const v=parseFloat(r[p]);
          if (isNaN(v)) continue;
          let s=0,cnt=0;
          for (const o of neigh){
            const ov=parseFloat(o[p]);
            if (isNaN(ov)) continue;
            s+=ov; cnt++;
          }
          if (cnt>0){
            const d=Math.abs(v-(s/cnt));
            if (d>dev) dev=d;
          }
        }
      }
    }
    r.Uc_Carpani=1/(1+Math.max(0,dev-3)/5);
  }
  for (const r of df) r['Ağırlık']=r.Temel_Agirlik*r.Decay_Carpani*r.Frekans_Carpani*r.Uc_Carpani;
  const meanW=arrMean(df.map(r=>r['Ağırlık']));
  for (const r of df) r['Influence']= meanW>0? r['Ağırlık']/meanW : 1;
  return df;
}
function buildPollTableHtml(df, tabloPartileri){
  let html="<style>.fte-table { width: 100%; border-collapse: collapse; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 15px; color: #1A1A1A; margin-bottom: 25px; } .fte-table th { text-align: left; padding: 16px 12px; border-bottom: 2px solid #1A1A1A; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; color: #71716E; } .fte-table td { padding: 14px 12px; border-bottom: 1px solid #E3E3E3; } .fte-influence-bar-bg { width: 45px; height: 14px; background-color: #F0F0F0; display: inline-block; vertical-align: middle; margin-right: 8px; border-radius: 2px; overflow: hidden; } .fte-influence-bar-fill { height: 100%; background-color: #C9C9C9; } .fte-margin { font-weight: 900; } .fte-table tr:hover { background-color: #FAFAFA; }</style><div style='font-size: 11px; color: #71716E; font-weight: 700; margin-bottom: 10px;'>Frekans: aynı firmanın 28 günlük penceredeki anket sayısına göre 1/√n ağırlık azaltması · Uç: diğer anketlerin ortalamasından 3 puan üzeri sapmada yumuşak ceza uygulanır.</div><div style='overflow-x: auto;'><table class='fte-table'><thead><tr><th>Tarih</th><th>Firma</th><th>Frekans</th><th>Uç</th><th>Ağırlık</th>";
  for (const p of tabloPartileri) html += `<th style='color: ${PARTY_COLORS[p]||'#888'}; text-align: center;'>${esc(p)}</th>`;
  html += "<th style='text-align: right;'>Fark</th></tr></thead><tbody>";
  const maxInf=df.length?Math.max.apply(null,df.map(r=>r['Influence'])):0;
  const sorted=df.slice().sort((a,b)=>{
    const ia=(a.Tarih_Formatli instanceof Date&&!isNaN(a.Tarih_Formatli.getTime()))?a.Tarih_Formatli.getTime():-Infinity;
    const ib=(b.Tarih_Formatli instanceof Date&&!isNaN(b.Tarih_Formatli.getTime()))?b.Tarih_Formatli.getTime():-Infinity;
    return ib-ia;
  });
  for (const row of sorted){
    const wPct=(maxInf>0)?(row['Influence']/maxInf)*100:0;
    const sirali=tabloPartileri.map(p=>[p, (row[p]==null||isNaN(row[p]))?0:row[p]]).sort((a,b)=>b[1]-a[1]);
    let marginText="-", marginColor="#888";
    if (sirali.length>=2){
      const margin=sirali[0][1]-sirali[1][1];
      if (margin>0){ marginText=`${sirali[0][0]} +${margin.toFixed(1)}`; marginColor=PARTY_COLORS[sirali[0][0]]||'#888'; }
      else { marginText="BAŞA BAŞ"; marginColor="#888"; }
    } else if (sirali.length===1){ marginText=`${sirali[0][0]} +100`; marginColor=PARTY_COLORS[sirali[0][0]]||'#888'; }
    const tarihMetni = String(row.Tarih==null?'-':row.Tarih) + (row.Decay_Carpani<0.25 ? " <span style='font-size:10px; color:#E00000;'>(Eski)</span>" : "");
    let rowHtml=`<tr><td style='color: #71716E;'>${tarihMetni}</td><td style='font-weight: 900;'>${esc(row.Firma)}</td><td style='color: #71716E; font-weight: 700;'>${(row.Frekans_Carpani||1).toFixed(2)}</td><td style='color: #71716E; font-weight: 700;'>${(row.Uc_Carpani||1).toFixed(2)}</td><td><div class='fte-influence-bar-bg'><div class='fte-influence-bar-fill' style='width: ${wPct.toFixed(1)}%;'></div></div><span style='font-weight: 700; color: #71716E;'>${row['Influence'].toFixed(2)}</span></td>`;
    for (const p of tabloPartileri) rowHtml += `<td style='color: ${PARTY_COLORS[p]||'#888'}; text-align: center; font-weight: 900;'>%${((row[p]==null||isNaN(row[p]))?0:row[p]).toFixed(1)}</td>`;
    html += rowHtml + `<td class='fte-margin' style='color: ${marginColor}; text-align: right;'>${marginText}</td></tr>`;
  }
  return html + "</tbody></table></div>";
}
function buildTrendSvg(df, tabloPartileri){
  if (!df.length || !tabloPartileri.length) return "<div style='color:#888; text-align:center;'>Anket verisi yok.</div>";
  const w=1000,h=460;
  const padL=60,padR=30,padT=40,padB=40;
  const withDate=df.filter(r=>r.Tarih_Formatli instanceof Date && !isNaN(r.Tarih_Formatli.getTime()));
  if (!withDate.length) return "<div style='color:#888; text-align:center;'>Tarih verisi yok.</div>";
  let tsMin=Infinity,tsMax=-Infinity;
  for (const r of withDate){ if (r.Tarih_Formatli.getTime()<tsMin) tsMin=r.Tarih_Formatli.getTime(); if (r.Tarih_Formatli.getTime()>tsMax) tsMax=r.Tarih_Formatli.getTime(); }
  const spanDays=Math.max(1,Math.round((tsMax-tsMin)/86400000));
  let allMax=0;
  for (const r of withDate) for (const p of tabloPartileri){ const v=(r[p]==null||isNaN(r[p]))?0:r[p]; if (v>allMax) allMax=v; }
  const yMax=(Number.isFinite(allMax))? allMax+5.0 : 1.0;
  const sxMs=(t)=>padL+((t-tsMin)/86400000/spanDays)*(w-padL-padR);
  const sy=(v)=>h-padB-(v/yMax)*(h-padT-padB);
  let svg=`<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#FFFFFF; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">`;
  for (let k=0;k<6;k++){
    const gv=yMax*k/5;
    const gy=sy(gv);
    svg+=`<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#E0E0E0" stroke-width="1" stroke-dasharray="4,4"/><text x="${padL-10}" y="${gy+4}" text-anchor="end" fill="#71716E" font-size="12" font-weight="700">%${Math.round(gv)}</text>`;
  }
  const xStep=Math.max(1,Math.floor(spanDays/6));
  for (let dc=0; dc<=spanDays; dc+=xStep){
    const d=new Date(tsMin+dc*86400000);
    svg+=`<text x="${sxMs(d.getTime())}" y="${h-padB+20}" text-anchor="middle" fill="#71716E" font-size="12" font-weight="700">${String(d.getDate()).padStart(2,'0')} ${POLL_MONTH_SHORT_EN[d.getMonth()]}</text>`;
  }
  const labelPool=[];
  svg+=`<text x="${padL}" y="16" fill="#71716E" font-size="12" font-weight="700">Gölgeli bant: %90 güven aralığı (örneklem + firma farkı)</text>`;
  for (const p of tabloPartileri){
    const sub=withDate.filter(r=>r[p]!=null&&!isNaN(r[p])&&isFinite(r[p]));
    if (!sub.length) continue;
    const color=PARTY_COLORS[p]||'#888888';
    const lx=sub.map(s=>(s.Tarih_Formatli.getTime()-tsMin)/86400000);
    const ly=sub.map(s=>s[p]);
    const res=lowessSmooth(lx,ly,0.4);
    // 90% confidence band: Gaussian-kernel weighted local mean/variance (adaptive sigma),
    // sampling variance estimated from each poll's MAE (s2 = (MAE/1.96)^2).
    const SIGMA0=14.0, SIGMA_CAP=84.0, Z90=1.645;
    const bandPts=[];
    for (let gi=0; gi<res.xs.length; gi++){
      const xd=res.xs[gi];
      if (xd==null||isNaN(xd)||!isFinite(xd)) continue;
      const dists=lx.map(x=>Math.abs(x-xd)).sort((a,b)=>a-b);
      let nIn=0; for (const d of dists) if (d<=SIGMA0) nIn++;
      let sigma=SIGMA0;
      if (nIn<3) sigma=Math.min(SIGMA_CAP, dists.length>=3?dists[2]:SIGMA_CAP);
      const ws=[]; let wSum=0;
      for (let i=0;i<lx.length;i++){ const w=Math.exp(-0.5*Math.pow((lx[i]-xd)/sigma,2)); ws.push(w); wSum+=w; }
      if (wSum<=0) continue;
      let contributing=0; for (const w of ws) if (w>0.01) contributing++;
      if (contributing<2) continue;
      let mu=0; for (let i=0;i<lx.length;i++) mu+=ws[i]*ly[i];
      mu/=wSum;
      let vLoc=0; for (let i=0;i<lx.length;i++) vLoc+=ws[i]*Math.pow(ly[i]-mu,2);
      vLoc/=wSum;
      let vSamp=0;
      for (let i=0;i<lx.length;i++){
        const mae=sub[i].Hesaplanan_MAE>0?sub[i].Hesaplanan_MAE:2.5;
        vSamp+=ws[i]*ws[i]*Math.pow(mae/100/1.96,2);
      }
      vSamp/= (wSum*wSum);
      const half=Z90*Math.sqrt(Math.max(0,vLoc)+vSamp);
      const li=padL+(xd/spanDays)*(w-padL-padR);
      bandPts.push([li, sy(mu+half), sy(mu-half), sy(mu)]);
    }
    let lastLi=null,lastTi=null;
    if (bandPts.length>1){
      // band polygon (kernel mean ± 90% range)
      let bandPath='M '+bandPts.map(pt=>pt[0].toFixed(1)+' '+pt[1].toFixed(1)).join(' L ');
      const bot=bandPts.slice().reverse();
      bandPath+=' L '+bot.map(pt=>pt[0].toFixed(1)+' '+pt[2].toFixed(1)).join(' L ')+' Z';
      svg+=`<path d="${bandPath}" fill="${color}" opacity="0.12" stroke="none"/>`;
      for (const r of sub) svg+=`<circle cx="${sxMs(r.Tarih_Formatli.getTime())}" cy="${sy(r[p])}" r="6" fill="${color}" opacity="0.55" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`;
      // bold line = Gaussian kernel weighted mean (consistent with the band center)
      let meanPath='';
      for (let i=0;i<bandPts.length;i++){
        const pt=bandPts[i];
        meanPath+=(meanPath===''?`M ${pt[0].toFixed(1)} ${pt[3].toFixed(1)}`:` L ${pt[0].toFixed(1)} ${pt[3].toFixed(1)}`);
        lastLi=pt[0]; lastTi=pt[3];
      }
      if (meanPath) svg+=`<path d="${meanPath}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round"/>`;
    } else {
      // fallback: LOWESS flat line for very sparse parties
      for (const r of sub) svg+=`<circle cx="${sxMs(r.Tarih_Formatli.getTime())}" cy="${sy(r[p])}" r="6" fill="${color}" opacity="0.55" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`;
      let path="";
      for (let i=0;i<res.xs.length;i++){
        const yi=res.ys[i];
        if (yi==null||isNaN(yi)||!isFinite(yi)) continue;
        const li=padL+(res.xs[i]/spanDays)*(w-padL-padR);
        const ti=sy(yi);
        path+=(path===''?`M ${li.toFixed(1)} ${ti.toFixed(1)}`:` L ${li.toFixed(1)} ${ti.toFixed(1)}`);
        lastLi=li; lastTi=ti;
      }
      if (path && lastLi!==null) svg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round"/>`;
    }
    if (lastLi!==null) labelPool.push([lastTi,p,color,lastLi]);
  }
  labelPool.sort((a,b)=>a[0]-b[0]);
  const minGap=17.0, maxY=h-padB-4;
  const nlab=labelPool.length;
  if (nlab>1){
    for (let i=nlab-2;i>=0;i--){
      const need=labelPool[i+1][0]-minGap;
      if (labelPool[i][0]>need) labelPool[i][0]=need;
    }
    for (const item of labelPool) item[0]=Math.max(padT,Math.min(maxY,item[0]));
  } else {
    for (const item of labelPool) item[0]=Math.max(padT,Math.min(maxY,item[0]));
  }
  for (const [y,p,color,li] of labelPool){
    svg+=`<circle cx="${li}" cy="${y}" r="3.5" fill="${color}"/>`;
    svg+=`<line x1="${li}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="${color}" stroke-width="1.5"/>`;
    svg+=`<text x="${w-padR-4}" y="${y}" text-anchor="end" fill="${color}" font-size="14" font-weight="900">${esc(p)}</text>`;
  }
  return svg+'</svg>';
}
function buildBeeSwarmSvg(scatterX, scatterColors){
  const n=scatterX.length;
  if (!n) return "<div style='color:#888; text-align:center;'>Simülasyon sonucu yok.</div>";
  const w=920,h=520;
  const xMin=Math.max(0,Math.min.apply(null,scatterX)-10), xMax=Math.min(600,Math.max.apply(null,scatterX)+10);
  const yMax=6, padL=70,padR=40,padT=72,padB=64;
  const sx=(v)=>padL+(v-xMin)/(xMax-xMin)*(w-padL-padR);
  const sy=(v)=>padT+(v+yMax)/(2*yMax)*(h-padT-padB);
  let svg=`<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#FFFFFF;">`;
  svg+=`<rect x="${sx(0)}" y="${padT}" width="${sx(300.5)-sx(0)}" height="${h-padT-padB}" fill="#E30A17" opacity="0.08"/>`;
  svg+=`<rect x="${sx(300.5)}" y="${padT}" width="${sx(600)-sx(300.5)}" height="${h-padT-padB}" fill="#FF8C00" opacity="0.08"/>`;
  const x301=sx(300.5);
  svg+=`<line x1="${x301}" y1="${padT}" x2="${x301}" y2="${h-padB}" stroke="#1A1A1A" stroke-width="2" stroke-dasharray="6,6"/>`;
  svg+=`<text x="${x301}" y="${padT-16}" text-anchor="middle" fill="#1A1A1A" font-size="13" font-weight="900">301 ÇOĞUNLUK SINIRI</text>`;
  const legend=[['YENİ','#A7050E'],['MUHALEFET','#E30A17'],['AKP','#FDA000'],['CUMHUR','#FF8C00']];
  const itemW=(lab)=>12+6+Math.max(24,lab.length*8)+22;
  const totalW=legend.reduce((a,[lab])=>a+itemW(lab),0);
  let lx=(w-totalW)/2, ly=h-24;
  for (const [lab,col] of legend){
    svg+=`<rect x="${lx}" y="${ly}" width="12" height="12" fill="${col}" stroke="#111827" stroke-width="1.5"/><text x="${lx+16}" y="${ly+10}" fill="#1A1A1A" font-size="10" font-weight="800">${lab}</text>`;
    lx+=itemW(lab);
  }
  for (let gv=0; gv<=600; gv+=50){
    if (gv<xMin||gv>xMax) continue;
    const gx=sx(gv);
    svg+=`<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${h-padB}" stroke="#E0E0E0" stroke-width="1" stroke-dasharray="4,4"/><text x="${gx}" y="${h-padB+22}" text-anchor="middle" fill="#71716E" font-size="12" font-weight="700">${gv}</text>`;
  }
  const r=6, step=12, center=sy(0);
  const placed=[];
  const occupied=(px,py)=>{ for (const [qx,qy] of placed){ if ((px-qx)*(px-qx)+(py-qy)*(py-qy) < (2*r+1)*(2*r+1)) return true; } return false; };
  const idxs=scatterX.map((_,i)=>i).sort((a,b)=>scatterX[a]-scatterX[b]);
  for (const idx of idxs){
    const xv=scatterX[idx], cv=scatterColors[idx];
    const jitter=(idx*7919)%5-2;
    const px=sx(xv)+jitter;
    let k=0, cy=center;
    while (k<300){
      if (!occupied(px,cy)) break;
      k++;
      cy=center+Math.floor((k+1)/2)*step*((k%2)?1:-1);
      if (cy<padT||cy>h-padB){ cy=(cy<padT)?padT:h-padB; break; }
    }
    cy=Math.max(padT,Math.min(h-padB,cy));
    placed.push([px,cy]);
    const majority = cv==='#A7050E' ? " YENİ çoğunluğu" : cv==='#E30A17' ? " muhalefet çoğunluğu" : cv==='#FDA000' ? " AKP çoğunluğu" : cv==='#FF8C00' ? " Cumhur çoğunluğu" : " başa baş";
    svg+=`<g><title>${xv} sandalye — ${majority}</title><circle cx="${px.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${cv}" stroke="rgba(255,255,255,0.9)" stroke-width="0.6"/></g>`;
  }
  return svg+'</svg>';
}
function mcTitleHtml(prob, allianceName, color){
  const label = prob>=95?'KESİN FAVORİ':prob>=75?'GÜÇLÜ FAVORİ':prob>=60?'FAVORİ':'KILPAYI ÖNDE';
  return `<div style='text-align: center; font-weight: 900; font-size: 1.8rem; letter-spacing: -1px; text-transform: uppercase; margin-bottom: 1rem; color: #1A1A1A;'>MECLİS ÇOĞUNLUĞUNDA <span style='color: ${color} !important;'>${allianceName}</span> ${label}</div>`;
}
// standard normal from the seeded rng (Box-Muller)
function gaussRandom(rng){
  let u1=rng(); if (u1<=0) u1=1e-12;
  const u2=rng();
  return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
}
function mcFaceoffHtml(items){
  const segs=items.map(it=>Math.max(it.prob,1.0));
  const tot=segs.reduce((a,b)=>a+b,0);
  const leader=items.slice().sort((a,b)=>b.prob-a.prob)[0];
  let html=`<div style='margin-bottom:1.2rem;width:100%;'>`;
  html+=`<div style='text-align:center;font-size:10px;font-weight:900;letter-spacing:1px;color:#71716E;text-transform:uppercase;margin-bottom:6px;'>MECLİS ÇOĞUNLUĞU OLASILIĞI</div>`;
  html+=`<div style='display:flex;justify-content:center;align-items:baseline;gap:14px;margin-bottom:10px;flex-wrap:wrap;'>`;
  items.forEach((it,i)=>{
    if (i>0) html+=`<span style='color:#CBD5E1;font-size:20px;font-weight:900;'>·</span>`;
    html+=`<span style='color:${it.color};font-size:30px;font-weight:900;font-variant-numeric:tabular-nums;'>%${it.prob}</span><span style='color:#71716E;font-size:11px;font-weight:900;letter-spacing:1px;'>${it.label} ÇOĞUNLUĞU</span>`;
  });
  html+=`</div>`;
  html+=`<div style='position:relative;'>`;
  html+=`<div style='display:flex;height:16px;border:2px solid #111827;box-shadow:3px 3px 0 rgba(17,24,39,1);overflow:hidden;'>`;
  items.forEach(it=>{ html+=`<div style='width:${((Math.max(it.prob,1.0)/tot)*100).toFixed(1)}%;background:${it.color};'></div>`; });
  html+=`</div>`;
  html+=`<div style='position:absolute;left:50%;top:-7px;transform:translateX(-50%);width:3px;height:30px;background:#111827;'></div>`;
  html+=`</div>`;
  html+=`<div style='display:flex;justify-content:space-between;margin-top:8px;font-size:11px;font-weight:900;color:#71716E;flex-wrap:wrap;gap:4px;'>`;
  items.forEach(it=>{ html+=`<span>${it.label} — ${it.wins} / 500 senaryo</span>`; });
  html+=`<span style='color:#1A1A1A;'>${leader.label} %${leader.prob}</span>`;
  html+=`</div></div>`;
  return html;
}
function buildConfTableHtml(confRows){
  let html=(
    "<style>"
    +".conf-table { width: 100%; border-collapse: collapse; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; color: #1A1A1A; }"
    +".conf-table th { text-align: left; padding: 12px 10px; border-bottom: 2px solid #111827; font-weight: 900; text-transform: uppercase; font-size: 11px; letter-spacing: 0.6px; color: #71716E; }"
    +".conf-table td { padding: 10px 10px; border-bottom: 1px solid #E3E3E3; vertical-align: middle; }"
    +".conf-seat { padding: 2px 0; }"
    +".conf-seat .track { position: relative; height: 14px; background: #F0EFED; border: 2px solid #111827; box-shadow: 2px 2px 0 rgba(17,24,39,1); }"
    +".conf-seat .ruler { position: absolute; top: 0; bottom: 0; width: 2px; background: #CBD5E1; transform: translateX(-50%); }"
    +".conf-seat .dot { position: absolute; top: -5px; width: 6px; height: 22px; background: #111827; transform: translateX(-50%); }"
    +".conf-seat .nums { display: flex; justify-content: space-between; margin-top: 4px; align-items: baseline; font-variant-numeric: tabular-nums; }"
    +".conf-seat .nums .lo, .conf-seat .nums .hi { font-weight: 900; font-size: 11px; color: #71716E; }"
    +".conf-seat .nums .mid { color: #1A1A1A; font-size: 15px; font-weight: 900; }"
    +".conf-prob { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }"
    +".conf-prob .bar { width: 90px; height: 10px; background: #F0EFED; border: 2px solid #111827; box-shadow: 2px 2px 0 rgba(17,24,39,1); }"
    +"</style>"
    +"<div style='overflow-x: auto;'><table class='conf-table'><thead><tr>"
    +"<th style='min-width:64px;'>Parti</th><th style='width:52%;min-width:240px;'>Beklenen Sandalye (95% Aralık)</th><th style='text-align:right;'>1. Parti İhtimali</th>"
    +"</tr></thead><tbody>"
  );
  for (const r of confRows){
    const pcol=PARTY_COLORS[r.p]||'#888';
    const loF=Math.max(0,Math.min(1,r.lo/600.0));
    const hiF=Math.max(0,Math.min(1,r.hi/600.0));
    const avgF=Math.max(0,Math.min(1,r.avg/600.0));
    const rulers=`<div class='ruler' style='left:${(301/600*100).toFixed(1)}%;'></div>`;
    html += (
      `<tr>`
      +`<td style='color:${pcol};font-weight:900;white-space:nowrap;'>${esc(r.p)}</td>`
      +`<td><div class='conf-seat'><div class='track'>`
      +`<div style='left:${(loF*100).toFixed(1)}%;width:${((hiF-loF)*100).toFixed(1)}%;background:${pcol};opacity:0.4;position:absolute;top:0;bottom:0;'></div>`
      +rulers
      +`<div class='dot' style='left:${(avgF*100).toFixed(1)}%;background:${pcol};'></div>`
      +`</div><div class='nums'><span class='lo'>${r.lo}</span><span class='mid'>${r.avg}</span><span class='hi'>${r.hi}</span></div></div></td>`
      +`<td><div class='conf-prob'><div class='bar'><div style='height:100%;width:${Math.min(100,r.prob)}%;background:${pcol};'></div></div>`
      +`<span style='font-weight:900;font-size:13px;color:#1A1A1A;font-variant-numeric:tabular-nums;width:46px;text-align:right;'>%${r.prob}</span>`
      +`</div></td></tr>`
    );
  }
  return html+"</tbody></table></div>";
}
function firmChipHtml(f){
  return `<div class="member-chip"><span class="t">${esc(f)}</span><button type="button" title="Kaldır">✕</button></div>`;
}
// province race ratings (5-tier)
function provTier(margin){
  if (margin>15) return 'KESİN';
  if (margin>10) return 'GÜÇLÜ';
  if (margin>5) return 'EĞİLİMLİ';
  if (margin>2.5) return 'HAFİF EĞİLİMLİ';
  return 'BAŞA BAŞ';
}
function mcDistDisplayName(nd){
  const m=String(nd).match(/(\d+)$/);
  if (m) return `${get_display_label(String(nd).replace(/\d+$/,''))} ${m[1]}. Bölge`;
  return get_display_label(nd);
}
function latestPollRaw(){
  let best=null,bestMs=-Infinity;
  for (const r of POLLS_RAW){
    const d=parseTurkishDate(r&&r.Tarih);
    if (d instanceof Date && !isNaN(d.getTime()) && d.getTime()>bestMs){ bestMs=d.getTime(); best=r.Tarih; }
  }
  return best?String(best):null;
}
function runMc(){
  if (state.mc.running) return;
  const firms=state.selectedFirms||[];
  if (!firms.length || !FIRM_NAMES_JS.length) return;
  const total=Object.values(state.userInputs).reduce((a,b)=>a+(b||0),0);
  if (total<=0) return;
  state.mc.running=true;
  renderOlasilik();
  window.setTimeout(()=>{
    try{
      const alliances=alliancesObj();
      const jointL=jointListsObj();
      const baseObj=_weightedBase(state.w18,state.w23,state.w24,state.customPartiesDef);
      const baseNational=baseObj.nat;
      const allP=allParties();
      const dfPolls=processPolls(firms);
      if (!dfPolls) return;
      state.pollTableHtml=""; state.trendSvg="";
      const tabloPartileri=state.activeParties.filter(p=>dfPolls.some(r=>p in r));
      if (tabloPartileri.length){
        state.pollTableHtml=buildPollTableHtml(dfPolls,tabloPartileri);
        state.trendSvg=buildTrendSvg(dfPolls,tabloPartileri);
      }
      // weighted poll votes (port of run_mc)
      let toplamAgirlik=0;
      for (const r of dfPolls) toplamAgirlik+=r['Ağırlık'];
      const agirlikliOylar={};
      for (const p of tabloPartileri){
        let s=0;
        for (const r of dfPolls) s+=(r[p]==null||isNaN(r[p])?0:r[p])*r['Ağırlık'];
        agirlikliOylar[p] = toplamAgirlik>0? s/toplamAgirlik : 0;
      }
      for (const p of allP){ if (agirlikliOylar[p]===undefined) agirlikliOylar[p]=0.5; }
      let aSum=Object.values(agirlikliOylar).reduce((a,b)=>a+b,0)||1;
      for (const p of Object.keys(agirlikliOylar)) agirlikliOylar[p]=(agirlikliOylar[p]/aSum)*100;

      const iterCount=500, hataPayi=state.hataPayi;
      // correlated noise: national shock (shared by all districts) + per-province shocks
      const MC_NAT_SIGMA=0.03, MC_PROV_SIGMA=0.04;
      const provSet={};
      for (const key of Object.keys(baseObj.base)){ const prov=String(key.split('|')[0]).replace(/[0-9]+$/,''); provSet[prov]=1; }
      const MC_PROVS=Object.keys(provSet);
      const rng=mulberry32(Math.floor(Math.random()*0x7fffffff)|0);
      let yeniWins=0,muhWins=0,akpWins=0,cumhurWins=0,noneWins=0;
      const mcSeatsHistory={}, firstPartyWins={};
      for (const p of allP){ mcSeatsHistory[p]=[]; firstPartyWins[p]=0; }
      const districtWinHistory={};
      const distMarginSum={};
      const scatterX=[],scatterColors=[];

      for (let i=0;i<iterCount;i++){
        const partiesInMix=Object.keys(agirlikliOylar).filter(p=>agirlikliOylar[p]>0.0);
        const mcInputsNorm={};
        if (partiesInMix.length){
          const dirichletArgs=partiesInMix.map(p=>Math.max(agirlikliOylar[p]/100.0,1e-6)*(1000.0/Math.max(0.5,hataPayi)));
          const mcVals=dirichletSample(dirichletArgs,rng).map(v=>v*100.0);
          for (let k=0;k<partiesInMix.length;k++) mcInputsNorm[partiesInMix[k]]=mcVals[k];
        }
        for (const p of allP){ if (mcInputsNorm[p]===undefined) mcInputsNorm[p]=0.0; }
        // correlated error model: shared national shock + per-province multipliers per party
        const provBoostMap={};
        for (const p of partiesInMix){
          const natMult=Math.exp(MC_NAT_SIGMA*gaussRandom(rng));
          mcInputsNorm[p]*=natMult;
          const pmap={};
          for (const prov of MC_PROVS) pmap[prov]=Math.exp(MC_PROV_SIGMA*gaussRandom(rng));
          const def=REGIONAL_BOOSTS_DEFAULT[p];
          if (def && def.multiplier>1 && def.provinces){
            for (const prov of def.provinces){ if (pmap[prov]!==undefined) pmap[prov]*=def.multiplier; }
          }
          provBoostMap[p]={map:pmap};
        }

        const dfMc=run_simulation(baseObj, baseNational, mcInputsNorm, alliances, jointL, state.threshold, state.allocation, provBoostMap, allP);
        const mcSeats={};
        for (const r of dfMc) mcSeats[r.p]=(mcSeats[r.p]||0)+r.seats_won;
        for (const p of allP) mcSeatsHistory[p].push(mcSeats[p]||0);
        // per-district margin tracking (ratings are region/district based)
        const distGrouped0={};
        for (const r of dfMc){ (distGrouped0[r.d]=distGrouped0[r.d]||[]).push(r); }
        for (const d of Object.keys(distGrouped0)){
          const nd=normalize_id(d);
          const pcts=distGrouped0[d].map(r=>[r.p,r.new_vote_pct]).sort((a,b)=>b[1]-a[1]);
          if (!pcts.length) continue;
          const margin=pcts.length>1?(pcts[0][1]-pcts[1][1]):pcts[0][1];
          distMarginSum[nd]=(distMarginSum[nd]||0)+margin;
        }
        const seatKeys=Object.keys(mcSeats);
        if (seatKeys.length){
          let fp=seatKeys[0],mx=-1;
          for (const p of seatKeys){ if (mcSeats[p]>mx){ mx=mcSeats[p]; fp=p; } }
          firstPartyWins[fp]=(firstPartyWins[fp]||0)+1;
        }
        const distGrouped={};
        for (const r of dfMc){ (distGrouped[r.d]=distGrouped[r.d]||[]).push(r); }
        for (const dist of Object.keys(distGrouped)){
          const normDist=normalize_id(dist);
          if (!districtWinHistory[normDist]) districtWinHistory[normDist]={};
          const distData=distGrouped[dist];
          let sumV=0; for (const r of distData) sumV+=r.new_vote_pct;
          if (sumV>0){
            let wincand=null,wv=-1;
            for (const r of distData){ if (r.new_vote_pct>wv){ wv=r.new_vote_pct; wincand=r.p; } }
            districtWinHistory[normDist][wincand]=(districtWinHistory[normDist][wincand]||0)+1;
          }
        }
        const cumhurKoltuk=(mcSeats.AKP||0)+(mcSeats.MHP||0)+(mcSeats.BBP||0)+(mcSeats.YRP||0)+(mcSeats.HUDA||0);
        const yeniKoltuk=mcSeats.YENI||0;
        const akpKoltuk=mcSeats.AKP||0;
        const muhKoltuk=600-cumhurKoltuk;
        let ocol;
        if (yeniKoltuk>=301){ yeniWins++; ocol='#A7050E'; }
        else if (muhKoltuk>=301){ muhWins++; ocol='#E30A17'; }
        else if (akpKoltuk>=301){ akpWins++; ocol='#FDA000'; }
        else if (cumhurKoltuk>=301){ cumhurWins++; ocol='#FF8C00'; }
        else { noneWins++; ocol='#71716E'; }
        scatterColors.push(ocol);
        scatterX.push(cumhurKoltuk);
      }

      const yeniProb=Math.floor(yeniWins/iterCount*100), muhProb=Math.floor(muhWins/iterCount*100), akpProb=Math.floor(akpWins/iterCount*100), cumhurProb=Math.floor(cumhurWins/iterCount*100);
      const outItems=[{label:'YENİ',prob:yeniProb,wins:yeniWins,color:'#A7050E'},{label:'MUHALEFET',prob:muhProb,wins:muhWins,color:'#E30A17'},{label:'CUMHUR',prob:cumhurProb,wins:cumhurWins,color:'#FF8C00'},{label:'AKP',prob:akpProb,wins:akpWins,color:'#FDA000'}];
      const leader=outItems.slice().sort((a,b)=>b.prob-a.prob)[0];
      if (leader.prob>=50) state.mc.titleHtml=mcTitleHtml(leader.prob,leader.label,leader.color);
      else state.mc.titleHtml="<div style='text-align: center; font-weight: 900; font-size: 1.8rem; letter-spacing: -1px; text-transform: uppercase; margin-bottom: 1rem; color: #1A1A1A;'>MECLİS ÇOĞUNLUĞU <span style='color: #71716E !important;'>BAŞA BAŞ</span></div>";
      state.mc.faceoffHtml=mcFaceoffHtml(outItems);

      const confRows=[];
      for (const p of allP){
        const arr=mcSeatsHistory[p];
        const avg=arrMean(arr);
        if (avg>1){
          confRows.push({p:p, lo:Math.floor(arrPercentile(arr,2.5)), avg:Math.floor(avg), hi:Math.floor(arrPercentile(arr,97.5)), prob:Math.floor((firstPartyWins[p]/iterCount)*100)});
        }
      }
      confRows.sort((a,b)=>b.avg-a.avg);
      state.mc.confTableHtml=buildConfTableHtml(confRows);
      state.mc.beeSvg=buildBeeSwarmSvg(scatterX,scatterColors);

      const mcolDict={}, mcDistWinners={}, mcTooltipDict={};
      for (const normDist of Object.keys(districtWinHistory)){
        const partyWins=districtWinHistory[normDist];
        let topParty=null,tcnt=-1;
        for (const p of Object.keys(partyWins)){ if (partyWins[p]>tcnt){ tcnt=partyWins[p]; topParty=p; } }
        mcDistWinners[normDist]=topParty;
        mcolDict[normDist]=get_probability_color(topParty,partyWins[topParty],iterCount);
        const displayName=mcDistDisplayName(normDist);
        const partsHtml=[`<div class="tip-header">${displayName}<span class="tip-total">KAZANMA OLASILIĞI</span></div>`];
        const entries=Object.entries(partyWins).sort((a,b)=>b[1]-a[1]);
        for (const [pName,wins] of entries){
          const pct=(wins/iterCount)*100;
          if (pct>0) partsHtml.push(`<div class="tip-row"><div class="tip-party" style="width:70px;">${esc(pName)}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${pct.toFixed(1)}%; background-color: ${PARTY_COLORS[pName]||'#888'};"></div></div><div class="tip-pct">%${pct.toFixed(1)}</div></div>`);
        }
        mcTooltipDict[normDist]=partsHtml.join("");
      }
      // district race ratings + tier chip on each district tooltip
      const provRatings=[];
      for (const nd of Object.keys(districtWinHistory)){
        const counts=districtWinHistory[nd];
        let topParty=null,tcnt=-1;
        for (const p of Object.keys(counts)){ if (counts[p]>tcnt){ tcnt=counts[p]; topParty=p; } }
        const prob=Math.floor((tcnt/iterCount)*100);
        const margin=(distMarginSum[nd]||0)/iterCount;
        provRatings.push({prov:nd, party:topParty, prob, margin, tier:provTier(margin)});
      }
      provRatings.sort((a,b)=>a.margin-b.margin);
      state.mc.provRatings=provRatings;
      const provTierMap={}; for (const rt of provRatings) provTierMap[rt.prov]=rt;
      for (const normDist of Object.keys(mcTooltipDict)){
        const rt=provTierMap[normDist];
        if (!rt) continue;
        const tc=PARTY_COLORS[rt.party]||'#888';
        mcTooltipDict[normDist]+=`<div class="tip-tier" style="display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:4px 0;border:2px solid #111827;background:${tc};color:#FFFFFF;font-weight:900;font-size:11px;letter-spacing:1px;text-align:center;">${rt.tier}</div>`;
      }
      state.mc.mapHtml=renderColoredSvg(SVG_TURKIYE,{provWinners:{},distWinners:mcDistWinners,colorsDict:PARTY_COLORS,tooltipDict:mcTooltipDict,seatsData:{},showBadges:false,customColors:mcolDict,uid:'mc',svgFile:'turkiye.svg',hiddenInputId:'hidden_prov_input_mc',detailSectionId:'mc_prov_detail_section'});
    } finally {
      state.mc.running=false;
      renderOlasilik();
      window.setTimeout(()=>{ if ($('#map-wrapper-mc')) bindMapWrapper('mc', null); },30);
    }
  },30);
}
function bindOlasilikEvents(){
  const pane=$('#pane_538');
  if (!pane) return;
  const run=document.getElementById('mc-run');
  if (run) run.onclick=()=>runMc();
  $$('#pane_538 .member-chip button').forEach(b=>{
    b.onclick=()=>{
      const t=(b.parentElement&&b.parentElement.querySelector('.t'))?b.parentElement.querySelector('.t').textContent:'';
      state.selectedFirms=(state.selectedFirms||[]).filter(x=>x!==t);
      renderOlasilik();
    };
  });
  const add=document.getElementById('mc-firm-add');
  if (add) add.onchange=()=>{
    const v=add.value;
    if (v){ if ((state.selectedFirms||[]).indexOf(v)<0) state.selectedFirms=[...(state.selectedFirms||[]),v]; add.value=''; renderOlasilik(); }
  };
  const hata=document.getElementById('mc-hata');
  if (hata) hata.onchange=()=>{
    const v=parseFloat(hata.value);
    if (!isNaN(v)) state.hataPayi=clamp(v,0.5,5.0);
  };
  const tier=document.getElementById('mc-tier-filter');
  if (tier) tier.onchange=()=>{ state.mc.tierFilter=tier.value; renderOlasilik(); };
}
function renderOlasilik(){
  const pane=$('#pane_538');
  if (!pane) return;
  const firms=state.selectedFirms||[];
  const avail=FIRM_NAMES_JS.filter(f=>firms.indexOf(f)<0);
  let html=`<div class="tab-pane-inner"><div class="tab-pane-538">`;
  // 0) nowcast framing banner
  const latestT=latestPollRaw();
  html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;margin-bottom:12px;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
    <div class="sb-kicker"><div class="bar"></div><div class="t">SON DURUM (NOWCAST)</div></div>
    <div style="font-size:12px;color:var(--c-text-muted);width:100%;line-height:1.6;">Model, bugün seçim olsa ortaya çıkacak tabloyu gösterir; geleceğe projeksiyon yapmaz. Kararsızlar hiçbir partiye dağıtılmaz; farklar anketlerde yayınlandığı haliyle korunur.${latestT?` <span style="color:#1A1A1A;font-weight:900;">Son güncelleme: ${esc(latestT)}.</span>`:''}</div>
  </div>`;
  // 1) firm selection + hata payı
  html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;margin-bottom:12px;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
    <div class="sb-kicker"><div class="bar"></div><div class="t">MODELE DAHİL EDİLECEK FİRMALAR</div></div>
    <div style="display:flex;gap:12px;align-items:flex-end;width:100%;flex-wrap:wrap;">
      <div style="flex:1;min-width:260px;background:#F7F7F5;border:1px solid var(--c-border);padding:12px;width:100%;">
        <div style="width:100%;margin-bottom:8px;">${firms.length?`<div class="chip-row">${firms.map(firmChipHtml).join('')}</div>`:`<div style="font-size:10px;color:var(--c-text-muted);">Firma seçilmedi — aşağıdaki menüden ekleyin.</div>`}</div>
        <div class="editor-add"><select id="mc-firm-add"><option value="">+ Firma ekle</option>${avail.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></div>
      </div>
      <div style="width:110px;flex-shrink:0;text-align:center;">
        <div style="font-weight:900;color:var(--c-text-muted);font-size:10px;letter-spacing:1px;width:100%;margin-bottom:6px;">Anket Hata Payı (MC σ)</div>
        <input id="mc-hata" class="sb-in" type="number" min="0.5" max="5" step="0.1" value="${state.hataPayi}" style="width:110px;height:38px;text-align:center;font-size:13px;font-weight:900;">
      </div>
    </div>
  </div>`;
  // 2) run button
  html+=`<div style="display:flex;flex-direction:column;align-items:center;width:100%;gap:12px;margin-bottom:12px;">
    <button class="btn-calc" id="mc-run" style="width:100%;padding-top:10px;padding-bottom:10px;">Modeli Çalıştır (500 Simülasyon)</button>
    ${state.mc.running?`<div style="color:#B0540A;font-weight:900;font-size:13px;">Model çalışıyor, lütfen bekleyin...</div>`:''}
  </div>`;
  // 3) results (title+faceoff+bee+conf+map)
  if (state.mc.titleHtml){
    html+=`<div style="display:flex;flex-direction:column;align-items:center;width:100%;gap:16px;">`;
    html+=state.mc.titleHtml;
    html+=state.mc.faceoffHtml;
    html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
      <div class="sb-kicker"><div class="bar"></div><div class="t">SANDALYE DAĞILIMI — 500 SİMÜLASYON</div></div>
      <div style="font-size:12px;color:var(--c-text-muted);text-align:left;width:100%;margin-bottom:8px;">Her nokta bir simülasyonun meclis sandalyesidir. Noktaya gelince sonucu görün.</div>
      <div>${state.mc.beeSvg}</div>
    </div>`;
    html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
      <div class="sb-kicker"><div class="bar"></div><div class="t">SENARYO SONUÇ LİSTESİ</div></div>
      <div>${state.mc.confTableHtml}</div>
    </div>`;
    html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
      <div class="sb-kicker"><div class="bar"></div><div class="t">TÜRKİYE OLASILIK HARİTASI</div></div>
      <div class="map-frame">${state.mc.mapHtml||emptyMap()}</div>
    </div>`;
    if (state.mc.provRatings && state.mc.provRatings.length){
      const tf=state.mc.tierFilter||'TÜMÜ';
      const filtered=tf==='TÜMÜ'?state.mc.provRatings:state.mc.provRatings.filter(r=>r.tier===tf);
      const tierChip=(t,party)=>`<span style="display:inline-block;padding:2px 8px;border:2px solid #111827;background:${PARTY_COLORS[party]||'#888'};color:#FFFFFF;font-weight:900;font-size:10px;letter-spacing:1px;">${t}</span>`;
      html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;width:100%;flex-wrap:wrap;gap:8px;">
          <div class="sb-kicker" style="margin-bottom:0"><div class="bar"></div><div class="t">SEÇİM BÖLGESİ YARIŞ KARNESİ</div></div>
          <select id="mc-tier-filter" style="height:34px;border:2px solid var(--c-edge);font-weight:900;font-size:12px;padding:0 8px;background:#fff;color:#1A1A1A;">
            ${['TÜMÜ','KESİN','GÜÇLÜ','EĞİLİMLİ','HAFİF EĞİLİMLİ','BAŞA BAŞ'].map(t=>`<option value="${t}" ${t===tf?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:12px;color:var(--c-text-muted);margin:8px 0 10px 0;">En dar farktan başlayarak ${state.mc.provRatings.length} seçim bölgesinin durumu (500 simülasyon ortalaması). Kademe eşikleri: KESİN &gt;15 · GÜÇLÜ 10-15 · EĞİLİMLİ 5-10 · HAFİF EĞİLİMLİ 2.5-5 · BAŞA BAŞ &lt;2.5 puan.</div>
        <div style="overflow-x:auto;"><table class="conf-table" style="min-width:560px;"><thead><tr><th>Seçim Bölgesi</th><th>Önde Giden Parti</th><th style="text-align:right;">1. Parti Olasılığı</th><th style="text-align:right;">Ort. Fark</th><th style="text-align:right;">Kademe</th></tr></thead><tbody>
          ${filtered.map(r=>{
            const pc=PARTY_COLORS[r.party]||'#888';
            return `<tr>
              <td style="font-weight:900;color:#1A1A1A;">${esc(mcDistDisplayName(r.prov))}</td>
              <td style="font-weight:900;color:${pc};white-space:nowrap;">${esc(r.party)}</td>
              <td style="text-align:right;font-variant-numeric:tabular-nums;">%${r.prob}</td>
              <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:900;color:#1A1A1A;">${r.margin.toFixed(1)}</td>
              <td style="text-align:right;">${tierChip(r.tier, r.party)}</td>
            </tr>`;
          }).join('')}
        </tbody></table></div>
      </div>`;
    }
    html+=`</div>`;
  }
  // 4) trend
  if (state.trendSvg){
    html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;margin-top:16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
      <div class="sb-kicker"><div class="bar"></div><div class="t">ZAMANA BAĞLI OY EĞİLİMLERİ</div></div>
      <div>${state.trendSvg}</div>
    </div>`;
  }
  // 5) poll table
  if (state.pollTableHtml){
    html+=`<div style="background:var(--c-surface);border:2px solid var(--c-edge);width:100%;padding:14px 16px;margin-top:16px;box-shadow:5px 5px 0 rgba(17,24,39,1);">
      <div class="sb-kicker"><div class="bar"></div><div class="t">SİSTEME YÜKLÜ SON ANKETLER</div></div>
      <div>${state.pollTableHtml}</div>
    </div>`;
  }
  html+=`</div></div>`;
  pane.innerHTML=html;
  bindOlasilikEvents();
}

// ================= boot =================
async function boot(){
  bindSegNav();
  const [yrs, dists, svg, polls, ilceNames, svg2, yerel, big, ytargets, meclis] = await Promise.all([
    fetch('data/base_years.json').then(r=>r.json()),
    fetch('data/districts.json').then(r=>r.json()),
    fetch('data/turkiye.svg').then(r=>r.text()),
    fetch('data/polls.json').then(r=>r.json()).catch(()=>[]),
    fetch('data/ilce_names.json').then(r=>r.json()).catch(()=>null),
    fetch('data/turkiye2.svg').then(r=>r.text()).catch(()=>''),
    fetch('data/yerel_2024_merkez.json').then(r=>r.json()).catch(()=>null),
    fetch('data/buyuksehir.json').then(r=>r.json()).catch(()=>[]),
    fetch('data/yerel_targets.json').then(r=>r.json()).catch(()=>null),
    fetch('data/belediye_meclis.json').then(r=>r.json()).catch(()=>null)
  ]);
  YEARS=yrs; DISTRICTS=dists; SVG_TURKIYE=cleanSvgString(svg);
  window.BASE_YEARS=yrs; window.DISTRICTS=dists;
  ILCE_NAMES=ilceNames;
  SVG_TURKIYE2=cleanSvgString(svg2);
  YEREL_2024=yerel;
  BUYUKSEHIR={}; for (const b of big) BUYUKSEHIR[String(b).toLowerCase()]=1;
  YEREL_TARGETS=ytargets;
  BELEDIYE_MECLIS=meclis;
  POLLS_RAW=polls||[];
  const seen={}; FIRM_NAMES_JS=[];
  for (const r of POLLS_RAW){ if (r && r.Firma && !seen[r.Firma]){ seen[r.Firma]=1; FIRM_NAMES_JS.push(String(r.Firma)); } }
  FIRM_NAMES_JS.sort();
  state.selectedFirms=[...FIRM_NAMES_JS];
  // seed custom party base pcts
  state.customPartyBasePcts={}; for (const p of BASE_PARTIES) state.customPartyBasePcts[p]=0;
  state.activeParties=[...OZEL_SIRA];
  setTab('tab_genel');
}
if (document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded', boot);

})();