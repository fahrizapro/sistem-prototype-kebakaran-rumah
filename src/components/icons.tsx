/**
 * Ikon bergaya ilustrasi berlapis (kesan 3D kartun) — pengganti ikon garis lucide
 * untuk elemen konten utama. Semua ikon memakai gradasi + highlight agar terlihat
 * "timbul" seperti gambar api berlapis merah/orange/kuning.
 */

interface IconProps {
  className?: string;
}

// ===================== Api =====================
export function Flame3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="fg-outer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5722" />
          <stop offset="1" stopColor="#d50000" />
        </linearGradient>
        <linearGradient id="fg-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9800" />
          <stop offset="1" stopColor="#f4511e" />
        </linearGradient>
        <linearGradient id="fg-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe082" />
          <stop offset="1" stopColor="#ffb300" />
        </linearGradient>
      </defs>
      {/* lidah api luar (merah) */}
      <path
        fill="url(#fg-outer)"
        d="M13.5 2.2c.4 2.6 1.8 4.6 3.8 6.2 2 1.6 3.2 3.6 3.2 5.8 0 4.4-3.6 7.8-8.5 7.8S3.5 18.6 3.5 14.2c0-1.4.5-2.7 1.2-3.7.4 1 .9 1.7 1.9 2.2-.2-1.6-.7-2.5-1.2-3.6-.9-2-.2-3.9 1.9-5.6.4 1.6 1.3 2.9 2.7 3.6.6-2.5 1.8-4.2 3.5-4.9z"
      />
      {/* lidah api tengah (orange) */}
      <path
        fill="url(#fg-mid)"
        transform="translate(12.6 14.2) scale(0.66) translate(-12.6 -14.2)"
        d="M13.5 2.2c.4 2.6 1.8 4.6 3.8 6.2 2 1.6 3.2 3.6 3.2 5.8 0 4.4-3.6 7.8-8.5 7.8S3.5 18.6 3.5 14.2c0-1.4.5-2.7 1.2-3.7.4 1 .9 1.7 1.9 2.2-.2-1.6-.7-2.5-1.2-3.6-.9-2-.2-3.9 1.9-5.6.4 1.6 1.3 2.9 2.7 3.6.6-2.5 1.8-4.2 3.5-4.9z"
      />
      {/* inti api (kuning) */}
      <path
        fill="url(#fg-core)"
        transform="translate(12.9 15.6) scale(0.38) translate(-12.9 -15.6)"
        d="M13.5 2.2c.4 2.6 1.8 4.6 3.8 6.2 2 1.6 3.2 3.6 3.2 5.8 0 4.4-3.6 7.8-8.5 7.8S3.5 18.6 3.5 14.2c0-1.4.5-2.7 1.2-3.7.4 1 .9 1.7 1.9 2.2-.2-1.6-.7-2.5-1.2-3.6-.9-2-.2-3.9 1.9-5.6.4 1.6 1.3 2.9 2.7 3.6.6-2.5 1.8-4.2 3.5-4.9z"
      />
    </svg>
  );
}

// ===================== Lonceng Notifikasi =====================
export function Bell3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="bl-outer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="bl-inner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      {/* badan lonceng */}
      <path
        fill="url(#bl-outer)"
        d="M12 2.2c-.7 0-1.3.6-1.3 1.3v.7c-3.1.6-5.4 3.3-5.4 6.6v3.4l-1.6 2.6c-.4.7.1 1.6.9 1.6h14.8c.8 0 1.3-.9.9-1.6l-1.6-2.6v-3.4c0-3.3-2.3-6-5.4-6.6v-.7c0-.7-.6-1.3-1.3-1.3z"
      />
      {/* kilau dalam */}
      <path
        fill="url(#bl-inner)"
        opacity="0.8"
        transform="translate(11.2 12.5) scale(0.62) translate(-11.2 -12.5)"
        d="M12 2.2c-.7 0-1.3.6-1.3 1.3v.7c-3.1.6-5.4 3.3-5.4 6.6v3.4l-1.6 2.6c-.4.7.1 1.6.9 1.6h14.8c.8 0 1.3-.9.9-1.6l-1.6-2.6v-3.4c0-3.3-2.3-6-5.4-6.6v-.7c0-.7-.6-1.3-1.3-1.3z"
      />
      {/* pentungan */}
      <path
        fill="#f59e0b"
        d="M9.6 19.4a2.5 2.5 0 0 0 4.8 0z"
      />
    </svg>
  );
}

// ===================== Rumah =====================
export function Home3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="hm-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id="hm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8fafc" />
          <stop offset="1" stopColor="#cbd5e1" />
        </linearGradient>
      </defs>
      {/* badan rumah */}
      <path fill="url(#hm-body)" d="M5 10.5h14V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20z" />
      {/* sisi gelap badan (kedalaman) */}
      <path fill="#94a3b8" d="M16.2 10.5H19V20a1.5 1.5 0 0 1-1.5 1.5h-1.3z" opacity="0.55" />
      {/* atap */}
      <path
        fill="url(#hm-roof)"
        d="M11.1 2.6a1.4 1.4 0 0 1 1.8 0l8.4 7a1 1 0 0 1-1.3 1.5l-.5-.4v.2H4.5v-.2l-.5.4A1 1 0 0 1 2.7 9.6z"
      />
      {/* pintu */}
      <path fill="#7c2d12" d="M10.6 13.8h2.8v7.7h-2.8z" />
      <circle cx="12.9" cy="17.8" r="0.45" fill="#fbbf24" />
      {/* jendela */}
      <rect x="6.4" y="13" width="3.2" height="3.2" rx="0.5" fill="#bae6fd" stroke="#0369a1" strokeWidth="0.6" />
      <rect x="14.4" y="13" width="3.2" height="3.2" rx="0.5" fill="#bae6fd" stroke="#0369a1" strokeWidth="0.6" />
    </svg>
  );
}

// ===================== Kipas =====================
export function Fan3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="fn-blade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0369a1" />
        </linearGradient>
        <radialGradient id="fn-hub" cx="0.35" cy="0.35" r="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#64748b" />
        </radialGradient>
      </defs>
      {/* baling-baling */}
      <g fill="url(#fn-blade)">
        <path d="M12 12C10 8.6 10.6 4.6 12 3c1.4 1.6 2 5.6 0 9z" />
        <path d="M12 12c3.4-2 7.4-1.4 9 0-1.6 1.4-5.6 2-9 0z" />
        <path d="M12 12c2 3.4 1.4 7.4 0 9-1.4-1.6-2-5.6 0-9z" />
        <path d="M12 12C8.6 14 4.6 13.4 3 12c1.6-1.4 5.6-2 9 0z" />
      </g>
      {/* hub tengah */}
      <circle cx="12" cy="12" r="3" fill="url(#fn-hub)" />
      <circle cx="12" cy="12" r="1.1" fill="#334155" />
    </svg>
  );
}

// ===================== Tetesan air / Sprinkler =====================
export function Drop3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="dr-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <path
        fill="url(#dr-body)"
        d="M12 2.6c3.4 4.4 6 7.6 6 10.8a6 6 0 1 1-12 0c0-3.2 2.6-6.4 6-10.8z"
      />
      <ellipse cx="9.6" cy="13.4" rx="1.6" ry="2.4" fill="#dbeafe" opacity="0.75" transform="rotate(-18 9.6 13.4)" />
    </svg>
  );
}

// ===================== Termometer =====================
export function Thermo3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="th-mercury" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f87171" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
        <radialGradient id="th-bulb" cx="0.35" cy="0.35" r="1">
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="1" stopColor="#dc2626" />
        </radialGradient>
      </defs>
      {/* tabung luar */}
      <rect x="10" y="2.5" width="4" height="13" rx="2" fill="#e2e8f0" />
      {/* merkuri */}
      <rect x="11.15" y="5" width="1.7" height="10.5" rx="0.85" fill="url(#th-mercury)" />
      <rect x="10.55" y="4.6" width="0.9" height="2" rx="0.45" fill="#ffffff" opacity="0.7" />
      {/* bulb */}
      <circle cx="12" cy="17.2" r="4.3" fill="url(#th-bulb)" />
      <circle cx="10.6" cy="15.8" r="1" fill="#fecaca" opacity="0.8" />
    </svg>
  );
}

// ===================== Awan asap (MQ2) =====================
export function Smoke3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="sm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cbd5e1" />
          <stop offset="1" stopColor="#64748b" />
        </linearGradient>
      </defs>
      <path
        fill="url(#sm-body)"
        d="M6.8 19.5a4.3 4.3 0 0 1-.4-8.6 6 6 0 0 1 11.6-1.4 3.9 3.9 0 0 1-.9 7.7z"
      />
      <ellipse cx="9" cy="11" rx="2.6" ry="1.4" fill="#f1f5f9" opacity="0.65" transform="rotate(-12 9 11)" />
    </svg>
  );
}

// ===================== Awan gas (MQ6) =====================
export function Gas3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="gs-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9f99d" />
          <stop offset="1" stopColor="#65a30d" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gs-body)"
        d="M6.8 19.5a4.3 4.3 0 0 1-.4-8.6 6 6 0 0 1 11.6-1.4 3.9 3.9 0 0 1-.9 7.7z"
      />
      <ellipse cx="9" cy="11" rx="2.6" ry="1.4" fill="#f7fee7" opacity="0.7" transform="rotate(-12 9 11)" />
    </svg>
  );
}

// ===================== Perisai aman =====================
export function ShieldCheck3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="sc-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4ade80" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <path
        fill="url(#sc-body)"
        d="M12 2.5l7.5 3v5.2c0 4.9-3.1 8.6-7.5 10.8-4.4-2.2-7.5-5.9-7.5-10.8V5.5z"
      />
      <path
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.8 12.2l2.3 2.3 4.3-4.5"
      />
      <path fill="#065f46" opacity="0.35" d="M12 2.5l7.5 3v5.2c0 4.9-3.1 8.6-7.5 10.8z" />
    </svg>
  );
}

// ===================== Perisai bahaya =====================
export function ShieldAlert3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="sa-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f87171" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
      </defs>
      <path
        fill="url(#sa-body)"
        d="M12 2.5l7.5 3v5.2c0 4.9-3.1 8.6-7.5 10.8-4.4-2.2-7.5-5.9-7.5-10.8V5.5z"
      />
      <path fill="#7f1d1d" opacity="0.35" d="M12 2.5l7.5 3v5.2c0 4.9-3.1 8.6-7.5 10.8z" />
      <rect x="10.9" y="6.6" width="2.2" height="7" rx="1.1" fill="#ffffff" />
      <circle cx="12" cy="16.4" r="1.35" fill="#ffffff" />
    </svg>
  );
}

// ===================== Segitiga peringatan =====================
export function AlertTriangle3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="at-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <path
        fill="url(#at-body)"
        stroke="#b45309"
        strokeWidth="0.8"
        strokeLinejoin="round"
        d="M10.3 4.2c.8-1.3 2.6-1.3 3.4 0l7.2 12.6c.8 1.3-.2 3-1.7 3H4.8c-1.5 0-2.5-1.7-1.7-3z"
      />
      <rect x="10.9" y="8.4" width="2.2" height="6" rx="1.1" fill="#7c2d12" />
      <circle cx="12" cy="17" r="1.3" fill="#7c2d12" />
    </svg>
  );
}

// ===================== Info =====================
export function Info3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <radialGradient id="in-body" cx="0.35" cy="0.3" r="1.1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1d4ed8" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="9.5" fill="url(#in-body)" />
      <ellipse cx="9.2" cy="7.6" rx="3.4" ry="2" fill="#dbeafe" opacity="0.45" transform="rotate(-24 9.2 7.6)" />
      <rect x="10.9" y="10" width="2.2" height="7" rx="1.1" fill="#ffffff" />
      <circle cx="12" cy="7.3" r="1.35" fill="#ffffff" />
    </svg>
  );
}

// ===================== Gear pengaturan =====================
export function Gear3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="gr-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#334155" />
        </linearGradient>
      </defs>
      <g fill="url(#gr-body)">
        <rect x="10.7" y="1.6" width="2.6" height="4" rx="1.1" />
        <rect x="10.7" y="18.4" width="2.6" height="4" rx="1.1" />
        <rect x="1.6" y="10.7" width="4" height="2.6" rx="1.1" />
        <rect x="18.4" y="10.7" width="4" height="2.6" rx="1.1" />
        <rect x="10.7" y="1.6" width="2.6" height="4" rx="1.1" transform="rotate(45 12 12)" />
        <rect x="10.7" y="18.4" width="2.6" height="4" rx="1.1" transform="rotate(45 12 12)" />
        <rect x="1.6" y="10.7" width="4" height="2.6" rx="1.1" transform="rotate(45 12 12)" />
        <rect x="18.4" y="10.7" width="4" height="2.6" rx="1.1" transform="rotate(45 12 12)" />
      </g>
      <circle cx="12" cy="12" r="6.2" fill="url(#gr-body)" />
      <circle cx="12" cy="12" r="2.6" fill="#0f172a" />
      <circle cx="12" cy="12" r="1.2" fill="#e2e8f0" />
      <path d="M7.4 8.2a5.8 5.8 0 0 1 4.6-2" stroke="#cbd5e1" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.8" />
    </svg>
  );
}

// ===================== Gulungan log =====================
export function Scroll3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="rl-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      {/* rol atas */}
      <rect x="4" y="2.6" width="16" height="4.4" rx="2.2" fill="#d97706" />
      <rect x="4" y="3.4" width="16" height="2.8" rx="1.4" fill="#f59e0b" />
      {/* kertas */}
      <path fill="url(#rl-paper)" d="M6.2 5.4h11.6V20a1.6 1.6 0 0 1-1.6 1.6H7.8A1.6 1.6 0 0 1 6.2 20z" />
      <path fill="#d97706" opacity="0.4" d="M15.4 5.4h2.4V20a1.6 1.6 0 0 1-1.6 1.6h-.8z" />
      {/* garis teks */}
      <g stroke="#92400e" strokeWidth="1.1" strokeLinecap="round" opacity="0.75">
        <path d="M9 10.4h6" />
        <path d="M9 13.2h6" />
        <path d="M9 16h4" />
      </g>
    </svg>
  );
}

// ===================== Chip perangkat (ESP32) =====================
export function Chip3D({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="cp-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      {/* kaki kiri & kanan */}
      <g stroke="#64748b" strokeWidth="1.6" strokeLinecap="round">
        <path d="M2.2 9.4h3.4M2.2 14.6h3.4M18.4 9.4h3.4M18.4 14.6h3.4" />
      </g>
      <rect x="5" y="5" width="14" height="14" rx="2.4" fill="url(#cp-body)" />
      <rect x="8" y="8" width="8" height="8" rx="1.2" fill="#064e3b" />
      <circle cx="12" cy="12" r="1.6" fill="#6ee7b7" />
      <path d="M6.6 6.8c1-1 2.4-1.4 3.6-1.2" stroke="#a7f3d0" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.8" />
    </svg>
  );
}
