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
const ILCE_CACHE = {};          // prov -> {norm:{name, parties:{P:{v18,v23,v24}}}}
const ILCE_SVG_CACHE = {};      // prov -> raw svg

window.BASE_YEARS = [] ; window.DISTRICTS = [];



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
  mcResult:null,
  hataPayi:0.5,
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
        risks.push({district:to_tr_title(d), rakip:firstL.party, desc:`${firstL.party}'den %${margin.toFixed(2)} farkla kurtarıldı.`, margin});
      } else if (firstL.party===state.targetPartySwing){
        opps.push({district:to_tr_title(d), rakip:lastW.party, desc:`${lastW.party}'ye %${margin.toFixed(2)} farkla kaybedildi.`, margin});
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
    const gv={},gs={},gc={},grep={};
    for (const p of keyset){
      const [ab,col] = badges.get(p) || [p, PARTY_COLORS[p]||'#888'];
      const v = dUn[p]||0, s = seatMap[p]||0;
      if (v<=0 && s<=0) continue;
      gv[ab]=(gv[ab]||0)+v; gs[ab]=(gs[ab]||0)+s; gc[ab]=col;
      if (!badges.has(p)) grep[ab]=p;
      else if (grep[ab]===undefined || (dUn[p]||0)>(dUn[grep[ab]]||0)) grep[ab]=p;
    }
    entities = Object.keys(gv);
    const rows = entities.map(ab=>{
      const votePct=gv[ab], seats=gs[ab], col=gc[ab];
      return summaryItem(ab, seats, votePct, col, adjBaseV[ab]||0, adjBaseS[ab]||0, dUn, grep[ab]||ab);
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
function tooltipHtmlFromRows(title, rows){
  let html = `<div class="tip-header">${title}</div>`;
  for (const r of rows.slice(0,5)){
    html += `<div class="tip-row"><div class="tip-party">${esc(r.label)}</div><div class="tip-seat">${r.seats}</div><div class="tip-bar-bg"><div class="tip-bar-fill" style="width: ${Math.min(r.vote,100).toFixed(1)}%; background-color: ${r.col};"></div></div><div class="tip-pct">%${r.vote.toFixed(1)}</div></div>`;
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
      let html=`<div class="tip-header">${to_tr_upper(prov)}<span class="tip-total">${seatSum} MİLLETVEKİLİ</span></div>`;
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
      let html=`<div class="tip-header">${dist}${seatSpan}</div>`;
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
  let html=`<div class="tip-header">${dist}${seatSpan}</div>`;
  for (const r of group){ if (r.p===party && r.new_vote_pct>0) html+=tipRowHtml(r.p, r.seats_won, r.new_vote_pct); }
  return html;
}
function provinceTooltip(prov, group, party){
  let html=`<div class="tip-header">${prov}</div>`;
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
      colorKey=winEnt?colorKeyForEntity(winEnt, regVotes, entities, alliances):'#888';
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
      colorKey=winEnt?colorKeyForEntity(winEnt, regVotes, entities, alliances):'#888';
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
  const RE_HEADER_CLEAN=/\b(width|height|style)=["'][^"']*["']/;
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
    header=header.replace(RE_HEADER_CLEAN,'');
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
  let html=`<div class="sidebar-logo"><img src="data/turkiye.svg" alt="" style="display:none"/><div style="font-weight:900;font-size:20px;letter-spacing:1px;">AD PROJEKSİYON</div><div style="font-size:11px;color:var(--c-text-muted);font-weight:900">anket &amp; seçim modeli</div></div>`;
  html+=`<div class="sb-card shadow"><button class="btn-calc" id="btn-run">SİMÜLASYONU ÇALIŞTIR</button>
    <div style="margin-top:16px"><div class="sim-select-wrap">
      <select id="scenario-select">${Object.keys(PREDEFINED_SCENARIOS).map(s=>`<option ${s===state.scenario?'selected':''}>${esc(s)}</option>`).join('')}</select>
    </div></div>
    <div class="btn-row">
      <button class="btn-side" id="btn-export">Dışa Aktar</button>
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
  const dName=to_tr_title(prov);
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
        const label=`${String(dist).split('-').slice(-1)[0]}. Bölge`;
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
  // re-bind tab triggers
  $$('.dist-nav-trigger').forEach(b=>b.addEventListener('click',()=>{
    state.detailActiveTab=b.getAttribute('data-tab');
    renderMeclis();
  }));
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
      const winEnt=Object.keys(ents).length?Object.keys(ents).sort((a,b)=>entitySum(b,ents,dpcts)-entitySum(a,ents,dpcts))[0]:null;
      const colorKey=winEnt?colorKeyForEntity(winEnt,dpcts,ents,ilsAlliances):'#888';
      wParty=colorKey; dCol=PARTY_COLORS[colorKey]||'#888';
    } else {
      wParty=top[0].p;
      dCol=get_heatmap_color(PARTY_COLORS[wParty]||'#888888', clamp(Math.max(0.3,Math.min(1.0,top[0].new_vote_pct/65)),0,1));
    }
    distWinners[nDist]=wParty; distColors[nDist]=dCol;
    const seatSum=grp.reduce((a,r)=>a+r.seats_won,0);
    const seatSpan=seatSum>0?`<span class="tip-total">${seatSum} MİLLETVEKİLİ</span>`:"";
    const dagg=aggRows(grp);
    distTips[nDist]=tooltipHtmlFromRows(`${to_tr_title(String(dist))}${seatSpan}`, tooltipGroupRows(dagg.map(o=>({party:o.party,new_vote_pct:o.pct,seats_won:o.seats}))));
    // ilce bars (2023 base from baked per-year data)
    const ilceBase=cityData[nDist]; 
    const b23=ilceBase&&ilceBase.parties?Object.fromEntries(Object.entries(ilceBase.parties).map(([p,v])=>[p,v.v23||0])):{};
    ilceBars[nDist]=buildDistrictBarRows(grp.map(r=>({party:r.p,new_vote_pct:r.new_vote_pct,seats_won:0})), b23, {}, false, null);
  }
  state.detailIlceBarsMap=ilceBars;
  const barsGroup=state.mapMode==="İttifak Renklendirmesi";
  const mapHtml=renderColoredSvg(svgText, {provWinners:{}, distWinners, colorsDict:PARTY_COLORS, tooltipDict:distTips, seatsData:{}, showBadges:false, customColors:distColors, uid:'city', svgFile:prov+'.svg', hiddenInputId:'hidden_city_input', detailSectionId:'prov_detail_section'});
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
  const pName=to_tr_title(state.detailProv);
  const bars=getActiveBars();
  const labels=state.detailTabLabels||[];
  let inner=``;
  inner+=`<div class="sb-card shadow">
    <div class="sb-kicker"><div class="bar"></div><div class="t">${pName} İLİ DETAYLI ANALİZİ</div></div>
    <div style="padding:0 14px">
    <div class="city-map-box" id="city-map-box"><div style="display:flex;justify-content:center;align-items:center;height:100%;color:#777;font-weight:bold;">${state.detailProv? 'İlçe haritası yükleniyor...':''}</div></div>
    ${state.detailIlce?`
      <div class="detail-translate">
        <div class="di-name">${to_tr_title(state.detailIlce)}</div>
        <button id="btn-back-prov" onclick="__clearIlce()">← İl Geneli</button>
      </div>
      ${ilceBarsHtml()}
      `:`
      ${labels.length?`<div class="dist-nav">${labels.map((l,i)=>`<button class="dist-nav-trigger" data-tab="${esc(l)}" ${l===state.detailActiveTab?'data-active="true"':''}>${esc(l)}</button>`).join('')}</div>`:''}
      <div class="detail-bars">${bars.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>
      `}
    </div>
    <div style="display:flex;justify-content:center;margin-top:14px;width:100%">
      <button class="btn-download" style="margin:0 auto">İL İNFOGRAFİĞİNİ İNDİR (PNG)</button>
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
      <div class="cb-picker-logo" style="background:${PARTY_COLORS[p]||'#888'}"><span>${esc(p)}</span></div>
      <div class="cb-picker-name">${esc(p)}</div>
      ${c.party===p?'<div class="cb-picker-check">✓</div>':''}
    </div>`).join('')}
  </div>`;
}
function cbBlockGridHtml(votes, candId, isR2){
  const bcols=cbBlockColors(), btot=cbBlockTotals();
  return cbVoteKeys().map(g=>`
    <div class="cb-block">
      <div><div class="cb-block-lbl" style="color:${bcols[g]||'#111827'}">${esc(g)}</div><div class="cb-block-tot">${btot[g]||'%0.0'}</div></div>
      <input class="cb-num ${isR2?'cb-r2-num':''}" type="number" min="0" max="100" step="1" ${isR2?'':`data-cand="${candId}" `}data-group="${esc(g)}" value="${votes[g]}" />
    </div>`).join('');
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
  return `<div class="cand-card cb-r2-card">
    <div class="head">
      <div class="cb-mini-label" style="margin-right:8px">2. TUR ADAYI</div>
      ${cbPartyBtnHtml(c)}
      <div class="cb-name-in" style="margin-left:8px"><input class="cb-name-input" value="${esc(c.name)}" readonly /></div>
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
    tooltips[nd]=cbTipHtml(d, entries, candColors, true);
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
    tooltips[nprov]=cbTipHtml(prov, entries, candColors, true);
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
function cbSummaryChipsHtml(summary){
  if (!summary || !summary.length) return '';
  return `<div class="prov-summary">${summary.map(s=>`<div class="prov-card cb-chip" style="border-left:3px solid ${s.color}"><div class="p">${esc(s.name)}</div><div class="v">${esc(s.pct)}</div></div>`).join('')}</div>`;
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
      ${cbSummaryChipsHtml(det.summary)}
      <div class="city-map-box" id="cb-city-map-${rn}"><div style="display:flex;justify-content:center;align-items:center;height:100%;color:#777;font-weight:bold;">İlçe haritası yükleniyor...</div></div>
      ${det.ilceSelected?`
        <div class="detail-translate">
          <div class="di-name">${to_tr_title(det.ilceSelected)}</div>
          <button data-act="cb-clear-ilce" data-rn="${rn}">← İl Geneli</button>
        </div>
        <div class="detail-bars">${ilceBars.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>
        `:`
        ${labels.length?`<div class="dist-nav">${labels.map((l,i)=>`<button class="dist-nav-trigger cb-dist-trigger" data-rn="${rn}" data-tab="${esc(l)}" ${l===det.activeTab?'data-active="true"':''}>${esc(l)}</button>`).join('')}</div>`:''}
        <div class="detail-bars">${bars.map(geoBarHtml).join('')||'<div class="big-note">Bu ilçe için sonuç bulunamadı.</div>'}</div>
        `}
    </div>
    <div style="display:flex;justify-content:center;margin-top:14px;width:100%">
      <button class="btn-download" style="margin:0 auto">İL İNFOGRAFİĞİNİ İNDİR (PNG)</button>
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
  det.prov=prov; det.name=to_tr_title(prov);
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
      const means={}; let cnt=0;
      for (const d of Object.keys(out)){ cnt++; for (const c of Object.keys(out[d])) means[c]=(means[c]||0)+out[d][c]; }
      for (const c of Object.keys(means)) means[c]/=cnt;
      labels.push('İl Geneli (Toplam)');
      tabs['İl Geneli (Toplam)']=cbBarItemsDetail(means, candColors, candPP);
      const provDists=Object.keys(out);
      if (provDists.length>1){
        for (const d of provDists){
          const m=String(d).match(/(\d+)$/);
          const label=`${m?m[1]:d}. Bölge`;
          const items=cbBarItemsDetail(out[d], candColors, candPP);
          if (items.length){ labels.push(label); tabs[label]=items; }
        }
      }
    }
  }
  det.tabLabels=labels; det.barsMap=tabs; det.activeTab=labels[0]||''; det.activeBars=tabs[labels[0]||'']||[];
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
  det.ilceSelected=ilceId; det.ilceName=to_tr_title(String(ilceId));
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
    let tipH=`<div class="tip-header">${to_tr_title(String(d))}</div>`;
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
function bindCBEvents(){
  const on=(id,fn)=>{ const e=$('#pane_cb #'+id); if (e) e.onclick=fn; };
  on('cb-add-cand',()=>addCbCandidate());
  on('cb-reset-cands',()=>resetCbCandidates());
  on('cb-round1-btn',()=>computeCbRound1());
  on('cb-round2-btn',()=>computeCbRound2());
  $$('#pane_cb .cb-name-input').forEach(inp=>{ inp.onchange=()=>{ setCbCandidateName(inp.getAttribute('data-cand'), inp.value); }; });
  $$('#pane_cb .cb-num:not(.cb-r2-num)').forEach(inp=>{ inp.onchange=()=>{ setCbCandidateVote(inp.getAttribute('data-cand'), inp.getAttribute('data-group'), inp.value); }; });
  $$('#pane_cb .cb-r2-num').forEach(inp=>{ inp.onchange=()=>{ setCb2Vote(inp.getAttribute('data-group'), inp.value); }; });
  $$('#pane_cb .cb-party-btn').forEach(btn=>{ btn.onclick=()=>{ toggleCbPicker(btn.id.replace('cb-party-','')); }; });
  $$('#pane_cb .cb-picker-close').forEach(btn=>{ btn.onclick=()=>closeCbPicker(); });
  $$('#pane_cb .cb-picker-row').forEach(row=>{ row.onclick=()=>{ selectCbParty(row.getAttribute('data-cand'), row.getAttribute('data-party')); }; });
  $$('#pane_cb .cb-del').forEach(btn=>{ btn.onclick=()=>removeCbCandidate(btn.getAttribute('data-cand')); });
  $$('#pane_cb [data-act="cb-clear-ilce"]').forEach(btn=>{ btn.onclick=()=>clearCbDetailIlce(parseInt(btn.getAttribute('data-rn'),10)); });
  $$('#pane_cb .cb-dist-trigger').forEach(b=>{ b.addEventListener('click',()=>{ setCbDetailDistTab(parseInt(b.getAttribute('data-rn'),10), b.getAttribute('data-tab')); }); });
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

// ---------------- OLASILIK (minimal port) ----------------
function renderOlasilik(){ $('#pane_538').innerHTML=`<div class="tab-pane-inner"><div class="sb-card shadow"><div class="sb-kicker"><div class="bar"></div><div class="t">OLASILIK MODELİ</div></div><div class="big-note">Olasılık modeli yakında bu alanda çalışacak.</div></div></div>`; }

// ================= boot =================
async function boot(){
  bindSegNav();
  const [yrs, dists, svg] = await Promise.all([
    fetch('data/base_years.json').then(r=>r.json()),
    fetch('data/districts.json').then(r=>r.json()),
    fetch('data/turkiye.svg').then(r=>r.text())
  ]);
  YEARS=yrs; DISTRICTS=dists; SVG_TURKIYE=cleanSvgString(svg);
  window.BASE_YEARS=yrs; window.DISTRICTS=dists;
  // seed custom party base pcts
  state.customPartyBasePcts={}; for (const p of BASE_PARTIES) state.customPartyBasePcts[p]=0;
  state.activeParties=[...OZEL_SIRA];
  setTab('tab_genel');
}
if (document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded', boot);

})();