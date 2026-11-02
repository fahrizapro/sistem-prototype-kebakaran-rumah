/*
 * =====================================================================
 *  FIRE GUARD MONITOR — Firmware ESP32-S3 (FreeRTOS dual-core)
 * =====================================================================
 *  ARSITEKTUR:
 *    Core 1 (APP)  → task Kontrol : baca sensor (DS18B20, MQ2/MQ6, ADS1115
 *                    fire), fuzzy Mamdani, relay sprinkler 1-4 + kipas,
 *                    buzzer. TIDAK pernah melakukan operasi jaringan.
 *    Core 0 (PRO)  → task Komunikasi : WiFi, REST Firebase Realtime
 *                    Database (status, actuators, settings, meta, events),
 *                    kirim pesan Telegram.
 *    Sinkronisasi  → mutex (data sensor/pengaturan) + FreeRTOS queue
 *                    (antrean log kejadian & Telegram dari kontrol → kom).
 *
 *  Program ini IDENTIK untuk semua perangkat — perbedaan tiap ESP32
 *  hanya pada DEVICE_ID di bawah. Path database otomatis mengikuti:
 *      devices/{DEVICE_ID}/status      ← ESP32 menulis sensor
 *      devices/{DEVICE_ID}/actuators   ← ESP32 membaca perintah web
 *      settings                        ← threshold, fuzzy, telegram
 *      events                          ← log kejadian
 *
 *  Library (Arduino IDE → Library Manager):
 *    - ArduinoJson            v7.x  (Benoit Blanchon)
 *    - OneWire                (Paul Stoffregen)
 *    - DallasTemperature      (Miles Burton)
 *    - Adafruit ADS1X15       (+ Adafruit BusIO)
 *  Tidak perlu library Firebase — komunikasi via REST HTTPS.
 * =====================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

// =====================================================================
//  1. KONFIGURASI WAJIB — ubah hanya bagian ini untuk tiap perangkat
// =====================================================================
#define DEVICE_ID        "ESP32-A"          // ← GANTI di tiap ESP32 (ESP32-B, ...)
#define WIFI_SSID        "kebakaran"        // ← nama hotspot/router
#define WIFI_PASSWORD    "12345678"    // ← password wifi

// URL Realtime Database (sama seperti yang dipakai web)
#define FIREBASE_DB_URL  "https://fireguard-ff7c1-default-rtdb.asia-southeast1.firebasedatabase.app"
// Isi HANYA jika rules database dikunci (opsional; saat rules terbuka kosongkan)
#define FIREBASE_DB_SECRET ""

// =====================================================================
//  2. PIN & HARDWARE (ESP32-S3 DevKit)
// =====================================================================
#define I2C_SDA     8        // pin I2C default S3 — ADS1115
#define I2C_SCL     9
#define ADS_ADDR    0x48     // ADDR → GND

#define PIN_DS18B20 4        // DS18B20 DATA (pull-up 4.7k ke 3.3V)
#define PIN_BUZZER  5        // buzzer
#define PIN_MQ2     1        // MQ2  AO (via divider 10k/10k)  = ADC1_CH0
#define PIN_MQ6     2        // MQ6  AO (via divider 10k/10k)  = ADC1_CH1

#define PIN_RELAY_SPR1 10    // relay IN1 → sprinkler 1
#define PIN_RELAY_SPR2 11    // relay IN2 → sprinkler 2
#define PIN_RELAY_SPR3 12    // relay IN3 → sprinkler 3
#define PIN_RELAY_SPR4 13    // relay IN4 → sprinkler 4
#define PIN_RELAY_FAN  14    // relay IN5 → kipas (fan1)

#define RELAY_ACTIVE_LOW   1 // modul relay umumnya aktif-LOW: IN = LOW → relay ON
#define BUZZER_ACTIVE_HIGH 1 // driver BC548 NPN: GPIO HIGH → transistor ON → buzzer bunyi
#define BUZZER_ENABLE      1 // 0 = buzzer dimatikan total
#define BUZZER_PATTERN_MS  500 // beep berdenyut saat BAHAYA: 500ms on / 500ms off

// --- Sensor api via ADS1115 (analog) ---
#define FIRE_THRESHOLD_AUTO 1  // 1 = threshold otomatis dari baseline udara bersih
#define FIRE_THRESHOLD      8000   // dipakai bila FIRE_THRESHOLD_AUTO = 0
#define FIRE_MARGIN         2000   // jarak threshold dari baseline (auto mode)
#define FIRE_ACTIVE_ABOVE   0      // 0 = api bila nilai TURUN dari baseline

// --- MQ via divider 10k/10k ---
#define MQ_DIVIDER         2.0f   // tegangan sensor = 2 × tegangan di ADC
#define MQ_VC              5.0f   // tegangan sirkuit modul MQ (Vc pada rumus Rs)
#define ADC_MAX            4095.0f
#define ADC_VREF           3.3f

// =====================================================================
//  3. KALIBRASI MQ2 / MQ6 (kurva datasheet — sesuaikan dengan modul Anda)
// =====================================================================
#define MQ2_RL   5000.0f   // resistansi beban modul (ohm)
#define MQ6_RL   5000.0f
#define MQ2_R0   0.0f      // 0 = auto-kalibrasi saat boot di udara bersih
#define MQ6_R0   0.0f
#define MQ2_A    116.60206982f   // ppm = A * (Rs/R0)^B   (kurva LPG MQ2)
#define MQ2_B    -2.769034857f
#define MQ6_A    1009.13f        // (kurva LPG MQ6)
#define MQ6_B    -2.35f
#define MQ2_CLEAN_AIR_RATIO  9.83f   // Rs/R0 di udara bersih (datasheet)
#define MQ6_CLEAN_AIR_RATIO  10.0f
#define MQ2_R0_FALLBACK  10000.0f    // dipakai bila kalibrasi gagal (sensor dingin)
#define MQ6_R0_FALLBACK  10000.0f
#define MQ_CALIB_TIMEOUT_MS  90000UL // batas waktu kalibrasi otomatis setelah boot

// =====================================================================
//  4. INTERVAL (ms) & RTOS
// =====================================================================
#define INTERVAL_SENSOR_READ    1000UL
#define INTERVAL_STATUS_PUSH    1000UL   // 1 detik → web terasa realtime
#define INTERVAL_ACTUATOR_POLL  1000UL
#define INTERVAL_SETTINGS_POLL  30000UL
#define INTERVAL_META_POLL      60000UL
#define TG_COOLDOWN_MS          10000UL   // jeda minimum antar kirim Telegram
#define DS_CONVERSION_MS        800UL     // waktu konversi DS18B20

#define STACK_KONTROL  8192
#define STACK_KOM      16384
#define CORE_KONTROL   1   // APP
#define CORE_KOM       0   // PRO (network stack ada di core 0)
#define PRIO_KONTROL   3
#define PRIO_KOM       2
#define QUEUE_LEN      12

// =====================================================================
//  Struktur data bersama (dilindungi dataMx)
// =====================================================================
struct Settings {
  float temp_threshold, smoke_threshold, gas_threshold;
  int   sprinkler_delay, fan_delay, fan_duration;
  float fuzzy_temp_aman, fuzzy_temp_bahaya;
  float fuzzy_smoke_rendah, fuzzy_smoke_tinggi;
  float fuzzy_gas_rendah,  fuzzy_gas_tinggi;
  int   fuzzy_fan_flow;
  bool  fan_idle_flow;            // true = FLOW saat idle, false = OFF
};

// Default = sama persis dengan DEFAULT_SETTINGS di web (src/lib/db.ts)
Settings S = { 50, 1000, 2000, 3, 2, 30, 35, 55, 400, 600, 500, 2000, 50, true };

struct ActuatorCmd {             // perintah dari web → kontrol
  bool sprAuto[4];
  bool sprManual[4];
  bool fanAuto;
  bool fanManualActive;
  bool fanManualBoost;           // manual: false = FLOW (pelan), true = BOOST (kencang)
};
ActuatorCmd cmd = { { true, true, true, true }, { false, false, false, false }, true, false, false };

struct SensorSnap {              // hasil kontrol → komunikasi
  float temp, smoke, gas;
  bool  fire[4];
  int   fuzzyFan;                // 0=OFF 1=FLOW 2=BOOST
  bool  fuzzySpr;
  int   level;                   // 0=aman 1=warning 2=danger
  uint32_t stamp;                // millis terakhir diperbarui
};

SensorSnap snap = { 0, 0, 0, { false, false, false, false }, 0, false, 0, 0 };

SemaphoreHandle_t dataMx;        // melindungi S, cmd, snap
volatile uint32_t settingsVer = 0;

// Antrean keluar: log kejadian + permintaan Telegram (kontrol → kom)
struct OutMsg {
  bool    telegram;              // true = juga kirim Telegram
  char    type[12];              // fire/smoke/gas/temperature/system
  char    sev[10];               // info/warning/danger
  char    msg[180];
};
QueueHandle_t outQueue;

// =====================================================================
//  State per-task
// =====================================================================
Adafruit_ADS1115 ads;
OneWire oneWire(PIN_DS18B20);
DallasTemperature ds(&oneWire);

float mq2R0 = MQ2_R0, mq6R0 = MQ6_R0;
uint32_t bootMs = 0;             // waktu boot — acuan timeout kalibrasi MQ
int16_t fireBase[4] = { 0, 0, 0, 0 };  // baseline udara bersih per channel
String deviceName = DEVICE_ID;   // hanya diutik oleh task Komunikasi

String tgToken = "";
bool   tgEnabled = false;
struct Recipient { String chatId; String label; };
Recipient recipients[8];
int    nRecip = 0;
uint32_t lastTgSend = (uint32_t)-TG_COOLDOWN_MS;  // kirim pertama langsung boleh

#define MAX_RECIPIENTS 8

// =====================================================================
//  Fuzzy Mamdani — identik dengan evalFuzzy() di src/lib/db.ts
// =====================================================================
struct Mem { float low, mid, high; };

Mem membership(float x, float L, float H) {
  float l = min(L, H - 1.0f);
  float h = max(H, l + 1.0f);
  float m = (l + h) / 2.0f;      // puncak himpunan tengah
  float d = (h - l) / 4.0f;      // jarak overlap
  Mem r;
  r.low  = (x <= l) ? 1.0f : (x < l + d) ? (l + d - x) / d : 0.0f;
  r.mid  = (x <= l || x >= h) ? 0.0f : (x < m) ? (x - l) / (m - l) : (h - x) / (h - m);
  r.high = (x < h - d) ? 0.0f : (x < h) ? (x - h + d) / d : 1.0f;
  return r;
}

// Rule base — RULES[suhu][gas][asap]; F=FLOW, B=BOOST, S=BOOST+Sprinkler
const char RULES[3][3][3] = {
  { { 'F','F','B' }, { 'F','B','B' }, { 'B','B','B' } },   // suhu AMAN
  { { 'F','F','B' }, { 'B','B','B' }, { 'B','B','B' } },   // suhu WASPADA
  { { 'B','B','S' }, { 'S','S','S' }, { 'S','S','S' } },   // suhu BAHAYA
};

void evalFuzzy(float temp, float smoke, float gas, const Settings &s,
               int &fan, bool &sprinkler, float &wFlow, float &wBoost) {
  Mem mt = membership(temp,  s.fuzzy_temp_aman,    s.fuzzy_temp_bahaya);
  Mem ms = membership(smoke, s.fuzzy_smoke_rendah, s.fuzzy_smoke_tinggi);
  Mem mg = membership(gas,   s.fuzzy_gas_rendah,   s.fuzzy_gas_tinggi);

  float muT[3] = { mt.low, mt.mid, mt.high };
  float muS[3] = { ms.low, ms.mid, ms.high };
  float muG[3] = { mg.low, mg.mid, mg.high };

  wFlow = 0; wBoost = 0; sprinkler = false;
  for (int t = 0; t < 3; t++)
    for (int g = 0; g < 3; g++)
      for (int a = 0; a < 3; a++) {
        char rule = RULES[t][g][a];
        float w = min(muT[t], min(muS[a], muG[g]));   // MIN (AND)
        if (w <= 0) continue;
        if (rule == 'F') {
          wFlow = max(wFlow, w);                       // MAX agregasi
        } else {
          wBoost = max(wBoost, w);
          if (rule == 'S') sprinkler = true;
        }
      }

  fan = (wBoost > wFlow) ? 2 : (s.fan_idle_flow && wFlow > 0) ? 1 : 0;
}

// =====================================================================
//  Level bahaya — cerminan evalDanger() di web
// =====================================================================
int evalLevel(const SensorSnap &d, const Settings &s, String &reasons, String &eventType) {
  bool fireAny = d.fire[0] || d.fire[1] || d.fire[2] || d.fire[3];
  reasons = ""; eventType = "system";
  int level = 0;

  if (fireAny) {
    level = 2; eventType = "fire";
    for (int i = 0; i < 4; i++)
      if (d.fire[i]) reasons += String(reasons.length() ? ", " : "") +
        "Api terdeteksi di titik " + String(i + 1) + " (Sprinkler " + String(i + 1) + ")";
  }
  if (d.temp >= s.temp_threshold) {
    level = 2; if (!eventType.startsWith("fire")) eventType = "temperature";
    reasons += String(reasons.length() ? ", " : "") + "Suhu " + String(d.temp, 1) + " C (>= " + String(s.temp_threshold, 0) + ")";
  }
  if (d.smoke >= s.smoke_threshold) {
    level = 2; if (eventType == "system") eventType = "smoke";
    reasons += String(reasons.length() ? ", " : "") + "Asap " + String((int)d.smoke) + " ppm (>= " + String((int)s.smoke_threshold) + ")";
  }
  if (d.gas >= s.gas_threshold) {
    level = 2; if (eventType == "system") eventType = "gas";
    reasons += String(reasons.length() ? ", " : "") + "Gas " + String((int)d.gas) + " ppm (>= " + String((int)s.gas_threshold) + ")";
  }
  if (level == 0) {
    // PERINGATAN: mendekati ambang batas — sebutkan sensor mana yang tinggi.
    // Suhu memakai 0.75x (ruang tropis 30-35 C adalah normal, jangan sampai
    // memicu notifikasi terus-menerus); asap & gas tetap 0.5x.
    String r = "";
    if (d.temp >= s.temp_threshold * 0.75f)
      r += String(r.length() ? ", " : "") + "Suhu " + String(d.temp, 1) + " C (ambang " + String(s.temp_threshold, 0) + " C)";
    if (d.smoke >= s.smoke_threshold * 0.5f)
      r += String(r.length() ? ", " : "") + "Asap " + String((int)d.smoke) + " ppm (ambang " + String((int)s.smoke_threshold) + ")";
    if (d.gas >= s.gas_threshold * 0.5f)
      r += String(r.length() ? ", " : "") + "Gas " + String((int)d.gas) + " ppm (ambang " + String((int)s.gas_threshold) + ")";
    if (r.length()) {
      level = 1;
      reasons = "Mendekati ambang batas: " + r;
    }
  }
  return level;
}

// =====================================================================
//  REST ke Realtime Database — HANYA dipakai task Komunikasi
//  Koneksi HTTPS di-REUSE (keep-alive) agar tidak handshake TLS ulang
//  di setiap request — inilah kunci update web yang cepat/realtime.
// =====================================================================
WiFiClientSecure tlsClient;   // khusus Firebase RTDB
WiFiClientSecure tlsTg;       // khusus Telegram (host berbeda)
HTTPClient httpRtdb;

int rtdbRequest(const char *method, const String &path, const String &payload, String &response) {
  if (WiFi.status() != WL_CONNECTED) return -100;
  String url = String(FIREBASE_DB_URL) + path + ".json";
  if (FIREBASE_DB_SECRET[0] != '\0') url += String("?auth=") + FIREBASE_DB_SECRET;

  tlsClient.setInsecure();          // demo; produksi: pasang sertifikat Google
  tlsClient.setHandshakeTimeout(15);
  if (!httpRtdb.begin(tlsClient, url)) return -101;
  httpRtdb.setReuse(true);          // keep-alive: handshake TLS hanya sekali
  httpRtdb.addHeader("Content-Type", "application/json");
  int code = httpRtdb.sendRequest(method, payload);
  if (code > 0) response = httpRtdb.getString();
  httpRtdb.end();                   // dengan reuse=true, TCP tetap terbuka
  return code;
}

bool rtdbPatch(const String &path, const String &payload) {
  String resp;
  int code = rtdbRequest("PATCH", path, payload, resp);
  if (code <= 0) Serial.printf("[RTDB] PATCH %s gagal: %d\n", path.c_str(), code);
  return code >= 200 && code < 300;
}

bool rtdbPost(const String &path, const String &payload) {
  String resp;
  int code = rtdbRequest("POST", path, payload, resp);
  if (code <= 0) Serial.printf("[RTDB] POST %s gagal: %d\n", path.c_str(), code);
  return code >= 200 && code < 300;
}

bool rtdbGet(const String &path, String &body) {
  int code = rtdbRequest("GET", path, "", body);
  if (code <= 0) Serial.printf("[RTDB] GET %s gagal: %d\n", path.c_str(), code);
  return code >= 200 && code < 300;
}

String isoTime() {
  time_t now = time(nullptr);
  struct tm t;
  gmtime_r(&now, &t);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// =====================================================================
//  TASK KOMUNIKASI (core 0) — Firebase + Telegram
// =====================================================================
void pushStatus() {
  SensorSnap d;
  xSemaphoreTake(dataMx, portMAX_DELAY);
  d = snap;
  xSemaphoreGive(dataMx);

  JsonDocument doc;
  doc["temperature"]     = roundf(d.temp * 10) / 10.0f;
  doc["smoke_mq2"]       = (int)roundf(d.smoke);
  doc["gas_mq6"]         = (int)roundf(d.gas);
  doc["fire1"]           = d.fire[0];
  doc["fire2"]           = d.fire[1];
  doc["fire3"]           = d.fire[2];
  doc["fire4"]           = d.fire[3];
  doc["fuzzy_fan"]       = (d.fuzzyFan == 2) ? "boost" : (d.fuzzyFan == 1) ? "flow" : "off";
  doc["fuzzy_sprinkler"] = d.fuzzySpr;
  doc["updated_at"]      = isoTime();
  String out;
  serializeJson(doc, out);
  rtdbPatch("/devices/" DEVICE_ID "/status", out);
}

void pollActuators() {
  String body;
  if (!rtdbGet("/devices/" DEVICE_ID "/actuators", body) || body == "null") return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  ActuatorCmd c;
  xSemaphoreTake(dataMx, portMAX_DELAY);
  c = cmd;
  xSemaphoreGive(dataMx);

  const char *names[4] = { "sprinkler1", "sprinkler2", "sprinkler3", "sprinkler4" };
  bool changed = false;
  for (int i = 0; i < 4; i++) {
    auto node = doc[names[i]];
    if (node.isNull()) continue;
    const char *mode = node["mode"] | "auto";
    bool newAuto   = (strcmp(mode, "auto") == 0);
    bool newManual = (bool)(node["manual_active"] | false);
    if (newAuto != c.sprAuto[i] || newManual != c.sprManual[i]) changed = true;
    c.sprAuto[i] = newAuto; c.sprManual[i] = newManual;
  }
  auto fanNode = doc["fan1"];
  if (!fanNode.isNull()) {
    const char *mode = fanNode["mode"] | "auto";
    bool newAuto   = (strcmp(mode, "auto") == 0);
    bool newManual = (bool)(fanNode["manual_active"] | false);
    const char *lvl = fanNode["manual_level"] | "flow";
    bool newBoost  = (strcmp(lvl, "boost") == 0);
    if (newAuto != c.fanAuto || newManual != c.fanManualActive || newBoost != c.fanManualBoost) changed = true;
    c.fanAuto = newAuto; c.fanManualActive = newManual; c.fanManualBoost = newBoost;
  }
  if (changed) {
    xSemaphoreTake(dataMx, portMAX_DELAY);
    cmd = c;
    xSemaphoreGive(dataMx);
    Serial.println("[KOM] Perintah aktuator baru dari web");
  }
}

void applySettingsJson(const String &body) {
  if (body == "null") return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  Settings s;
  xSemaphoreTake(dataMx, portMAX_DELAY);
  s = S;
  xSemaphoreGive(dataMx);

  s.temp_threshold    = doc["temp_threshold"]    | s.temp_threshold;
  s.smoke_threshold   = doc["smoke_threshold"]   | s.smoke_threshold;
  s.gas_threshold     = doc["gas_threshold"]     | s.gas_threshold;
  s.sprinkler_delay   = doc["sprinkler_delay"]   | s.sprinkler_delay;
  s.fan_delay         = doc["fan_delay"]         | s.fan_delay;
  s.fan_duration      = doc["fan_duration"]      | s.fan_duration;
  s.fuzzy_temp_aman   = doc["fuzzy_temp_aman"]   | s.fuzzy_temp_aman;
  s.fuzzy_temp_bahaya = doc["fuzzy_temp_bahaya"] | s.fuzzy_temp_bahaya;
  s.fuzzy_smoke_rendah = doc["fuzzy_smoke_rendah"] | s.fuzzy_smoke_rendah;
  s.fuzzy_smoke_tinggi = doc["fuzzy_smoke_tinggi"] | s.fuzzy_smoke_tinggi;
  s.fuzzy_gas_rendah  = doc["fuzzy_gas_rendah"]  | s.fuzzy_gas_rendah;
  s.fuzzy_gas_tinggi  = doc["fuzzy_gas_tinggi"]  | s.fuzzy_gas_tinggi;
  s.fuzzy_fan_flow    = doc["fuzzy_fan_flow"]    | s.fuzzy_fan_flow;
  const char *idle = doc["fan_idle_mode"] | "flow";
  s.fan_idle_flow = (strcmp(idle, "flow") == 0);

  xSemaphoreTake(dataMx, portMAX_DELAY);
  S = s;
  settingsVer++;
  xSemaphoreGive(dataMx);

  JsonObject tg = doc["telegram"];
  if (!tg.isNull()) {
    tgToken   = String((const char *)(tg["bot_token"] | ""));
    tgEnabled = (bool)(tg["enabled"] | false);
    nRecip = 0;
    JsonObject rec = tg["recipients"];
    for (JsonPair kv : rec) {
      if (nRecip >= MAX_RECIPIENTS) break;
      recipients[nRecip].chatId = String(kv.key().c_str());
      recipients[nRecip].label  = String((const char *)(kv.value()["label"] | ""));
      nRecip++;
    }
    Serial.printf("[KOM] Telegram: %s, %d penerima\n", tgEnabled ? "AKTIF" : "nonaktif", nRecip);
  }
  Serial.println("[KOM] Pengaturan diperbarui dari web");
}

void pollSettings() {
  String body;
  if (rtdbGet("/settings", body)) applySettingsJson(body);
}

void pollMeta() {
  String body;
  if (!rtdbGet("/devices/" DEVICE_ID "/meta/name", body) || body == "null") return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  if (!doc.is<const char *>()) return;
  String n = String(doc.as<const char *>());
  if (n.length() && n != deviceName) {
    deviceName = n;
    Serial.printf("[KOM] Nama perangkat: %s\n", deviceName.c_str());
  }
}

void sendTelegramAll(const String &text) {
  if (!tgEnabled || tgToken.length() < 10 || nRecip == 0) {
    Serial.printf("[TG] Tidak kirim: enabled=%d token=%s penerima=%d\n",
                  tgEnabled ? 1 : 0, tgToken.length() < 10 ? "belum-ada/salah" : "ada", nRecip);
    return;
  }
  if (millis() - lastTgSend < TG_COOLDOWN_MS) {
    Serial.println("[TG] Cooldown aktif, kirim dilewati");
    return;
  }
  tlsTg.setInsecure();
  int okCount = 0;
  for (int i = 0; i < nRecip; i++) {
    HTTPClient http;
    String url = "https://api.telegram.org/bot" + tgToken + "/sendMessage";
    if (!http.begin(tlsTg, url)) continue;
    http.addHeader("Content-Type", "application/json");
    JsonDocument doc;
    doc["chat_id"]    = recipients[i].chatId;
    doc["text"]       = text;
    doc["parse_mode"] = "HTML";
    String body;
    serializeJson(doc, body);
    int code = http.POST(body);
    if (code == 200) {
      okCount++;
      Serial.printf("[TG] OK -> %s (%s)\n", recipients[i].label.c_str(), recipients[i].chatId.c_str());
    } else {
      String err = http.getString();
      Serial.printf("[TG] GAGAL -> %s (%s): HTTP %d %s\n",
                    recipients[i].label.c_str(), recipients[i].chatId.c_str(), code, err.c_str());
    }
    http.end();
  }
  lastTgSend = millis();
  Serial.printf("[TG] Selesai: %d/%d penerima sukses\n", okCount, nRecip);
}

// =====================================================================
//  Safety: BAHAYA → semua aktuator kembali ke mode AUTO (auto-switch)
//  ------------------------------------------------------------------
//  Mode manual dari web tidak boleh memblokir respons kebakaran.
//  Saat event level BAHAYA keluar, fungsi ini mem-patch node
//  actuators di RTDB (semua node → mode:auto, manual_active:false,
//  manual_level:flow) dan mereset perintah manual lokal, sehingga
//  logika api/fuzzy otomatis berlaku lagi di task Kontrol.
// =====================================================================
void resetActuatorsAuto() {
  JsonDocument doc;
  for (int i = 1; i <= 4; i++) {
    JsonObject n = doc[String("sprinkler") + i].to<JsonObject>();
    n["mode"]          = "auto";
    n["manual_active"] = false;
    n["updated_at"]    = isoTime();
  }
  JsonObject fan = doc["fan1"].to<JsonObject>();
  fan["mode"]          = "auto";
  fan["manual_active"] = false;
  fan["manual_level"]  = "flow";
  fan["updated_at"]    = isoTime();
  String out;
  serializeJson(doc, out);
  rtdbPatch("/devices/" DEVICE_ID "/actuators", out);

  ActuatorCmd c = { { true, true, true, true },
                    { false, false, false, false },
                    true, false, false };
  xSemaphoreTake(dataMx, portMAX_DELAY);
  cmd = c;
  xSemaphoreGive(dataMx);
  Serial.println("[KOM] BAHAYA — semua aktuator dikembalikan ke mode AUTO");
}

void taskKomunikasi(void *) {
  uint32_t tStatus = 0, tAct = 0, tSet = 0, tMeta = 0;
  static uint32_t tWifi = 0;

  for (;;) {
    // ---- WiFi reconnect otomatis ----
    if (WiFi.status() != WL_CONNECTED && millis() - tWifi > 5000) {
      tWifi = millis();
      Serial.println("[KOM] WiFi putus — mencoba ulang...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }

    if (WiFi.status() == WL_CONNECTED) {
      if (millis() - tStatus >= INTERVAL_STATUS_PUSH)   { tStatus = millis(); pushStatus(); }
      if (millis() - tAct   >= INTERVAL_ACTUATOR_POLL)  { tAct = millis();    pollActuators(); }
      if (millis() - tSet   >= INTERVAL_SETTINGS_POLL)  { tSet = millis();    pollSettings(); }
      if (millis() - tMeta  >= INTERVAL_META_POLL)      { tMeta = millis();   pollMeta(); }
    }

    // ---- antrean keluar: event + Telegram ----
    OutMsg m;
    while (xQueueReceive(outQueue, &m, 0) == pdTRUE) {
      // tulis log kejadian ke RTDB
      JsonDocument doc;
      doc["device_id"]   = DEVICE_ID;
      doc["device_name"] = deviceName;
      doc["event_type"]  = m.type;
      doc["severity"]    = m.sev;
      doc["message"]     = m.msg;
      doc["created_at"]  = isoTime();
      String out;
      serializeJson(doc, out);
      rtdbPost("/events", out);
      Serial.printf("[KOM][EVENT] %s | %s | %s\n", m.type, m.sev, m.msg);

      // Safety: saat level BAHAYA, aktuator manual dipaksa kembali ke AUTO
      // (mode manual tidak boleh memblokir respons kebakaran)
      if (strcmp(m.sev, "danger") == 0) resetActuatorsAuto();

      if (m.telegram) {
        SensorSnap d;
        xSemaphoreTake(dataMx, portMAX_DELAY);
        d = snap;
        xSemaphoreGive(dataMx);

        String t;
        if (strcmp(m.sev, "danger") == 0)      t = "🔥 <b>PERINGATAN KEBAKARAN</b>";
        else if (strcmp(m.sev, "warning") == 0) t = "⚠️ <b>PERINGATAN</b>";
        else                                    t = "✅ <b>Sistem Prototype Kebakaran Rumah</b>";
        t += "\n📍 Lokasi: " + deviceName + " (" + DEVICE_ID + ")";
        t += "\n" + String(m.msg);
        t += "\n🌡 Suhu: " + String(d.temp, 1) + " °C";
        t += "\n💨 Asap: " + String((int)d.smoke) + " ppm";
        t += "\n🧪 Gas: " + String((int)d.gas) + " ppm";
        sendTelegramAll(t);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// =====================================================================
//  TASK KONTROL (core 1) — sensor, fuzzy, aktuator, buzzer
// =====================================================================
void relayWrite(int pin, bool on) {
  digitalWrite(pin, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

// Baca 1 channel ADS1115 (0..32767 @ ±4.096V)
int16_t adsRead(int ch) {
  return ads.readADC_SingleEnded(ch);
}

// Threshold per channel: auto-baseline (dari udara bersih saat boot) atau tetap
int16_t fireThresholdOf(int ch) {
#if FIRE_THRESHOLD_AUTO
  int16_t th = FIRE_ACTIVE_ABOVE ? fireBase[ch] + FIRE_MARGIN : fireBase[ch] - FIRE_MARGIN;
  return constrain(th, 0, 32767);
#else
  return FIRE_THRESHOLD;
#endif
}

bool fireDetected(int ch, int16_t raw) {
  return FIRE_ACTIVE_ABOVE ? (raw > fireThresholdOf(ch)) : (raw < fireThresholdOf(ch));
}

float readMQ(int pin, float RL, float &R0, float A, float B, float cleanRatio,
             float fallbackR0, const char *tag) {
  uint32_t sum = 0;
  for (int i = 0; i < 10; i++) { sum += analogRead(pin); vTaskDelay(pdMS_TO_TICKS(2)); }
  float raw = sum / 10.0f;
  float vAdc = raw * ADC_VREF / ADC_MAX;
  float vOut = vAdc * MQ_DIVIDER;                 // tegangan keluaran modul (0..5V)
  if (vOut <= 0.05f) return 0;
  if (vOut > MQ_VC - 0.05f) vOut = MQ_VC - 0.05f; // saturasi
  float rs = RL * (MQ_VC - vOut) / vOut;          // Rs = RL·(Vc−Vout)/Vout

  // Kalibrasi R0: dicoba TERUS sampai berhasil (sensor MQ butuh pemanasan —
  // saat boot AO masih ≈0V sehingga kalibrasi sekali di setup bisa gagal).
  if (R0 <= 0) {
    if (vOut > 0.3f && vOut < MQ_VC - 0.3f) {
      R0 = rs / cleanRatio;
      Serial.printf("[CAL] %s R0 = %.0f ohm (catat & hard-code agar stabil)\n", tag, R0);
    } else if (millis() - bootMs > MQ_CALIB_TIMEOUT_MS) {
      R0 = fallbackR0;
      Serial.printf("[CAL] %s kalibrasi gagal (AO tidak wajar %.2fV) — pakai R0 fallback %.0f\n",
                    tag, vOut, R0);
    }
  }
  if (R0 <= 0) return 0;
  float ratio = rs / R0;
  if (ratio <= 0.01f) return 0;
  float ppm = A * powf(ratio, B);
  return constrain(ppm, 0.0f, 10000.0f);
}

// Tegangan di pin ADC (untuk debug)
float vAdcOf(int pin) {
  return analogRead(pin) * ADC_VREF / ADC_MAX;
}

void taskKontrol(void *) {
  uint32_t tSensor = 0, tApply = 0, lastDsScan = 0;
  int lastLevel = -1;
  uint32_t warnBeepUntil = 0;

  bool fireLatched[4] = { false, false, false, false };
  uint32_t fireSince[4] = { 0, 0, 0, 0 };

  bool boostActive = false;
  uint32_t boostCondSince = 0, boostCondEnded = 0;

  for (;;) {
    // ---------- 1. Baca sensor ----------
    if (millis() - tSensor >= INTERVAL_SENSOR_READ) {
      tSensor = millis();

      // DS18B20 asinkron: baca hasil konversi sebelumnya, lalu minta yang baru
      float t = ds.getTempCByIndex(0);
      if (t != DEVICE_DISCONNECTED_C && t > -100 && t < 150) {
        xSemaphoreTake(dataMx, portMAX_DELAY);
        snap.temp = t;
        xSemaphoreGive(dataMx);
      } else {
        static bool dsWarned = false;
        if (!dsWarned) {
          dsWarned = true;
          Serial.println("[DS] Pembacaan gagal (-127) — akan di-scan ulang tiap 5 dtk");
        }
        // re-scan bus bila sensor tidak terbaca (mis. baru dicolok)
        if (millis() - lastDsScan >= 5000) {
          lastDsScan = millis();
          ds.begin();
          if (ds.getDeviceCount() > 0) Serial.printf("[DS] DS18B20 terdeteksi ulang (%d)\n", ds.getDeviceCount());
        }
      }
      ds.requestTemperatures();       // mulai konversi berikutnya (hasil dibaca 1 dtk lagi)

      float smoke = readMQ(PIN_MQ2, MQ2_RL, mq2R0, MQ2_A, MQ2_B, MQ2_CLEAN_AIR_RATIO, MQ2_R0_FALLBACK, "MQ2");
      float gas   = readMQ(PIN_MQ6, MQ6_RL, mq6R0, MQ6_A, MQ6_B, MQ6_CLEAN_AIR_RATIO, MQ6_R0_FALLBACK, "MQ6");

      bool fire[4];
      int16_t adsRaw[4];
      for (int i = 0; i < 4; i++) {
        adsRaw[i] = adsRead(i);
        fire[i] = fireDetected(i, adsRaw[i]);
      }

      xSemaphoreTake(dataMx, portMAX_DELAY);
      snap.smoke = smoke;
      snap.gas   = gas;
      for (int i = 0; i < 4; i++) snap.fire[i] = fire[i];
      xSemaphoreGive(dataMx);

      // Debug tiap 10 detik — bantu kalibrasi & cek hardware
      static uint32_t tDbg = 0;
      if (tDbg == 0) tDbg = millis();
      if (millis() - tDbg >= 10000) {
        tDbg = millis();
        Serial.printf(
          "[DBG] T=%.1fC | MQ2 raw=%d (%.2fV) asap=%.0f ppm | MQ6 raw=%d (%.2fV) gas=%.0f ppm\n"
          "[DBG] ADS raw: api1=%d api2=%d api3=%d api4=%d | th: %d,%d,%d,%d (%s)\n",
          snap.temp, (int)analogRead(PIN_MQ2), vAdcOf(PIN_MQ2), smoke,
          (int)analogRead(PIN_MQ6), vAdcOf(PIN_MQ6), gas,
          adsRaw[0], adsRaw[1], adsRaw[2], adsRaw[3],
          fireThresholdOf(0), fireThresholdOf(1), fireThresholdOf(2), fireThresholdOf(3),
          FIRE_ACTIVE_ABOVE ? ">th = api" : "<th = api");
      }
    }

    // ---------- 2. Snapshot pengaturan & perintah ----------
    Settings s;
    ActuatorCmd c;
    xSemaphoreTake(dataMx, portMAX_DELAY);
    s = S;
    c = cmd;
    xSemaphoreGive(dataMx);

    // ---------- 3. Fuzzy + level ----------
    SensorSnap d;
    xSemaphoreTake(dataMx, portMAX_DELAY);
    d = snap;
    xSemaphoreGive(dataMx);

    float wFlow, wBoost;
    int fuzzyFan; bool fuzzySpr;
    evalFuzzy(d.temp, d.smoke, d.gas, s, fuzzyFan, fuzzySpr, wFlow, wBoost);
    bool fireAny = d.fire[0] || d.fire[1] || d.fire[2] || d.fire[3];

    // simpan hasil fuzzy + level ke snapshot (untuk web & task kom)
    String reasons, eventType;
    int level = evalLevel(d, s, reasons, eventType);
    xSemaphoreTake(dataMx, portMAX_DELAY);
    snap.fuzzyFan = fuzzyFan;
    snap.fuzzySpr = fuzzySpr;
    snap.level = level;
    snap.stamp = millis();
    xSemaphoreGive(dataMx);

    // ---------- 4. Aktuator ----------
    if (millis() - tApply >= 100) {
      tApply = millis();

      // sprinkler 1-4: trigger keras api (dengan delay) ATAU perintah fuzzy
      for (int i = 0; i < 4; i++) {
        if (d.fire[i] && !fireLatched[i]) { fireLatched[i] = true; fireSince[i] = millis(); }
        if (!d.fire[i]) fireLatched[i] = false;

        bool afterDelay = d.fire[i] && fireLatched[i] &&
                          (millis() - fireSince[i] >= (uint32_t)s.sprinkler_delay * 1000UL);
        bool on = c.sprAuto[i] ? (afterDelay || fuzzySpr) : c.sprManual[i];
        int pin = (i == 0) ? PIN_RELAY_SPR1 : (i == 1) ? PIN_RELAY_SPR2 :
                  (i == 2) ? PIN_RELAY_SPR3 : PIN_RELAY_SPR4;
        relayWrite(pin, on);
      }

      // kipas: FLOW / BOOST dengan fan_delay & fan_duration
      bool boostCond = fireAny || (fuzzyFan == 2);
      if (boostCond) {
        if (boostCondSince == 0) boostCondSince = millis();
        if (millis() - boostCondSince >= (uint32_t)s.fan_delay * 1000UL) {
          boostActive = true;
          boostCondEnded = 0;
        }
      } else {
        boostCondSince = 0;
        if (boostActive) {
          if (boostCondEnded == 0) boostCondEnded = millis();
          if (millis() - boostCondEnded >= (uint32_t)s.fan_duration * 1000UL) boostActive = false;
        }
      }

      int pwm = 0;
      if (!c.fanAuto) {
        // Manual: FLOW = pelan (relay off), BOOST = kencang (relay on)
        pwm = c.fanManualActive ? (c.fanManualBoost ? 100 : 50) : 0;
      } else if (boostActive) {
        pwm = 100;                                   // BOOST (kencang)
      } else if (fuzzyFan == 1 && s.fan_idle_flow) {
        pwm = s.fuzzy_fan_flow;                      // FLOW (pelan)
      }
      // relay kipas: hanya ON saat BOOST (manual BOOST / fuzzy boost).
      // FLOW = mode pelan, relay sengaja dibiarkan MATI.
      relayWrite(PIN_RELAY_FAN, pwm >= 100);

      // buzzer: beep berdenyut saat BAHAYA (500ms on/off); 2 blip saat PERINGATAN
#if BUZZER_ENABLE
      bool phase = (millis() / BUZZER_PATTERN_MS) % 2 == 0;   // denyut
      bool buzzerOn = (level == 2) ? phase : false;
      if (level == 1 && lastLevel < 1) warnBeepUntil = millis() + 400;
      if (buzzerOn || millis() < warnBeepUntil)
        digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_HIGH ? HIGH : LOW);
      else
        digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
#endif
    }

    // ---------- 5. Level berubah → antre event + Telegram ----------
    // (boot dalam kondisi bahaya juga langsung dilaporkan)
    if ((lastLevel == -1 && level >= 1) || (lastLevel != -1 && level != lastLevel)) {
      OutMsg m;
      m.telegram = true;
      strlcpy(m.type, eventType.c_str(), sizeof(m.type));
      strlcpy(m.sev,  (level == 2) ? "danger" : (level == 1) ? "warning" : "info", sizeof(m.sev));
      String msg = (level == 0)
          ? "Kondisi kembali AMAN di " + deviceName
          : String((level == 2) ? "BAHAYA" : "PERINGATAN") + " di " + deviceName + ": " + reasons;
      strlcpy(m.msg, msg.c_str(), sizeof(m.msg));
      xQueueSend(outQueue, &m, 0);
    }
    lastLevel = level;

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// =====================================================================
//  Setup
// =====================================================================
void setup() {
  Serial.begin(115200);
  bootMs = millis();
  delay(200);
  Serial.printf("\n=== Sistem Prototype Kebakaran Rumah (FreeRTOS) | %s ===\n", DEVICE_ID);

  pinMode(PIN_RELAY_SPR1, OUTPUT); pinMode(PIN_RELAY_SPR2, OUTPUT);
  pinMode(PIN_RELAY_SPR3, OUTPUT); pinMode(PIN_RELAY_SPR4, OUTPUT);
  pinMode(PIN_RELAY_FAN,  OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  relayWrite(PIN_RELAY_SPR1, false); relayWrite(PIN_RELAY_SPR2, false);
  relayWrite(PIN_RELAY_SPR3, false); relayWrite(PIN_RELAY_SPR4, false);
  relayWrite(PIN_RELAY_FAN, false);
  digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_HIGH ? LOW : HIGH);

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_MQ2, ADC_11db);
  analogSetPinAttenuation(PIN_MQ6, ADC_11db);

  Wire.begin(I2C_SDA, I2C_SCL);
  if (!ads.begin(ADS_ADDR)) {
    Serial.println("[ADS] ADS1115 TIDAK TERDETEKSI! Cek wiring I2C/alamat 0x48.");
  } else {
    ads.setGain(GAIN_ONE);          // ±4.096V — rentang 0..32767
    ads.setDataRate(RATE_ADS1115_250SPS);  // 4 ms/baca (default 128 SPS = 8 ms)
    Serial.println("[ADS] ADS1115 siap (0x48)");
  }
  ds.begin();
  ds.setWaitForConversion(false);   // asinkron: request → tunggu → baca (tidak blocking)
  if (ds.getDeviceCount() > 0) {
    Serial.printf("[DS] DS18B20 terdeteksi (%d perangkat di bus)\n", ds.getDeviceCount());
  } else {
    Serial.println("[DS] DS18B20 TIDAK TERDETEKSI! Cek: pull-up 4.7k DATA→3.3V, kabel ke GPIO 4, GND bersama.");
  }
  ds.requestTemperatures();         // mulai konversi pertama

  WiFi.mode(WIFI_STA);
  WiFi.hostname(DEVICE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Menghubungkan ke %s", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(300); Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED
      ? "\n[WiFi] Terhubung, IP: " + WiFi.localIP().toString()
      : "\n[WiFi] Gagal — akan terus mencoba di task Komunikasi");

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // UTC
  Serial.print("[NTP] Sinkron waktu");
  t0 = millis();
  while (time(nullptr) < 100000 && millis() - t0 < 10000) { delay(300); Serial.print('.'); }
  Serial.println(" OK");

  // Auto-kalibrasi MQ di udara bersih — kalau sensor masih dingin (AO ≈ 0V)
  // kalibrasi akan dicoba ulang otomatis di task Kontrol sampai berhasil.
  readMQ(PIN_MQ2, MQ2_RL, mq2R0, MQ2_A, MQ2_B, MQ2_CLEAN_AIR_RATIO, MQ2_R0_FALLBACK, "MQ2");
  readMQ(PIN_MQ6, MQ6_RL, mq6R0, MQ6_A, MQ6_B, MQ6_CLEAN_AIR_RATIO, MQ6_R0_FALLBACK, "MQ6");

  // Baseline sensor api (pastikan TIDAK ada api saat boot!)
#if FIRE_THRESHOLD_AUTO
  for (int ch = 0; ch < 4; ch++) {
    int32_t sum = 0;
    for (int k = 0; k < 20; k++) { sum += adsRead(ch); vTaskDelay(pdMS_TO_TICKS(6)); }
    fireBase[ch] = (int16_t)(sum / 20);
  }
  Serial.printf("[ADS] Baseline api: %d, %d, %d, %d (threshold = baseline %s %d)\n",
                fireBase[0], fireBase[1], fireBase[2], fireBase[3],
                FIRE_ACTIVE_ABOVE ? "+" : "-", FIRE_MARGIN);
#endif

  // RTOS objects — HARUS sebelum pollSettings (dipakai di dalamnya)
  dataMx = xSemaphoreCreateMutex();
  outQueue = xQueueCreate(QUEUE_LEN, sizeof(OutMsg));

  // Ambil pengaturan awal + nama perangkat
  pollSettings();
  pollMeta();

  Serial.printf("[TG] Konfigurasi awal: enabled=%d, penerima=%d, token=%s\n",
                tgEnabled ? 1 : 0, nRecip,
                tgToken.length() > 8 ? (tgToken.substring(0, 6) + "..." + tgToken.substring(tgToken.length() - 4)).c_str() : "KOSONG");

  // Log boot
  {
    OutMsg m;
    m.telegram = false;
    strlcpy(m.type, "system", sizeof(m.type));
    strlcpy(m.sev, "info", sizeof(m.sev));
    String msg = "Perangkat " + deviceName + " (" + DEVICE_ID + ") terhubung / boot";
    strlcpy(m.msg, msg.c_str(), sizeof(m.msg));
    xQueueSend(outQueue, &m, 0);
  }

  // ---- Buat task dual-core ----
  xTaskCreatePinnedToCore(taskKontrol,   "Kontrol",   STACK_KONTROL, NULL, PRIO_KONTROL, NULL, CORE_KONTROL);
  xTaskCreatePinnedToCore(taskKomunikasi, "Komunikasi", STACK_KOM,     NULL, PRIO_KOM,     NULL, CORE_KOM);
  Serial.println("[RTOS] Task Kontrol (core 1) & Komunikasi (core 0) berjalan");
}

void loop() {
  // Kosong — semua kerja di task FreeRTOS
  vTaskDelete(NULL);
}
