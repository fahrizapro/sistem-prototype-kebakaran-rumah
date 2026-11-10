# Firmware ESP32-S3 — Sistem Prototype Kebakaran Rumah (FreeRTOS)

Firmware ini **identik untuk semua perangkat** — perbedaan tiap ESP32 hanya pada
`#define DEVICE_ID` di bagian atas sketch. Path database otomatis mengikuti ID:

| Path RTDB | Arah | Isi |
|---|---|---|
| `devices/{ID}/status` | ESP32 → web | suhu °C, asap ppm, gas ppm, fire1–4, hasil fuzzy |
| `devices/{ID}/actuators` | web → ESP32 | mode auto/manual + manual_active sprinkler 1–4; fan1 juga punya `manual_level` `flow`/`boost` |
| `settings` | web → ESP32 | threshold, parameter fuzzy, delay, konfigurasi Telegram |
| `events` | ESP32 → web | log kejadian (tampil di menu Log Kejadian) |

## Arsitektur FreeRTOS (dual-core)

| Task | Core | Tugas |
|---|---|---|
| **Kontrol** (prio 3) | Core 1 (APP) | Baca DS18B20 (asinkron), MQ2/MQ6, ADS1115 (api 1–4) → fuzzy Mamdani → relay sprinkler & kipas → buzzer. **Tidak pernah menyentuh jaringan** — kontrol tetap jalan walau WiFi putus. |
| **Komunikasi** (prio 2) | Core 0 (PRO) | WiFi + reconnect, push status (2 s), poll actuators (1,5 s), settings (30 s), meta (60 s), tulis events, kirim Telegram (cooldown 60 s). |

Sinkronisasi: `dataMx` (mutex) melindungi struct sensor/pengaturan/perintah;
`outQueue` (FreeRTOS queue) membawa log kejadian & permintaan Telegram dari
task Kontrol ke task Komunikasi — sehingga HTTP yang lambat tidak pernah
menunda reaksi aktuator.

## 1. Instalasi

1. **Arduino IDE** → Board: *ESP32S3 Dev Module* (instal board ESP32 via Boards Manager).
2. **Library Manager** — instal:
   - **ArduinoJson** (Benoit Blanchon, v7.x)
   - **OneWire** (Paul Stoffregen) + **DallasTemperature** (Miles Burton)
   - **Adafruit ADS1X15** (+ **Adafruit BusIO**)
3. Tidak perlu library Firebase — komunikasi memakai REST HTTPS langsung.

## 2. Konfigurasi (bagian atas `fireguard_esp32.ino`)

```cpp
#define DEVICE_ID        "ESP32-A"   // ← ganti di tiap board: ESP32-B, ESP32-C, ...
#define WIFI_SSID        "NAMA_WIFI"
#define WIFI_PASSWORD    "PASSWORD_WIFI"
#define FIREBASE_DB_URL  "https://fireguard-ff7c1-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_DB_SECRET ""        // kosongkan selama rules terbuka
```

> **Penting:** daftarkan dulu Device ID di web (menu **Kelola Perangkat**)
> sebelum menyalakan ESP32, agar device muncul di dashboard.

## 3. Wiring (sesuai hardware Anda)

| Modul | Interface | Pin ESP32-S3 | Catatan |
|---|---|---|---|
| ADS1115 | I2C 0x48 (ADDR→GND) | SDA=GPIO 8, SCL=GPIO 9 | A0=Api 1, A1=Api 2, A2=Api 3, A3=Api 4 |
| DS18B20 | OneWire | GPIO 4 | pull-up 4.7kΩ ke 3.3V |
| Buzzer (via BC548 NPN) | Digital out | GPIO 5 | **aktif-HIGH** (`BUZZER_ACTIVE_HIGH 1`) — GPIO HIGH → NPN ON → beep berdenyut saat BAHAYA |
| MQ2 AO | ADC1_CH0 | GPIO 1 | **via divider 10k/10k** (sudah dikompensasi di kode) |
| MQ6 AO | ADC1_CH1 | GPIO 2 | idem divider 10k/10k |
| Relay IN1–IN4 | Digital out | GPIO 10, 11, 12, 13 | sprinkler 1–4 |
| Relay IN5 | Digital out | GPIO 14 | kipas (fan1) |
| OLED SSD1306 128x32 | I2C 0x3C | **SDA=GPIO 8, SCL=GPIO 9** (satu bus dengan ADS1115) | alamat beda (ADS 0x48 / OLED 0x3C) → aman berbagi; akses diserialkan mutex `i2cMx` |
| Relay VCC/GND | — | 5V / GND common | — |

Jika pin I2C Anda bukan 8/9, ubah `I2C_SDA` / `I2C_SCL`. Pin OLED diatur di
`PIN_OLED_SDA` / `PIN_OLED_SCL`.

### Layar OLED SSD1306 (128x32, bus I2C bersama ADS1115)

Panel OLED ditancapkan di **bus Wire yang sama dengan ADS1115** (SDA=GPIO 8,
SCL=GPIO 9, alamat 0x3C vs ADS 0x48 — berbeda, jadi aman). Akses bus
diserialkan lewat mutex `i2cMx`: ADS dibaca `taskKontrol`, OLED ditulis
task `Layar`.

Mesin status di task `Layar` (core 0, prioritas 1, siklus 50 ms):

| Kondisi | Tampilan |
|---|---|
| Boot / WiFi putus | Animasi koneksi: ikon WiFi busur naik 0→3 + titik melompat ("WIFI menghubungkan..") |
| Baru tersambung | **3 detik** (`OLED_SPLASH_MS`): "Sistem Prototype / Kebakaran Rumah" + **alamat web berjalan (marquee)** + `IP x.x.x.x` |
| Layar utama — AMAN | Baris 1: nama rumah (meta `name` di RTDB; default DEVICE_ID); baris 2: **AMAN** (FreeSansBold 12pt) |
| Layar utama — WASPADA | Jenis bahaya singkat + **WASPADA** berkedip lambat + animasi asap |
| Layar utama — BAHAYA | Jenis & letak ("API TITIK 2", "SUHU/ASAP/GAS TINGGI" — bergantian tiap 1,2 dtk bila lebih dari satu) + **BAHAYA** besar + animasi api berkedip (saat api) / asap naik |

Data sensor/status disalurkan antar-task lewat mutex `lcdMx` (struct `LcdInfo`):
taskKontrol mengirim level + api per titik + alasan; taskKomunikasi mengirim
status WiFi + IP; pollMeta mengirim nama. OLED tidak terdeteksi → sistem tetap
jalan tanpa layar (log `[LCD] TIDAK TERDETEKSI`).

## 4. Kalibrasi

- **MQ2/MQ6**: model kalibrasi memakai **RL efektif = RL modul ∥ pembagi 20 kΩ**
  (MQ-2: 2 kΩ ∥ 20 kΩ = **1818 Ω**; MQ-6: 1 kΩ ∥ 20 kΩ = **952 Ω** — lihat `MQ2_RL`/`MQ6_RL`).
  Tegangan ADC dibaca dengan `analogReadMilliVolts` (kalibrasi pabrik, akurat di
  rentang rendah). **R0 sudah di-hard-code hasil kalibrasi sketch terpisah
  (2026-11-04): `MQ2_R0 = 1379 Ω`, `MQ6_R0 = 1481 Ω`** — auto-kalibrasi tidak
  berjalan selama R0 ≠ 0. Untuk kalibrasi ulang: set `MQ2_R0`/`MQ6_R0` kembali
  ke `0.0f`, boot di udara bersih, catat baris `[CAL]`, hard-code lagi. Bila 90
  detik tidak berhasil, dipakai nilai fallback 10000Ω. Gunakan `[DBG]` di Serial
- **Sensor api (ADS1115)**: threshold **otomatis dari baseline** udara bersih
  saat boot (`FIRE_THRESHOLD_AUTO 1`, margin ±2000) — pastikan TIDAK ada api
  saat ESP32 dinyalakan. Baseline & threshold tercetak di Serial; nilai mentah
  per channel tampil di log `[DBG]` tiap 10 dtk. Untuk mode manual, set
  `FIRE_THRESHOLD_AUTO 0` + isi `FIRE_THRESHOLD`.
- **Relay**: modul Anda aktif-LOW (`RELAY_ACTIVE_LOW 1` — IN = LOW → relay ON).
- **Buzzer**: dikendalikan transistor **BC548 NPN** (GPIO HIGH → buzzer bunyi,
  `BUZZER_ACTIVE_HIGH 1`) — pola **beep berdenyut** saat BAHAYA, 2 blip saat
  masuk PERINGATAN. Bunyi terus-menerus (bukan denyut) = polaritas salah.
- **Kecepatan**: koneksi HTTPS ke RTDB di-reuse (keep-alive) sehingga tidak ada
  handshake TLS ulang per request — status push tiap **500 ms** terasa realtime.
  Jika masih lambat, kebanyakan berarti WiFi lambat, bukan firmware.

## 5. Cara kerja

- **Fuzzy Mamdani** identik dengan web (`evalFuzzy` di `src/lib/db.ts`):
  3 input (suhu/asap/gas), 27 rule, MIN–MAX, defuzzifikasi diskrit →
  kipas **FLOW** / **BOOST**, sprinkler ON saat rule BAHAYA menyala.
- **Trigger keras:** api i (via ADS1115) → sprinkler i **ON LANGSUNG** dan
  kipas **BOOST LANGSUNG**; **gas ≥ threshold → kipas BOOST LANGSUNG** juga
  (tanpa delay — sama cepat dengan buzzer). Slider `sprinkler_delay` /
  `fan_delay` hanya membatasi **jalur fuzzy** (asap tinggi tanpa api/gas;
  0 = langsung). `fan_duration` tetap tahanan
  BOOST setelah semua pemicu hilang. Buzzer ON denyut saat BERBAHAYA.
- **Perintah web:** mode `manual` + `manual_active` menimpa perilaku auto.
  Kipas manual punya dua level: `manual_level: "flow"` (pelan, relay off) dan
  `"boost"` (kencang, relay on). Auto tetap berjalan fuzzy: FLOW = relay off,
  BOOST = relay on.
- **Safety auto-switch saat BAHAYA:** mode manual TIDAK boleh memblokir
  respons kebakaran. Saat level masuk BAHAYA (level 2), firmware mem-patch
  semua node `actuators` ke `mode:auto` + `manual_active:false`
  (`manual_level: "flow"` untuk kipas) dan mereset perintah manual lokal —
  logika api/fuzzy otomatis berlaku lagi. Tercatat di Serial sebagai
  `[KOM] BAHAYA — semua aktuator dikembalikan ke mode AUTO`, dan panel web
  ikut menampilkan mode AUTO. Setting manual harus di-set ulang setelahnya.
- **Telegram:** saat level berubah, task Komunikasi mengirim pesan HTML ke
  semua penerima di `settings/telegram` (cooldown 60 detik).
- **Log kejadian** dikirim ke `events` setiap perubahan level + saat boot.

## 6. Verifikasi koneksi ke web

1. Serial Monitor 115200 — pastikan: `ADS1115 siap`, `WiFi Terhubung`,
   `Pengaturan diperbarui`, `Nama perangkat`, `Task Kontrol & Komunikasi berjalan`.
2. Buka https://monitoringkebakaranrumah.web.app → masuk ke device → nilai sensor
   bergerak tiap ±2 detik.
3. Uji aktuator dari web: kipas Manual → BOOST → relay IN5 ON.
4. Uji notifikasi: tombol **Kirim Uji** di menu Notifikasi Telegram.

## 7. Keamanan (opsional, untuk produksi)

Saat ini rules RTDB terbuka (demo). Jika nanti dikunci:
1. Project settings → Service accounts → **Database secrets** → salin secret.
2. Isi `FIREBASE_DB_SECRET`.
3. Untuk HTTPS ketat, ganti `tlsClient.setInsecure()` dengan sertifikat Google.

## 8. Troubleshooting cepat

| Gejala | Cek |
|---|---|
| Relay terbalik (ON saat harusnya OFF) | `RELAY_ACTIVE_LOW` — ganti 0 ↔ 1 |
| Buzzer nyala terus (tanpa denyut) | `BUZZER_ACTIVE_HIGH` — driver BC548 pakai 1 (HIGH=bunyi); denyut = level BAHAYA |
| Api terdeteksi terbalik / tidak pernah | `FIRE_ACTIVE_ABOVE`; lihat `[DBG] ADS raw` & baseline `[ADS]` |
| Gas selalu 0 ppm | Tunggu kalibrasi (`[CAL]`); cek `[DBG] MQ raw` — kalau 0V cek wiring AO & divider |
| Suhu 0 / -127 | `[DS]` saat boot — pull-up 4.7k DATA→3.3V & GND bersama; ada scan ulang otomatis tiap 5 dtk |
| Telegram tidak terkirim | Serial: `[TG] Konfigurasi awal` (enabled/penerima/token), `[TG] GAGAL ...` = alasan dari Telegram |
| Web update lambat | Cek `[DBG]` tetap berdenyut 10 dtk — kalau sensor cepat tapi web lambat, WiFi/RTDB lambat |
