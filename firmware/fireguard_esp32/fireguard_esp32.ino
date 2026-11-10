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
 *    - Adafruit SSD1306       (+ Adafruit GFX)  ← OLED 128x64 I2C kedua
 *  Tidak perlu library Firebase — komunikasi via REST HTTPS.
 * =====================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Fonts/FreeSansBold9pt7b.h>    // font sedang (nama & jenis bahaya)
#include <Fonts/FreeSansBold12pt7b.h>   // font besar utk panel 32px (status)
#include <Fonts/FreeSansBold18pt7b.h>   // font besar (utk panel 64px bila pakai)
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

// =====================================================================
//  2b. OLED SSD1306 — DIPASANG DI BUS Wire YANG SAMA DENGAN ADS1115
//      (GPIO 8/9, alamat 0x3C — ADS 0x48, alamat beda = aman berbagi).
//      Akses bus diserialkan dengan mutex i2cMx (ADS dibaca taskKontrol,
//      OLED ditulis taskLayar) supaya tidak tabrakan antar FreeRTOS.
// =====================================================================
#define OLED_ADDR       0x3C  // alamat panel (sudah terbukti)
#define OLED_SPLASH_MS  3000UL // durasi layar nama web + IP setelah tersambung

// prototype maju (implementasi di blok OLED tepat sebelum setup());
// dipanggil dari pollMeta/taskKontrol/taskKomunikasi di atas
void publishLcdName(const String &n);
void publishLcdData(int level, const bool *fire, const String &reasons);
void publishLcdWifi(bool ok);

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
//  3. KALIBRASI MQ2 / MQ6 — HASIL KALIBRASI SKETCH TERPISAH (2026-11-04)
//     Model Rs = RL_eff · (Vc−Vout)/Vout, RL_eff = RL_modul ∥ pembagi 20k
//     Kurva datasheet LPG: ppm = A · (Rs/R0)^B
// =====================================================================
#define MQ2_RL   1818.0f   // RL efektif = modul 202 (2 kΩ) ∥ pembagi 20 kΩ (ohm)
#define MQ6_RL   952.0f    // RL efektif = modul 102 (1 kΩ) ∥ pembagi 20 kΩ (ohm)
#define MQ2_R0   1379.0f   // R0 tersimpan dari kalibrasi (kΩ 1.379 → ohm).
                           // 0 = auto-kalibrasi saat boot di udara bersih
#define MQ6_R0   1481.0f   // R0 tersimpan dari kalibrasi (kΩ 1.481 → ohm)
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
#define INTERVAL_SENSOR_READ    500UL    // MQ + ADS tiap 500 ms (web lebih hidup)
#define INTERVAL_STATUS_PUSH    500UL    // push tiap 500 ms → web terasa realtime
#define INTERVAL_ACTUATOR_POLL  500UL    // perintah web diterapkan ≤ 0,5 dtk
#define INTERVAL_SETTINGS_POLL  30000UL
#define INTERVAL_META_POLL      60000UL
#define INTERVAL_DEVICES_POLL   5000UL   // /devices.json → layar semua rumah
#define ONLINE_WINDOW_MS        15000UL  // sama dengan web (App.tsx)
#define INTERVAL_DS_READ        1000UL   // DS18B20: konversi 800 ms → tetap 1 dtk
#define TG_COOLDOWN_MS          2000UL   // jeda minimum antar kirim Telegram
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

SemaphoreHandle_t i2cMx;         // serialisasi bus Wire (ADS1115 ↔ OLED)
SemaphoreHandle_t lcdMx;         // melindungi struct LcdInfo (data layar OLED)

// =====================================================================
//  LcdInfo — data tampilan OLED (dipakai taskLayar di bawah)
//  Didefinisikan DI ATAS fungsi pertama: Arduino menyisipkan auto-
//  prototype fungsi (drawSplashScreen(const LcdInfo&) dll.) tepat sebelum
//  fungsi pertama file ini — bila struct di bawah, compile error
//  "'LcdInfo' does not name a type".
// =====================================================================
// Kartu 1 rumah: diri sendiri diisi taskKontrol (publishLcdData),
// perangkat LAIN diisi taskKomunikasi (pollDevices, dari /devices.json).
struct LcdDev {
  String name;                           // "Rumah B" (meta RTDB) atau DEVICE_ID
  int    level;                          // 0 = AMAN, 2 = BAHAYA (threshold web)
  bool   online;                         // updated_at < 15 dtk
  bool   fire[4];
  String reasons;                        // kata "Suhu"/"Asap"/"Gas" (keyword)
};

struct LcdInfo {
  bool   wifiOk;                         // WiFi tersambung
  bool   everWifi;                       // pernah tersambung
  String ip;                             // IP saat tersambung
  String name;                           // rumah DOMAIN sendiri ("Rumah A")
  int    level;                          // 0 = AMAN, 1 = WASPADA, 2 = BAHAYA
  bool   fire[4];
  String reasons;                        // alasan level rumah sendiri
  LcdDev others[3];                      // rumah lain (maks 3)
  uint8_t nOthers;                       // jumlah rumah lain terbaca
};

LcdInfo lcdInfo;                 // data layar OLED — static → POD member zero-init.
                                 // Deklarasinya SETELAH struct & SEBELUM fungsi apa pun
                                 // yang memakai (pollDevices di bawah).

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
    publishLcdName(deviceName);       // OLED: nama rumah ikut meta RTDB
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

// =====================================================================
//  Status RUMAH LAIN untuk OLED — baca /devices.json tiap
//  INTERVAL_DEVICES_POLL. Rumah sendiri diurus taskKontrol.
//  Online & level dihitung dengan aturan yang sama dengan web
//  (updated_at < 15 dtk; threshold settings temp/smoke/gas).
// =====================================================================
// ISO-8601 "YYYY-MM-DDTHH:MM:SS..." → epoch detik (0 = gagal)
time_t isoToEpoch(const String &s) {
  if (s.length() < 19) return 0;
  struct tm t = {};
  t.tm_year = s.substring(0,  4).toInt() - 1900;
  t.tm_mon  = s.substring(5,  7).toInt() - 1;
  t.tm_mday = s.substring(8, 10).toInt();
  t.tm_hour = s.substring(11, 13).toInt();
  t.tm_min  = s.substring(14, 16).toInt();
  t.tm_sec  = s.substring(17, 19).toInt();
  t.tm_isdst = 0;
  time_t e = mktime(&t);              // TZ hasil configTime = UTC
  return (e < 0) ? 0 : e;
}

void pollDevices() {
  String body;
  if (!rtdbGet("/devices.json", body) || body == "null") return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  Settings s;                          // snapshot threshold (sama dgn evalLevel web)
  xSemaphoreTake(dataMx, portMAX_DELAY);
  s = S;
  xSemaphoreGive(dataMx);

  time_t nowT = time(nullptr);
  LcdDev tmp[3]; uint8_t n = 0;

  JsonObject root = doc.as<JsonObject>();
  for (JsonPair kv : root) {
    if (n >= 3) break;
    if (strcmp(kv.key().c_str(), DEVICE_ID) == 0) continue;   // diri sendiri

    LcdDev d;                          // String ctor default; POD di-zero-init static
    d.name = String(kv.key().c_str());
    JsonObject src = kv.value().as<JsonObject>();
    if (src.isNull()) { tmp[n++] = d; continue; }             // belum ada apa2 → OFFLINE

    d.name = src["meta"]["name"] | String(kv.key().c_str());
    JsonObject st = src["status"].as<JsonObject>();
    if (st.isNull()) { tmp[n++] = d; continue; }              // belum pernah kirim status

    time_t ua = isoToEpoch(st["updated_at"] | "");
    bool online = ua > 0 && nowT >= ua &&
                  (uint32_t)(nowT - ua) <= (ONLINE_WINDOW_MS / 1000);
    if (!online) { tmp[n++] = d; continue; }                  // offline → tampil OFFLINE

    int level = 0;
    String reasons = "";
    for (int i = 1; i <= 4; i++) {
      if (st[String("fire") + i] | false) { d.fire[i - 1] = true; level = 2; }
    }
    if ((st["temperature"] | 0.0f) >= s.temp_threshold) { level = 2; reasons += "Suhu "; }
    if ((st["smoke_mq2"]   | 0  ) >= s.smoke_threshold) { level = 2; reasons += "Asap "; }
    if ((st["gas_mq6"]     | 0  ) >= s.gas_threshold)   { level = 2; reasons += "Gas "; }

    d.online = true; d.level = level; d.reasons = reasons;
    tmp[n++] = d;
  }

  xSemaphoreTake(lcdMx, portMAX_DELAY);
  lcdInfo.nOthers = n;
  for (uint8_t i = 0; i < n; i++) lcdInfo.others[i] = tmp[i];
  xSemaphoreGive(lcdMx);
}

void taskKomunikasi(void *) {
  uint32_t tStatus = 0, tAct = 0, tSet = 0, tMeta = 0, tDev = 0;
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
      publishLcdWifi(true);           // OLED: status sambung + IP
      if (millis() - tStatus >= INTERVAL_STATUS_PUSH)   { tStatus = millis(); pushStatus(); }
      if (millis() - tAct   >= INTERVAL_ACTUATOR_POLL)  { tAct = millis();    pollActuators(); }
      if (millis() - tSet   >= INTERVAL_SETTINGS_POLL)  { tSet = millis();    pollSettings(); }
      if (millis() - tMeta  >= INTERVAL_META_POLL)      { tMeta = millis();   pollMeta(); }
      if (millis() - tDev   >= INTERVAL_DEVICES_POLL)   { tDev  = millis();   pollDevices(); }
    } else {
      publishLcdWifi(false);          // OLED: kembali ke animasi koneksi
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
  xSemaphoreTake(i2cMx, portMAX_DELAY);   // bus Wire dipakai bersama taskLayar (OLED)
  int16_t v = ads.readADC_SingleEnded(ch);
  xSemaphoreGive(i2cMx);
  return v;
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
  // analogReadMilliVolts = hasil kalibrasi pabrik ESP32-S3 — konsisten dengan
  // sketch kalibrasi (yang mengukur Vadc dengan cara yang sama)
  uint32_t sum = 0;
  for (int i = 0; i < 10; i++) { sum += analogReadMilliVolts(pin); vTaskDelay(pdMS_TO_TICKS(2)); }
  float vAdc = (sum / 10.0f) / 1000.0f;           // tegangan di pin ADC (V)
  float vOut = vAdc * MQ_DIVIDER;                 // tegangan keluaran modul (0..5V)
  if (vOut <= 0.05f) return 0;
  if (vOut > MQ_VC - 0.05f) vOut = MQ_VC - 0.05f; // saturasi
  float rs = RL * (MQ_VC - vOut) / vOut;          // Rs = RL·(Vc−Vout)/Vout

  // Kalibrasi R0: hanya berjalan bila R0 belum di-set (0).
  // R0 di MQ2_R0/MQ6_R0 sudah di-hard-code hasil kalibrasi → bagian ini dilewati.
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

// Tegangan di pin ADC (untuk debug) — pakai analogReadMilliVolts
float vAdcOf(int pin) {
  return analogReadMilliVolts(pin) / 1000.0f;
}

void taskKontrol(void *) {
  uint32_t tSensor = 0, tApply = 0, lastDsScan = 0;
  int lastLevel = -1;
  uint32_t warnBeepUntil = 0;

  bool boostActive = false;
  uint32_t boostCondSince = 0, boostCondEnded = 0;
  uint32_t fzSprSince = 0;         // jeda jalur fuzzy untuk sprinkler

  for (;;) {
    // ---------- 1. Baca sensor ----------
    if (millis() - tSensor >= INTERVAL_SENSOR_READ) {
      tSensor = millis();

      // DS18B20 asinkron: konversi butuh ~800 ms → baca/minta TIAP 1 dtk
      // (bila dipaksa 500 ms konversi selalu terputus → suhu tak pernah segar)
      static uint32_t tDs = 0;
      if (millis() - tDs >= INTERVAL_DS_READ) {
        tDs = millis();
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
        ds.requestTemperatures();     // mulai konversi berikutnya (hasil dibaca 1 dtk lagi)
      }

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
    publishLcdData(level, d.fire, reasons);   // OLED: level + api + alasan

    // ---------- 4. Aktuator ----------
    if (millis() - tApply >= 100) {
      tApply = millis();

      // sprinkler 1-4:
      //  - Api keras di titik i → sprinkler i ON LANGSUNG (tanpa delay; sama
      //    cepat dengan buzzer). Delay sprinkler hanya membatasi jalur fuzzy.
      //  - Tanpa api (hanya asap/gas tinggi) → ikut hasil fuzzy (dengan jeda
      //    sprinkler_delay dari Pengaturan; 0 = langsung).
      bool fuzzySprOn = false;
      if (fuzzySpr) {
        if (fzSprSince == 0) fzSprSince = millis();
        if (s.sprinkler_delay == 0 ||
            millis() - fzSprSince >= (uint32_t)s.sprinkler_delay * 1000UL) fuzzySprOn = true;
      } else {
        fzSprSince = 0;
      }
      for (int i = 0; i < 4; i++) {
        bool on = c.sprAuto[i] ? (d.fire[i] || fuzzySprOn) : c.sprManual[i];
        int pin = (i == 0) ? PIN_RELAY_SPR1 : (i == 1) ? PIN_RELAY_SPR2 :
                  (i == 2) ? PIN_RELAY_SPR3 : PIN_RELAY_SPR4;
        relayWrite(pin, on);
      }

      // kipas: api keras ATAU gas tinggi → BOOST LANGSUNG (tanpa fan_delay);
      // kondisi fuzzy saja (asap tinggi tanpa keduanya) tetap menghormati fan_delay.
      // fan_duration tetap berlaku: durasi BOOST setelah semua pemicu hilang.
      bool gasHard = (d.gas >= s.gas_threshold);
      if (fireAny || gasHard) {
        boostActive = true;
        boostCondSince = 0;
        boostCondEnded = 0;
      } else if (fuzzyFan == 2) {
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
// =====================================================================
//  OLED SSD1306 128x32 — task "Layar" (core 0, prio 1)
// =====================================================================
//  - Boot / WiFi putus → animasi koneksi WiFi (ikon busur naik + titik)
//  - Baru tersambung   → 3 dtk: nama web + IP address
//  - Layar utama       → maks 2 baris:
//      AMAN    : nama rumah + "AMAN" (font besar)
//      WASPADA : jenis bahaya singkat + "WASPADA" (berkedip lambat)
//      BAHAYA  : jenis & letak ("API TITIK 2", "ASAP TINGGI", ...) + font
//                besar "BAHAYA" + animasi api berkedip / asap naik
//  Panel berbagi bus Wire dengan ADS1115 → transfer pakai mutex i2cMx.
//  Data ditulis taskKontrol (level, api, alasan) & taskKomunikasi
//  (WiFi/IP/nama) di balik mutex lcdMx — dibaca taskLayar tiap 50 ms.
// =====================================================================
Adafruit_SSD1306 lcd(128, 32, &Wire, -1);
bool lcdOk = false;

// (Deklarasi variabel lcdInfo ada di blok state atas file, setelah struct.)

void publishLcdWifi(bool ok) {
  if (!lcdOk) return;
  String ip = (ok ? WiFi.localIP().toString() : "");
  xSemaphoreTake(lcdMx, portMAX_DELAY);
  if (lcdInfo.wifiOk != ok) lcdInfo.wifiOk = ok;
  if (ok && lcdInfo.ip != ip) lcdInfo.ip = ip;
  xSemaphoreGive(lcdMx);
}

void publishLcdName(const String &n) {
  if (!lcdOk) return;
  xSemaphoreTake(lcdMx, portMAX_DELAY);
  lcdInfo.name = n;
  xSemaphoreGive(lcdMx);
}

void publishLcdData(int level, const bool *fire, const String &reasons) {
  if (!lcdOk) return;
  xSemaphoreTake(lcdMx, portMAX_DELAY);
  lcdInfo.level = level;
  for (int i = 0; i < 4; i++) lcdInfo.fire[i] = fire[i];
  lcdInfo.reasons = reasons;
  xSemaphoreGive(lcdMx);
}

// ---------- ikon & animasi ----------

// Ikon WiFi: titik + busur sinyal (level 0..3), baseD = radius titik,
// stepD = jarak antar busur (besar utk animasi koneksi, kecil utk sudut layar)
void drawWifiArc(int cx, int cy, uint8_t level, int baseD, int stepD) {
  lcd.fillCircle(cx, cy, baseD, SSD1306_WHITE);
  for (uint8_t i = 1; i <= level; i++) {
    int r = baseD + i * stepD;                       // 0x1|0x2 = setengah lingkaran atas
    lcd.drawCircleHelper(cx, cy, r,     0x1 | 0x2, SSD1306_WHITE);
    lcd.drawCircleHelper(cx, cy, r + 1, 0x1 | 0x2, SSD1306_WHITE);
  }
}

// Api berkedip (frame 0..3 — tinggi/lebar lidah berganti)
void drawFlame(int cx, int baseY, uint8_t frame) {
  int h = 9 + (frame & 1) * 3;
  int w = 5 + ((frame >> 1) & 1) * 2;
  lcd.fillTriangle(cx - w, baseY, cx + w, baseY, cx, baseY - h, SSD1306_WHITE);
  lcd.fillCircle(cx, baseY - 3, 4, SSD1306_WHITE);
  lcd.fillCircle(cx, baseY - 2, 2, SSD1306_BLACK);   // inti gelap
}

// Asap naik (bola-bola berganti posisi)
void drawSmoke(int cx, int baseY, uint8_t frame) {
  for (uint8_t i = 0; i < 3; i++) {
    int dy = (frame * 2 + i * 7) % 16;
    int side = ((i + frame) & 1) ? 3 : -3;
    lcd.drawCircle(cx + side, baseY - dy, 3, SSD1306_WHITE);
  }
}

// ---------- panel & helper teks ----------

// Kirim frame ke panel — transfer I2C dijaga mutex bus (dipakai ADS juga)
void lcdShow() {
  xSemaphoreTake(i2cMx, portMAX_DELAY);
  lcd.display();
  xSemaphoreGive(i2cMx);
}

// Teks status besar di tengah (y = baseline) — 12pt agar muat layar 32px
void drawBigStatus(const char *txt, int y) {
  lcd.setFont(&FreeSansBold12pt7b);
  int16_t x1, y1; uint16_t w, h;
  lcd.getTextBounds(txt, 0, 0, &x1, &y1, &w, &h);
  lcd.setCursor((128 - (int)w) / 2, y);
  lcd.print(txt);
  lcd.setFont();
}

// Teks jenis bahaya besarmenengah (9pt)
void drawReasonLine(const String &s, int y) {
  lcd.setFont(&FreeSansBold9pt7b);
  int16_t x1, y1; uint16_t w, h;
  lcd.getTextBounds(s.c_str(), 0, 0, &x1, &y1, &w, &h);
  int x = (128 - (int)w) / 2; if (x < 0) x = 0;
  lcd.setCursor(x, y);
  lcd.print(s);
  lcd.setFont();
}

// Susun daftar singkat jenis-letak bahaya dari SATU kartu rumah:
// entri-0 = nama rumah itu sendiri (muncul bergantian di layar), lalu
// api (letak titik) dan suhu/asap/gas dari keyword di reasons.
void buildReasonList(const String &name, const bool *fire, const String &reasons,
                     String out[5], uint8_t &n) {
  n = 0;
  if (name.length()) out[n++] = name;
  String f;                                          // api → letak (titik)
  for (int i = 0; i < 4; i++)
    if (fire[i]) f += String(f.length() ? ", " : "") + String(i + 1);
  if (f.length()) out[n++] = "API TITIK " + f;
  if (reasons.indexOf("Suhu") >= 0)  out[n++] = "SUHU TINGGI";
  if (reasons.indexOf("Asap") >= 0)  out[n++] = "ASAP TINGGI";
  if (reasons.indexOf("Gas")  >= 0)  out[n++] = "GAS TINGGI";
}

// ---------- layar-layar ----------

void drawConnectingScreen() {
  uint8_t arc = (millis() / 350) % 4;                // busur naik 0→3 lalu ulang
  uint8_t dot = (millis() / 250) % 3;                // titik yang melompat
  lcd.clearDisplay();
  lcd.setTextColor(SSD1306_WHITE);
  drawWifiArc(20, 24, arc, 2, 4);                    // ikon WiFi (radius maks 14)
  lcd.setFont(&FreeSansBold9pt7b);
  lcd.setCursor(44, 16); lcd.print(F("WIFI"));
  lcd.setFont();
  lcd.setTextSize(1);
  lcd.setCursor(44, 20); lcd.print(F("menghubungkan.."));
  for (uint8_t i = 0; i < 3; i++)
    lcd.fillCircle(52 + i * 12, 28, (i == dot) ? 3 : 2, SSD1306_WHITE);
  lcdShow();
}

void drawSplashScreen(const LcdInfo &inf, uint32_t since) {
  lcd.clearDisplay();
  lcd.setTextColor(SSD1306_WHITE);
  // baseline 9pt = 12px dari atas glyph — kurang dari itu → tulisan kepotong
  lcd.setFont(&FreeSansBold9pt7b);
  lcd.setCursor(2, 12);  lcd.print(F("Sistem Prototype"));
  lcd.setCursor(2, 24);  lcd.print(F("Kebakaran Rumah"));
  // alamat web berjalan (marquee) + IP di jalur paling bawah
  drawMarquee(String("monitoringkebakaranrumah.web.app | IP ") + inf.ip, 31, since);
  lcdShow();
}

// Teks berjalan dari kanan ke kiri tanpa terputus (duituhkan satu set font
// default; y = TOP koordinat teks size 1). since = t0 animasi.
void drawMarquee(const String &txt, int y, uint32_t since) {
  lcd.setFont();
  lcd.setTextSize(1);
  int16_t x1, y1; uint16_t w, h;
  lcd.getTextBounds(txt.c_str(), 0, 0, &x1, &y1, &w, &h);
  int gap = 12;                          // jarak antar pengulangan
  int period = (int)w + gap;
  int firstX = 128 - (int)((millis() - since) % (uint32_t)period);
  lcd.setCursor(firstX, y);       lcd.print(txt);
  lcd.setCursor(firstX + period, y); lcd.print(txt);  // salinan utk loop mulus
  lcd.setFont();
}

void drawMainScreen(const LcdInfo &inf) {
  uint8_t frame = (millis() / 280) & 0x03;           // 4 frame @ ~3.6 fps
  lcd.clearDisplay();
  lcd.setTextColor(SSD1306_WHITE);

  // Kartu rumah: 0 = diri sendiri, 1..nOthers = rumah lain (si RTDB)
  const String *nm[4]; const bool *fr[4]; const String *rs[4];
  int lv[4]; bool on[4];
  nm[0] = &inf.name; fr[0] = inf.fire; rs[0] = &inf.reasons;
  lv[0] = inf.level; on[0] = true;                   // diri sendiri selalu "on"
  for (uint8_t i = 0; i < inf.nOthers; i++) {
    nm[i + 1] = &inf.others[i].name;
    fr[i + 1] = inf.others[i].fire;
    rs[i + 1] = &inf.others[i].reasons;
    lv[i + 1] = inf.others[i].level;
    on[i + 1] = inf.others[i].online;
  }
  uint8_t nCard = 1 + inf.nOthers;

  // Prioritas: kartu BAHAYA mana pun → satu layar penuh (sebabnya gantian)
  int dangerSel = -1;
  for (uint8_t i = 0; i < nCard; i++)
    if (lv[i] >= 2) { dangerSel = i; break; }

  if (dangerSel >= 0) {
    String list[5]; uint8_t n;
    buildReasonList(*nm[dangerSel], fr[dangerSel], *rs[dangerSel], list, n);
    // entri bergantian 1,2 dtk: "Rumah B" → "API TITIK 2" → ...
    const String &e = list[(millis() / 1200) % max(n, (uint8_t)1)];
    drawReasonLine(e, 12);
    drawBigStatus("BAHAYA", 31);
    bool hasFire = false;
    for (uint8_t j = 0; j < n && !hasFire; j++) hasFire = list[j].startsWith("API");
    if (hasFire) drawFlame(118, 31, frame);          // animasi api (kanan-bawah)
    else         drawSmoke(118, 31, frame);          // animasi asap naik
  } else {
    // Tidak ada bahaya → rumah bergantian tampil tiap 3 dtk
    uint8_t sel = (millis() / 3000) % nCard;
    drawReasonLine(*nm[sel], 12);
    if (!on[sel]) {
      drawBigStatus("OFFLINE", 31);                  // rumah itu tidak mengirim >15 dtk
    } else if (lv[sel] >= 1) {
      if ((millis() / 600) & 1) drawBigStatus("WASPADA", 31);  // berkedip lambat
      drawSmoke(118, 31, frame);
    } else {
      drawWifiArc(121, 12, 3, 2, 3);                 // sinyal kecil kanan-atas
      drawBigStatus("AMAN", 31);
    }
  }
  lcdShow();
}

void taskLayar(void *) {
  enum { ST_CONNECT, ST_SPLASH, ST_MAIN } st = ST_CONNECT;
  bool lastWifi = false;
  uint32_t splashAt = 0;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(50));

    LcdInfo inf;
    xSemaphoreTake(lcdMx, portMAX_DELAY);
    inf = lcdInfo;
    xSemaphoreGive(lcdMx);

    if (!inf.wifiOk) {                               // WiFi belum/putus
      st = ST_CONNECT; lastWifi = false;
      drawConnectingScreen();
      continue;
    }
    if (!lastWifi) {                                 // baru tersambung → splash
      st = ST_SPLASH; splashAt = millis(); lastWifi = true;
    }
    if (st == ST_SPLASH) {
      drawSplashScreen(inf, splashAt);
      if (millis() - splashAt >= OLED_SPLASH_MS) st = ST_MAIN;
      continue;
    }
    drawMainScreen(inf);
  }
}

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

  // RTOS objects — HARUS paling awal: i2cMx dipakai adsRead() saat baseline
  // diambil di setup, dataMx dipakai pollSettings/pollMeta. (Sebelumnya
  // dibuat di bawah → assert failed xQueueSemaphoreTake (pxQueue NULL).)
  dataMx = xSemaphoreCreateMutex();
  lcdMx  = xSemaphoreCreateMutex();   // data tampilan OLED (LcdInfo)
  i2cMx  = xSemaphoreCreateMutex();   // serialisasi bus Wire (ADS ↔ OLED)
  outQueue = xQueueCreate(QUEUE_LEN, sizeof(OutMsg));
  if (!ads.begin(ADS_ADDR)) {
    Serial.println("[ADS] ADS1115 TIDAK TERDETEKSI! Cek wiring I2C/alamat 0x48.");
  } else {
    ads.setGain(GAIN_ONE);          // ±4.096V — rentang 0..32767
    ads.setDataRate(RATE_ADS1115_250SPS);  // 4 ms/baca (default 128 SPS = 8 ms)
    Serial.println("[ADS] ADS1115 siap (0x48)");
  }

  // ---- OLED SSD1306 di bus Wire yang sama dengan ADS1115 (addr 0x3C,
  //      berbeda dari ADS 0x48 → aman berbagi). Akses antar-task diserialkan
  //      lewat mutex i2cMx (dibuat di blok RTOS; task belum jalan di sini).
  if (lcd.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    lcdOk = true;
    lcd.clearDisplay();
    lcd.setTextColor(SSD1306_WHITE);
    lcd.display();                  // aman: task Layar belum berjalan
    lcdInfo.name = DEVICE_ID;       // default s/d meta/name dari RTDB masuk
    Serial.printf("[LCD] SSD1306 siap (0x%02X, bus Wire SDA=%d SCL=%d, digabung ADS)\n",
                  OLED_ADDR, I2C_SDA, I2C_SCL);
  } else {
    Serial.println("[LCD] SSD1306 TIDAK TERDETEKSI di 0x3C — layar dipaksa mati, "
                   "sistem tetap jalan. Kabel OLED tetap di SDA=8/SCL=9.");
  }
  ds.begin();
  ds.setWaitForConversion(false);   // asinkron: request → tunggu → baca (tidak blocking)
  if (ds.getDeviceCount() > 0) {
    Serial.printf("[DS] DS18B20 terdeteksi (%d perangkat di bus)\n", ds.getDeviceCount());
  } else {
    Serial.println("[DS] DS18B20 TIDAK TERDETEKSI! Cek: pull-up 4.7k DATA→3.3V, kabel ke GPIO 4, GND bersama.");
  }
  ds.requestTemperatures();         // mulai konversi pertama

  uint32_t lcdAnimT = 0;                       // acuan fps animasi koneksi di setup
  WiFi.mode(WIFI_STA);
  WiFi.hostname(DEVICE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Menghubungkan ke %s", WIFI_SSID);
  uint32_t t0 = millis();
  if (lcdOk) drawConnectingScreen();          // startup: animasi koneksi di OLED
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(300); Serial.print('.');
    if (lcdOk && millis() - lcdAnimT >= 120) { lcdAnimT = millis(); drawConnectingScreen(); }
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
  if (lcdOk) {                        // task Layar hanya bila OLED terdeteksi
    xTaskCreatePinnedToCore(taskLayar, "Layar", 8192, NULL, 1, NULL, 0);
    Serial.println("[RTOS] Task Layar (core 0) berjalan");
  }
  Serial.println("[RTOS] Task Kontrol (core 1) & Komunikasi (core 0) berjalan");
}

void loop() {
  // Kosong — semua kerja di task FreeRTOS
  vTaskDelete(NULL);
}
