// YEREL candidate layer generator — outputs data/yerel_candidates.json
// Inputs: data/ilce/*.json, data/buyuksehir.json, data/yerel_targets.json (in repo)
//         external CSVs: ysk_2024_secim_verisi.csv and 2024mayor.csv
// Usage: node scripts/gen_yerel_candidates.js [yskCsv] [mayorCsv]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ILCE_DIR = path.join(ROOT, 'data', 'ilce');
const OUT = path.join(ROOT, 'data', 'yerel_candidates.json');
const YSK_CSV = process.argv[2] || 'C:/Users/deneme/Desktop/adp/ilce/veri/2024/ysk_2024_secim_verisi.csv';
const MAYOR_CSV = process.argv[3] || 'C:/Users/deneme/Desktop/2024mayor.csv';

const BIG = JSON.parse(fs.readFileSync(path.join(ROOT,'data','buyuksehir.json'),'utf8')).map(s=>String(s).toLowerCase());
const BIGSET = {}; for (const b of BIG) BIGSET[b]=1;
const CANON = ['AKP','BBP','BTP','CHP','DEVA','DEM','DP','HUDA','IYI','MHP','SAADET','TIP','TKP','YENI','YRP','ZAFER','A'];
const normKey = (k)=> CANON.find(c=>c.toLowerCase()===String(k).toLowerCase()) || null;
const FOLD = {'İ':'i','I':'i','ı':'i','i':'i','ğ':'g','Ğ':'g','ü':'u','Ü':'u','ş':'s','Ş':'s','ö':'o','Ö':'o','ç':'c','Ç':'c'};
const fold = (s) => s.split('').map(c => FOLD[c] !== undefined ? FOLD[c] : c.toLowerCase()).join('');

function readCsv(file){
  const lines = fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim()!=='');
  const out = {};
  for (const l of lines.slice(1)){
    const parts = l.split(',');
    if (parts.length < 4) continue;
    const key = fold(parts[0].replace(/-\d+$/,'').trim());
    if (!out[key]) out[key] = {};
    if (out[key][parts[2]] === undefined) out[key][parts[2]] = parseFloat(parts[3]);
  }
  return out;
}
const ysk = readCsv(YSK_CSV);
const mayor = readCsv(MAYOR_CSV);
const round2=(x)=>Math.round(x*100)/100;
const normalize=(obj)=>{
  const tot=Object.values(obj).reduce((a,b)=>a+b,0);
  const out={};
  for (const k of Object.keys(obj)) out[k]=tot>0?round2(obj[k]/tot*100):0;
  return out;
};
const STATUS_OVERRIDES = {'izmir': {'CHP': 'withdrew'}, 'kilis': {'CHP': 'withdrew'}, 'sanliurfa': {'YRP': 'withdrew'}};

const provinces = {};
const missing = [];
for (const f of fs.readdirSync(ILCE_DIR).filter(x=>x.endsWith('.json'))){
  const prov = f.replace('.json','');
  const data = JSON.parse(fs.readFileSync(path.join(ILCE_DIR,f),'utf8'));
  const isBig = !!BIGSET[prov];
  let structural = {};
  if (isBig){
    structural = Object.assign({}, ysk[prov]||{});
  } else {
    const m = data['merkez'];
    if (!m){ missing.push(prov); continue; }
    for (const [p,v] of Object.entries(m.parties||{})){ const c=normKey(p); if(c) structural[c]=(parseFloat(v.v24)||0); }
  }
  for (const p of CANON) if (structural[p]===undefined) structural[p]=0;
  structural = normalize(structural);
  const may = Object.assign({}, mayor[prov]||{});
  for (const p of CANON) if (may[p]===undefined) may[p]=0;
  const mayNorm = normalize(may);
  const winner = Object.entries(mayNorm).sort((a,b)=>b[1]-a[1])[0][0];
  const candidates = Object.entries(mayNorm)
    .filter(([,v])=>v>0.05)
    .map(([p,v])=>({party:p, personal:round2(v-(structural[p]||0)), status:(STATUS_OVERRIDES[prov]&&STATUS_OVERRIDES[prov][p])||(p===winner?'running':'withdrew'), incumbent:p===winner?1:0}))
    .sort((a,b)=>b.personal-a.personal);
  provinces[prov] = {structural, mayoral2024: mayNorm, winner, candidates};
}
let defections = [];
try { defections = JSON.parse(fs.readFileSync(path.join(ROOT,'data','yerel_targets.json'),'utf8')).defections||[]; } catch(e){}
const out = {provinces, winners: Object.fromEntries(Object.entries(provinces).map(([p,v])=>[p,v.winner])), defections};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, '| provinces:', Object.keys(provinces).length, '| missing:', missing.join(',')||'none', '| defections:', defections.length);
