import { Flame3D, Drop3D } from './icons';
import { Power, Settings2, Loader2 } from 'lucide-react';
import { type DeviceState } from '@/lib/db';

interface Props {
  index: number;
  fireOn: boolean;
  fuzzySprinkler: boolean;
  device: DeviceState | undefined;
  pending: boolean;
  error?: string;
  onSetMode: (mode: 'auto' | 'manual') => void;
  onToggleManual: (active: boolean) => void;
}

export function SprinklerControl({ index, fireOn, fuzzySprinkler, device, pending, error, onSetMode, onToggleManual }: Props) {
  const mode = device?.mode ?? 'auto';
  const manualActive = device?.manual_active ?? false;

  // Sprinkler active when: auto + (sensor api ATAU fuzzy mamdani), OR manual + manual_active
  const active = mode === 'auto' ? (fireOn || fuzzySprinkler) : manualActive;

  return (
    <div
      className={`relative rounded-xl border p-3 transition-all overflow-hidden ${
        active
          ? 'border-primary/60 bg-primary/5 shadow-glow'
          : 'border-bg-line bg-bg-card hover:border-slate-600'
      }`}
    >
      {/* Fire animation */}
      {fireOn && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center overflow-hidden">
          <div className="animate-flame mb-8">
            <Flame3D className="w-9 h-9 drop-shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
          </div>
        </div>
      )}

      <div className="relative flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-300">Fire {index}</span>
        <div
          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
            fireOn ? 'bg-danger/30 text-danger' : 'bg-slate-700/50 text-slate-400'
          }`}
        >
          {fireOn ? 'API' : 'NO FIRE'}
        </div>
      </div>

      {/* Sprinkler visualization */}
      <div className="relative h-16 flex items-center justify-center mb-2">
        <div
          className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors ${
            active ? 'border-primary bg-primary/20' : 'border-slate-600 bg-slate-800/50'
          }`}
        >
          <Drop3D className={`w-7 h-7 ${active ? '' : 'opacity-40 grayscale'}`} />
        </div>
        {/* Water spray droplets */}
        {active && (
          <div className="pointer-events-none absolute inset-0">
            <span className="absolute top-7 left-1/2 -translate-x-6 w-1 h-1 rounded-full bg-primary-light animate-water" />
            <span className="absolute top-7 left-1/2 -translate-x-2 w-1 h-1 rounded-full bg-primary-light animate-water [animation-delay:0.1s]" />
            <span className="absolute top-7 left-1/2 translate-x-2 w-1 h-1 rounded-full bg-primary-light animate-water [animation-delay:0.2s]" />
            <span className="absolute top-7 left-1/2 translate-x-6 w-1 h-1 rounded-full bg-primary-light animate-water [animation-delay:0.15s]" />
          </div>
        )}
      </div>

      <div className="relative text-center text-xs font-semibold mb-2">
        <span className={active ? 'text-primary-light' : 'text-slate-500'}>
          Sprinkler {index}
        </span>
      </div>

      {/* Mode toggle */}
      <div className="relative flex rounded-lg bg-bg-soft border border-bg-line p-0.5 mb-2">
        <button
          onClick={() => onSetMode('auto')}
          disabled={pending}
          className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === 'auto' ? 'bg-primary text-white' : 'text-slate-400 hover:text-slate-200'
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

      {/* Manual control */}
      {mode === 'manual' && (
        <button
          onClick={() => onToggleManual(!manualActive)}
          disabled={pending}
          className={`relative w-full py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed ${
            manualActive
              ? 'bg-primary text-white shadow-glow'
              : 'bg-bg-line text-slate-400 hover:text-slate-200'
          }`}
        >
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
          {manualActive ? 'AKTIF' : 'MATI'}
        </button>
      )}
      {mode === 'auto' && (
        <div className="relative text-center text-[10px] text-slate-500 py-1.5">
          Auto: aktif saat api terdeteksi / perintah fuzzy
        </div>
      )}
      {error && (
        <div className="relative text-center text-[10px] text-danger mt-1">{error}</div>
      )}
    </div>
  );
}
