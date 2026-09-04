// Sweep büyükşehir major-threshold + minor-flow params. Run: node scripts/sweep_buyuksehir.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
function loadGlobal(file){ vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), {filename: file}); }
loadGlobal('js/config.js');
loadGlobal('js/engine.js');
const {ymSynthNat, ymProjectProvince, YEREL_MATRIX_DEFAULTS} = require(path.join(ROOT, 'js', 'yerel_model.js'));
const YEREL_2024 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'yerel_2024_merkez.json'), 'utf8'));
const YEREL_CANDIDATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'yerel_candidates.json'), 'utf8'));
const BELEDIYE_MECLIS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'belediye_meclis.json'), 'utf8'));
const BUYUKSEHIR = {};
for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'buyuksehir.json'), 'utf8'))) BUYUKSEHIR[String(b).toLowerCase()] = 1;
const allPList = _allParties(null);
const allysObj = defaultAlliances();
const blocs = {};
for (const b of CB_GROUP_LIST){ for (const p of (CB_GROUPS[b]||[b])) blocs[p]=b; }

function projectAll(un, opts){
  opts = opts || {};
  const w24 = opts.w24!==undefined ? opts.w24 : 0.30;
  const flowRate = opts.flowRate!==undefined ? opts.flowRate : 0.05;
  const bigFlowRate = opts.bigFlowRate!==undefined ? opts.bigFlowRate : null;
  const bigMajorThresh = opts.bigMajorThresh!==undefined ? opts.bigMajorThresh : 0;
  const matrix = opts.matrix || YEREL_MATRIX_DEFAULTS;
  const pb = opts.pb || 0;
  const nerf = {};
  const synthNat = ymSynthNat(YEREL_2024.nat, un);
  const overAll = opts.overAll || {};
  const popAll = opts.popAll || {};
  const majorsAll = opts.majorsAll || {};
  const candStatusAll = opts.candStatusAll || {};
  const candPersonalAll = opts.candPersonalAll || {};
  const defections = YEREL_CANDIDATES.defections || [];
  const out = {};
  for (const prov of Object.keys(YEREL_2024.provinces)){
    const candProv = YEREL_CANDIDATES.provinces[prov];
    const defMap = {};
    for (const d of defections) if (d[0]===prov) defMap[d[1]]=d[2];
    out[prov] = ymProjectProvince({
      prov,
      structural: (candProv&&candProv.structural)||YEREL_2024.provinces[prov],
      synthNat, un, w24, flowRate, matrix, blocs, allysObj,
      over: overAll[prov]||{}, pop: popAll[prov]||{}, manualMajors: majorsAll[prov]||null,
      candProv, candStatus: candStatusAll[prov]||{}, candPersonal: candPersonalAll[prov]||{},
      defMap, allPList, winner: YEREL_2024.winners[prov]||'', pb,
      isBig: BUYUKSEHIR[prov]?1:0,
      councilTotal: BELEDIYE_MECLIS[prov]||0,
      nerf, bigFlowRate, bigMajorThresh
    });
  }
  return out;
}

const SCEN_2024 = {'AKP':35.5,'CHP':37.8,'MHP':5.0,'IYI':3.8,'DEM':5.7,'YRP':6.2,'ZAFER':1.7,'TIP':0.2,'YENI':0.0,'A':0.0,'HUDA':0.6,'DEVA':0.3,'BTP':0.2,'DP':0.2,'TKP':0.1,'BBP':0.4,'SAADET':1.1};
const SCEN_AD = {'AKP':28.5,'CHP':1.0,'MHP':7.3,'DEM':8.0,'IYI':5.1,'YRP':3.7,'ZAFER':2.5,'TIP':1.5,'YENI':34.4,'A':4.2,'BBP':1.0,'SAADET':1.2,'HUDA':0.6,'DP':0.2,'DEVA':0.3,'BTP':0.4,'TKP':0.1};
const COMPARE = ['AKP','CHP','DEM','MHP','IYI','YRP','ZAFER','SAADET','HUDA','BBP','TIP','DEVA','BTP','DP','TKP'];
const bigProvs = Object.keys(YEREL_2024.provinces).filter(p=>BUYUKSEHIR[p]);

function metrics(out, un){
  let match=0, maeSum=0, maeN=0;
  for (const prov of Object.keys(out)){
    const actual = YEREL_CANDIDATES.provinces[prov].mayoral2024;
    const projMapped = out[prov].winner==='YENI'?'CHP':out[prov].winner;
    const actualTop = Object.entries(actual).sort((a,b)=>b[1]-a[1])[0];
    if (projMapped===actualTop[0]) match++;
    for (const p of COMPARE){
      if (actual[p]===undefined) continue;
      const pr = (out[prov].shares[p]||0)+(p==='CHP'?(out[prov].shares['YENI']||0):0);
      maeSum += Math.abs(pr-actual[p]); maeN++;
    }
  }
  return {win: match/81*100, mae: maeSum/maeN};
}

console.log('Sweep: bigMajorThresh x bigFlowRate  (base flow=0.05, base thresh auto top-3)');
console.log('Columns after | : BACKTEST win% / MAE  |  AD-big avgMajors, <=3majors %, topranked-2 capture%');
console.log('thresh,flowrate | backtest     | AD-big plausibility');
for (const th of [0,3,4,5,6]){
  for (const bf of [null, 0.05, 0.10, 0.15, 0.20, 0.25]){
    const m24 = metrics(projectAll(SCEN_2024,{bigFlowRate:bf,bigMajorThresh:th}), SCEN_2024);
    const ad = projectAll(SCEN_AD,{bigFlowRate:bf,bigMajorThresh:th});
    let majSum=0, le3=0, top2Sum=0;
    for (const p of bigProvs){
      const r = ad[p];
      majSum += r.majors.length;
      if (r.majors.length<=3) le3++;
      const s = Object.values(r.shares).sort((a,b)=>b-a);
      top2Sum += s[0]+s[1];
    }
    const nb = bigProvs.length;
    // baseline backtest current = win 93.8
    const flag = (m24.win>=92 && m24.mae<=2.0) ? ' ' : '!';
    console.log(`${String(th).padStart(2)}  ,  ${String(bf).padEnd(4)}  | ${m24.win.toFixed(1).padStart(5)}% / ${m24.mae.toFixed(2)}  | avgMaj=${(majSum/nb).toFixed(2)}  <=3=${(le3/nb*100).toFixed(0)}%  top2=${(top2Sum/nb).toFixed(1)} ${flag}`);
  }
}
