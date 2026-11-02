import { useEffect, useState } from 'react';
import {
  saveSettings,
  evalFuzzy,
  type AppSettings,
  DEFAULT_SETTINGS,
} from '@/lib/db';
import { Gear3D, Thermo3D, Smoke3D, Gas3D, Drop3D, Fan3D } from './icons';
import { X, Loader2, Save, RotateCcw, SlidersHorizontal, Timer } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
}

// ===================== Definisi field =====================

interface FieldDef {
  key: keyof AppSettings;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

const THRESHOLD_FIELDS: FieldDef[] = [
  {
    key: 'temp_threshold', label: 'Suhu (Sensor 1)', unit: '°C', min: 0, max: 120, step: 1,
    hint: 'Status berubah BAHAYA saat suhu >= nilai ini. Contoh: 50 → alarm menyala di 50 °C ke atas.',
  },
  {
    key: 'smoke_threshold', label: 'Asap (MQ2 — Sensor 2)', unit: 'ppm', min: 0, max: 5000, step: 10,
    hint: 'Status berubah BAHAYA saat kadar asap >= nilai ini (ppm). Udara bersih biasanya dekat 0 ppm.',
  },
  {
    key: 'gas_threshold', label: 'Gas LPG (MQ6 — Sensor 3)', unit: 'ppm', min: 300, max: 5000, step: 50,
    hint: 'Status berubah BAHAYA saat kadar gas >= nilai ini (ppm). Udara bersih biasanya di bawah 20 ppm.',
  },
];

const FUZZY_FIELDS: FieldDef[] = [
  {
    key: 'fuzzy_temp_aman', label: 'Suhu — batas AMAN', unit: '°C', min: 20, max: 60, step: 1,
    hint: 'Suhu <= nilai ini dianggap sepenuhnya normal. Di atasnya mulai masuk zona WASPADA.',
  },
  {
    key: 'fuzzy_temp_bahaya', label: 'Suhu — batas BAHAYA', unit: '°C', min: 40, max: 100, step: 1,
    hint: 'Suhu >= nilai ini dianggap panas berbahaya. Di antara dua batas = WASPADA (bertahap).',
  },
  {
    key: 'fuzzy_smoke_rendah', label: 'Asap — batas RENDAH', unit: 'ppm', min: 100, max: 1000, step: 10,
    hint: 'Asap <= nilai ini dianggap bersih. Di atasnya mulai masuk zona SEDANG.',
  },
  {
    key: 'fuzzy_smoke_tinggi', label: 'Asap — batas TINGGI', unit: 'ppm', min: 300, max: 2000, step: 10,
    hint: 'Asap >= nilai ini masuk zona TINGGI (kipas BOOST). Di antara dua batas = SEDANG.',
  },
  {
    key: 'fuzzy_gas_rendah', label: 'Gas — batas RENDAH', unit: 'ppm', min: 300, max: 3000, step: 10,
    hint: 'Gas <= nilai ini dianggap bersih. Di atasnya mulai masuk zona SEDANG.',
  },
  {
    key: 'fuzzy_gas_tinggi', label: 'Gas — batas TINGGI', unit: 'ppm', min: 800, max: 5000, step: 10,
    hint: 'Gas >= nilai ini masuk zona TINGGI (kipas BOOST + sprinkler). Di antara dua batas = SEDANG.',
  },
  {
    key: 'fuzzy_fan_flow', label: 'Kipas FLOW (pelan)', unit: '%', min: 20, max: 80, step: 5,
    hint: 'Kekencangan kipas di mode FLOW (persen dari kecepatan BOOST). FLOW TIDAK menyalakan relay; relay hanya menyala saat BOOST.',
  },
];

const DELAY_FIELDS: FieldDef[] = [
  {
    key: 'sprinkler_delay', label: 'Delay Sprinkler', unit: 'detik', min: 0, max: 30, step: 1,
    hint: 'Tunggu (detik) sejak api terdeteksi sebelum sprinkler titik tersebut menyala.',
  },
  {
    key: 'fan_delay', label: 'Delay Kipas (BOOST)', unit: 'detik', min: 0, max: 30, step: 1,
    hint: 'Kondisi BOOST harus bertahan selama ini (detik) baru relay kipas menyala. Anti-nyala gara-gara deteksi sekilas.',
  },
  {
    key: 'fan_duration', label: 'Durasi BOOST (tahan)', unit: 'detik', min: 5, max: 300, step: 5,
    hint: 'Setelah kondisi bahaya hilang, kipas tetap BOOST selama ini (detik). Anti-kipas hidup-mati berulang.',
  },
];

// ===================== Modal utama =====================

export function SettingsModal({ open, onClose, settings, onSave }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setError(null);
  }, [open, settings]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveSettings(draft);
      onSave({ ...draft, updated_at: new Date().toISOString() });
      onClose();
    } catch {
      setError('Gagal menyimpan pengaturan. Coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDraft({ ...DEFAULT_SETTINGS });
  }

  return (
    <ModalShell open onClose={onClose} title="Pengaturan" icon={<Gear3D className="w-6 h-6" />} wide>
      <div className="space-y-6">
        {/* ===== 1. Threshold Sensor ===== */}
        <Section
          no={1}
          icon={<SlidersHorizontal className="w-4 h-4" />}
          title="Threshold Sensor"
          desc="Ambang batas peringatan sederhana (di luar fuzzy)."
        >
          {THRESHOLD_FIELDS.map((f) => (
            <Slider key={f.key} def={f} draft={draft} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          ))}
        </Section>

        {/* ===== 2. Fuzzy Logic ===== */}
        <Section
          no={2}
          icon={<Fan3D className="w-5 h-5" />}
          title="Fuzzy Logic (Mamdani)"
          desc="Batas keanggotaan tiap input. Detail rule base & grafik ada di menu Informasi."
        >
          {FUZZY_FIELDS.map((f) => (
            <Slider key={f.key} def={f} draft={draft} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          ))}

          {/* Idle mode */}
          <div className="pt-1">
            <label className="text-sm font-medium text-slate-200">Kipas saat idle (aturan FLOW menyala)</label>
            <div className="mt-1.5 flex gap-2">
              {(['flow', 'off'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDraft((d) => ({ ...d, fan_idle_mode: m }))}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    draft.fan_idle_mode === m
                      ? 'bg-primary text-white'
                      : 'bg-bg-line text-slate-400 hover:text-white'
                  }`}
                >
                  {m === 'flow' ? 'Tetap FLOW (ventilasi kontinu)' : 'OFF (hemat daya)'}
                </button>
              ))}
            </div>
          </div>

          <FuzzyPreview settings={draft} />
        </Section>

        {/* ===== 3. Delay Aktuator ===== */}
        <Section
          no={3}
          icon={<Timer className="w-4 h-4" />}
          title="Delay Aktuator"
          desc="Jeda & durasi operasi sprinkler/kipas di ESP32."
        >
          {DELAY_FIELDS.map((f) => (
            <Slider key={f.key} def={f} draft={draft} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          ))}
        </Section>

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <div className="flex items-center gap-2 mt-6 sticky bottom-0 bg-bg-card pt-4 border-t border-bg-line">
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-line text-slate-300 text-sm hover:text-white transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-bg-line text-slate-300 text-sm hover:text-white transition-colors"
        >
          Batal
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Simpan Semua
        </button>
      </div>
    </ModalShell>
  );
}

// ===================== Komponen kecil =====================

function Section({ no, icon, title, desc, children }: { no: number; icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-bg-line bg-bg-soft p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-6 h-6 rounded-md bg-primary/20 text-primary-light text-[11px] font-bold flex items-center justify-center">{no}</span>
        <span>{icon}</span>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">{desc}</p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Slider({ def, draft, onChange }: { def: FieldDef; draft: AppSettings; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-slate-200">{def.label}</label>
        <span className="text-sm font-mono text-primary-light">
          {draft[def.key] as number} {def.unit}
        </span>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={draft[def.key] as number}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary cursor-pointer"
      />
      <p className="text-[11px] text-slate-500 mt-0.5">{def.hint}</p>
    </div>
  );
}

/** Simulator rule base: hitung output fuzzy dari input manual. */
function FuzzyPreview({ settings }: { settings: AppSettings }) {
  const [temp, setTemp] = useState(48);
  const [smoke, setSmoke] = useState(300);
  const [gas, setGas] = useState(500);

  const result = evalFuzzy(
    { device_id: 'preview', temperature: temp, smoke_mq2: smoke, gas_mq6: gas, fire1: false, fire2: false, fire3: false, fire4: false, updated_at: '' },
    settings,
  );

  const inputs: Array<{ label: string; unit: string; icon: React.ReactNode; value: number; mu: { low: number; mid: number; high: number }; names: [string, string, string]; onSet: (v: number) => void }> = [
    { label: 'Suhu', unit: '°C', icon: <Thermo3D className="w-5 h-5" />, value: temp, mu: result.mu.temp, names: ['AMAN', 'WASPADA', 'BAHAYA'], onSet: setTemp },
    { label: 'Asap', unit: 'ppm', icon: <Smoke3D className="w-5 h-5" />, value: smoke, mu: result.mu.smoke, names: ['RENDAH', 'SEDANG', 'TINGGI'], onSet: setSmoke },
    { label: 'Gas', unit: 'ppm', icon: <Gas3D className="w-5 h-5" />, value: gas, mu: result.mu.gas, names: ['RENDAH', 'SEDANG', 'TINGGI'], onSet: setGas },
  ];

  return (
    <div className="rounded-lg border border-primary/30 bg-bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Fan3D className="w-4 h-4" />
        <span className="text-xs font-bold text-white uppercase tracking-wide">Simulator Rule Base</span>
      </div>

      <div className="space-y-3">
        {inputs.map((inp) => (
          <div key={inp.label} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
            <div className="flex items-center gap-2 w-28">
              {inp.icon}
              <div>
                <div className="text-xs font-semibold text-slate-200">{inp.label}</div>
                <input
                  type="number"
                  value={inp.value}
                  onChange={(e) => inp.onSet(Number(e.target.value) || 0)}
                  className="w-20 bg-bg-soft border border-bg-line rounded px-1.5 py-0.5 text-xs font-mono text-white"
                />
                <span className="text-[10px] text-slate-500 ml-1">{inp.unit}</span>
              </div>
            </div>
            <div className="space-y-1">
              {([inp.mu.low, inp.mu.mid, inp.mu.high] as number[]).map((mu, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-500 w-14">{inp.names[i]}</span>
                  <div className="flex-1 h-2 rounded bg-bg-line overflow-hidden">
                    <div
                      className={`h-full ${i === 0 ? 'bg-safe' : i === 1 ? 'bg-warning' : 'bg-danger'}`}
                      style={{ width: `${Math.round(mu * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 w-7 text-right">{mu.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <span className={`px-3 py-1 rounded-lg text-xs font-bold ${
          result.fan === 'boost' ? 'bg-accent/20 text-accent-light' : result.fan === 'flow' ? 'bg-safe/15 text-safe' : 'bg-bg-line text-slate-400'
        }`}>
          KIPAS: {result.fan === 'boost' ? 'BOOST' : result.fan === 'flow' ? 'FLOW' : 'OFF'} ({result.fan_pwm}%)
        </span>
        <span className={`px-3 py-1 rounded-lg text-xs font-bold ${result.sprinkler ? 'bg-primary/20 text-primary-light' : 'bg-bg-line text-slate-400'}`}>
          SPRINKLER: {result.sprinkler ? 'ON' : 'OFF'}
        </span>
      </div>
    </div>
  );
}

// ===================== Modal shell (dipakai modal lain juga) =====================

export function ModalShell({
  open,
  onClose,
  title,
  icon,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in-up"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} bg-bg-card border border-bg-line rounded-2xl shadow-card my-8 animate-fade-in-up`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-line sticky top-0 bg-bg-card rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-lg font-bold text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-bg-line transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
