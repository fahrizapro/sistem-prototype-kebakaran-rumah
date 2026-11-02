import { useEffect, useState } from 'react';
import { subscribeEvents, clearEvents, type EventLogEntry } from '@/lib/db';
import { ModalShell } from './SettingsModal';
import { Scroll3D, Flame3D, Smoke3D, Thermo3D, Gas3D, AlertTriangle3D } from './icons';
import { Trash2, Loader2 } from 'lucide-react';

export function EventLogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;

    // Realtime: 200 event terakhir (push keys kronologis, terbaru di atas)
    const unsub = subscribeEvents((logs) => {
      if (!mounted) return;
      setLogs(logs);
      setLoading(false);
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [open]);

  async function handleClear() {
    setClearing(true);
    try {
      await clearEvents();
      setLogs([]);
    } catch (e) {
      console.warn('Gagal membersihkan log:', e);
    } finally {
      setClearing(false);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Log Kejadian" icon={<Scroll3D className="w-6 h-6" />} wide>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-400">
          Riwayat kejadian terbaru ({logs.length} entri)
        </p>
        <button
          onClick={handleClear}
          disabled={clearing || logs.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-line text-slate-300 text-xs hover:text-danger transition-colors disabled:opacity-50"
        >
          {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Bersihkan
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            Belum ada kejadian tercatat.
          </div>
        ) : (
          logs.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </ModalShell>
  );
}

function LogRow({ log }: { log: EventLogEntry }) {
  const sev =
    log.severity === 'danger'
      ? 'border-danger/40 bg-danger/5'
      : log.severity === 'warning'
        ? 'border-warning/40 bg-warning/5'
        : 'border-bg-line bg-bg-soft';

  const sevColor =
    log.severity === 'danger' ? 'text-danger' : log.severity === 'warning' ? 'text-warning' : 'text-slate-400';

  const icon = (() => {
    switch (log.event_type) {
      case 'fire': return <Flame3D className="w-5 h-5" />;
      case 'smoke': return <Smoke3D className="w-5 h-5" />;
      case 'gas': return <Gas3D className="w-5 h-5" />;
      case 'temperature': return <Thermo3D className="w-5 h-5" />;
      default: return <AlertTriangle3D className="w-5 h-5" />;
    }
  })();

  return (
    <div className={`flex items-start gap-3 rounded-lg border ${sev} p-3`}>
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-200">
            {log.device_name || log.device_id}
          </span>
          <span className={`text-[10px] uppercase font-bold ${sevColor}`}>{log.severity}</span>
        </div>
        <p className="text-sm text-slate-300 mt-0.5">{log.message}</p>
      </div>
      <div className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
        {new Date(log.created_at).toLocaleString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </div>
    </div>
  );
}
