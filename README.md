# 🔥 Sistem Prototype Kebakaran Rumah

Sistem pemantau & pemadam kebakaran rumah berbasis **ESP32-S3 (FreeRTOS)** dengan dashboard web **React + Firebase Realtime Database**. Perangkat mendukung banyak device — cukup bedakan **Device ID**, semua memakai program yang sama.

**Demo live:** https://monitoringkebakaranrumah.web.app

---

## ✨ Fitur

### Dashboard Web
- **Pemantauan realtime** — suhu (DS18B20), asap MQ-2, gas MQ-6, deteksi api 4 titik (sensor api via ADS1115)
- **Status Aman / Waspada / Bahaya** yang dihitung di sisi web dan firmware (identik)
- **Kontrol aktuator remote**: 4 sprinkler (Auto / Manual-Aktif / Manual-Mati) + kipas (Auto / Manual FLOW / Manual BOOST)
- **Indikator Online/Offline per device** — deteksi heartbeat dari aliran `updated_at` (ambang 15 detik)
- **Info log kejadian** (event log dengan severity) & grafik keanggotaan fuzzy di modal Informasi
- **Notifikasi Telegram** — konfigurasi bot + daftar penerima langsung dari web, tombol kirim uji
- **Manajemen device** dinamis (tambah/hapus/rename device via UI)
- **Mobile-friendly** — responsif untuk Android

### Firmware ESP32-S3 (FreeRTOS dual-core)
- **Fuzzy Mamdani** 3 input × 27 rule, MIN–MAX, defuzzifikasi diskrit → kipas FLOW / BOOST, sprinkler ON saat rule bahaya — implementasi identik dengan sisi web
- **Trigger keras api**: sprinkler titik i menyala setelah `sprinkler_delay`, kipas BOOST setelah `fan_delay`, bertahan `fan_duration` setelah pemicu hilang
- **Auto-baseline sensor api** (`FIRE_THRESHOLD_AUTO`), kalibrasi MQ-2/MQ-6 otomatis saat boot
- **Status push 1 detik ke RTDB** → web menunjukkan device Online/Offline
- **Telegram**: alert perubahan level ke semua penerima (kirim pertama tanpa cooldown, lalu cooldown 60 detik)
- **Safety auto-switch**: saat kondisi **BAHAYA**, semua aktuator yang tersisa di mode manual dipaksa kembali ke **AUTO** — mode manual tak bisa memblokir respons kebakaran (patch RTDB + reset perintah lokal)

---

## 📁 Struktur Project

```
├── src/                        # Dashboard web (React + TypeScript + Tailwind)
│   ├── App.tsx                 # Entry: device selection, tracking online/offline
│   ├── components/             # SensorCard, SprinklerControl, FanControl, modals, dll.
│   ├── lib/
│   │   ├── firebase.ts         # Init Firebase dari variabel .env
│   │   ├── db.ts               # Fuzzy eval, hazard eval, helpers RTDB
│   │   └── telegram.ts         # Kirim pesan uji Telegram
│   └── index.css               # Theme Tailwind (dark)
├── firmware/
│   ├── fireguard_esp32/fireguard_esp32.ino   # Firmware utama (FreeRTOS dual-core)
│   └── README.md               # Wiring, kalibrasi, troubleshooting firmware
├── supabase/migrations/        # Versi lama (sudah diganti Firebase) — arsip
├── firebase.json / .firebaserc # Hosting Firebase (situs: monitoringkebakaranrumah)
└── database.rules.json         # Rules RTDB (terbuka untuk demo)
```

---

## 🚀 Menjalankan Dashboard Web

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Setup Firebase** — ikuti panduan [FIREBASE_SETUP.md](FIREBASE_SETUP.md):
   - Buat project Firebase → aktifkan **Realtime Database** (region Asia-Southeast1)
   - Salin konfigurasi web app → buat file `.env` berdasarkan `.env.example`:
     ```bash
     copy .env.example .env
     # isi semua nilai dari Project settings → Your apps → SDK setup
     ```

3. **Development**
   ```bash
   npm run dev        # http://localhost:5173
   ```

4. **Deploy ke Firebase Hosting**
   ```bash
   npm run deploy     # vite build + firebase deploy (hosting + rules)
   ```

---

## 🛠 Firmware ESP32-S3

Detail lengkap (wiring, pin, kalibrasi, troubleshooting): **[firmware/README.md](firmware/README.md)**

Ringkas:
1. Board: **ESP32-S3** (Arduino IDE, install board ESP32 by Espressif)
2. Library: `ArduinoJson` (v7), `FirebaseClient`/`HTTPClient`, `Adafruit_ADS1X15`, `OneWire`, `DallasTemperature`
3. Isi konfigurasi di bagian atas `.ino`: `WIFI_SSID`, `WIFI_PASSWORD`, `DEVICE_ID`, `FIREBASE_DB_URL`
4. Wiring hardware: ADS1115 (sensor api × 4, MQ-2, MQ-6), DS18B20, relay 5 ch (4 sprinkler + 1 kipas), buzzer
5. Upload → cek Serial Monitor **115200**: `ADS1115 siap`, `WiFi Terhubung`, `Task Kontrol & Komunikasi berjalan`

### Alur data firmware → web
| Node RTDB | Arah | Isi |
|---|---|---|
| `devices/{ID}/status` | ESP32 → web | temperature, smoke_mq2, gas_mq6, fire1–4, fuzzy_fan, fuzzy_sprinkler, updated_at (tiap ±1 dtk) |
| `devices/{ID}/actuators` | web ↔ ESP32 | sprinkler1–4 & fan1: mode + manual (fan1 punya `manual_level`: flow/boost) |
| `settings` | web → ESP32 | threshold sensor + parameter fuzzy + delay + config Telegram |
| `events` | ESP32 → web | log kejadian (fire/smoke/gas/temperature/system + severity) |

---

## 🧠 Logika Hazard (identik web ↔ firmware)

| Level | Kondisi | Respons |
|---|---|---|
| **AMAN** (0) | semua sensor di bawah threshold | kipas FLOW (idle), sprinkler OFF |
| **WASPADA** (1) | suhu ≥ 75% threshold bahaya, atau asap/gas tinggi | kipas mengikuti hasil fuzzy, membantu sirkulasi udara |
| **BAHAYA** (2) | api terdeteksi di titik mana pun, atau multi-sensor bahaya menyeberang threshold | sprinkler delay menyala, kipas BOOST, buzzer, Telegram + aktuator manual di-**force** ke AUTO |

Kondisi manual:
- **Sprinkler manual** → hanya mengikuti `manual_active` yang dipilih dari web
- **Kipas manual** → FLOW (relay OFF) / BOOST (relay ON)
- Mode manual **tidak berlaku** jika level berubah ke BAHAYA → semua aktuator otomatis balik ke AUTO

---

## 📄 Lisensi & Catatan

- Project prototype untuk tujuan pembelajaran/demo tugas.
- Rules RTDB saat ini terbuka (cocok untuk demo). Untuk produksi, kunci sesuai [dokumen keamanan Firebase](FIREBASE_SETUP.md).
- Folder `supabase/` adalah sisa skema database versi lama — tidak dipakai runtime, disimpan sebagai arsip.
