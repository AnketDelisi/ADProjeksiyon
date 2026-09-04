// YEREL model regression tests — run with: node scripts/test_yerel.js
// Loads config.js + engine.js into the global scope, then exercises the pure
// yerel_model.js functions the same way app.js's runLocal() does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

function loadGlobal(file){
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), {filename: file});
}
loadGlobal('js/config.js');
loadGlobal('js/engine.js');
const {ymSynthNat, ymProjectProvince, YEREL_MATRIX_DEFAULTS} = require(path.join(ROOT, 'js', 'yerel_model.js'));

const YEREL_2024 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'yerel_2024_merkez.json'), 'utf8'));
const YEREL_CANDIDATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'yerel_candidates.json'), 'utf8'));
const BELEDIYE_MECLIS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'belediye_meclis.json'), 'utf8'));
const BUYUKSEHIR = {};
for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'buyuksehir.json'), 'utf8'))) BUYUKSEHIR[String(b).toLowerCase()] = 1;
const allPList = _allParties(null);

// replicate runLocal() assembly (defaults: yerelAlliances from defaultAlliances, blocs from CB_GROUPS)
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
    out[prov].base2024 = Object.assign({}, YEREL_2024.provinces[prov]);
  }
  return out;
}

const SCEN_2024 = {'AKP':35.5,'CHP':37.8,'MHP':5.0,'IYI':3.8,'DEM':5.7,'YRP':6.2,'ZAFER':1.7,'TIP':0.2,'YENI':0.0,'A':0.0,'HUDA':0.6,'DEVA':0.3,'BTP':0.2,'DP':0.2,'TKP':0.1,'BBP':0.4,'SAADET':1.1};
const SCEN_AD = {'AKP':28.5,'CHP':1.0,'MHP':7.3,'DEM':8.0,'IYI':5.1,'YRP':3.7,'ZAFER':2.5,'TIP':1.5,'YENI':34.4,'A':4.2,'BBP':1.0,'SAADET':1.2,'HUDA':0.6,'DP':0.2,'DEVA':0.3,'BTP':0.4,'TKP':0.1};
const COMPARE = ['AKP','CHP','DEM','MHP','IYI','YRP','ZAFER','SAADET','HUDA','BBP','TIP','DEVA','BTP','DP','TKP'];

let pass = 0, fail = 0;
function assert(name, cond, detail){
  if (cond){ pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail!==undefined?'  [' + detail + ']':'')); }
}
function round1(x){ return Math.round(x*10)/10; }

// ---- 1. Backtest (2024 scenario, defaults) ----
{
  const out = projectAll(SCEN_2024);
  let match = 0, maeSum = 0, maeN = 0;
  const actualMayoral = YEREL_CANDIDATES.provinces;
  for (const prov of Object.keys(out)){
    const actual = actualMayoral[prov].mayoral2024;
    const projMapped = out[prov].winner==='YENI'?'CHP':out[prov].winner;
    const actualTop = Object.entries(actual).sort((a,b)=>b[1]-a[1])[0];
    if (projMapped===actualTop[0]) match++;
    for (const p of COMPARE){
      if (actual[p]===undefined) continue;
      const pr = (out[prov].shares[p]||0)+(p==='CHP'?(out[prov].shares['YENI']||0):0);
      maeSum += Math.abs(pr-actual[p]); maeN++;
    }
  }
  const winAcc = match/81*100;
  const mae = maeSum/maeN;
  assert('backtest winners >= 92%', winAcc >= 92, winAcc.toFixed(1)+'%');
  assert('backtest MAE < 2.0pp', mae < 2.0, mae.toFixed(2));
  console.log('     (winners '+winAcc.toFixed(1)+'%, MAE '+mae.toFixed(2)+')');
}

// ---- 2. No NaN / shares sum to 100 ----
{
  const out = projectAll(SCEN_AD);
  let nan = 0, sumBad = 0;
  for (const prov of Object.keys(out)){
    const s = out[prov].shares;
    const sum = Object.values(s).reduce((a,b)=>a+b,0);
    if (Math.abs(sum-100) > 0.5) sumBad++;
    for (const v of Object.values(s)) if (!isFinite(v) || v < -0.001) nan++;
  }
  assert('no NaN/negative, sums ~100 (Anket Delisi)', nan===0 && sumBad===0, nan+'/'+sumBad);
}

// ---- 3. A+C fix: CHP at 1% collapses (was ~10-21%) ----
{
  const out = projectAll(SCEN_AD);
  const chpIstanbul = out['istanbul'].shares['CHP']||0;
  const chpAnkara = out['ankara'].shares['CHP']||0;
  const chpMersin = out['mersin'].shares['CHP']||0;
  assert('istanbul CHP < 2% at un CHP=1', chpIstanbul < 2.0, chpIstanbul.toFixed(1));
  assert('ankara CHP < 2% at un CHP=1', chpAnkara < 2.0, chpAnkara.toFixed(1));
  // mersin keeps its incumbent's personal vote (Seçer, +11.7) — by design
  assert('mersin CHP keeps incumbent personal vote', chpMersin > 8, chpMersin.toFixed(1));
}

// ---- 4. Büyükşehir alliance rule: only largest component races ----
{
  const out = projectAll(SCEN_AD);
  const mhpIstanbul = out['istanbul'].shares['MHP']||0;
  const mhpAmasya = out['amasya'].shares['MHP']||0;
  assert('istanbul (big) MHP dropped to 0', mhpIstanbul < 0.01, mhpIstanbul.toFixed(2));
  assert('amasya (non-big) MHP still runs', mhpAmasya > 1, mhpAmasya.toFixed(1));
  // bugfix: dropped alliance members must not remain majors
  const istMajors = out['istanbul'].majors;
  const ankMajors = out['ankara'].majors;
  assert('istanbul majors exclude dropped MHP', istMajors.indexOf('MHP')<0, istMajors.join(','));
  assert('ankara majors exclude dropped MHP', ankMajors.indexOf('MHP')<0, ankMajors.join(','));
  assert('istanbul majors include the alliance leader AKP', istMajors.indexOf('AKP')>=0, istMajors.join(','));
}

// ---- 5. Defection preset: İmamoğlu personal vote moves CHP->YENI ----
{
  const out = projectAll(SCEN_AD);
  const yen = out['istanbul'].shares['YENI']||0;
  const chp = out['istanbul'].shares['CHP']||0;
  assert('istanbul YENI dominant (defection world)', yen > 30, yen.toFixed(1));
  assert('istanbul CHP residual small', chp < 2, chp.toFixed(1));
}

// ---- 6. Candidate status: withdrawing the incumbent removes their personal vote ----
{
  const outRun = projectAll(SCEN_AD);
  const outWithdrew = projectAll(SCEN_AD, {candStatusAll: {mersin: {CHP: 'withdrew'}}});
  const chpRun = outRun['mersin'].shares['CHP']||0;
  const chpWd = outWithdrew['mersin'].shares['CHP']||0;
  assert('mersin CHP loses ~11.7pp personal when withdrawn', chpRun - chpWd > 8, (chpRun-chpWd).toFixed(1));
  // defected target override: mersin CHP -> YENI moves the personal vote
  const outDef = projectAll(SCEN_AD, {candStatusAll: {mersin: {CHP: 'defected:YENI'}}});
  const yenDef = outDef['mersin'].shares['YENI']||0;
  assert('mersin CHP->YENI gives YENI the personal vote', yenDef > 8, yenDef.toFixed(1));
}

// ---- 7. popBoost slider reaches incumbent ----
{
  const out = projectAll(SCEN_2024, {pb: 5});
  const ist = out['istanbul'];
  assert('popBoost+5 lands on winner CHP share', (ist.shares['CHP']||0) > 40, (ist.shares['CHP']||0).toFixed(1));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
