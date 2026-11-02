import { ModalShell } from './SettingsModal';
import { Thermo3D, Smoke3D, Gas3D, Flame3D, Drop3D, Fan3D, Chip3D, ShieldCheck3D } from './icons';
import { Wifi, Bot } from 'lucide-react';
import { evalFuzzy, type AppSettings } from '@/lib/db';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
}

export function InfoModal({ open, onClose, settings }: Props) {
  return (
    <ModalShell open={open} onClose={onClose} title="Informasi Sistem" icon={<ShieldCheck3D className="w-6 h-6" />} wide>
      <div className="space-y-4 text-sm text-slate-300">

        <p>
          <strong className="text-white">Sistem Prototype Kebakaran Rumah</strong> — sistem pemantau &amp; pemadam kebakaran multi-device ESP32. Semua device memakai program yang sama, dibedakan hanya oleh <strong className="text-white">Device ID</strong>.
        </p>

        {/* ===== Fuzzy Logic ===== */}
        <div className="rounded-xl border border-bg-line bg-bg-soft p-4 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wide">Fuzzy Logic — Mamdani</h3>
          <p className="text-xs text-slate-400">
            Grafik keanggotaan di bawah digambar langsung dari <strong className="text-slate-300">batas aktif</strong> (lihat menu Pengaturan → Fuzzy Logic).
          </p>

          <MembershipGraph
            title="Suhu"
            unit="°C"
            icon={<Thermo3D className="w-5 h-5" />}
            L={settings.fuzzy_temp_aman}
            H={settings.fuzzy_temp_bahaya}
            max={100}
            labelLow="AMAN"
          />
          <MembershipGraph
            title="Asap (MQ2)"
            unit="ppm"
            icon={<Smoke3D className="w-5 h-5" />}
            L={settings.fuzzy_smoke_rendah}
            H={settings.fuzzy_smoke_tinggi}
            max={1000}
            labelLow="RENDAH"
          />
          <MembershipGraph
            title="Gas LPG (MQ6)"
            unit="ppm"
            icon={<Gas3D className="w-5 h-5" />}
            L={settings.fuzzy_gas_rendah}
            H={settings.fuzzy_gas_tinggi}
            max={5000}
            labelLow="RENDAH"
          />

          <div>
            <div className="text-xs font-bold text-slate-200 uppercase tracking-wide mb-2">Rule Base — Kipas (FLOW / BOOST, +S = Sprinkler ON)</div>
            <RuleTable gasLevel="Gas RENDAH" />
            <RuleTable gasLevel="Gas SEDANG" />
            <RuleTable gasLevel="Gas TINGGI" />
          </div>

          <div className="text-xs text-slate-400 space-y-1.5">
            <p><strong className="text-slate-200">Inferensi:</strong> bobot aturan = MIN(µsuhu, µasap, µgas); agregasi output = MAX; pilihan akhir = <em>argmax</em> (bobot BOOST &gt; bobot FLOW → BOOST).</p>
            <p><strong className="text-slate-200">Trigger keras (prioritas tertinggi):</strong> sensor api fire1–4 aktif → sprinkler terkait langsung ON (setelah delay) + kipas BOOST, tanpa menunggu fuzzy.</p>
            <p><strong className="text-slate-200">Defuzzifikasi:</strong> diskrit — kipas hanya FLOW (setting) atau BOOST (100%), cocok untuk relay. Sprinkler ON bila ada aturan BAHAYA yang menyala.</p>
            <ContohHitung settings={settings} />
          </div>
        </div>

        {/* ===== Sensor & aktuator ===== */}
        <div className="rounded-xl border border-bg-line bg-bg-soft p-4 space-y-3">
          <Row icon={<Thermo3D className="w-5 h-5" />} title="Sensor 1 — Suhu Ruangan" desc="Suhu udara dalam °C. Masuk fuzzy sebagai input AMAN/WASPADA/BAHAYA." />
          <Row icon={<Smoke3D className="w-5 h-5" />} title="Sensor 2 — MQ2 (Asap)" desc="Konsentrasi asap dalam ppm. Input fuzzy RENDAH/SEDANG/TINGGI." />
          <Row icon={<Gas3D className="w-5 h-5" />} title="Sensor 3 — MQ6 (Gas LPG)" desc="Konsentrasi gas dalam ppm (kalibrasi kurva LPG datasheet). Input fuzzy." />
          <Row icon={<Flame3D className="w-5 h-5" />} title="Sensor Api 1-4" desc="Empat sensor api — trigger keras sprinkler 1-4." />
          <Row icon={<Drop3D className="w-5 h-5" />} title="Sprinkler 1-4" desc="Pemadam otomatis: sensor api terkait atau keputusan fuzzy (suhu BAHAYA). Mode manual dikendalikan dari dashboard." />
          <Row icon={<Fan3D className="w-5 h-5" />} title="Kipas Ventilasi (FLOW/BOOST)" desc="FLOW = ventilasi pelan kontinu; BOOST = kencang saat asap/gas/suhu naik. Ditentukan fuzzy Mamdani di ESP32." />
        </div>

        {/* ===== Perangkat & cloud ===== */}
        <div className="rounded-xl border border-bg-line bg-bg-soft p-4 space-y-3">
          <Row icon={<Chip3D className="w-5 h-5" />} title="ESP32 + Device ID" desc="Tiap ESP32 dikompilasi dengan Device ID unik (mis. ESP32-A) yang menentukan path datanya: devices/&#123;ID&#125;/status dan devices/&#123;ID&#125;/actuators." />
          <Row icon={<Wifi className="w-4 h-4 text-safe" />} title="Firebase Realtime Database" desc="Update sensor realtime tanpa refresh; perintah aktuator & pengaturan lewat node yang sama." />
          <Row icon={<Bot className="w-4 h-4 text-accent-light" />} title="Notifikasi Telegram" desc="Saat level bahaya berubah, ESP32 mengirim laporan ke semua penerima yang terdaftar di Pengaturan." />
        </div>

        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <p className="text-xs text-warning">
            <strong>Cara menghubungkan ESP32:</strong> daftarkan Device ID di menu <strong>Kelola Perangkat</strong>, lalu ESP32 menulis bacaan sensor ke <code className="font-mono">devices/&#123;ID&#125;/status</code>, membaca perintah dari <code className="font-mono">devices/&#123;ID&#125;/actuators</code>, parameter fuzzy dari <code className="font-mono">settings</code>, dan mengirim notifikasi Telegram saat level berubah.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}

// ===================== Grafik keanggotaan =====================

function MembershipGraph({ title, unit, icon, L, H, max, labelLow }: { title: string; unit: string; icon: React.ReactNode; L: number; H: number; max: number; labelLow: string }) {
  const W = 320, HGT = 124, PADX = 24, PADY = 22;
  const plotW = W - PADX * 2, plotH = HGT - PADY * 2;
  const x = (v: number) => PADX + Math.max(0, Math.min(1, v / max)) * plotW;
  const y = (mu: number) => PADY + (1 - mu) * plotH;

  const safeL = Math.min(L, H - 1), safeH = Math.max(H, safeL + 1);
  const M = (safeL + safeH) / 2, d = (safeH - safeL) / 4;

  // garis AMAN/RENDAH: (0,1) → (L,1) → (L+d,0)
  const lowLine = `M ${x(0)} ${y(1)} L ${x(safeL)} ${y(1)} L ${x(safeL + d)} ${y(0)}`;
  // garis tengah: (L,0) → (M,1) → (H,0)
  const midLine = `M ${x(safeL)} ${y(0)} L ${x(M)} ${y(1)} L ${x(safeH)} ${y(0)}`;
  // garis tinggi/bahaya: (H-d,0) → (H,1) → (max,1)
  const highLine = `M ${x(safeH - d)} ${y(0)} L ${x(safeH)} ${y(1)} L ${x(max)} ${y(1)}`;

  const area = (line: string, closeX: number) => `${line} L ${x(closeX)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  // Numerik di bawah plot: saring label yang terlalu rapat agar tidak bertumpuk
  const labelMid = labelLow === 'AMAN' ? 'WASPADA' : 'SEDANG';
  const labelHigh = labelLow === 'AMAN' ? 'BAHAYA' : 'TINGGI';
  const gap = 46; // jarak minimum antar label numerik (px)
  const atMax = x(max) - x(safeH) >= gap - 6;   // tampilkan "max unit" hanya jika cukup ruang

  return (
    <div className="rounded-lg border border-bg-line bg-bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-bold text-slate-200">{title}</span>
        <span className="text-[10px] text-slate-500 font-mono">
          batas: {safeL} · {safeH} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${HGT}`} className="w-full">
        <rect x={PADX} y={PADY} width={plotW} height={plotH} fill="none" stroke="#334155" strokeWidth="1" rx="4" />
        {/* area berwarna */}
        <path d={area(lowLine, safeL + d)} fill="#4ade80" opacity="0.15" />
        <path d={area(midLine, safeH)} fill="#fbbf24" opacity="0.15" />
        <path d={area(highLine, max)} fill="#f87171" opacity="0.15" />
        {/* garis */}
        <path d={lowLine} fill="none" stroke="#4ade80" strokeWidth="2" />
        <path d={midLine} fill="none" stroke="#fbbf24" strokeWidth="2" />
        <path d={highLine} fill="none" stroke="#f87171" strokeWidth="2" />
        {/* label himpunan — di DALAM plot baris atas, terpisah dari angka di bawah */}
        <text x={x(safeL + d / 2)} y={y(0) - 14} fill="#4ade80" fontSize="9" fontWeight="bold" textAnchor="middle">{labelLow}</text>
        <text x={x(M)} y={y(1) - 6} fill="#fbbf24" fontSize="9" fontWeight="bold" textAnchor="middle">{labelMid}</text>
        <text x={x(safeH - d / 2)} y={y(0) - 14} fill="#f87171" fontSize="9" fontWeight="bold" textAnchor="middle">{labelHigh}</text>
        {/* sumbu µ di kiri atas */}
        <text x={PADX + 2} y={PADY - 6} fill="#64748b" fontSize="9" fontFamily="monospace">µ=1</text>
        <text x={PADX + 2} y={HGT - 4} fill="#64748b" fontSize="9" fontFamily="monospace">0</text>
        {/* numerik batas di bawah plot — hanya yang muat, sisanya tertulis di baris judul */}
        <text x={x(safeL)} y={HGT - 4} fill="#4ade80" fontSize="9" textAnchor="middle" fontFamily="monospace">{safeL}</text>
        <text x={x(safeH)} y={HGT - 4} fill="#f87171" fontSize="9" textAnchor="middle" fontFamily="monospace">{safeH}</text>
        {atMax && (
          <text x={x(max)} y={HGT - 4} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="monospace">{max} {unit}</text>
        )}
      </svg>
    </div>
  );
}

// ===================== Tabel rule base =====================

type RuleCell = 'F' | 'B' | 'BS';

const RULES_DISPLAY: Record<string, RuleCell[][]> = {
  'Gas RENDAH': [
    ['F', 'F', 'B'],
    ['F', 'F', 'B'],
    ['B', 'B', 'BS'],
  ],
  'Gas SEDANG': [
    ['F', 'B', 'B'],
    ['B', 'B', 'B'],
    ['BS', 'BS', 'BS'],
  ],
  'Gas TINGGI': [
    ['B', 'B', 'B'],
    ['B', 'B', 'B'],
    ['BS', 'BS', 'BS'],
  ],
};

function RuleTable({ gasLevel }: { gasLevel: string }) {
  const rows = RULES_DISPLAY[gasLevel];
  const asapLabels = ['Asap RENDAH', 'Asap SEDANG', 'Asap TINGGI'];
  const suhuLabels = ['Suhu AMAN', 'Suhu WASPADA', 'Suhu BAHAYA'];

  function cell(r: RuleCell) {
    if (r === 'F') return <span className="text-safe font-bold">FLOW</span>;
    if (r === 'B') return <span className="text-accent-light font-bold">BOOST</span>;
    return (
      <span className="font-bold">
        <span className="text-accent-light">BOOST</span>
        <span className="text-primary-light"> +S</span>
      </span>
    );
  }

  return (
    <div className="mb-2">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{gasLevel}</div>
      <table className="w-full text-[10px] text-center border-collapse">
        <thead>
          <tr>
            <th className="border border-bg-line bg-bg-card px-1 py-0.5 w-24"></th>
            {asapLabels.map((l) => (
              <th key={l} className="border border-bg-line bg-bg-card px-1 py-0.5 text-slate-400">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="border border-bg-line bg-bg-card px-1 py-0.5 text-slate-400 text-left">{suhuLabels[i]}</td>
              {row.map((r, j) => (
                <td key={j} className="border border-bg-line px-1 py-0.5 bg-bg-soft">{cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Contoh perhitungan live dari data sensor terakhir (atau default). */
function ContohHitung({ settings }: { settings: AppSettings }) {
  const contohStatus = {
    device_id: 'contoh',
    temperature: 48,
    smoke_mq2: 300,
    gas_mq6: 500,
    fire1: false, fire2: false, fire3: false, fire4: false,
    updated_at: '',
  };
  const r = evalFuzzy(contohStatus, settings);
  return (
    <p>
      <strong className="text-slate-200">Contoh (suhu 48 °C, asap 300 ppm, gas {contohStatus.gas_mq6} ppm):</strong>{' '}
      suhu WASPADA µ={(r.mu.temp.mid).toFixed(2)}, asap RENDAH µ=1.0 → aturan (WASPADA, RENDAH, RENDAH) → <strong className="text-safe">Kipas {r.fan === 'boost' ? 'BOOST' : r.fan === 'flow' ? 'FLOW' : 'OFF'}</strong>, sprinkler {r.sprinkler ? 'ON' : 'OFF'}.
    </p>
  );
}

// ===================== Baris info =====================

function Row({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div>
        <div className="font-semibold text-white text-sm">{title}</div>
        <div className="text-xs text-slate-400">{desc}</div>
      </div>
    </div>
  );
}
