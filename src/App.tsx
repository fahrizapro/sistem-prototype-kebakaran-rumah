import { useState, useEffect, useRef } from 'react';
import {
  type DeviceId,
  type AppSettings,
  type DangerLevel,
  type EventType,
  evalDanger,
  logEvent,
  subscribeDevicesData,
  subscribeSettings,
  setDeviceMode as dbSetDeviceMode,
  setDeviceManualActive as dbSetDeviceManualActive,
  setDeviceFanManualLevel as dbSetDeviceFanManualLevel,
  ensureSeed,
  DEFAULT_SETTINGS,
} from '@/lib/db';
import { HousePanel } from '@/components/HousePanel';
import { SettingsModal } from '@/components/SettingsModal';
import { InfoModal } from '@/components/InfoModal';
import { EventLogModal } from '@/components/EventLogModal';
import { DeviceManagerModal } from '@/components/DeviceManagerModal';
import {
  Flame3D,
  Home3D,
  ShieldAlert3D,
  AlertTriangle3D,
  ShieldCheck3D,
  Gear3D,
  Info3D,
  Scroll3D,
  Chip3D,
  Bell3D,
} from './components/icons';
import { Menu, ChevronLeft, X, ShieldOff, Plus } from 'lucide-react';
import { TelegramModal } from './components/TelegramModal';

type Modal = null | 'settings' | 'info' | 'log' | 'devices' | 'telegram';

function App() {
  const [view, setView] = useState<'welcome' | 'dashboard'>('welcome');
  const [selectedId, setSelectedId] = useState<DeviceId | null>(null);
  const [rooms, setRooms] = useState<Record<DeviceId, import('@/lib/db').RoomData>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  // Konektivitas per device: waktu (ms) terakhir device mengirim data STATUS baru.
  // ESP32 push status tiap ~1 dtk — bila tanpa data > 15 dtk, anggap offline.
  const [deviceSeen, setDeviceSeen] = useState<Record<string, number>>({});
  const lastUaRef = useRef<Record<string, string>>({});

  // pencicil re-render tiap 5 dtk supaya umur "terakhir update" di layar segar
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((c) => c + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const prevLevelRef = useRef<Record<DeviceId, DangerLevel>>({});

  // Daftar device urut nama tampilan
  const deviceIds = Object.keys(rooms).sort((a, b) => {
    const na = rooms[a]?.meta?.name ?? a;
    const nb = rooms[b]?.meta?.name ?? b;
    return na.localeCompare(nb) || a.localeCompare(b);
  });

  // Status koneksi per device: ESP32 push status tiap ~1 dtk
  const ONLINE_WINDOW_MS = 15000;
  const onlineMap: Record<string, { online: boolean; seenAgoSec: number | null }> = {};
  deviceIds.forEach((id) => {
    const t = deviceSeen[id];
    if (t === undefined) {
      onlineMap[id] = { online: false, seenAgoSec: null };
    } else {
      const ago = Math.round((Date.now() - t) / 1000);
      onlineMap[id] = { online: ago * 1000 < ONLINE_WINDOW_MS, seenAgoSec: ago };
    }
  });

  function devKey(deviceId: DeviceId, device: string) {
    return `${deviceId}:${device}`;
  }

  function patchDevice(deviceId: DeviceId, device: string, patch: Partial<import('@/lib/db').DeviceState>) {
    setRooms((prev) => {
      const room = prev[deviceId];
      if (!room) return prev;
      return {
        ...prev,
        [deviceId]: {
          ...room,
          devices: room.devices.map((d) => (d.device === device ? { ...d, ...patch } : d)),
        },
      };
    });
  }

  useEffect(() => {
    let mounted = true;

    // Seed settings default sekali (device didaftarkan via menu Kelola Perangkat)
    ensureSeed().catch((e) => console.warn('Seed RTDB gagal:', e));

    // Realtime: seluruh data device (meta + status sensor + aktuator) via satu listener
    const unsubDevices = subscribeDevicesData((data) => {
      if (!mounted) return;
      setRooms(data);
      setLoading(false);
      setLastSync(new Date());
      // tandai device yang baru mengirim data status (nilai updated_at berubah)
      setDeviceSeen((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(data).forEach(([id, room]) => {
          const ua = room.status?.updated_at;
          if (ua && ua !== lastUaRef.current[id]) {
            lastUaRef.current[id] = ua;
            if (next[id] !== Date.now()) { next[id] = Date.now(); }
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });

    // Realtime: pengaturan threshold/delay
    const unsubSettings = subscribeSettings((s) => {
      if (!mounted || !s) return;
      setSettings(s);
      setLastSync(new Date());
    });

    return () => {
      mounted = false;
      unsubDevices();
      unsubSettings();
    };
  }, []);

  // Log events when danger level changes per device
  useEffect(() => {
    deviceIds.forEach((id) => {
      const room = rooms[id];
      const s = room?.status;
      if (!s || !room) return;
      const { level, reasons } = evalDanger(s, settings);
      const prev = prevLevelRef.current[id] ?? 'safe';
      if (level !== prev) {
        prevLevelRef.current[id] = level;
        const name = room.meta?.name ?? id;
        if (level === 'danger') {
          logEvent(id, name, 'fire', 'danger', `BAHAYA: ${reasons.join(', ')}`);
        } else if (level === 'warning') {
          const type: EventType =
            s.smoke_mq2 >= settings.smoke_threshold ? 'smoke' :
            s.gas_mq6 >= settings.gas_threshold ? 'gas' : 'temperature';
          logEvent(id, name, type, 'warning', `Waspada: ${reasons.join(', ')}`);
        } else if (prev !== 'safe') {
          logEvent(id, name, 'system', 'info', `Kondisi kembali aman`);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, settings]);

  async function setDeviceMode(deviceId: DeviceId, device: string, mode: 'auto' | 'manual') {
    const key = devKey(deviceId, device);
    const room = rooms[deviceId];
    const prevDev = room?.devices.find((d) => d.device === device);
    setPending((p) => new Set(p).add(key));
    setErrors((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
    patchDevice(deviceId, device, { mode, updated_at: new Date().toISOString() });
    try {
      await dbSetDeviceMode(deviceId, device as import('@/lib/db').DeviceName, mode);
      logEvent(deviceId, room?.meta?.name ?? deviceId, 'system', 'info', `${device} diubah ke mode ${mode}`);
    } catch {
      setErrors((e) => ({ ...e, [key]: 'Gagal mengubah mode' }));
      if (prevDev) patchDevice(deviceId, device, { mode: prevDev.mode });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }

  async function setDeviceFanManualLevel(deviceId: DeviceId, level: 'flow' | 'boost') {
    const key = devKey(deviceId, 'fan1');
    const room = rooms[deviceId];
    const prevDev = room?.devices.find((d) => d.device === 'fan1');
    setPending((p) => new Set(p).add(key));
    setErrors((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
    patchDevice(deviceId, 'fan1', { manual_active: true, manual_level: level, updated_at: new Date().toISOString() });
    try {
      await dbSetDeviceFanManualLevel(deviceId, level);
      logEvent(deviceId, room?.meta?.name ?? deviceId, 'system', 'info', `Kipas manual ke ${level.toUpperCase()}`);
    } catch {
      setErrors((e) => ({ ...e, [key]: 'Gagal mengubah level kipas' }));
      if (prevDev) patchDevice(deviceId, 'fan1', { manual_active: prevDev.manual_active, manual_level: prevDev.manual_level });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }

  async function setDeviceManualActive(deviceId: DeviceId, device: string, manual_active: boolean) {
    const key = devKey(deviceId, device);
    const room = rooms[deviceId];
    const prevDev = room?.devices.find((d) => d.device === device);
    setPending((p) => new Set(p).add(key));
    setErrors((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
    patchDevice(deviceId, device, { manual_active, updated_at: new Date().toISOString() });
    try {
      await dbSetDeviceManualActive(deviceId, device as import('@/lib/db').DeviceName, manual_active);
      logEvent(deviceId, room?.meta?.name ?? deviceId, 'system', 'info', `${device} ${manual_active ? 'diaktifkan manual' : 'dimatikan manual'}`);
    } catch {
      setErrors((e) => ({ ...e, [key]: 'Gagal mengaktifkan' }));
      if (prevDev) patchDevice(deviceId, device, { manual_active: prevDev.manual_active });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }

  function handleSaveSettings(s: AppSettings) {
    setSettings(s);
    deviceIds.forEach((id) => {
      logEvent(id, rooms[id]?.meta?.name ?? id, 'system', 'info', 'Pengaturan sistem diperbarui');
    });
  }

  function openDevice(id: DeviceId) {
    setSelectedId(id);
    setView('dashboard');
  }

  function backToWelcome() {
    setView('welcome');
    setSelectedId(null);
  }

  const dangerLevels = deviceIds
    .map((id) => (rooms[id]?.status ? evalDanger(rooms[id].status!, settings).level : 'safe' as const));
  const overallLevel: DangerLevel = dangerLevels.includes('danger')
    ? 'danger'
    : dangerLevels.includes('warning')
      ? 'warning'
      : 'safe';

  // ===================== Welcome Screen =====================
  if (view === 'welcome') {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <div className="max-w-[1100px] mx-auto w-full px-4 md:px-6 py-6 flex-1 flex flex-col">
          {/* Header */}
          <header className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-glow animate-float">
                <Flame3D className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                  Sistem Prototype Kebakaran Rumah
                </h1>
                <p className="text-xs text-slate-400">Pemantau & Pemadam Kebakaran Berbasis ESP32</p>
              </div>
            </div>
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-14 h-14 rounded-2xl border border-bg-line bg-bg-card hover:border-primary/50 hover:text-primary-light flex items-center justify-center text-slate-300 transition-colors shadow-card"
              aria-label="Menu"
            >
              <Menu className="w-7 h-7" />
            </button>
          </header>

          {/* Hero */}
          <div className="flex-1 flex flex-col items-center justify-center text-center mb-10">
            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/20 to-primary-dark/20 border border-primary/30 flex items-center justify-center animate-float">
                <Flame3D className="w-16 h-16" />
              </div>
              <div className="absolute -inset-2 rounded-3xl bg-primary/10 blur-2xl -z-10" />
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-3 tracking-tight">
              Selamat Datang
            </h2>
            <p className="text-slate-400 max-w-md mb-2">
              Pilih perangkat yang ingin Anda pantau. Setiap device memiliki sistem sensor dan pemadam kebakaran yang identik.
            </p>
            {!loading && (
              <div className="mt-2 mb-8 text-xs text-slate-500">
                {lastSync ? `Sinkron terakhir: ${lastSync.toLocaleTimeString('id-ID')}` : 'Menunggu data...'}
              </div>
            )}
          </div>

          {/* Device selection cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8 max-w-2xl mx-auto w-full">
            {deviceIds.map((id) => {
              const room = rooms[id];
              const name = room?.meta?.name ?? id;
              const status = room?.status ?? null;
              const danger = status ? evalDanger(status, settings) : { level: 'safe' as const, reasons: [] };
              const net = onlineMap[id] ?? { online: false, seenAgoSec: null as number | null };
              return (
                <button
                  key={id}
                  onClick={() => openDevice(id)}
                  className="group relative rounded-2xl border border-bg-line bg-bg-card p-6 text-left hover:border-primary/50 hover:shadow-glow transition-all animate-fade-in-up overflow-hidden"
                >
                  {/* Glow accent */}
                  <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl transition-opacity ${
                    danger.level === 'danger' ? 'bg-danger/20' : danger.level === 'warning' ? 'bg-warning/15' : 'bg-primary/15'
                  }`} />

                  <div className="relative flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${
                      danger.level === 'danger'
                        ? 'bg-danger/20'
                        : danger.level === 'warning'
                          ? 'bg-warning/20'
                          : 'bg-primary/20'
                    }`}>
                      <Home3D className="w-10 h-10" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold text-white truncate">{name}</h3>
                      <p className="text-xs text-slate-500 font-mono truncate">{id}</p>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="relative mt-4 flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold ${
                        danger.level === 'danger'
                          ? 'bg-danger/20 text-danger'
                          : danger.level === 'warning'
                            ? 'bg-warning/20 text-warning'
                            : 'bg-safe/15 text-safe'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${
                        danger.level === 'danger' ? 'bg-danger animate-pulse' : danger.level === 'warning' ? 'bg-warning' : 'bg-safe'
                      }`} />
                      {danger.level === 'danger' ? 'BAHAYA' : danger.level === 'warning' ? 'WASPADA' : 'AMAN'}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold ${
                        net.online ? 'bg-safe/15 text-safe' : 'bg-danger/15 text-danger'
                      }`}
                      title={net.seenAgoSec != null ? `Data terakhir ${net.seenAgoSec} detik lalu` : 'Belum ada data status'}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${net.online ? 'bg-safe animate-pulse' : 'bg-danger'}`} />
                      {net.online ? 'Online' : 'Offline'}
                    </span>
                    <span className="text-slate-500 group-hover:text-primary-light group-hover:translate-x-1 transition-all text-sm font-medium flex items-center gap-1">
                      Masuk <ChevronLeft className="w-4 h-4 rotate-180" />
                    </span>
                  </div>

                  {/* Quick stats */}
                  {status && (
                    <div className="relative mt-4 pt-4 border-t border-bg-line grid grid-cols-3 gap-2 text-center">
                      <QuickStat label="Suhu" value={`${status.temperature.toFixed(1)}°C`} />
                      <QuickStat label="Asap" value={`${status.smoke_mq2.toFixed(0)}`} />
                      <QuickStat label="Gas" value={`${status.gas_mq6.toFixed(0)} ppm`} />
                    </div>
                  )}
                </button>
              );
            })}

            {/* Empty state */}
            {!loading && deviceIds.length === 0 && (
              <button
                onClick={() => setModal('devices')}
                className="group relative rounded-2xl border border-dashed border-bg-line bg-bg-card p-6 text-left hover:border-primary/50 hover:shadow-glow transition-all overflow-hidden"
              >
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-bg-soft flex items-center justify-center">
                    <Plus className="w-8 h-8 text-slate-500 group-hover:text-primary-light transition-colors" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Belum ada perangkat</h3>
                    <p className="text-sm text-slate-400">Daftarkan ESP32 Anda di menu Kelola Perangkat</p>
                  </div>
                </div>
              </button>
            )}
          </div>

          <footer className="text-center text-xs text-slate-500 pb-2">
            Dashboard pemantau kebakaran · Terhubung ke ESP32 via Firebase Realtime Database
          </footer>
        </div>

        {/* Full-height drawer menu */}
        <DrawerMenu open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={setModal} />

        {/* Modals (also available from welcome view) */}
        <SettingsModal
          open={modal === 'settings'}
          onClose={() => setModal(null)}
          settings={settings}
          onSave={handleSaveSettings}
        />
        <DeviceManagerModal open={modal === 'devices'} onClose={() => setModal(null)} />
        <TelegramModal open={modal === 'telegram'} onClose={() => setModal(null)} />
        <InfoModal open={modal === 'info'} onClose={() => setModal(null)} settings={settings} />
        <EventLogModal open={modal === 'log'} onClose={() => setModal(null)} />
      </div>
    );
  }

  // ===================== Dashboard View =====================
  const room = selectedId ? rooms[selectedId] : null;
  const name = room?.meta?.name ?? selectedId ?? 'Dashboard';
  const statusLabel = overallLevel === 'danger' ? 'BAHAYA' : overallLevel === 'warning' ? 'PERHATIAN' : 'AMAN';
  const statusColor =
    overallLevel === 'danger' ? 'text-danger' : overallLevel === 'warning' ? 'text-warning' : 'text-safe';

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 py-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={backToWelcome}
              className="w-11 h-11 rounded-xl border border-bg-line bg-bg-card hover:border-slate-600 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
              aria-label="Kembali"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-glow">
              <Flame3D className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                {name}
              </h1>
              <p className="text-sm text-slate-400 font-mono">
                {selectedId ?? 'Dashboard'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`px-5 py-2.5 rounded-xl border bg-bg-card/70 backdrop-blur flex items-center gap-2 ${
                overallLevel === 'danger'
                  ? 'border-danger/60 animate-danger-pulse'
                  : overallLevel === 'warning'
                    ? 'border-warning/50 animate-warning-pulse'
                    : 'border-safe/40 shadow-glow-safe'
              }`}
            >
              <div
                className={`w-3 h-3 rounded-full ${
                  overallLevel === 'danger'
                    ? 'bg-danger animate-pulse'
                    : overallLevel === 'warning'
                      ? 'bg-warning'
                      : 'bg-safe'
                }`}
              />
              <span className={`text-base font-bold ${statusColor}`}>{statusLabel}</span>
            </div>
            <div className="text-xs text-slate-500 text-right hidden sm:block">
              <div>Live sync</div>
              <div className="text-slate-400 font-mono">
                {lastSync ? lastSync.toLocaleTimeString('id-ID') : '--'}
              </div>
            </div>

            {/* Bigger 3-line menu */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-14 h-14 rounded-2xl border border-bg-line bg-bg-card hover:border-primary/50 hover:text-primary-light flex items-center justify-center text-slate-300 transition-colors shadow-card"
              aria-label="Menu"
            >
              <Menu className="w-7 h-7" />
            </button>
          </div>
        </header>

        {/* Status banner */}
        <div
          className={`mb-6 rounded-2xl p-4 border flex items-center gap-3 transition-colors ${
            overallLevel === 'danger'
              ? 'bg-danger/10 border-danger/40'
              : overallLevel === 'warning'
                ? 'bg-warning/10 border-warning/40'
                : 'bg-safe/10 border-safe/30'
          }`}
        >
          <StatusIcon level={overallLevel} className="w-7 h-7 flex-shrink-0" />
          <p className="text-sm text-slate-200">
            {overallLevel === 'danger' && 'Bahaya terdeteksi! Sistem pemadam otomatis aktif.'}
            {overallLevel === 'warning' &&
              'Potensi bahaya terdeteksi. Kipas ventilasi aktif, pantau kondisi.'}
            {overallLevel === 'safe' &&
              'Perangkat dalam kondisi aman. Sistem monitoring aktif.'}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : selectedId ? (
          <div className="max-w-2xl mx-auto">
            <HousePanel
              deviceId={selectedId}
              name={name}
              status={room?.status ?? null}
              settings={settings}
              devices={room?.devices ?? []}
              pending={pending}
              errors={errors}
              onSetMode={setDeviceMode}
              onSetManualActive={setDeviceManualActive}
              onSetFanManualLevel={setDeviceFanManualLevel}
              online={onlineMap[selectedId]?.online ?? false}
              lastSeenSec={onlineMap[selectedId]?.seenAgoSec ?? null}
            />
          </div>
        ) : null}

        <footer className="mt-8 pt-6 border-t border-bg-line text-center text-xs text-slate-500">
          Dashboard pemantau kebakaran · Terhubung ke ESP32 via Firebase Realtime Database
        </footer>
      </div>

      {/* Full-height drawer menu */}
      <DrawerMenu
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={setModal}
        onBackToWelcome={backToWelcome}
        showHomeOption={view === 'dashboard'}
      />

      {/* Modals */}
      <SettingsModal
        open={modal === 'settings'}
        onClose={() => setModal(null)}
        settings={settings}
        onSave={handleSaveSettings}
      />
      <DeviceManagerModal open={modal === 'devices'} onClose={() => setModal(null)} />
      <TelegramModal open={modal === 'telegram'} onClose={() => setModal(null)} />
      <InfoModal open={modal === 'info'} onClose={() => setModal(null)} settings={settings} />
      <EventLogModal open={modal === 'log'} onClose={() => setModal(null)} />
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-mono text-slate-300">{value}</div>
    </div>
  );
}

function DrawerMenu({
  open,
  onClose,
  onNavigate,
  onBackToWelcome,
  showHomeOption,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (m: Modal) => void;
  onBackToWelcome?: () => void;
  showHomeOption?: boolean;
}) {
  if (!open) return null;

  function navigate(m: Modal) {
    onClose();
    onNavigate(m);
  }

  function handleHome() {
    onClose();
    onBackToWelcome?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-72 sm:w-80 bg-bg-card border-l border-bg-line shadow-card flex flex-col animate-fade-in-up">
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-bg-line flex-shrink-0">
          <div className="flex items-center gap-2">
            <Flame3D className="w-7 h-7" />
            <span className="text-lg font-bold text-white">Menu</span>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-bg-line transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer items - flex-1 fills to bottom */}
        <div className="flex-1 flex flex-col py-2 overflow-y-auto">
          {showHomeOption && (
            <DrawerItem
              icon={<Home3D className="w-6 h-6" />}
              label="Beranda"
              desc="Pilih perangkat lain"
              onClick={handleHome}
            />
          )}
          <DrawerItem
            icon={<Gear3D className="w-6 h-6" />}
            label="Pengaturan"
            desc="Threshold & delay pompa/kipas"
            onClick={() => navigate('settings')}
          />
          <DrawerItem
            icon={<Scroll3D className="w-6 h-6" />}
            label="Log Kejadian"
            desc="Riwayat peristiwa sistem"
            onClick={() => navigate('log')}
          />
          <DrawerItem
            icon={<Chip3D className="w-6 h-6" />}
            label="Kelola Perangkat"
            desc="Tambah / hapus device ESP32"
            onClick={() => navigate('devices')}
          />
          <DrawerItem
            icon={<Bell3D className="w-6 h-6" />}
            label="Notifikasi Telegram"
            desc="Bot token & daftar penerima"
            onClick={() => navigate('telegram')}
          />
          <DrawerItem
            icon={<Info3D className="w-6 h-6" />}
            label="Informasi"
            desc="Tentang sistem & ESP32"
            onClick={() => navigate('info')}
          />
        </div>

        {/* Drawer footer */}
        <div className="px-5 py-4 border-t border-bg-line flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldOff className="w-4 h-4" />
            <span>Sistem Prototype Kebakaran Rumah v2.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DrawerItem({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-bg-soft transition-colors group"
    >
      <span className="w-11 h-11 rounded-xl bg-bg-soft group-hover:bg-primary/20 flex items-center justify-center transition-colors flex-shrink-0">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
    </button>
  );
}

function StatusIcon({ level, className }: { level: DangerLevel; className?: string }) {
  if (level === 'danger') return <ShieldAlert3D className={className} />;
  if (level === 'warning') return <AlertTriangle3D className={className} />;
  return <ShieldCheck3D className={className} />;
}

export default App;
