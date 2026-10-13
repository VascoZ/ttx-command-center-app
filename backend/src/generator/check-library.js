// Pemeriksaan pustaka skenario: semua kombinasi ancaman × sektor × kesulitan tidak boleh menyisakan placeholder.
// Jalankan: docker compose exec api node src/generator/check-library.js
const { generateBuiltin } = require('./index');
const { THREATS, INDUSTRIES } = require('./library');

let bad = 0;
let n = 0;
for (const t of Object.keys(THREATS)) {
  for (const i of Object.keys(INDUSTRIES)) {
    for (const d of ['mudah', 'menengah', 'sulit']) {
      const s = generateBuiltin({ threat: t, industry: i, difficulty: d, duration_min: 180 });
      n++;
      const m = JSON.stringify(s).match(/\{[a-z_]+\}/g);
      if (m) {
        bad++;
        console.log('PLACEHOLDER TERSISA', t, i, d, [...new Set(m)]);
      }
    }
  }
}
console.log(`${n} kombinasi diperiksa, ${bad} bermasalah`);

if (process.argv.includes('--sample')) {
  const show = (s) => {
    console.log(`\n${s.title}`);
    s.injects.forEach((x) => console.log(`  ${String(x.offset_min).padStart(3)}m  ${x.sender}  →  ${x.title}`));
  };
  show(generateBuiltin({ threat: 'ransomware', industry: 'pemerintah', difficulty: 'menengah', duration_min: 180 }));
  show(generateBuiltin({ threat: 'data_breach', industry: 'keuangan', difficulty: 'sulit', duration_min: 180 }));
  show(generateBuiltin({ threat: 'bec', industry: 'pemerintah', organization: 'Pemkot Uji Coba', difficulty: 'mudah', duration_min: 120 }));
}
process.exit(bad ? 1 : 0);
