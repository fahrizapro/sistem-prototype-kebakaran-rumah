import {
  ref,
  onValue,
  set,
  update,
  push,
  remove,
  get,
  query,
  limitToLast,
} from 'firebase/database';
import { getDb } from './firebase';

// Koneksi database diambil lazy — aman saat config .env belum diisi
// (aplikasi menampilkan layar setup, tidak crash).
function rdb() {
  return getDb();
}

// ===================== Types =====================

/** ID device — dipakai ESP32 sebagai identitas. Program ESP32 semua sama, hanya ID yang beda. */
export type DeviceId = string;

/** Aktuator bawaan: sama untuk semua device (4 sprinkler + 1 kipas). */
export type DeviceName =
  | 'sprinkler1'
  | 'sprinkler2'
  | 'sprinkler3'
  | 'sprinkler4'
  | 'fan1';

export interface DeviceMeta {
  id: DeviceId;
  name: string; // tampilan, mis. "Rumah A"
  created_at: string;
  updated_at: string;
}

export interface HouseStatus {
  device_id: DeviceId;
  temperature: number;
  smoke_mq2: number;
  gas_mq6: number;
  fire1: boolean;
  fire2: boolean;
  fire3: boolean;
  fire4: boolean;
  updated_at: string;
}

export interface DeviceState {
  device_id: DeviceId;
  device: DeviceName;
  mode: 'auto' | 'manual';
  manual_active: boolean;
  /** Khusus fan1: level saat mode manual — FLOW (relay off) / BOOST (relay on) */
  manual_level: 'flow' | 'boost';
  updated_at: string;
}

export const DEVICE_LABELS: Record<DeviceName, string> = {
  sprinkler1: 'Sprinkler 1',
  sprinkler2: 'Sprinkler 2',
  sprinkler3: 'Sprinkler 3',
  sprinkler4: 'Sprinkler 4',
  fan1: 'Kipas 1',
};

export interface RoomData {
  meta: DeviceMeta | null;
  status: HouseStatus | null;
  devices: DeviceState[];
}

export type RoomsData = Record<DeviceId, RoomData>;

export interface AppSettings {
  temp_threshold: number;
  smoke_threshold: number;
  gas_threshold: number;
  sprinkler_delay: number;
  fan_delay: number;
  fan_duration: number;
  // ===== Fuzzy Mamdani (L = batas rendah/aman, H = batas tinggi/bahaya) =====
  fuzzy_temp_aman: number;    // °C
  fuzzy_temp_bahaya: number;  // °C
  fuzzy_smoke_rendah: number; // ppm
  fuzzy_smoke_tinggi: number; // ppm
  fuzzy_gas_rendah: number;   // ppm
  fuzzy_gas_tinggi: number;   // ppm
  fuzzy_fan_flow: number;     // % PWM saat FLOW (jika kipas PWM)
  fan_idle_mode: 'flow' | 'off'; // perilaku kipas saat hanya aturan FLOW yang menyala
  updated_at: string;
  telegram?: TelegramSettings | null;
}

export interface TelegramRecipientData {
  label: string;
}

export interface TelegramSettings {
  bot_token: string;
  enabled: boolean;
  recipients: Record<string, TelegramRecipientData>; // key = chat ID (grup = negatif)
}

export const DEFAULT_SETTINGS: AppSettings = {
  temp_threshold: 50,
  smoke_threshold: 1000,
  gas_threshold: 2000, // ppm
  sprinkler_delay: 3,
  fan_delay: 2,
  fan_duration: 30,
  fuzzy_temp_aman: 35,
  fuzzy_temp_bahaya: 55,
  fuzzy_smoke_rendah: 400,
  fuzzy_smoke_tinggi: 600,
  fuzzy_gas_rendah: 500,
  fuzzy_gas_tinggi: 2000,
  fuzzy_fan_flow: 50,
  fan_idle_mode: 'flow',
  updated_at: new Date().toISOString(),
  telegram: null,
};

export type EventType = 'fire' | 'smoke' | 'gas' | 'temperature' | 'system';
export type Severity = 'info' | 'warning' | 'danger';

export interface EventLogEntry {
  id: string;
  device_id: DeviceId;
  device_name: string;
  event_type: EventType;
  severity: Severity;
  message: string;
  created_at: string;
}

/** Gabungkan raw RTDB dengan default (kompatibel data lama). */
function normalizeSettings(raw: Record<string, unknown> | null): AppSettings {
  const r = raw ?? {};
  const gas = Number(r.gas_threshold ?? DEFAULT_SETTINGS.gas_threshold);
  // Migrasi unit: nilai lama memakai persen (≤ 100) → konversi ke ppm
  const gasThreshold = gas > 0 && gas <= 100 ? DEFAULT_SETTINGS.gas_threshold : gas;
  return {
    temp_threshold: Number(r.temp_threshold ?? DEFAULT_SETTINGS.temp_threshold),
    smoke_threshold: Number(r.smoke_threshold ?? DEFAULT_SETTINGS.smoke_threshold),
    gas_threshold: gasThreshold,
    sprinkler_delay: Number(r.sprinkler_delay ?? DEFAULT_SETTINGS.sprinkler_delay),
    fan_delay: Number(r.fan_delay ?? DEFAULT_SETTINGS.fan_delay),
    fan_duration: Number(r.fan_duration ?? DEFAULT_SETTINGS.fan_duration),
    fuzzy_temp_aman: Number(r.fuzzy_temp_aman ?? DEFAULT_SETTINGS.fuzzy_temp_aman),
    fuzzy_temp_bahaya: Number(r.fuzzy_temp_bahaya ?? DEFAULT_SETTINGS.fuzzy_temp_bahaya),
    fuzzy_smoke_rendah: Number(r.fuzzy_smoke_rendah ?? DEFAULT_SETTINGS.fuzzy_smoke_rendah),
    fuzzy_smoke_tinggi: Number(r.fuzzy_smoke_tinggi ?? DEFAULT_SETTINGS.fuzzy_smoke_tinggi),
    fuzzy_gas_rendah: Number(r.fuzzy_gas_rendah ?? DEFAULT_SETTINGS.fuzzy_gas_rendah),
    fuzzy_gas_tinggi: Number(r.fuzzy_gas_tinggi ?? DEFAULT_SETTINGS.fuzzy_gas_tinggi),
    fuzzy_fan_flow: Number(r.fuzzy_fan_flow ?? DEFAULT_SETTINGS.fuzzy_fan_flow),
    fan_idle_mode: r.fan_idle_mode === 'off' ? 'off' : 'flow',
    updated_at: String(r.updated_at ?? ''),
    telegram: (r.telegram as TelegramSettings) ?? null,
  };
}

// ===================== RTDB Paths =====================
//
// Struktur Realtime Database:
//   devices/{device_id}/meta               -> DeviceMeta (id device + nama, dikelola via web)
//   devices/{device_id}/status             -> HouseStatus (ditulis ESP32)
//   devices/{device_id}/actuators/{device} -> DeviceState (ditulis web, dibaca ESP32)
//   settings                               -> AppSettings (global, ditulis web & dibaca ESP32)
//   events/{pushId}                        -> EventLogEntry (append-only)
//
// Program ESP32 untuk semua device identik — dibedakan hanya oleh konstanta
// DEVICE_ID yang dikompilasi/dikirim ke tiap unit.
//
export const RTDB_PATHS = {
  devices: 'devices',
  device: (id: DeviceId) => `devices/${id}`,
  meta: (id: DeviceId) => `devices/${id}/meta`,
  status: (id: DeviceId) => `devices/${id}/status`,
  actuators: (id: DeviceId) => `devices/${id}/actuators`,
  actuator: (id: DeviceId, d: string) => `devices/${id}/actuators/${d}`,
  settings: 'settings',
  events: 'events',
};

const VALID_DEVICES: DeviceName[] = ['sprinkler1', 'sprinkler2', 'sprinkler3', 'sprinkler4', 'fan1'];

// RTDB path key tidak boleh mengandung . $ # [ ] / atau spasi
function assertSafeDeviceId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('ID device hanya boleh huruf, angka, tanda hubung (-), atau underscore (_). Contoh: ESP32-A');
  }
}

// ===================== Normalizers =====================

function normalizeMeta(id: DeviceId, raw: unknown): DeviceMeta {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id,
    name: String(r.name ?? id),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

function normalizeStatus(deviceId: DeviceId, raw: unknown): HouseStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    device_id: deviceId,
    temperature: Number(r.temperature ?? 0),
    smoke_mq2: Number(r.smoke_mq2 ?? 0),
    gas_mq6: Number(r.gas_mq6 ?? 0),
    fire1: Boolean(r.fire1),
    fire2: Boolean(r.fire2),
    fire3: Boolean(r.fire3),
    fire4: Boolean(r.fire4),
    updated_at: String(r.updated_at ?? ''),
  };
}

function normalizeActuators(deviceId: DeviceId, raw: unknown): DeviceState[] {
  const r = (raw ?? {}) as Record<string, Record<string, unknown>>;
  return VALID_DEVICES.map((device) => ({
    device_id: deviceId,
    device,
    mode: r[device]?.mode === 'manual' ? 'manual' : 'auto',
    manual_active: Boolean(r[device]?.manual_active),
    manual_level: r[device]?.manual_level === 'boost' ? 'boost' : 'flow',
    updated_at: String(r[device]?.updated_at ?? ''),
  }));
}

// ===================== Subscriptions =====================

export function subscribeDevicesData(callback: (rooms: RoomsData) => void): () => void {
  return onValue(ref(rdb(), RTDB_PATHS.devices), (snap) => {
    const raw = (snap.val() ?? {}) as Record<string, { meta?: unknown; status?: unknown; actuators?: unknown }>;
    const result: RoomsData = {};
    Object.keys(raw).forEach((id) => {
      result[id] = {
        meta: normalizeMeta(id, raw[id]?.meta),
        status: raw[id]?.status ? normalizeStatus(id, raw[id].status) : null,
        devices: normalizeActuators(id, raw[id]?.actuators),
      };
    });
    callback(result);
  });
}

/** Daftar meta device saja (untuk modal Kelola Perangkat), urut abjad. */
export function subscribeDeviceMetas(callback: (metas: DeviceMeta[]) => void): () => void {
  return onValue(ref(rdb(), RTDB_PATHS.devices), (snap) => {
    const raw = (snap.val() ?? {}) as Record<string, { meta?: unknown }>;
    const metas = Object.keys(raw).map((id) => normalizeMeta(id, raw[id]?.meta));
    metas.sort((a, b) => a.id.localeCompare(b.id));
    callback(metas);
  });
}

export function subscribeSettings(callback: (s: AppSettings) => void): () => void {
  return onValue(ref(rdb(), RTDB_PATHS.settings), (snap) => {
    const raw = (snap.val() ?? {}) as Record<string, unknown>;
    callback(normalizeSettings(Object.keys(raw).length > 0 ? raw : null));
  });
}

// ===================== Device management =====================

export async function addDevice(id: string, name: string): Promise<DeviceId> {
  const trimmed = id.trim();
  assertSafeDeviceId(trimmed);
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    [RTDB_PATHS.meta(trimmed)]: { name: name.trim() || trimmed, created_at: now, updated_at: now },
  };
  const existing = await get(ref(rdb(), RTDB_PATHS.device(trimmed)));
  if (!existing.exists()) {
    // Seed node sensor + aktuator bawaan (4 sprinkler + 1 kipas) untuk device baru
    updates[RTDB_PATHS.status(trimmed)] = {
      temperature: 0, smoke_mq2: 0, gas_mq6: 0,
      fire1: false, fire2: false, fire3: false, fire4: false,
      updated_at: now,
    };
    const actuators: Record<string, unknown> = {};
    VALID_DEVICES.forEach((d) => {
      actuators[d] = { mode: 'auto', manual_active: false, manual_level: 'flow', updated_at: now };
    });
    updates[RTDB_PATHS.actuators(trimmed)] = actuators;
  } else {
    updates[`${RTDB_PATHS.meta(trimmed)}/name`] = name.trim() || trimmed;
  }
  await update(ref(rdb(), '/'), updates);
  return trimmed;
}

export async function removeDevice(id: DeviceId): Promise<void> {
  await remove(ref(rdb(), RTDB_PATHS.device(id)));
}

// ===================== Writes =====================

export async function setDeviceMode(deviceId: DeviceId, device: DeviceName, mode: 'auto' | 'manual'): Promise<void> {
  await update(ref(rdb(), RTDB_PATHS.actuator(deviceId, device)), {
    mode,
    updated_at: new Date().toISOString(),
  });
}

export async function setDeviceManualActive(deviceId: DeviceId, device: DeviceName, manual_active: boolean): Promise<void> {
  await update(ref(rdb(), RTDB_PATHS.actuator(deviceId, device)), {
    manual_active,
    updated_at: new Date().toISOString(),
  });
}

/** Khusus kipas: pilih level saat mode manual — FLOW (pelan, relay off) / BOOST (kencang, relay on) */
export async function setDeviceFanManualLevel(deviceId: DeviceId, level: 'flow' | 'boost'): Promise<void> {
  await update(ref(rdb(), RTDB_PATHS.actuator(deviceId, 'fan1')), {
    manual_active: true,
    manual_level: level,
    updated_at: new Date().toISOString(),
  });
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await update(ref(rdb(), RTDB_PATHS.settings), {
    temp_threshold: s.temp_threshold,
    smoke_threshold: s.smoke_threshold,
    gas_threshold: s.gas_threshold,
    sprinkler_delay: s.sprinkler_delay,
    fan_delay: s.fan_delay,
    fan_duration: s.fan_duration,
    fuzzy_temp_aman: s.fuzzy_temp_aman,
    fuzzy_temp_bahaya: s.fuzzy_temp_bahaya,
    fuzzy_smoke_rendah: s.fuzzy_smoke_rendah,
    fuzzy_smoke_tinggi: s.fuzzy_smoke_tinggi,
    fuzzy_gas_rendah: s.fuzzy_gas_rendah,
    fuzzy_gas_tinggi: s.fuzzy_gas_tinggi,
    fuzzy_fan_flow: s.fuzzy_fan_flow,
    fan_idle_mode: s.fan_idle_mode,
    updated_at: new Date().toISOString(),
    // catatan: telegram disimpan lewat saveTelegramSettings()
  });
}

// ===================== Telegram =====================

export async function fetchTelegramSettings(): Promise<TelegramSettings> {
  const snap = await get(ref(rdb(), 'settings/telegram'));
  const raw = (snap.val() ?? {}) as Partial<TelegramSettings>;
  return {
    bot_token: String(raw.bot_token ?? ''),
    enabled: Boolean(raw.enabled),
    recipients: (raw.recipients ?? {}) as Record<string, TelegramRecipientData>,
  };
}

export async function saveTelegramSettings(tg: TelegramSettings): Promise<void> {
  await set(ref(rdb(), 'settings/telegram'), tg);
}

// ===================== Events =====================

export function logEvent(
  deviceId: DeviceId,
  device_name: string,
  event_type: EventType,
  severity: Severity,
  message: string,
): Promise<void> {
  const itemRef = push(ref(rdb(), RTDB_PATHS.events));
  return set(itemRef, {
    device_id: deviceId,
    device_name,
    event_type,
    severity,
    message,
    created_at: new Date().toISOString(),
  }).catch((e) => {
    console.warn('logEvent gagal:', e);
  });
}

export function subscribeEvents(callback: (logs: EventLogEntry[]) => void): () => void {
  const q = query(ref(rdb(), RTDB_PATHS.events), limitToLast(200));
  return onValue(q, (snap) => {
    const raw = (snap.val() ?? {}) as Record<string, Omit<EventLogEntry, 'id'>>;
    const logs = Object.entries(raw).map(([id, v]) => ({ id, ...v }));
    // push keys kronologis -> balik urutan agar terbaru di atas
    logs.reverse();
    callback(logs);
  });
}

export async function clearEvents(): Promise<void> {
  await remove(ref(rdb(), RTDB_PATHS.events));
}

// ===================== Seed =====================

export async function ensureSeed(): Promise<void> {
  const snap = await get(ref(rdb(), RTDB_PATHS.settings));
  if (!snap.exists()) {
    await set(ref(rdb(), RTDB_PATHS.settings), { ...DEFAULT_SETTINGS, updated_at: new Date().toISOString() });
  }
}

// ===================== Danger evaluation =====================

export type DangerLevel = 'safe' | 'warning' | 'danger';

export function evalDanger(s: HouseStatus, settings: AppSettings): {
  level: DangerLevel;
  reasons: string[];
} {
  // Cerminan evalLevel() firmware: nilai >= ambang = BAHAYA (danger),
  // mendekati ambang (suhu 0.75x, asap/gas 0.5x) = PERINGATAN (warning).
  const reasons: string[] = [];
  let level: DangerLevel = 'safe';

  if (s.fire1 || s.fire2 || s.fire3 || s.fire4) {
    reasons.push('Api terdeteksi');
    level = 'danger';
  }
  if (s.temperature >= settings.temp_threshold) {
    reasons.push(`Suhu ${s.temperature.toFixed(1)} °C (ambang ${settings.temp_threshold} °C)`);
    level = 'danger';
  }
  if (s.smoke_mq2 >= settings.smoke_threshold) {
    reasons.push(`Asap ${s.smoke_mq2} ppm (ambang ${settings.smoke_threshold})`);
    level = 'danger';
  }
  if (s.gas_mq6 >= settings.gas_threshold) {
    reasons.push(`Gas ${s.gas_mq6} ppm (ambang ${settings.gas_threshold})`);
    level = 'danger';
  }

  if (level === 'safe') {
    const warn: string[] = [];
    if (s.temperature >= settings.temp_threshold * 0.75)
      warn.push(`Suhu ${s.temperature.toFixed(1)} °C (ambang ${settings.temp_threshold} °C)`);
    if (s.smoke_mq2 >= settings.smoke_threshold * 0.5)
      warn.push(`Asap ${s.smoke_mq2} ppm (ambang ${settings.smoke_threshold})`);
    if (s.gas_mq6 >= settings.gas_threshold * 0.5)
      warn.push(`Gas ${s.gas_mq6} ppm (ambang ${settings.gas_threshold})`);
    if (warn.length) {
      level = 'warning';
      reasons.push(`Mendekati ambang batas: ${warn.join(', ')}`);
    }
  }
  return { level, reasons };
}

export function shouldAutoActivateFan(s: HouseStatus, settings: AppSettings): boolean {
  return s.smoke_mq2 >= settings.smoke_threshold || s.gas_mq6 >= settings.gas_threshold;
}

// ===================== Fuzzy Logic (Mamdani) =====================

export type FanMode = 'flow' | 'boost' | 'off';

export interface FuzzyMembership {
  low: number;
  mid: number;
  high: number;
}

export interface FuzzyResult {
  fan: FanMode;
  fan_pwm: number;          // 0 / fuzzy_fan_flow / 100
  sprinkler: boolean;       // hasil rule BAHAYA (trigger api menimpa ini di ESP32)
  mu: {
    temp: FuzzyMembership;  // aman / waspada / bahaya
    smoke: FuzzyMembership; // rendah / sedang / tinggi
    gas: FuzzyMembership;   // rendah / sedang / tinggi
  };
  w_flow: number;
  w_boost: number;
}

/** Derajat keanggotaan 3 himpunan dari 2 parameter batas (L, H). */
function membership(x: number, L: number, H: number): FuzzyMembership {
  const safeL = Math.min(L, H - 1);      // jaga L < H
  const safeH = Math.max(H, safeL + 1);
  const M = (safeL + safeH) / 2;         // puncak himpunan tengah
  const d = (safeH - safeL) / 4;         // jarak overlap
  const low = x <= safeL ? 1 : x < safeL + d ? (safeL + d - x) / d : 0;
  const mid =
    x <= safeL || x >= safeH ? 0 :
    x < M ? (x - safeL) / (M - safeL) : (safeH - x) / (safeH - M);
  const high = x < safeH - d ? 0 : x < safeH ? (x - safeH + d) / d : 1;
  return { low, mid, high };
}

/** Rule base 3×3×3 (suhu × asap × gas) — hasil koreksi: FLOW/BOOST (+S = sprinkler). */
const RULES: Array<Array<Array<'F' | 'B' | 'BS'>>> = [
  // gas RENDAH
  [
    // asap RENDAH, SEDANG, TINGGI
    ['F', 'F', 'B'],   // suhu AMAN
    ['F', 'F', 'B'],   // suhu WASPADA
    ['B', 'B', 'BS'],  // suhu BAHAYA
  ],
  // gas SEDANG
  [
    ['F', 'B', 'B'],
    ['B', 'B', 'B'],
    ['BS', 'BS', 'BS'],
  ],
  // gas TINGGI
  [
    ['B', 'B', 'B'],
    ['B', 'B', 'B'],
    ['BS', 'BS', 'BS'],
  ],
];

/**
 * Engine fuzzy Mamdani:
 * fuzzifikasi (MIN antecedent) → agregasi MAX → defuzzifikasi diskrit (argmax).
 * Identik dengan versi C++ yang akan dipasang di ESP32.
 */
export function evalFuzzy(status: HouseStatus, settings: AppSettings): FuzzyResult {
  const muTemp = membership(status.temperature, settings.fuzzy_temp_aman, settings.fuzzy_temp_bahaya);
  const muSmoke = membership(status.smoke_mq2, settings.fuzzy_smoke_rendah, settings.fuzzy_smoke_tinggi);
  const muGas = membership(status.gas_mq6, settings.fuzzy_gas_rendah, settings.fuzzy_gas_tinggi);

  const muT = [muTemp.low, muTemp.mid, muTemp.high];
  const muS = [muSmoke.low, muSmoke.mid, muSmoke.high];
  const muG = [muGas.low, muGas.mid, muGas.high];

  let wFlow = 0;
  let wBoost = 0;
  let sprinkler = false;

  for (let g = 0; g < 3; g++) {
    for (let t = 0; t < 3; t++) {
      for (let s = 0; s < 3; s++) {
        const rule = RULES[g][t][s];
        const w = Math.min(muT[t], Math.min(muS[s], muG[g])); // MIN (∧)
        if (w <= 0) continue;
        if (rule === 'F') {
          wFlow = Math.max(wFlow, w);       // MAX agregasi
        } else {
          wBoost = Math.max(wBoost, w);
          if (rule === 'BS') sprinkler = true;
        }
      }
    }
  }

  const fan: FanMode =
    wBoost > wFlow ? 'boost'
      : settings.fan_idle_mode === 'flow' && wFlow > 0 ? 'flow'
        : 'off';
  const fan_pwm = fan === 'boost' ? 100 : fan === 'flow' ? settings.fuzzy_fan_flow : 0;

  return {
    fan,
    fan_pwm,
    sprinkler,
    mu: { temp: muTemp, smoke: muSmoke, gas: muGas },
    w_flow: wFlow,
    w_boost: wBoost,
  };
}
