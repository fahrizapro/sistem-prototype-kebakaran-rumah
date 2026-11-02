import { initializeApp, getApps, getApp, type FirebaseOptions, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  // Penting: databaseURL wajib untuk Realtime Database
  // (salin persis dari console Firebase > RTDB, mis. https://xxx-default-rtdb.asia-southeast1.firebasedatabase.app)
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const REQUIRED_VARS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_DATABASE_URL', 'VITE_FIREBASE_PROJECT_ID'] as const;

/** Daftar variabel .env yang belum diisi (kosong = config lengkap). */
export function firebaseMissingVars(): string[] {
  return REQUIRED_VARS.filter((k) => !import.meta.env[k]);
}

let _app: FirebaseApp | null = null;
let _db: Database | null = null;

/**
 * Lazy init — dipanggil saat pertama kali operasi DB dijalankan.
 * Jangan init di module-level agar aplikasi tetap bisa menampilkan
 * layar setup ketika config belum lengkap.
 */
export function getDb(): Database {
  if (_db) return _db;
  const missing = firebaseMissingVars();
  if (missing.length > 0) {
    throw new Error(
      `Konfigurasi Firebase belum lengkap. Isi variabel berikut di file .env: ${missing.join(', ')}`,
    );
  }
  _app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  _db = getDatabase(_app);
  return _db;
}
