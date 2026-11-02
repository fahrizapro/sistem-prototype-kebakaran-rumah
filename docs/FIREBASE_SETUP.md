# Panduan Setup Firebase Realtime Database

Dashboard **Fire Guard Monitor** menggunakan **Firebase Realtime Database (RTDB)** untuk semua komunikasi data. ESP32 dan web berbagi data secara realtime melalui RTDB.

## Konsep Device ID

Semua ESP32 memakai **program yang sama** — dibedakan hanya oleh **Device ID** yang dikompilasi ke tiap unit (mis. `ESP32-A`, `ESP32-B`). ID menentukan seluruh path data di RTDB. Daftarkan setiap device lewat menu **Kelola Perangkat** di dashboard (input: Device ID + Nama, mis. "Rumah A").

## 1. Ambil Konfigurasi Firebase

1. Buka [Firebase Console](https://console.firebase.google.com/) → pilih proyek Anda.
2. **Build → Realtime Database → Create Database** (pilih lokasi, mulai dalam mode terkunci/locked, aturan bisa diisi dari file ini).
3. **Project settings (⚙️) → Your apps → Web app (`</>`)** → salin objek `firebaseConfig`.
4. Isi nilai tersebut ke file `.env` di root proyek:

```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=proyek-anda.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://proyek-anda-default-rtdb.asia-southeast1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=proyek-anda
VITE_FIREBASE_STORAGE_BUCKET=proyek-anda.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

> ⚠️ **`VITE_FIREBASE_DATABASE_URL` wajib diisi** — ini URL RTDB lengkap. Untuk region Asia: `https://<proyek>-default-rtdb.asia-southeast1.firebasedatabase.app`.

## 2. Terapkan Aturan Keamanan

File `database.rules.json` di root proyek berisi aturan terbuka (sesuai desain single-tenant tanpa auth).

Cara menerapkan:
- **Console**: Realtime Database → tab **Rules** → salin isi `database.rules.json` → Publish, **atau**
- **CLI**: `npm i -g firebase-tools && firebase login && firebase deploy --only database`

## 3. Struktur Data RTDB

```jsonc
{
  "devices": {
    "ESP32-A": {                        // ⬅ key = Device ID (didaftarkan via Kelola Perangkat)
      "meta": { "name": "Rumah A", "created_at": "...", "updated_at": "..." },
      "status": {                       // ⬅ ditulis ESP32 (bacaan sensor)
        "temperature": 31.5,            // °C
        "smoke_mq2": 320,               // ppm / nilai analog MQ2
        "gas_mq6": 4.2,                 // % kebocoran gas
        "fire1": false,                 // 4 sensor api
        "fire2": false,
        "fire3": false,
        "fire4": false,
        "updated_at": "..."
      },
      "actuators": {                    // ⬅ ditulis web, dibaca ESP32 (aktuator bawaan semua device sama)
        "sprinkler1": { "mode": "auto", "manual_active": false, "updated_at": "..." },
        "sprinkler2": { "mode": "auto", "manual_active": false, "updated_at": "..." },
        "sprinkler3": { "mode": "auto", "manual_active": false, "updated_at": "..." },
        "sprinkler4": { "mode": "auto", "manual_active": false, "updated_at": "..." },
        "fan1":       { "mode": "auto", "manual_active": false, "updated_at": "..." }
      }
    },
    "ESP32-B": { "...": "program sama, hanya Device ID berbeda" }
  },
  "settings": {                         // ⬅ global, ditulis web & dibaca semua ESP32
    "temp_threshold": 50,               // °C — suhu dianggap berbahaya
    "smoke_threshold": 1000,            // ppm — asap memicu kipas
    "gas_threshold": 20,                // % — gas memicu kipas
    "sprinkler_delay": 3,               // detik — jeda sprinkler setelah api
    "fan_delay": 2,                     // detik — jeda kipas setelah asap/gas
    "fan_duration": 30,                 // detik — kipas tetap jalan setelah pemicu hilang
    "updated_at": "..."
  },
  "events": {                           // ⬅ append-only log kejadian
    "-NxxxxPushId": { "device_id": "ESP32-A", "device_name": "Rumah A", "event_type": "fire", "severity": "danger", "message": "BAHAYA: Api terdeteksi", "created_at": "..." }
  }
}
```

`settings` di-seed otomatis saat web pertama dibuka. Node device (meta + status + actuators) dibuat otomatis saat device didaftarkan di **Kelola Perangkat**.

## 4. Alur Data

| Arah | Jalur | Isi |
|---|---|---|
| ESP32 → Web | `devices/{ID}/status` | bacaan sensor terakhir (tulis/update tiap beberapa detik) |
| Web → ESP32 | `devices/{ID}/actuators/{device}` | `mode` (`auto`/`manual`) + `manual_active` (on/off) |
| Web → ESP32 | `settings` | threshold & delay aktuator |
| Web → RTDB | `events` | log otomatis saat level bahaya berubah |

Web memakai listener `onValue` pada `devices` dan `settings` — perubahan dari ESP32 tampil tanpa refresh, dan perubahan dari web langsung diterima ESP32.

## 5. Contoh Snippet ESP32 (Arduino)

```cpp
#include <WiFi.h>
#include <Firebase_ESP_Client.h> // library mobizt/Firebase-ESP-Client

// ====== SATU-SATUNYA YANG DIBEDA-BEDAKAN ANTAR UNIT ======
#define DEVICE_ID "ESP32-A"   // unit lain: "ESP32-B", dst.

// Tulis bacaan sensor (tiap loop / interval):
Firebase.RTDB.setFloat(&fbdo, "devices/" DEVICE_ID "/status/temperature", t);
Firebase.RTDB.setFloat(&fbdo, "devices/" DEVICE_ID "/status/smoke_mq2",   smoke);
Firebase.RTDB.setFloat(&fbdo, "devices/" DEVICE_ID "/status/gas_mq6",     gas);
Firebase.RTDB.setBool (&fbdo, "devices/" DEVICE_ID "/status/fire1",       f1);
// ... fire2..fire4, lalu updated_at (ISO string)

// Baca perintah aktuator (tiap loop):
Firebase.RTDB.getString(&fbdo, "devices/" DEVICE_ID "/actuators/sprinkler1/mode");
Firebase.RTDB.getBool  (&fbdo, "devices/" DEVICE_ID "/actuators/sprinkler1/manual_active");

// Baca threshold (sama untuk semua device):
Firebase.RTDB.getFloat(&fbdo, "settings/temp_threshold");
```

## 6. Verifikasi

1. `npm run dev` → buat `.env` terisi dulu → dashboard tampil, `settings` ter-seed di RTDB.
2. Menu **Menu → Kelola Perangkat → Tambah** → masukkan ID `ESP32-A` + nama `Rumah A` → node `devices/ESP32-A/` muncul di RTDB dengan 4 sprinkler + 1 kipas.
3. Ubah `devices/ESP32-A/status/fire1` → `true` lewat console Firebase → kartu "Rumah A" berubah ke **BAHAYA** dalam < 1 detik.
4. Klik mode **Manual → AKTIF** pada sprinkler → `devices/ESP32-A/actuators/sprinkler1/manual_active` berubah `true`.

## 7. Hosting Gratis (Firebase Hosting — paket Spark)

Konfigurasi sudah disiapkan di proyek ini:
- `firebase.json` — hosting dari folder `dist` + SPA rewrite + aturan database
- `.firebaserc` — ganti `GANTI-DENGAN-PROJECT-ID` dengan ID proyek Firebase Anda
- Script npm: `npm run deploy` (= `vite build && firebase deploy --only hosting,database`)

Langkah:

```bash
# 1. Login (membuka browser)
npx firebase login

# 2. Edit .firebaserc -> ganti "GANTI-DENGAN-PROJECT-ID"

# 3. Build + upload (hosting + aturan database)
npm run deploy
```

Hasil: `https://<PROJECT-ID>.web.app` (gratis, HTTPS + SSL otomatis). Custom domain juga gratis di tab Hosting → Add custom domain.

> Catatan: jika RTDB Anda dibuat di region **luar** `us-central1`, deploy aturan via CLI kadang gagal dengan error region. Solusi termudah: salin isi `database.rules.json` secara manual di Console → Realtime Database → **Rules** → Publish (hosting tetap bisa di-deploy via CLI).

### Kuota gratis (paket Spark)

| Layanan | Kuota gratis |
|---|---|
| Hosting | 10 GB penyimpanan, 360 MB transfer/hari, custom domain + SSL |
| Realtime Database | 1 GB penyimpanan, 10 GB download/bulan, 100 koneksi bersimultan |

Untuk dashboard monitoring 2–3 device ESP32, kuota ini jauh melebihi kebutuhan.

