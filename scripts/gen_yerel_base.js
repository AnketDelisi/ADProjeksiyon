// YEREL base generator (mayoral reference) — outputs data/yerel_2024_merkez.json
// Usage: node scripts/gen_yerel_base.js [mayoWeight 0..1] [yskCsv] [mayorCsv]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ILCE_DIR = path.join(ROOT, 'data', 'ilce');
const OUT = path.join(ROOT, 'data', 'yerel_2024_merkez.json');
const YSK_CSV = process.argv[2] || 'C:/Users/deneme/Desktop/adp/ilce/veri/2024/ysk_2024_secim_verisi.csv';
const MAYOR_CSV = process.argv[3] || 'C:/Users/deneme/Desktop/2024mayor.csv';
const MAYO_WEIGHT = process.argv[4]!==undefined?parseFloat(process.argv[4]):1.0;

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

const provinces = {};
const mode = {};
const missing = [];
for (const f of fs.readdirSync(ILCE_DIR).filter(x=>x.endsWith('.json'))){
  const prov = f.replace('.json','');
  const data = JSON.parse(fs.readFileSync(path.join(ILCE_DIR,f),'utf8'));
  const isBig = !!BIGSET[prov];
  let council;
  if (isBig){
    council = Object.assign({}, ysk[prov]||{});
    for (const p of CANON) if (council[p]===undefined) council[p]=0;
  } else {
    const m = data['merkez'];
    if (!m){ missing.push(prov); continue; }
    council = {};
    for (const [p,v] of Object.entries(m.parties||{})){ const c=normKey(p); if(c) council[c]=(parseFloat(v.v24)||0); }
    for (const p of CANON) if (council[p]===undefined) council[p]=0;
  }
  const may = Object.assign({}, mayor[prov]||{});
  for (const p of CANON) if (may[p]===undefined) may[p]=0;
  const blend = {};
  for (const p of CANON) blend[p] = MAYO_WEIGHT*(may[p]||0) + (1-MAYO_WEIGHT)*(council[p]||0);
  const tot = Object.values(blend).reduce((a,b)=>a+b,0);
  const norm = {};
  for (const p of CANON) norm[p] = tot>0 ? Math.round(blend[p]/tot*10000)/100 : 0;
  provinces[prov] = norm;
  mode[prov] = isBig ? 'big' : 'merkez';
}

const winners = {};
for (const prov of Object.keys(provinces)){
  winners[prov] = Object.entries(provinces[prov]).sort((a,b)=>b[1]-a[1])[0][0];
}
const natAgg = {};
let np = 0;
for (const prov of Object.keys(provinces)){ np++; for (const p of Object.keys(provinces[prov])) natAgg[p]=(natAgg[p]||0)+provinces[prov][p]; }
for (const p of Object.keys(natAgg)) natAgg[p]=Math.round(natAgg[p]/np*100)/100;
const nat24 = {'AKP':35.5,'CHP':37.8,'MHP':5.0,'IYI':3.8,'DEM':5.7,'YRP':6.2,'ZAFER':1.7,'TIP':0.2,'YENI':0,'A':0,'HUDA':0.6,'DEVA':0.3,'BTP':0.2,'DP':0.2,'TKP':0.1,'BBP':0.4,'SAADET':1.1};
const nat23 = {'AKP':35.6,'CHP':25.3,'MHP':10.1,'IYI':9.7,'DEM':8.8,'YRP':2.8,'ZAFER':2.2,'TIP':1.8,'BBP':1.0,'SAADET':0.0,'YENI':0,'A':0,'HUDA':0.0,'TKP':0.1,'DP':0,'DEVA':0,'BTP':0};
const mayorWinners = {};
for (const prov of Object.keys(provinces)){
  const v = mayor[prov];
  if (v){ const best = Object.entries(v).sort((a,b)=>b[1]-a[1])[0]; mayorWinners[prov]=best[0]; }
}
const finalWinners = {};
for (const prov of Object.keys(provinces)) finalWinners[prov] = mayorWinners[prov] || winners[prov];
const out = {provinces, winners: finalWinners, natAgg, nat24, nat23, nat: nat24, mode};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, '| provinces:', Object.keys(provinces).length, '| missing:', missing.join(',')||'none', '| mayo weight:', MAYO_WEIGHT);
