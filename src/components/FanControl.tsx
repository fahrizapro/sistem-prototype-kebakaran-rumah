import { Fan3D, Smoke3D } from './icons';
import { Wind, Gauge, Power, Settings2, Loader2 } from 'lucide-react';
import { type DeviceState, type DeviceName, type FanMode } from '@/lib/db';

interface Props {
  deviceName: DeviceName;
  fanAuto: FanMode;
  device: DeviceState | undefined;
  pending: boolean;
  error?: string;
  onSetMode: (mode: 'auto' | 'manual') => void;
  onSetManualLevel: (level: 'flow' | 'boost') => void;
}

export function FanControl({ deviceName, fanAuto, device, pending, error, onSetMode, onSetManualLevel }: Props) {
  const mode = device?.mode ?? 'auto';
  const manualActive = device?.manual_active ?? false;
  const manualLevel = device?.manual_level ?? 'flow';
  const active = mode === 'auto' ? fanAuto !== 'off' : manualActive;
  const label = 'Kipas';

  return (
    <div
      className={`relative rounded-xl border p-4 transition-all overflow-hidden ${
        active
          ? 'border-accent/60 bg-accent/5'
          : 'border-bg-line bg-bg-card hover:border-slate-600'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Fan icon with spin */}
        <div
          className={`relative w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors ${
            active ? 'border-accent bg-accent/10' : 'border-slate-600 bg-slate-800/50'
          }`}
        >
          <Fan3D
            className={`w-9 h-9 ${active ? 'animate-spin-slow' : 'opacity-40 grayscale'}`}
          />
          {/* Airflow indicator */}
          {active && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Smoke3D className="w-9 h-9 opacity-40 animate-ping" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">{label}</span>
            <span
              className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                mode === 'auto'
                  ? fanAuto === 'boost'
                    ? 'bg-accent/20 text-accent-light'
                    : fanAuto === 'flow'
                      ? 'bg-safe/15 text-safe'
                      : 'bg-slate-700/50 text-slate-500'
                  : active
                    ? 'bg-accent/20 text-accent-light'
                    : 'bg-slate-700/50 text-slate-500'
              }`}
            >
              {mode === 'auto'
                ? fanAuto === 'boost' ? 'BOOST' : fanAuto === 'flow' ? 'FLOW' : 'OFF'
                : manualActive ? (manualLevel === 'boost' ? 'BOOST' : 'FLOW') : 'OFF'}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mb-2">
            {mode === 'auto'
              ? fanAuto === 'boost'
                ? 'Auto: BOOST (kencang) — relay kipas ON'
                : fanAuto === 'flow'
                  ? 'Auto: FLOW (pelan) — relay kipas OFF'
                  : 'Auto: OFF'
              : manualActive
                ? manualLevel === 'boost'
                  ? 'Manual: BOOST (kencang) — relay kipas ON'
                  : 'Manual: FLOW (pelan) — relay kipas OFF'
                : 'Manual: pilih FLOW atau BOOST'}
          </p>

          {/* Mode toggle */}
          <div className="flex rounded-lg bg-bg-soft border border-bg-line p-0.5 mb-2">
            <button
              onClick={() => onSetMode('auto')}
              disabled={pending}
              className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === 'auto' ? 'bg-accent text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {pending && mode === 'auto' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings2 className="w-3 h-3" />} Auto
            </button>
            <button
              onClick={() => onSetMode('manual')}
              disabled={pending}
              className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === 'manual' ? 'bg-warning text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {pending && mode === 'manual' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />} Manual
            </button>
          </div>

          {mode === 'manual' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onSetManualLevel('flow')}
                disabled={pending}
                className={`py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed ${
                  manualActive && manualLevel === 'flow'
                    ? 'bg-safe text-white'
                    : 'bg-bg-line text-slate-400 hover:text-slate-200'
                }`}
              >
                {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wind className="w-3 h-3" />}
                FLOW
              </button>
              <button
                onClick={() => onSetManualLevel('boost')}
                disabled={pending}
                className={`py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed ${
                  manualActive && manualLevel === 'boost'
                    ? 'bg-accent text-white'
                    : 'bg-bg-line text-slate-400 hover:text-slate-200'
                }`}
              >
                {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gauge className="w-3 h-3" />}
                BOOST
              </button>
            </div>
          )}
          {error && (
            <div className="text-center text-[10px] text-danger mt-1">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
