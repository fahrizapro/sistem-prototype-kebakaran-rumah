import { useState } from 'react';

const REQUIRED_VARS = [
  { key: 'VITE_FIREBASE_API_KEY', label: 'API Key' },
  { key: 'VITE_FIREBASE_AUTH_DOMAIN', label: 'Auth Domain' },
  { key: 'VITE_FIREBASE_DATABASE_URL', label: 'Database URL (RTDB)' },
  { key: 'VITE_FIREBASE_PROJECT_ID', label: 'Project ID' },
  { key: 'VITE_FIREBASE_STORAGE_BUCKET', label: 'Storage Bucket' },
  { key: 'VITE_FIREBASE_MESSAGING_SENDER_ID', label: 'Messaging Sender ID' },
  { key: 'VITE_FIREBASE_APP_ID', label: 'App ID' },
];

/** Layar setup — ditampilkan saat konfigurasi Firebase di .env belum diisi. */
export function SetupScreen({ missing }: { missing: string[] }) {
  const [showSteps, setShowSteps] = useState(false);

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="max-w-lg w-full rounded-2xl border border-bg-line bg-bg-card p-6 shadow-card animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-glow">
            {/* eslint-disable-next-line */}
            <span className="text-2xl">🔥</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Sistem Prototype Kebakaran Rumah</h1>
            <p className="text-xs text-slate-400">Konfigurasi Firebase dibutuhkan</p>
          </div>
        </div>

        <p className="text-sm text-slate-300 mb-3">
          Aplikasi belum terhubung ke Firebase Realtime Database. Lengkapi variabel berikut di file <code className="font-mono text-primary-light">.env</code> pada folder proyek:
        </p>

        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 mb-4 space-y-1">
          {REQUIRED_VARS.map((v) => {
            const filled = Boolean(import.meta.env[v.key]);
            const required = missing.includes(v.key);
            return (
              <div key={v.key} className="flex items-center gap-2 text-xs font-mono">
                <span className={filled ? 'text-safe' : required ? 'text-warning' : 'text-slate-500'}>
                  {filled ? '● terisi' : required ? '○ WAJIB diisi' : '○ opsional, kosong'}
                </span>
                <span className="text-slate-300">{v.key}</span>
                <span className="text-slate-500">— {v.label}</span>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setShowSteps((s) => !s)}
          className="text-xs text-primary-light hover:underline mb-2"
        >
          {showSteps ? 'Sembunyikan langkah ▲' : 'Cara mengisinya ▼'}
        </button>

        {showSteps && (
          <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside mb-4">
            <li>Buka <strong>console.firebase.google.com</strong> → proyek Anda</li>
            <li><strong>Build → Realtime Database → Create Database</strong></li>
            <li><strong>Project settings (⚙️) → Your apps → Web app</strong> → salin config</li>
            <li>Tempel nilainya ke <code className="font-mono">.env</code> (detail lengkap: file <code className="font-mono">docs/FIREBASE_SETUP.md</code>)</li>
            <li>Simpan .env → halaman otomatis ter-reload</li>
          </ol>
        )}

        <p className="text-[11px] text-slate-500">
          Panduan lengkap: <code className="font-mono">docs/FIREBASE_SETUP.md</code>.
        </p>
      </div>
    </div>
  );
}
