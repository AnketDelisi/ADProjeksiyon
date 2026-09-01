// ===== Core simulation engine (port of app.py) =====
// Dynamic base: per-year raw source rows (base_years.json) weighted by w18/w23/w24,
// then transition matrix (DEFAULT_TRANSITIONS + custom party defs) applied per district.
// run_simulation is district-agnostic: derives districts from the base object itself,
// so it works for the national 87-district map AND per-province ilce maps.

// config.js provides browser globals; in Node they live in module.exports.
function _cfg(){ return (typeof module !== 'undefined' && require) ? require('./config.js') : null; }
function _B(){ const c=_cfg(); return c ? c.BASE_PARTIES : BASE_PARTIES; }
function _OS(){ const c=_cfg(); return c ? c.OZEL_SIRA : OZEL_SIRA; }
function _DT(){ const c=_cfg(); return c ? c.DEFAULT_TRANSITIONS : DEFAULT_TRANSITIONS; }
function _clamp(){ const c=_cfg(); return c ? c.clamp : clamp; }
function _sig(){ const c=_cfg(); return c ? c.sig : sig; }
function getDISTRICTS(){ return (typeof module!=='undefined') ? globalThis.DISTRICTS : window.DISTRICTS; }
function getBASEYEARS(){ return (typeof module!=='undefined') ? globalThis.BASE_YEARS : window.BASE_YEARS; }
function _getDisplayName(x){ const c=_cfg(); return c ? c.get_display_name(x) : get_display_name(x); }
function _normId(x){ const c=_cfg(); return c ? c.normalize_id(x) : normalize_id(x); }

// all_parties ordering: OZEL_SIRA first, then any remaining base/custom parties
function _allParties(customDefs){
  const custom = (customDefs && typeof customDefs === 'object') ? Object.keys(customDefs) : [];
  const base = _B().slice();
  const pool = base.concat(custom.filter(cp => base.indexOf(cp) === -1));
  const basic = (_OS()).filter(p => pool.indexOf(p) !== -1);
  return basic.concat(pool.filter(p => basic.indexOf(p) === -1));
}

// Aggregate base_years rows into {d: {p: {v18,v23,v24}}}
function _yearDataMap(rows){
  const map = {};
  for (const r of rows){
    if (!map[r.d]) map[r.d] = {};
    map[r.d][r.p] = {v18:r.v18, v23:r.v23, v24:r.v24};
  }
  return map;
}

// Build transition matrix W: target -> source -> pct/100
function _weightMatrix(customDefs){
  const allDefs = {};
  for (const t of Object.keys(_DT())) allDefs[t] = Object.assign({}, _DT()[t]);
  const custom = (customDefs && typeof customDefs === 'object') ? customDefs : {};
  for (const cp of Object.keys(custom)){
    if (custom[cp] && custom[cp].bases) allDefs[cp] = Object.assign({}, custom[cp].bases);
  }
  const W = {}; // target -> {source: pct/100}
  for (const t of Object.keys(allDefs)){
    W[t] = {};
    for (const s of Object.keys(allDefs[t])) W[t][s] = allDefs[t][s] / 100.0;
  }
  return W;
}

// Core: weighted source per district -> transition matrix -> derived base + national base
// yearData: {d: {p: {v18,v23,v24}}};  seats: {d: count}
// Returns {base: {d|p: derived pct}, nat: {p: national pct (seat-weighted)}}
function applyCustomPartiesJS(yearData, seats, w18, w23, w24, customDefs){
  const W = _weightMatrix(customDefs);
  const targets = Object.keys(W);
  // source parties present in data (pivot columns)
  const pivotCols = {};
  for (const d of Object.keys(yearData)) for (const p of Object.keys(yearData[d])) pivotCols[p] = 1;
  const srcKeys = {};
  for (const t of Object.keys(W)) for (const s of Object.keys(W[t])) srcKeys[s] = 1;
  const common = Object.keys(srcKeys).filter(s => pivotCols[s]);

  const totW = (w18 + w23 + w24) || 100;
  const wn18 = w18/totW, wn23 = w23/totW, wn24 = w24/totW;

  const base = {};
  const nat = {};
  let totalSeats = 0;
  for (const d of Object.keys(seats)) totalSeats += seats[d] || 0;

  for (const d of Object.keys(yearData)){
    const src = yearData[d];
    const wRaw = {};
    for (const p of Object.keys(src)){
      const v = src[p];
      const wv = (v.v18||0)*wn18 + (v.v23||0)*wn23 + (v.v24||0)*wn24;
      if (wv !== 0) wRaw[p] = wv;
    }
    const sCount = seats[d] || 0;
    for (const t of targets){
      let val = 0;
      const row = W[t];
      for (const s of common){
        const srcPct = wRaw[s];
        const m = row[s];
        if (srcPct && m) val += srcPct * m;
      }
      const key = d + '|' + t;
      base[key] = val;
      if (sCount > 0) nat[t] = (nat[t] || 0) + val * sCount;
    }
  }
  if (totalSeats > 0){
    for (const t of Object.keys(nat)) nat[t] = nat[t] / totalSeats;
  }
  return { base, nat };
}

// National base object at arbitrary weights + custom parties
// Returns {base, seats, nat}
function _weightedBase(w18, w23, w24, customDefs){
  const DISTRICTS = getDISTRICTS();
  const seatByNorm = {};
  for (const d of DISTRICTS) seatByNorm[d.norm] = d.seats;
  const yearData = _yearDataMap(getBASEYEARS());
  const res = applyCustomPartiesJS(yearData, seatByNorm, w18, w23, w24, customDefs);
  return { base: res.base, seats: seatByNorm, nat: res.nat };
}

function _get_qualified_parties(working_nat, alliances, threshold, all_parties){
  all_parties = all_parties || (_B());
  const alliancesLocal = {};
  for (const aly of Object.keys(alliances)) alliancesLocal[aly] = [...alliances[aly]];
  const partyToAlliance = {};
  for (const aly of Object.keys(alliancesLocal)) for (const p of alliancesLocal[aly]) partyToAlliance[p]=aly;
  for (const p of all_parties){ if (!(p in partyToAlliance)){ partyToAlliance[p]=p; alliancesLocal[p]=[p]; } }
  const alyNat = {};
  for (const aly of Object.keys(alliancesLocal)) alyNat[aly] = alliancesLocal[aly].reduce((s,p)=>s+(working_nat[p]||0),0);
  const q = new Set();
  for (const aly of Object.keys(alyNat)) if (alyNat[aly] >= threshold) alliancesLocal[aly].forEach(p=>q.add(p));
  return q;
}

function _alloc_divisor(votes, s, method){
  let divs = [];
  if (method === "Sainte-Laguë" || method === "Modifiye Sainte-Laguë"){
    for (let i=1;i<=s;i++) divs.push(2*i-1);
    if (method === "Modifiye Sainte-Laguë") divs[0]=1.4;
  } else if (method === "Huntington-Hill (Eşit Orantılar)"){
    for (let i=1;i<=s;i++) divs.push(Math.sqrt(i*(i-1)));
    divs[0]=0.0001;
  } else {
    for (let i=1;i<=s;i++) divs.push(i);
  }
  const quot=[];
  for (let pi=0; pi<votes.length; pi++){
    for (let di=0; di<s; di++){
      const v = votes[pi]/divs[di];
      if (v>0) quot.push([v,pi]);
    }
  }
  quot.sort((a,b)=>b[0]-a[0]);
  const out = new Array(votes.length).fill(0);
  for (let k=0;k<s && k<quot.length;k++) out[quot[k][1]]++;
  return out;
}

function _alloc_quota(votes, s, method){
  const total = votes.reduce((a,b)=>a+b,0);
  const quota = method === "Droop Kotası" ? (total/(s+1)) : (total/s);
  let out = new Array(votes.length).fill(0);
  let used = 0;
  for (let i=0;i<votes.length;i++){ out[i]=Math.floor(votes[i]/quota); used+=out[i]; }
  let rem = s-used;
  if (rem>0){
    const idx = votes.map((v,i)=>[v/quota - out[i], i]).sort((a,b)=>b[0]-a[0]);
    for (let k=0;k<rem;k++) out[idx[k%idx.length][1]]++;
  }
  return out;
}

// Orchestrates district projection + allocation. Returns rows {d, p, new_vote_pct, seats_won, province, seat_count}
// baseObj: {base: {d|p: pct}, seats: {d: count}} — district set is derived from baseObj.base keys
function run_simulation(baseObj, base_nat, user_nat, alliances, joint_lists, threshold, allocation_method, regional_boosts, all_parties, baseDistricts){
  const clamp = _clamp(), sig = _sig();
  const partiesAll = all_parties || _allParties(null);
  const working_nat = {...user_nat};
  for (const umbrella of Object.keys(joint_lists)){
    for (const jp of joint_lists[umbrella]) { working_nat[umbrella] += working_nat[jp]||0; working_nat[jp]=0.0; }
  }
  const qualified = _get_qualified_parties(working_nat, alliances, threshold, partiesAll);

  const { base, seats } = baseObj;
  // district set from base keys (d|p prefix) — deterministic order
  let districtNorms = baseDistricts || null;
  if (!districtNorms){
    const set = {};
    for (const key of Object.keys(base)) set[key.split('|')[0]] = 1;
    districtNorms = Object.keys(set).sort();
  }

  const Pc = {};
  for (const p of partiesAll) Pc[p] = user_nat[p] || 0.0;

  const df = [];
  for (const d of districtNorms){
    for (const p of partiesAll){
      const R = base[d+'|'+p] || 0.0;
      const Bc = base_nat[p] || 0.0;
      let pc = user_nat[p] || 0.0;
      if (regional_boosts){
        const province = String(d).replace(/[0-9]+$/,'');
        const bo = regional_boosts[p];
        if (bo && bo.multiplier > 1.0){
          // matada with Python: province_clean is the display split; provs are lowercased norm ids;
          // the comparison never matches for Turkish names -> boosts are no-ops, matching the app.
          const provDisplay = _getDisplayName(province);
          if (bo.provinces.includes(provDisplay)) pc = Math.min(99.9, Math.max(0.001, pc * bo.multiplier));
        }
      }
      df.push({d, p, R, Pc:pc, Bc});
    }
  }

  for (const row of df){
    const Rc = clamp(row.R, 0.001, 99.999);
    const Pcc = clamp(row.Pc, 0.001, 99.999);
    const Bcc = clamp(row.Bc, 0.005, 99.999);
    const logitDiff = clamp(Math.log(Pcc/(100-Pcc)) - Math.log(Bcc/(100-Bcc)), -5, 5);
    const P_prop = sig(Math.log(Rc/(100-Rc)) + logitDiff);
    const P_uni_safe = Math.max(row.R*0.05, row.R + (row.Pc - row.Bc));
    row.proj = row.Pc <= 0 ? 0 : Math.sqrt(Math.max(0.001,P_prop) * P_uni_safe);
  }

  const totByD = {};
  for (const row of df) totByD[row.d] = (totByD[row.d]||0) + row.proj;
  for (const row of df) row.norm = totByD[row.d] > 0 ? (row.proj/totByD[row.d])*100 : 0;

  const pivot = {};
  for (const d of districtNorms){
    const row = {};
    for (const p of partiesAll) row[p] = 0;
    pivot[d]=row;
  }
  for (const row of df) pivot[row.d][row.p] = row.norm;

  for (const umbrella of Object.keys(joint_lists)){
    for (const jp of joint_lists[umbrella]){
      for (const d of districtNorms){
        if (pivot[d][umbrella] !== undefined){
          pivot[d][umbrella] += pivot[d][jp];
          pivot[d][jp] = 0;
        }
      }
    }
  }

  for (const d of districtNorms){
    for (const p of partiesAll){
      if (!qualified.has(p)) pivot[d][p] = 0;
    }
  }

  const seats_won = {};
  for (const d of districtNorms){
    const v = partiesAll.map(p=>pivot[d][p]);
    const s = seats[d] || 0;
    let alloc;
    if (s<=0 || v.reduce((a,b)=>a+b,0)<=0) alloc = new Array(partiesAll.length).fill(0);
    else if (allocation_method === "Winner Takes All (Çoğunluk)"){
      alloc = new Array(partiesAll.length).fill(0);
      let bi=0,max=-1; for(let i=0;i<v.length;i++) if(v[i]>max){max=v[i];bi=i;}
      alloc[bi]=s;
    } else if (allocation_method === "Hare Kotası" || allocation_method === "Droop Kotası"){
      alloc = _alloc_quota(v,s,allocation_method);
    } else {
      alloc = _alloc_divisor(v,s,allocation_method);
    }
    seats_won[d] = {};
    for (let i=0;i<partiesAll.length;i++) seats_won[d][partiesAll[i]] = alloc[i];
  }

  const leftoverDists = [];
  for (const d of districtNorms){
    const s = seats[d]||0;
    const allocated = partiesAll.reduce((a,p)=>a+(seats_won[d][p]||0),0);
    if (s - allocated > 0) leftoverDists.push(d);
  }
  if (leftoverDists.length){
    const natVotes = partiesAll.map(p => ((p in qualified)?(working_nat[p]||0):0));
    let totalLeft=0;
    for (const d of leftoverDists) totalLeft += (seats[d]||0) - partiesAll.reduce((a,p)=>a+seats_won[d][p],0);
    if (natVotes.reduce((a,b)=>a+b,0)>0 && totalLeft>0){
      const di = new Array(partiesAll.length).fill(1);
      const extra = new Array(partiesAll.length).fill(0);
      for (let t=0;t<totalLeft;t++){
        let j=0,max=-Infinity;
        for(let i=0;i<partiesAll.length;i++){ const q=natVotes[i]/di[i]; if(q>max){max=q;j=i;} }
        extra[j]++; di[j]++;
      }
      let k=0;
      for (let j=0;j<partiesAll.length;j++){
        for (let c=0;c<extra[j];c++){
          seats_won[leftoverDists[k % leftoverDists.length]][partiesAll[j]]++;
          k++;
        }
      }
    }
  }

  const out=[];
  for (const d of districtNorms){
    for (const p of partiesAll){
      out.push({
        d,
        p,
        new_vote_pct: round(pivot[d][p],6),
        seats_won: seats_won[d][p]||0,
        province: String(d).replace(/[0-9]+$/,''),
        seat_count: seats[d]||0
      });
    }
  }
  return out;
}

// national base per party = sum(base_vote_pct * seat_count)/total_seats
function compute_base_national(baseObj){
  const { base, seats } = baseObj;
  const nat = {};
  let total = 0;
  for (const d in seats) total += seats[d] || 0;
  const seen = {};
  for (const key of Object.keys(base)){
    const [d, p] = key.split('|');
    const s = seats[d]||0;
    if (s>0) nat[p] = (nat[p]||0) + base[key]*s;
  }
  for (const p in nat) nat[p] = nat[p]/total;
  return nat;
}

function defaultJointLists(){
  return {"DEM":["TIP"]};
}
function defaultAlliances(){
  return {"Cumhur İttifakı":["AKP","MHP","BBP","HUDA"], "Emek ve Özgürlük İttifakı":["DEM","TIP"]};
}

function round(v,p){ const m=Math.pow(10,p); return Math.round(v*m)/m; }

if (typeof module !== 'undefined') module.exports = {run_simulation, _get_qualified_parties, _alloc_divisor, _alloc_quota, _weightedBase, applyCustomPartiesJS, compute_base_national, _allParties, defaultJointLists, defaultAlliances};