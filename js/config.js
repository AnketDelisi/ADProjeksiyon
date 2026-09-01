// ===== AD Projeksiyon — Static JS config & shared helpers =====
// Ported from adp_reflex app/app.py

const PARTY_COLORS = {
  'AKP':'#FDA000','CHP':'#d33943','MHP':'#137BBB','DEM':'#90268F',
  'IYI':'#63bbed','YRP':'#009840','TIP':'#FF1D25','ZAFER':'#474647',
  'BBP':'#824d5d','SAADET':'#ff2e84','YENI':'#A7050E','A':'#20379f','HUDA':'#7fb526',
  'DP':'#cd42b2','DEVA':'#1368a6','BTP':'#b52138','TKP':'#ff000e'
};

const DEFAULT_TRANSITIONS = {
  'AKP': {'AKP':95.0,'MHP':3.0,'YRP':2.0},
  'YENI': {'CHP':85.0,'IYI':10.0,'DEM':3.0,'MHP':3.0},
  'IYI': {'IYI':85.0,'CHP':10.0,'MHP':5.0},
  'DEM': {'DEM':95.0,'TIP':5.0},
  'MHP': {'MHP':95.0,'AKP':5.0},
  'YRP': {'YRP':90.0,'AKP':10.0},
  'A': {'AKP':50.0,'BBP':20.0,'MHP':20.0,'IYI':10.0},
  'ZAFER': {'ZAFER':85.0,'IYI':10.0,'CHP':5.0},
  'TIP': {'TIP':100.0,'CHP':10.0},
  'SAADET': {'SAADET':100.0,'YRP':20.0,'AKP':10.0},
  'BBP': {'BBP':90.0,'MHP':10.0},
  'CHP': {'CHP':60.0,'DEM':7.5,'MHP':1.5,'AKP':1.5},
  'HUDA': {'HUDA':100.0,'DEM':10.0,'AKP':2.5,'YRP':2.5},
  'DP': {'IYI':15.0,'CHP':10.0,'AKP':10.0},
  'DEVA': {'AKP':20.0,'DEM':5.0,'SAADET':10.0},
  'BTP': {'IYI':10.0,'CHP':7.0,'ZAFER':10.0},
  'TKP': {'TIP':60.0,'CHP':5.0,'IYI':5.0}
};

const BASE_PARTIES = Object.keys(DEFAULT_TRANSITIONS);
const OZEL_SIRA = ["AKP","YENI","DEM","MHP","IYI","YRP","A","ZAFER","TIP","SAADET","DEVA","DP","BBP","BTP","HUDA","TKP","CHP"];
const PARLIAMENT_ORDER = ["TKP","TIP","DEM","CHP","YENI","IYI","DP","SAADET","DEVA","BTP","ZAFER","A","AKP","MHP","BBP","YRP","HUDA"];

const PREDEFINED_SCENARIOS = {
  "2023 Genel Seçim Sonuçları": {'AKP':35.6,'CHP':25.3,'MHP':10.1,'IYI':9.7,'DEM':8.8,'YRP':2.8,'ZAFER':2.2,'TIP':1.8,'BBP':1.0,'SAADET':0.0,'YENI':0.0,'A':0.0,'HUDA':0.0,'TKP':0.1,'DP':0.0,'DEVA':0.0,'BTP':0.0},
  "2024 Yerel Seçim Sonuçları": {'AKP':32.4,'CHP':34.5,'MHP':6.6,'IYI':4.6,'DEM':5.8,'YRP':7.0,'ZAFER':2.4,'TIP':0.6,'YENI':0.0,'A':0.0,'HUDA':0.7,'DEVA':0.5,'BTP':0.4,'DP':0.3,'TKP':0.2},
  "Anket Delisi Projeksiyon": {'AKP':28.5,'CHP':1.0,'MHP':7.3,'DEM':8.0,'IYI':5.1,'YRP':3.7,'ZAFER':2.5,'TIP':1.5,'YENI':34.4,'A':4.2,'BBP':1.0,'SAADET':1.2,'HUDA':0.6,'DP':0.2,'DEVA':0.3,'BTP':0.4,'TKP':0.1}
};

const CB_GROUPS = {
  "AKP":["AKP"], "YENI":["YENI"], "DEM":["DEM"],
  "Cumhur":["MHP","BBP","HUDA"],
  "Milliyetçi Muh.":["IYI","ZAFER","A","BTP","DP"],
  "Sol Muh.":["TIP","TKP","CHP"],
  "Muhafazakar Muh.":["YRP","SAADET","DEVA"]
};
const CB_GROUP_LIST = Object.keys(CB_GROUPS);
const CB_NOMINATING_BONUS = 20.0;

const DEFAULT_CB_CANDS_1 = [
  {id:"c1", name:"Erdoğan", party:"AKP", votes:{AKP:90,"Cumhur":90,"Milliyetçi Muh.":5,"Muhafazakar Muh.":5}},
  {id:"c2", name:"İmamoğlu", party:"YENI", votes:{YENI:100,"Sol Muh.":65,DEM:25,"Milliyetçi Muh.":25,"Muhafazakar Muh.":5}},
  {id:"c3", name:"Bakırhan", party:"DEM", votes:{DEM:75,"Sol Muh.":5}},
  {id:"c4", name:"Ağıralioğlu", party:"A", votes:{"Milliyetçi Muh.":30,"Muhafazakar Muh.":20}},
  {id:"c5", name:"Erbakan", party:"YRP", votes:{"Muhafazakar Muh.":70}},
  {id:"c6", name:"Dervişoğlu", party:"IYI", votes:{"Milliyetçi Muh.":25}},
  {id:"c7", name:"Özdağ", party:"ZAFER", votes:{"Milliyetçi Muh.":15}},
  {id:"c8", name:"Kılıçdaroğlu", party:"CHP", votes:{"Sol Muh.":30}}
];

const REGIONAL_BOOSTS_DEFAULT = {
  'HUDA': {provinces:['sirnak','mardin','van','hakkari','bitlis','sanliurfa','batman','bingol','diyarbakir'], multiplier:3.0},
  'A': {provinces:['trabzon'], multiplier:2.0},
  'IYI': {provinces:['ordu'], multiplier:2.0}
};

const PROVINCE_NAMES = {
  'adana':'Adana','adiyaman':'Adıyaman','afyonkarahisar':'Afyonkarahisar','agri':'Ağrı','amasya':'Amasya',
  'ankara':'Ankara','antalya':'Antalya','artvin':'Artvin','aydin':'Aydın','balikesir':'Balıkesir',
  'bilecik':'Bilecik','bingol':'Bingöl','bitlis':'Bitlis','bolu':'Bolu','burdur':'Burdur','bursa':'Bursa',
  'canakkale':'Çanakkale','cankiri':'Çankırı','corum':'Çorum','denizli':'Denizli','diyarbakir':'Diyarbakır',
  'edirne':'Edirne','elazig':'Elazığ','erzincan':'Erzincan','erzurum':'Erzurum','eskisehir':'Eskişehir',
  'gaziantep':'Gaziantep','giresun':'Giresun','gumushane':'Gümüşhane','hakkari':'Hakkari','hatay':'Hatay',
  'isparta':'Isparta','mersin':'Mersin','istanbul':'İstanbul','izmir':'İzmir','kars':'Kars',
  'kastamonu':'Kastamonu','kayseri':'Kayseri','kirklareli':'Kırklareli','kirsehir':'Kırşehir','kocaeli':'Kocaeli',
  'konya':'Konya','kutahya':'Kütahya','malatya':'Malatya','manisa':'Manisa','kahramanmaras':'Kahramanmaraş',
  'mardin':'Mardin','mugla':'Muğla','mus':'Muş','nevsehir':'Nevşehir','nigde':'Niğde','ordu':'Ordu',
  'rize':'Rize','sakarya':'Sakarya','samsun':'Samsun','siirt':'Siirt','sinop':'Sinop','sivas':'Sivas',
  'tekirdag':'Tekirdağ','tokat':'Tokat','trabzon':'Trabzon','tunceli':'Tunceli','sanliurfa':'Şanlıurfa',
  'usak':'Uşak','van':'Van','yozgat':'Yozgat','zonguldak':'Zonguldak','aksaray':'Aksaray','bayburt':'Bayburt',
  'karaman':'Karaman','kirikkale':'Kırıkkale','batman':'Batman','sirnak':'Şırnak','bartin':'Bartın',
  'ardahan':'Ardahan','igdir':'Iğdır','yalova':'Yalova','karabuk':'Karabük','kilis':'Kilis','osmaniye':'Osmaniye','duzce':'Düzce'
};

// ---------- Normalization helpers (mirror Python) ----------
const normMapRepl = [['I','i'],['ı','i'],['İ','i'],['Ğ','g'],['ğ','g'],['Ü','u'],['ü','u'],['Ş','s'],['ş','s'],['Ö','o'],['ö','o'],['Ç','c'],['ç','c']];
function normalize_id(text){
  if (typeof text !== 'string') return '';
  let s = text;
  for (const [a,b] of normMapRepl) s = s.split(a).join(b);
  return s.toLowerCase().replace(/-/g,'').replace(/_/g,'').replace(/ /g,'');
}
const trUpperMap = {'i':'İ','ı':'I','ğ':'Ğ','ü':'Ü','ş':'Ş','ö':'Ö','ç':'Ç'};
const trLowerMap = {'İ':'i','I':'ı','Ğ':'ğ','Ü':'ü','Ş':'ş','Ö':'ö','Ç':'ç'};
function to_tr_title(text){
  if (typeof text !== 'string') return '';
  return text.split(/\s+/).filter(w=>w).map(w=>{
    const first = trUpperMap[w[0].toLowerCase()] || w[0].toUpperCase();
    const rest = [...w.slice(1)].map(ch=>trLowerMap[ch]||ch.toLowerCase()).join('');
    return first+rest;
  }).join(' ');
}
function get_display_name(norm_id){ return PROVINCE_NAMES[norm_id] || to_tr_title(norm_id); }

function sig(x){ return 1/(1+Math.exp(-x)); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

// 538 probability color (from get_probability_color, mirror Python exactly)
function get_probability_color(party, wins, iter_count){
  const base = PARTY_COLORS[party] || '#888888';
  const r0 = parseInt(base.slice(1,3),16), g0 = parseInt(base.slice(3,5),16), b0 = parseInt(base.slice(5,7),16);
  const probability = wins/iter_count;
  let mix;
  if (probability >= 0.95) mix = 1.0;
  else if (probability >= 0.75) mix = 0.70;
  else if (probability >= 0.60) mix = 0.45;
  else if (probability > 0.50) mix = 0.25;
  else return '#D3D3D3';
  const r = Math.round(r0*mix + 220*(1-mix));
  const g = Math.round(g0*mix + 220*(1-mix));
  const b = Math.round(b0*mix + 220*(1-mix));
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}
// get_heatmap_color (mirror Python)
function get_heatmap_color(baseHex, ratio){
  const norm = clamp((ratio-0.25)/0.35, 0, 1);
  const curve = Math.pow(norm,3);
  const h = baseHex.replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  const fr=r+(200-r)*0.55, fg=g+(200-g)*0.55, fb=b+(200-b)*0.55;
  return '#'+[Math.round(fr+(r-fr)*curve),Math.round(fg+(g-fg)*curve),Math.round(fb+(b-fb)*curve)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

// Small seeded RNG + Box-Muller gaussian (for MC when not using Dirichlet-less paths)
function mulberry32(seed){
  return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
}
// Dirichlet sampling via Gamma (math-free: use Marsaglia-Tsang)
function dirichletSample(alphas, rng){
  const g=[];
  let sum=0;
  for (const a of alphas){ const gv=sampleGamma(a,rng); g.push(gv); sum+=gv; }
  return g.map(v=>v/sum);
}
function sampleGamma(alpha, rng){
  if (alpha < 1){
    const u = rng();
    if (u <= 0) return 0;
    return sampleGamma(alpha+1, rng)*Math.pow(u, 1/alpha);
  }
  const d = alpha - 1/3, c = 1/Math.sqrt(9*d);
  for(;;){
    let x=0,y=0,v=0;
    do { x = rng(); y = 1+rng(); v = y*Math.tan(Math.PI*x); } while (v<=0);
    const z = 1 + c*v;
    let s = z*z*z;
    if (s > 0 && Math.exp(-0.5*v*v)*rng() < (1 - 0.0331*(z-1)**4)/(s || 1)) return d*s;
  }
}

if (typeof module !== 'undefined') module.exports = {PARTY_COLORS, BASE_PARTIES, OZEL_SIRA, PARLIAMENT_ORDER, PREDEFINED_SCENARIOS, DEFAULT_TRANSITIONS, CB_GROUPS, CB_GROUP_LIST, DEFAULT_CB_CANDS_1, REGIONAL_BOOSTS_DEFAULT, PROVINCE_NAMES, normalize_id, to_tr_title, get_display_name, clamp, sig, get_probability_color, get_heatmap_color, mulberry32, dirichletSample};
