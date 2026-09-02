# Veri hattı ve testler

## YEREL model veri akışı

```
adp_reflex/app/ilce/veri/2024/ysk_2024_secim_verisi.csv   (2024 il meclisi / seçim çevresi)
Desktop/2024mayor.csv                                      (2024 belediye başkanı sonuçları)
data/ilce/*.json                                           (ilçe v18/v23/v24 — adp_reflex'ten üretildi)
data/yerel_targets.json                                    (aday geçiş listesi — el ile güncellenir)
                    │
                    ▼
scripts/gen_yerel_candidates.js  →  data/yerel_candidates.json
  {structural (meclis), mayoral2024, winner, candidates[{party, personal=başkan−meclis, status}], defections}
scripts/gen_yerel_base.js        →  data/yerel_2024_merkez.json
  {provinces (başkan ağırlıklı taban), winners, nat24 (başkan ulusal referansı)}
```

### Üretim komutları

```bash
node scripts/gen_yerel_candidates.js [yskCsv] [mayorCsv]
node scripts/gen_yerel_base.js [mayoWeight] [yskCsv] [mayorCsv]
```

CSV yolları verilmezse varsayılanlar: `Desktop/adp/ilce/veri/2024/ysk_2024_secim_verisi.csv` ve `Desktop/2024mayor.csv`.

**Dikkat:** `gen_yerel_base.js` çalıştırıldığında `data/yerel_2024_merkez.json`'un `nat/nat24` alanları başkan ulusal sonuçlarıyla yeniden yazılır (swing referansı).

## Model

- `js/yerel_model.js` — saf (DOM/state bağımsız) model: `ymSynthNat` + `ymProjectProvince` + `YEREL_MATRIX_DEFAULTS`. Hem tarayıcıda (index.html'de app.js'ten önce) hem node'da kullanılır.
- `js/app.js` → `runLocal()` bu modülü çağırır; kalan tüm state/UI app.js'te.

## Testler

```bash
node scripts/test_yerel.js
```

13 gerileme testi: 2024 geri testi (kazanan ≥%92, MAE <2), NaN/toplam kontrolü, A+C çöküş kuralı (CHP %1 → <2), büyükşehir ittifak kuralı, geçiş preseti, aday durumları, popBoost.
