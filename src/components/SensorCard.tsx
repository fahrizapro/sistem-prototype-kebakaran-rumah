import { Thermometer, Wind } from 'lucide-react';

interface Props {
  title: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  tone: 'neutral' | 'warning' | 'danger';
  hint?: string;
  decimals?: number;
}

const toneStyles = {
  neutral: {
    ring: 'border-bg-line',
    value: 'text-white',
    bg: 'bg-bg-card',
  },
  warning: {
    ring: 'border-warning/50',
    value: 'text-warning',
    bg: 'bg-warning/5',
  },
  danger: {
    ring: 'border-danger/50',
    value: 'text-danger',
    bg: 'bg-danger/5',
  },
};

export function SensorCard({ title, value, unit, icon, tone, hint, decimals = 0 }: Props) {
  const t = toneStyles[tone];
  return (
    <div
      className={`relative rounded-xl border ${t.ring} ${t.bg} p-4 transition-all overflow-hidden ${
        tone === 'danger' ? 'animate-danger-pulse' : tone === 'warning' ? 'animate-warning-pulse' : ''
      }`}
    >
      {/* Smoke animation overlay for danger gas/smoke */}
      {tone === 'danger' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute bottom-2 left-4 w-6 h-6 rounded-full bg-slate-400/30 blur-md animate-smoke" />
          <span className="absolute bottom-2 right-6 w-5 h-5 rounded-full bg-slate-400/30 blur-md animate-smoke [animation-delay:0.8s]" />
        </div>
      )}

      <div className="relative flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</span>
        <span className="text-slate-500">{icon}</span>
      </div>
      <div className="relative flex items-baseline gap-1">
        <span className={`text-3xl font-bold font-mono ${t.value}`}>{value.toFixed(decimals)}</span>
        <span className="text-sm text-slate-400 font-medium">{unit}</span>
      </div>
      {hint && <div className="relative mt-1 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}
