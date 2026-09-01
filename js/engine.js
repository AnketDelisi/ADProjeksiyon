// ===== Core simulation engine (port of app.py run_simulation) =====

// config.js provides these as browser globals (shared lexical scope, bare names);
// in Node they live in module.exports. Resolve lazily.
function _cfg(){ return (typeof module !== 'undefined' && require) ? require('./config.js') : null; }
function _B(){ const c=_cfg(); return c ? c.BASE_PARTIES : BASE_PARTIES; }
function _clamp(){ const c=_cfg(); return c ? c.clamp : clamp; }
function _sig(){ const c=_cfg(); return c ? c.sig : sig; }
function getDISTRICTS(){ return (typeof module!=='undefined') ? globalThis.DISTRICTS : window.DISTRICTS; }
function getBASEDATA(){ return (typeof module!=='undefined') ? globalThis.BASE_DATA : window.BASE_DATA; }
function _getDisplayName(x){ const c=_cfg(); return c ? c.get_display_name(x) : get_display_name(x); }

function _weightedBase(w18, w23, w24){
  // NOTE: The transition-weighted base (apply_custom_parties with DEFAULT_TRANSITIONS,
  // default weights 10/80/10) is already baked into base.json by the converter.
  // This returns the baked base directly (weights params accepted for signature parity).
  const DISTRICTS = getDISTRICTS();
  const seatByNorm = {};
  for (const d of DISTRICTS) seatByNorm[d.norm] = d.seats;
  const map = {};
  for (const r of getBASEDATA()){
    if (r.base_vote_pct !== 0) map[r.d+'|'+r.p] = r.base_vote_pct;
  }
  return { base: map, seats: seatByNorm };
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
  // votes: array, s: seats; returns count per party (same length as votes)
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
  // collect all quotients
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
  // remaining seats by largest remainder
  let rem = s-used;
  if (rem>0){
    const idx = votes.map((v,i)=>[v/quota - out[i], i]).sort((a,b)=>b[0]-a[0]);
    for (let k=0;k<rem;k++) out[idx[k%idx.length][1]]++;
  }
  return out;
}

// Orchestrates district projection + allocation. Returns list of {d, p, new_vote_pct, seats_won, province, seat_count}
function run_simulation(baseObj, base_nat, user_nat, alliances, joint_lists, threshold, allocation_method, regional_boosts){
  const clamp = _clamp(), sig = _sig();
  const all_parties = _B();
  const working_nat = {...user_nat};
  for (const umbrella of Object.keys(joint_lists)){
    for (const jp of joint_lists[umbrella]) { working_nat[umbrella] += working_nat[jp]||0; working_nat[jp]=0.0; }
  }
  const qualified = _get_qualified_parties(working_nat, alliances, threshold, all_parties);

  const { base, seats } = baseObj;
  const DISTRICTS = getDISTRICTS();
  // Build per (d,p): R, P_c, B_c
  const districtNorms = DISTRICTS.map(d=>d.norm);
  const partiesAll = all_parties;

  // P_c per party (with regional boosts)
  const Pc = {};
  for (const p of partiesAll) Pc[p] = user_nat[p] || 0.0;

  const df = []; // {d,p,R,Pc,Bc}
  for (const d of districtNorms){
    for (const p of partiesAll){
      const R = base[d+'|'+p] || 0.0;
      const Bc = base_nat[p] || 0.0;
      let pc = user_nat[p] || 0.0;
      if (regional_boosts){
        const province = String(d).replace(/[0-9]+$/,'');
        const bo = regional_boosts[p];
        if (bo && bo.multiplier > 1.0){
          // Replicate Python: compare display province name (get_display_name) against
          // the normalized provs list.  Python's province_clean is the Turkish display
          // name (e.g. "Şırnak") while provs are lowercase ASCII ("sirnak"), so the
          // comparison never matches — boosts are no-ops, matching the Python app.
          const provDisplay = _getDisplayName(province);
          if (bo.provinces.includes(provDisplay)) pc = Math.min(1, pc * bo.multiplier);
        }
      }
      df.push({d, p, R, Pc:pc, Bc});
    }
  }

  // projection per row
  for (const row of df){
    const Rc = clamp(row.R, 0.001, 99.999);
    const Pcc = clamp(row.Pc, 0.001, 99.999);
    const Bcc = clamp(row.Bc, 0.005, 99.999);
    const logitDiff = clamp(Math.log(Pcc/(100-Pcc)) - Math.log(Bcc/(100-Bcc)), -5, 5);
    const P_prop = sig(Math.log(Rc/(100-Rc)) + logitDiff);
    const P_uni_safe = Math.max(row.R*0.05, row.R + (row.Pc - row.Bc));
    row.proj = row.Pc <= 0 ? 0 : Math.sqrt(Math.max(0.001,P_prop) * P_uni_safe);
  }

  // normalize per district
  const totByD = {};
  for (const row of df) totByD[row.d] = (totByD[row.d]||0) + row.proj;
  for (const row of df) row.norm = totByD[row.d] > 0 ? (row.proj/totByD[row.d])*100 : 0;

  // pivot votes per district
  const pivot = {};
  for (const d of districtNorms){
    const row = {};
    for (const p of partiesAll) row[p] = 0;
    pivot[d]=row;
  }
  for (const row of df) pivot[row.d][row.p] = row.norm;

  // sum joint lists into umbrella
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

  // eligibility
  for (const d of districtNorms){
    for (const p of partiesAll){
      if (!qualified.has(p)) pivot[d][p] = 0;
    }
  }

  // allocate per district
  const seats_won = {}; // d -> {p: count}
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

  // leftover re-allocation nationally
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

  // build output rows
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

function compute_base_national(baseObj){
  // national base per party = sum(base_vote_pct * seat_count)/total_seats
  const { base, seats } = baseObj;
  const DISTRICTS = getDISTRICTS();
  const nat = {};
  const seenDistricts = new Set();
  let total = 0;
  for (const d of DISTRICTS){ if (!seenDistricts.has(d.norm)){ seenDistricts.add(d.norm); total += d.seats; } }
  for (const r of getBASEDATA()){
    const d = r.d, p = r.p;
    const s = seats[d]||0;
    const bv = base[d+'|'+p]||0;
    nat[p] = (nat[p]||0) + bv*s;
  }
  for (const p in nat) nat[p] = nat[p]/total;
  return nat;
}

// Joint-list default: Emek ve Özgürlük (DEM+TIP) — but keep only if user has them
function defaultJointLists(){
  return {"DEM":["TIP"]};
}
function defaultAlliances(){
  return {"Cumhur İttifakı":["AKP","MHP","BBP","HUDA"], "Emek ve Özgürlük İttifakı":["DEM","TIP"]};
}

function round(v,p){ const m=Math.pow(10,p); return Math.round(v*m)/m; }

if (typeof module !== 'undefined') module.exports = {run_simulation, _get_qualified_parties, _alloc_divisor, _alloc_quota, _weightedBase, compute_base_national, defaultJointLists, defaultAlliances};
