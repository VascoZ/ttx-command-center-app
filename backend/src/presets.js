// Preset peran player bawaan per sektor.
// `code` dipakai generator untuk memetakan inject ke peran.
const PRESETS = [
  {
    name: 'Pemerintah Daerah',
    sector: 'pemerintah',
    description:
      'Struktur tanggap krisis pemerintah provinsi/kabupaten/kota: pimpinan daerah, Diskominfo, CSIRT daerah, Humas & PPID, Hukum, Inspektorat, OPD, BPBD.',
    roles: [
      { code: 'leader', name: 'Pimpinan Daerah', subtitle: 'Kepala Daerah / Sekda', color: '#E5534B', can_approve: true,
        description: 'Pengambil keputusan strategis, menetapkan status krisis, menyetujui pernyataan resmi dan anggaran darurat.' },
      { code: 'it_head', name: 'Kepala Dinas Kominfo', subtitle: 'Penanggung jawab TIK daerah', color: '#3FB27F', can_approve: true, can_escalate: true,
        description: 'Mengoordinasikan penanganan insiden siber, berkoordinasi dengan BSSN, melapor ke pimpinan daerah.' },
      { code: 'tech', name: 'Tim Teknis / CSIRT Daerah', subtitle: 'Penanganan teknis insiden', color: '#4C9AFF', can_escalate: true,
        description: 'Deteksi, analisis, containment, pemulihan sistem, dan pengumpulan bukti digital.' },
      { code: 'comms', name: 'Humas & PPID', subtitle: 'Komunikasi publik', color: '#F2A33A', can_statement: true,
        description: 'Mengelola media dan media sosial, menyusun siaran pers, melayani permohonan informasi publik.' },
      { code: 'legal', name: 'Bagian Hukum', subtitle: 'Kepatuhan dan regulasi', color: '#A78BFA',
        description: 'Menilai kewajiban hukum (UU PDP, pelaporan insiden), koordinasi dengan aparat penegak hukum.' },
      { code: 'audit', name: 'Inspektorat', subtitle: 'Pengawasan internal', color: '#2DD4BF',
        description: 'Memastikan akuntabilitas keputusan dan penggunaan anggaran darurat.' },
      { code: 'ops', name: 'OPD Pemilik Layanan', subtitle: 'Dukcapil, Bapenda, RSUD, dll.', color: '#F472B6',
        description: 'Menjaga kelangsungan layanan publik, menyiapkan prosedur manual sementara.' },
      { code: 'disaster', name: 'BPBD', subtitle: 'Penanggulangan bencana', color: '#FB923C', can_escalate: true,
        description: 'Koordinasi tanggap darurat bencana, logistik, evakuasi, dan posko.' },
    ],
  },
  {
    name: 'Perbankan',
    sector: 'keuangan',
    description: 'Struktur tanggap insiden lembaga jasa keuangan sesuai praktik OJK.',
    roles: [
      { code: 'leader', name: 'Direksi', subtitle: 'Direktur Utama / Direktur terkait', color: '#E5534B', can_approve: true,
        description: 'Menetapkan keputusan strategis, menyetujui komunikasi eksternal dan pelaporan ke regulator.' },
      { code: 'it_head', name: 'CISO / Tim Keamanan Informasi', subtitle: 'Keamanan informasi', color: '#3FB27F', can_approve: true, can_escalate: true,
        description: 'Memimpin respons insiden keamanan, menilai dampak, koordinasi dengan pihak eksternal.' },
      { code: 'tech', name: 'Tim IT Operasional', subtitle: 'Infrastruktur dan aplikasi', color: '#4C9AFF', can_escalate: true,
        description: 'Menjaga ketersediaan core banking, kanal digital, dan pemulihan sistem.' },
      { code: 'comms', name: 'Corporate Communication', subtitle: 'Komunikasi korporat', color: '#F2A33A', can_statement: true,
        description: 'Mengelola pernyataan publik, media, dan komunikasi ke nasabah.' },
      { code: 'legal', name: 'Kepatuhan & Hukum', subtitle: 'Compliance & legal', color: '#A78BFA',
        description: 'Kewajiban pelaporan ke OJK/BI, UU PDP, dan aspek hukum lainnya.' },
      { code: 'risk', name: 'Manajemen Risiko', subtitle: 'Risiko operasional', color: '#2DD4BF',
        description: 'Menilai dampak risiko operasional, reputasi, dan finansial.' },
      { code: 'customer', name: 'Layanan Nasabah', subtitle: 'Contact center & cabang', color: '#F472B6',
        description: 'Menangani keluhan nasabah dan menyampaikan informasi di kanal layanan.' },
    ],
  },
  {
    name: 'Rumah Sakit',
    sector: 'kesehatan',
    description: 'Struktur Hospital Incident Command untuk rumah sakit.',
    roles: [
      { code: 'leader', name: 'Direktur', subtitle: 'Direktur Utama RS', color: '#E5534B', can_approve: true,
        description: 'Penanggung jawab tertinggi, menetapkan status darurat dan keputusan strategis.' },
      { code: 'tech', name: 'Tim IT / SIMRS', subtitle: 'Sistem informasi RS', color: '#4C9AFF', can_escalate: true,
        description: 'Menjaga SIMRS, rekam medis elektronik, dan perangkat jaringan.' },
      { code: 'medical', name: 'Pelayanan Medis', subtitle: 'Komite medik / IGD', color: '#3FB27F', can_escalate: true,
        description: 'Menjamin keselamatan pasien dan kelangsungan pelayanan klinis.' },
      { code: 'comms', name: 'Humas', subtitle: 'Hubungan masyarakat', color: '#F2A33A', can_statement: true,
        description: 'Komunikasi dengan keluarga pasien, media, dan publik.' },
      { code: 'legal', name: 'Hukum & Etik', subtitle: 'Kepatuhan', color: '#A78BFA',
        description: 'Aspek hukum, kerahasiaan rekam medis, dan pelaporan ke Kemenkes.' },
      { code: 'ops', name: 'Keperawatan & Penunjang', subtitle: 'Operasional', color: '#F472B6',
        description: 'Operasional ruang rawat, farmasi, laboratorium, dan logistik.' },
    ],
  },
  {
    name: 'Korporasi Umum',
    sector: 'swasta',
    description: 'Struktur manajemen krisis perusahaan pada umumnya.',
    roles: [
      { code: 'leader', name: 'Manajemen Puncak', subtitle: 'CEO / Direksi', color: '#E5534B', can_approve: true,
        description: 'Keputusan strategis, persetujuan anggaran dan komunikasi eksternal.' },
      { code: 'tech', name: 'Tim IT / SOC', subtitle: 'Teknologi informasi', color: '#4C9AFF', can_escalate: true,
        description: 'Deteksi, analisis, dan pemulihan sistem TI.' },
      { code: 'comms', name: 'Komunikasi Korporat', subtitle: 'PR & media', color: '#F2A33A', can_statement: true,
        description: 'Pernyataan publik, media, media sosial, dan komunikasi internal.' },
      { code: 'legal', name: 'Legal', subtitle: 'Hukum & kepatuhan', color: '#A78BFA',
        description: 'Kewajiban hukum, kontrak, dan pelaporan regulator.' },
      { code: 'hr', name: 'HR', subtitle: 'Sumber daya manusia', color: '#2DD4BF',
        description: 'Keselamatan karyawan, komunikasi internal, dan isu kepegawaian.' },
      { code: 'ops', name: 'Operasional Bisnis', subtitle: 'Unit bisnis', color: '#F472B6',
        description: 'Kelangsungan operasi, pelanggan, dan rantai pasok.' },
    ],
  },
];

// Jika preset tidak memiliki peran dengan kode tertentu, coba kode alternatif.
const FALLBACK = {
  leader: [],
  it_head: ['tech', 'leader'],
  tech: ['it_head'],
  comms: ['leader'],
  legal: ['audit', 'risk', 'leader'],
  audit: ['legal', 'risk'],
  risk: ['audit', 'legal', 'leader'],
  ops: ['customer', 'medical', 'disaster', 'leader'],
  customer: ['ops', 'comms'],
  medical: ['ops', 'leader'],
  disaster: ['ops', 'leader'],
  hr: ['ops', 'leader'],
};

function resolveRoleCode(code, available) {
  if (!code) return null;
  const set = new Set(available);
  if (set.has(code)) return code;
  for (const alt of FALLBACK[code] || []) if (set.has(alt)) return alt;
  return null;
}

module.exports = { PRESETS, resolveRoleCode };
