// ===== YEREL model — pure per-province projection (no DOM/state) =====
// Extracted from runLocal() in app.js for testability. All inputs are explicit.
// Browser: loaded before app.js. Node: module.exports used by scripts/test_yerel.js.

const YEREL_MATRIX_DEFAULTS = {
  'AKP':  {'AKP':1.0,'YENI':0.0,'DEM':0.0,'MHP':0.80,'BBP':0.85,'HUDA':0.80,'IYI':0.25,'ZAFER':0.30,'A':0.20,'BTP':0.20,'DP':0.25,'TIP':0.0,'TKP':0.0,'CHP':0.0,'SAADET':0.50,'YRP':0.45,'DEVA':0.35},
  'YENI': {'AKP':0.0,'YENI':1.0,'DEM':0.45,'MHP':0.0,'BBP':0.0,'HUDA':0.0,'IYI':0.35,'ZAFER':0.20,'A':0.40,'BTP':0.30,'DP':0.30,'TIP':0.70,'TKP':0.70,'CHP':0.70,'SAADET':0.10,'YRP':0.10,'DEVA':0.30},
  'DEM':  {'AKP':0.0,'YENI':0.35,'DEM':1.0,'MHP':0.0,'BBP':0.0,'HUDA':0.0,'IYI':0.15,'ZAFER':0.0,'A':0.15,'BTP':0.10,'DP':0.10,'TIP':0.50,'TKP':0.50,'CHP':0.55,'SAADET':0.0,'YRP':0.0,'DEVA':0.10},
  'Cumhur': {'AKP':0.85,'YENI':0.0,'DEM':0.0,'MHP':1.0,'BBP':0.90,'HUDA':0.90,'IYI':0.20,'ZAFER':0.30,'A':0.10,'BTP':0.15,'DP':0.20,'TIP':0.0,'TKP':0.0,'CHP':0.0,'SAADET':0.35,'YRP':0.45,'DEVA':0.25},
  'Milliyetçi Muh.': {'AKP':0.30,'YENI':0.25,'DEM':0.10,'MHP':0.35,'BBP':0.20,'HUDA':0.15,'IYI':1.0,'ZAFER':0.90,'A':0.85,'BTP':0.70,'DP':0.75,'TIP':0.05,'TKP':0.05,'CHP':0.10,'SAADET':0.10,'YRP':0.15,'DEVA':0.30},
  'Sol Muh.': {'AKP':0.0,'YENI':0.65,'DEM':0.55,'MHP':0.0,'BBP':0.0,'HUDA':0.0,'IYI':0.10,'ZAFER':0.0,'A':0.20,'BTP':0.15,'DP':0.10,'TIP':1.0,'TKP':1.0,'CHP':1.0,'SAADET':0.0,'YRP':0.0,'DEVA':0.15},
  'Muhafazakar Muh.': {'AKP':0.60,'YENI':0.10,'DEM':0.0,'MHP':0.55,'BBP':0.50,'HUDA':0.45,'IYI':0.10,'ZAFER':0.15,'A':0.10,'BTP':0.20,'DP':0.20,'TIP':0.0,'TKP':0.0,'CHP':0.0,'SAADET':1.0,'YRP':1.0,'DEVA':0.85}
};

function ymSynthNat(nat, un){
  const n=Object.assign({}, nat||{});
  const mk=(p)=>{ if (!(un[p]||0)>0) return; const row=DEFAULT_TRANSITIONS[p]||{}; let g=0; for (const s of Object.keys(row)){ if (s===p) continue; g+=(n[s]||0)*row[s]/100; } n[p]=(n[p]||0)+g; };
  mk('YENI'); mk('A');
  const t=Object.values(n).reduce((a,b)=>a+b,0);
  for (const k of Object.keys(n)) n[k]=t>0?n[k]/t*100:0;
  return n;
}

function ymProjectProvince(o){
  const {prov, structural, synthNat, un, w24, flowRate, matrix, blocs, allysObj, over, pop, manualMajors, candProv, candStatus, candPersonal, defMap, allPList, winner, pb, isBig, councilTotal, nerf} = o;
  // synthesized per-province base: structural + breakoff parties added on top (no deduction)
  const base=Object.assign({}, structural);
  const mkB=(p)=>{ if (!((un[p]||0)>0)) return; const row=DEFAULT_TRANSITIONS[p]||{}; let g=0; for (const s of Object.keys(row)){ if (s===p) continue; g+=(base[s]||0)*row[s]/100; } base[p]=(base[p]||0)+g; };
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
    if (Pcc<Bcc){
      // collapsing party: same geometric-mean scale as grow branch, anchored to R*(Pc/Bc)
      const ratio=Math.max(0.01, Pc/Math.max(0.01,Bc));
      const Puni=Math.max(R*0.05, R*ratio);
      swinged[p]=Math.sqrt(Math.max(0.001,Pprop)*Math.max(0.001,Puni));
    } else {
      const Puni=Math.max(R*0.05, R+(Pc-Bc));
      swinged[p]=Math.sqrt(Math.max(0.001,Pprop)*Math.max(0.001,Puni));
    }
  }
  const tS=Object.values(swinged).reduce((a,b)=>a+b,0);
  for (const p of keys) swinged[p]=tS>0?swinged[p]/tS*100:0;
  // blend with structural base; base weight scaled per party by national presence (Pc/Bc)
  const final0={};
  for (const p of keys){
    const Bc=synthNat[p]||0;
    const presence=Bc>0?clamp((un[p]||0)/Bc,0,1):1;
    const wEff=w24*presence;
    final0[p]=wEff*(base[p]||0)+(1-wEff)*(swinged[p]||0);
  }
  const tF=Object.values(final0).reduce((a,b)=>a+b,0);
  for (const p of keys) final0[p]=tF>0?final0[p]/tF*100:0;
  // candidate layer: personal vote (aday etkisi)
  if (candProv&&candProv.candidates&&candProv.candidates.length){
    const add={};
    for (const c of candProv.candidates){
      const preset=defMap[c.party]?('defected:'+defMap[c.party]):null;
      let st=candStatus[c.party]||preset||c.status||'running';
      if (st==='withdrew') continue;
      let target=c.party;
      if (st.indexOf('defected:')===0) target=st.slice(9);
      if (!allPList.includes(target)) continue;
      const pers=parseFloat(candPersonal[c.party]!==undefined?candPersonal[c.party]:c.personal)||0;
      if (Math.abs(pers)<0.01) continue;
      add[target]=(add[target]||0)+pers;
    }
    if (Object.keys(add).length){
      for (const p of Object.keys(add)){ if (final0[p]===undefined){ final0[p]=0; keys.push(p); } final0[p]+=add[p]; }
      const tA=Object.values(final0).reduce((a,b)=>a+b,0);
      for (const p of keys) final0[p]=tA>0?final0[p]/tA*100:0;
    }
  }
  // per-province popularity multiplier
  let anyPop=false;
  for (const p of Object.keys(pop)){
    const m=parseFloat(pop[p]);
    if (m>0 && m!==1 && final0[p]!==undefined){ final0[p]*=m; anyPop=true; }
  }
  if (anyPop){
    const tP=Object.values(final0).reduce((a,b)=>a+b,0);
    for (const p of keys) final0[p]=tP>0?final0[p]/tP*100:0;
  }
  // majors: manual override or auto (top 3 + >10pp, max 4), ÇEKİL skipped
  const ranked=Object.entries(final0).sort((a,b)=>b[1]-a[1]);
  let majors=[];
  if (manualMajors&&manualMajors.length){
    majors=manualMajors.filter(p=>over[p]!=='drop'&&(final0[p]||0)>0);
    for (const [p,v] of ranked){ if (v>0&&over[p]!=='drop'&&majors.length<2&&majors.indexOf(p)<0) majors.push(p); }
  }else{
    for (const [p,v] of ranked){ if (over[p]!=='drop' && majors.length<3) majors.push(p); }
    for (const [p,v] of ranked.slice(3)){ if (v>10 && majors.length<4 && over[p]!=='drop' && majors.indexOf(p)<0) majors.push(p); }
    if (majors.length<2){ for (const [p,v] of ranked) if (majors.indexOf(p)<0&&over[p]!=='drop'&&v>0&&majors.length<2) majors.push(p); }
  }
  // alliance dropout
  const allyMap={};
  for (const aly of Object.keys(allysObj)){
    for (const p of allysObj[aly]){ allyMap[p]=aly; }
  }
  const running=new Set(majors);
  for (const p of keys){ if (over[p]==='stay') running.add(p); }
  const dropSet=new Set();
  // BÜYÜKŞEHİR kuralı: her ittifakta yalnız en büyük bileşen yarışır
  if (isBig){
    for (const aly of Object.keys(allysObj)){
      const members=allysObj[aly].filter(p=>keys.indexOf(p)>=0);
      if (members.length<2) continue;
      const best=members.slice().sort((a,b)=>(final0[b]||0)-(final0[a]||0)).find(p=>over[p]!=='drop')||members[0];
      running.add(best);
      for (const p of members){
        if (over[p]==='drop'){ dropSet.add(p); continue; }
        if (over[p]==='stay'||p===best) continue;
        dropSet.add(p);
      }
    }
  }
  for (const p of keys){
    if (over[p]==='drop'){ dropSet.add(p); continue; }
    if (over[p]==='stay' || majors.indexOf(p)>=0) continue;
    if (dropSet.has(p)) continue;
    const aly=allyMap[p];
    if (!aly) continue;
    if (allysObj[aly].some(x=>x!==p && running.has(x))) dropSet.add(p);
  }
  // çekilen partiler ana aday olamaz (ör. büyükşehir ittifak kuralı)
  majors = majors.filter(p => !dropSet.has(p));
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
  // party strength adjustments (nerf)
  let anyN=false;
  for (const p of Object.keys(final)){ const f=nerf[p]; if (f!==undefined && f!==1){ final[p]=(final[p]||0)*f; anyN=true; } }
  if (anyN){
    const tN=Object.values(final).reduce((a,b)=>a+b,0);
    for (const p of Object.keys(final)) final[p]=tN>0?final[p]/tN*100:0;
  }
  // popularity boost: 2024 kazananının yerel popülarite desteği (puan)
  if (pb>0){
    const inc=winner||'';
    if (inc && (final[inc]||0)>0){
      final[inc]+=pb;
      const tB=Object.values(final).reduce((a,b)=>a+b,0);
      for (const p of Object.keys(final)) final[p]=tB>0?final[p]/tB*100:0;
    }
  }
  // municipal council: her partiden 10 puan düş, D'Hondt
  const council={};
  if (councilTotal>0){
    const cP=Object.keys(final);
    const votes=cP.map(p=>Math.max(0,(final[p]||0)-10));
    const alloc=_alloc_divisor(votes, councilTotal, "D'Hondt (Varsayılan)");
    for (let i=0;i<cP.length;i++) if (alloc[i]>0) council[cP[i]]=alloc[i];
  }
  const sortedF=Object.entries(final).sort((a,b)=>b[1]-a[1]);
  return {prov, winner:sortedF[0][0], winnerPct:sortedF[0][1],
    margin:sortedF.length>1?sortedF[0][1]-sortedF[1][1]:sortedF[0][1],
    second:sortedF.length>1?sortedF[1][0]:'',
    shares:final, base, majors, flows, council, councilTotal, dropped, popApplied:Object.keys(pop).length?pop:null, majorsManual:!!(manualMajors&&manualMajors.length), big:isBig?1:0,
    incumbent:winner||''};
}

if (typeof module !== 'undefined') module.exports = {ymSynthNat, ymProjectProvince, YEREL_MATRIX_DEFAULTS};
