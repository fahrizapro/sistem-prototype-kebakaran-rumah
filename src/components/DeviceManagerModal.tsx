import { useEffect, useState } from 'react';
import { subscribeDeviceMetas, addDevice, removeDevice, type DeviceMeta } from '@/lib/db';
import { ModalShell } from './SettingsModal';
import { Chip3D } from './icons';
import { Plus, Trash2, Loader2, Check, Cpu } from 'lucide-react';

export function DeviceManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [metas, setMetas] = useState<DeviceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const unsub = subscribeDeviceMetas((rows) => {
      if (!mounted) return;
      setMetas(rows);
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [open]);

  async function handleDelete(meta: DeviceMeta) {
    if (!confirm(`Hapus device "${meta.name}" (ID: ${meta.id})? Status sensor & kontrol aktuator device ini juga akan terhapus.`)) return;
    try {
      await removeDevice(meta.id);
    } catch (e) {
      console.warn('Gagal menghapus device:', e);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Kelola Perangkat" icon={<Chip3D className="w-6 h-6" />}>
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-400 pr-2">
            Daftar device ESP32. Program ESP32 semua identik — dibedakan hanya oleh <strong className="text-slate-300">Device ID</strong> yang dikompilasi ke tiap unit.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> Tambah
          </button>
        </div>

        {showForm ? (
          <DeviceForm onCancel={() => setShowForm(false)} onSaved={() => setShowForm(false)} />
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {metas.map((meta) => (
              <DeviceRow key={meta.id} meta={meta} onDelete={() => handleDelete(meta)} />
            ))}
            {metas.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-sm">
                Belum ada device. Klik "Tambah" untuk mendaftarkan ESP32.
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function DeviceRow({ meta, onDelete }: { meta: DeviceMeta; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-bg-line bg-bg-soft p-3">
      <div className="w-9 h-9 rounded-lg bg-bg-card flex items-center justify-center flex-shrink-0">
        <Cpu className="w-4 h-4 text-primary-light" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{meta.name}</div>
        <div className="text-xs text-slate-500 font-mono truncate">ID: {meta.id}</div>
      </div>
      <button onClick={onDelete} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-danger hover:bg-bg-line transition-colors flex-shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function DeviceForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceId.trim() || !name.trim()) {
      setError('ID device dan nama wajib diisi.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDevice(deviceId, name);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah device.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Tambah Device</h3>
        <button type="button" onClick={onCancel} className="text-xs text-slate-400 hover:text-white transition-colors">Batal</button>
      </div>

      <Field label="ID Device (ESP32)">
        <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="contoh: ESP32-A" className="input-base font-mono text-sm" />
        <Hint>Identitas unik yang dikompilasi ke program ESP32. Path Firebase: devices/&#123;ID&#125;/...</Hint>
      </Field>

      <Field label="Nama Device">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="contoh: Rumah A" className="input-base" />
        <Hint>Nama yang tampil di dashboard (mis. nama rumah/lokasi).</Hint>
      </Field>

      <div className="rounded-xl border border-bg-line bg-bg-soft p-3 text-xs text-slate-400">
        Device baru otomatis mendapat aktuator bawaan yang sama dengan device lain:
        <strong className="text-slate-300"> 4 Sprinkler + 1 Kipas</strong>, serta node status sensor untuk ESP32.
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-bg-line text-slate-300 text-sm hover:text-white transition-colors">Batal</button>
        <div className="flex-1" />
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Tambah
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-slate-500 mt-1">{children}</p>;
}
