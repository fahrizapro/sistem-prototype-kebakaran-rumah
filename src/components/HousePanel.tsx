import {
  type HouseStatus,
  type DeviceState,
  type DeviceId,
  type AppSettings,
  evalDanger,
  evalFuzzy,
} from '@/lib/db';
import { SensorCard } from './SensorCard';
import { SprinklerControl } from './SprinklerControl';
import { FanControl } from './FanControl';
import { Home3D, Thermo3D, Smoke3D, Gas3D, Drop3D, Fan3D, Flame3D } from './icons';
import { Bot } from 'lucide-react';

interface Props {
  deviceId: DeviceId;
  name: string;
  status: HouseStatus | null;
  settings: AppSettings;
  devices: DeviceState[];
  pending: Set<string>;
  errors: Record<string, string>;
  onSetMode: (deviceId: DeviceId, device: string, mode: 'auto' | 'manual') => Promise<void>;
  onSetManualActive: (deviceId: DeviceId, device: string, manual_active: boolean) => Promise<void>;
  onSetFanManualLevel: (deviceId: DeviceId, level: 'flow' | 'boost') => Promise<void>;
  online: boolean;
  lastSeenSec: number | null;
}

export function HousePanel({ deviceId, name, status, settings, devices, pending, errors, onSetMode, onSetManualActive, onSetFanManualLevel, online, lastSeenSec }: Props) {
  const danger = status ? evalDanger(status, settings) : { level: 'safe' as const, reasons: [] };
  const fuzzy = status ? evalFuzzy(status, settings) : null;
  const t = settings;
  const tg = settings.telegram;

  const headerTone =
    danger.level === 'danger'
      ? 'border-danger/50 bg-danger/5'
      : danger.level === 'warning'
        ? 'border-warning/50 bg-warning/5'
        : 'border-bg-line bg-bg-card';

  const ringTone =
    danger.level === 'danger'
      ? 'shadow-glow-danger'
      : danger.level === 'warning'
        ? 'shadow-glow'
        : 'shadow-card';

  return (
    <section
      className={`rounded-2xl border ${headerTone} ${ringTone} overflow-hidden animate-fade-in-up transition-shadow`}
    >
      {/* Device header */}
      <div className="px-5 py-4 border-b border-bg-line flex items-center justify-between bg-bg-card/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
              danger.level === 'danger'
                ? 'bg-danger/20'
                : danger.level === 'warning'
                  ? 'bg-warning/20'
                  : 'bg-primary/20'
            }`}
          >
            <Home3D className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{name}</h2>
            <p className="text-xs text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold ${
                  online ? 'bg-safe/15 text-safe' : 'bg-danger/15 text-danger'
                }`}
                title={online ? 'Perangkat mengirim data normal' : lastSeenSec != null ? `Tidak ada data selama ${lastSeenSec} detik` : 'Belum ada data status'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-safe animate-pulse' : 'bg-danger'}`} />
                {online ? 'Online' : 'Offline'}
              </span>
              <span>
                {danger.level === 'danger'
                  ? 'Kebakaran terdeteksi'
                  : danger.level === 'warning'
                    ? 'Potensi bahaya'
                    : 'Kondisi normal'}
                {' · '}
                {deviceId}
              </span>
              {lastSeenSec != null && (
                <span className="text-slate-500">
                  · update {lastSeenSec >= 60 ? `${Math.floor(lastSeenSec / 60)} mnt` : `${lastSeenSec} dtk`} lalu
                </span>
              )}
            </p>
          </div>
        </div>

        <div
          className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 ${
            danger.level === 'danger'
              ? 'bg-danger/20 text-danger animate-pulse'
              : danger.level === 'warning'
                ? 'bg-warning/20 text-warning'
                : 'bg-safe/15 text-safe'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              danger.level === 'danger'
                ? 'bg-danger animate-ping'
                : danger.level === 'warning'
                  ? 'bg-warning'
                  : 'bg-safe'
            }`}
          />
          {danger.level === 'danger' ? 'BAHAYA' : danger.level === 'warning' ? 'WASPADA' : 'AMAN'}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Sensor readings */}
        <div>
          <SectionTitle icon={<Thermo3D className="w-5 h-5" />} title="Sensor Lingkungan" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SensorCard
              title="Suhu Ruangan"
              value={status?.temperature ?? 0}
              unit="°C"
              decimals={1}
              icon={<Thermo3D className="w-6 h-6" />}
              tone={status && status.temperature >= t.temp_threshold ? 'danger' : status && status.temperature >= t.temp_threshold * 0.7 ? 'warning' : 'neutral'}
              hint="Sensor 1"
            />
            <SensorCard
              title="Asap (MQ2)"
              value={status?.smoke_mq2 ?? 0}
              unit="ppm"
              icon={<Smoke3D className="w-6 h-6" />}
              tone={status && status.smoke_mq2 >= t.smoke_threshold ? 'danger' : status && status.smoke_mq2 >= t.smoke_threshold * 0.5 ? 'warning' : 'neutral'}
              hint="Sensor 2"
            />
            <SensorCard
              title="Gas (MQ6)"
              value={status?.gas_mq6 ?? 0}
              unit="ppm"
              icon={<Gas3D className="w-6 h-6" />}
              tone={status && status.gas_mq6 >= t.gas_threshold ? 'danger' : status && status.gas_mq6 >= t.gas_threshold * 0.5 ? 'warning' : 'neutral'}
              hint="Sensor 3"
            />
          </div>
        </div>

        {/* Fire sensors + sprinklers */}
        <div>
          <SectionTitle
            icon={<Drop3D className="w-5 h-5" />}
            title="Sensor Api & Sprinkler (1-4)"
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([1, 2, 3, 4] as const).map((i) => {
              const fireOn = status ? (status as unknown as Record<string, boolean>)[`fire${i}`] : false;
              const dev = devices.find((d) => d.device === `sprinkler${i}`);
              return (
                <SprinklerControl
                  key={i}
                  index={i}
                  fireOn={!!fireOn}
                  fuzzySprinkler={fuzzy?.sprinkler ?? false}
                  device={dev}
                  pending={pending.has(`${deviceId}:sprinkler${i}`)}
                  error={errors[`${deviceId}:sprinkler${i}`]}
                  onSetMode={(mode) => onSetMode(deviceId, `sprinkler${i}`, mode)}
                  onToggleManual={(active) => onSetManualActive(deviceId, `sprinkler${i}`, active)}
                />
              );
            })}
          </div>
        </div>

        {/* Fan */}
        <div>
          <SectionTitle
            icon={<Fan3D className="w-5 h-5" />}
            title="Kipas Ventilasi (Aktif saat gas/asap terdeteksi)"
          />
          <div className="grid grid-cols-1 gap-3">
            <FanControl
              key="fan1"
              deviceName="fan1"
              fanAuto={fuzzy?.fan ?? 'off'}
              device={devices.find((d) => d.device === 'fan1')}
              pending={pending.has(`${deviceId}:fan1`)}
              error={errors[`${deviceId}:fan1`]}
              onSetMode={(mode) => onSetMode(deviceId, 'fan1', mode)}
              onSetManualLevel={(level) => onSetFanManualLevel(deviceId, level)}
            />
          </div>
        </div>

        {/* Output fuzzy */}
        {fuzzy && status && (
          <div>
            <SectionTitle icon={<Flame3D className="w-5 h-5" />} title="Output Fuzzy (Mamdani)" />
            <div className="rounded-xl border border-bg-line bg-bg-soft p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={`px-3 py-1 rounded-lg text-xs font-bold ${
                  fuzzy.fan === 'boost' ? 'bg-accent/20 text-accent-light' : fuzzy.fan === 'flow' ? 'bg-safe/15 text-safe' : 'bg-bg-line text-slate-400'
                }`}>
                  KIPAS: {fuzzy.fan === 'boost' ? 'BOOST' : fuzzy.fan === 'flow' ? 'FLOW' : 'OFF'} ({fuzzy.fan_pwm}%)
                </span>
                <span className={`px-3 py-1 rounded-lg text-xs font-bold ${fuzzy.sprinkler ? 'bg-primary/20 text-primary-light' : 'bg-bg-line text-slate-400'}`}>
                  SPRINKLER: {fuzzy.sprinkler ? 'ON' : 'OFF'}
                </span>
                <span className="text-[10px] text-slate-500 ml-auto font-mono">
                  wFLOW {fuzzy.w_flow.toFixed(2)} · wBOOST {fuzzy.w_boost.toFixed(2)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { label: 'Suhu', mu: fuzzy.mu.temp, names: ['AMAN', 'WASPADA', 'BAHAYA'] },
                  { label: 'Asap', mu: fuzzy.mu.smoke, names: ['RENDAH', 'SEDANG', 'TINGGI'] },
                  { label: 'Gas', mu: fuzzy.mu.gas, names: ['RENDAH', 'SEDANG', 'TINGGI'] },
                ] as const).map((inp) => (
                  <div key={inp.label}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{inp.label}</div>
                    {([inp.mu.low, inp.mu.mid, inp.mu.high] as number[]).map((mu, i) => (
                      <div key={i} className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[9px] text-slate-500 w-12">{inp.names[i]}</span>
                        <div className="flex-1 h-1.5 rounded bg-bg-line overflow-hidden">
                          <div
                            className={`h-full ${i === 0 ? 'bg-safe' : i === 1 ? 'bg-warning' : 'bg-danger'}`}
                            style={{ width: `${Math.round(mu * 100)}%` }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-slate-400">{mu.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Status Telegram */}
        <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
          <Bot className="w-4 h-4" />
          <span>
            {tg?.enabled && tg.bot_token && tg.recipients
              ? `Telegram AKTIF · ${Object.keys(tg.recipients).length} penerima`
              : tg?.enabled
                ? 'Telegram AKTIF · 0 penerima'
                : 'Telegram belum disetel (atur di Pengaturan)'}
          </span>
        </div>

        {/* Danger reasons */}
        {danger.reasons.length > 0 && (
          <div
            className={`rounded-xl p-3 border text-sm ${
              danger.level === 'danger'
                ? 'bg-danger/10 border-danger/40 text-danger'
                : 'bg-warning/10 border-warning/40 text-warning'
            }`}
          >
            <strong>Pemicu:</strong> {danger.reasons.join(' · ')}
          </div>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 text-slate-300">
      <span>{icon}</span>
      <h3 className="text-sm font-semibold uppercase tracking-wider">{title}</h3>
    </div>
  );
}
