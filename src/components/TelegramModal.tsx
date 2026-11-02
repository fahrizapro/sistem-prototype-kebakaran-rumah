/**
 * Modal konfigurasi Notifikasi Telegram — menu tersendiri di drawer
 * (di bawah "Kelola Perangkat"), bukan bagian dari Pengaturan.
 */
import { useEffect, useState } from 'react';
import {
  fetchTelegramSettings,
  saveTelegramSettings,
  type TelegramSettings,
} from '@/lib/db';
import {
  testRecipients,
  getRecentChats,
  isValidToken,
  isValidChatId,
  type SendResult,
  type DiscoveredChat,
} from '@/lib/telegram';
import { Bell3D } from './icons';
import { ModalShell } from './SettingsModal';
import {
  X,
  Loader2,
  Save,
  Send,
  Trash2,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TelegramModal({ open, onClose }: Props) {
  const [tg, setTg] = useState<TelegramSettings>({ bot_token: '', enabled: false, recipients: {} });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedFlash(false);
    setLoaded(false);
    fetchTelegramSettings()
      .then(setTg)
      .catch(() => setError('Gagal memuat konfigurasi dari database.'))
      .finally(() => setLoaded(true));
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveTelegramSettings(tg);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setError('Gagal menyimpan konfigurasi. Coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Notifikasi Telegram"
      icon={<Bell3D className="w-6 h-6" />}
      wide
    >
      <p className="text-xs text-slate-400 mb-4">
        Saat kebakaran/kebocoran gas terdeteksi, ESP32 mengirim laporan ke semua penerima di
        daftar ini. Konfigurasi disimpan di database dan dibaca oleh ESP32.
      </p>

      {error && <p className="text-xs text-danger mb-3">{error}</p>}

      {!loaded ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <TelegramForm tg={tg} setTg={setTg} />
      )}

      {/* Tombol simpan */}
      <div className="flex items-center gap-2 mt-6 sticky bottom-0 bg-bg-card pt-4 border-t border-bg-line">
        {savedFlash && (
          <span className="flex items-center gap-1 text-xs text-safe">
            <CheckCircle2 className="w-4 h-4" /> Tersimpan
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-bg-line text-slate-300 text-sm hover:text-white transition-colors"
        >
          Tutup
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !loaded}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Simpan
        </button>
      </div>
    </ModalShell>
  );
}

function TelegramForm({ tg, setTg }: { tg: TelegramSettings; setTg: (t: TelegramSettings) => void }) {
  const [showToken, setShowToken] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<SendResult[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredChat[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const tokenValid = isValidToken(tg.bot_token);
  const recipientList = Object.entries(tg.recipients).map(([chat_id, v]) => ({ chat_id, label: v.label }));

  function addRecipient() {
    setAddError(null);
    if (!isValidChatId(newChatId)) {
      setAddError('Chat ID harus angka (grup biasanya negatif). Contoh: 612345678 atau -1001234567890');
      return;
    }
    if (tg.recipients[newChatId.trim()]) {
      setAddError('Chat ID sudah ada di daftar.');
      return;
    }
    setTg({ ...tg, recipients: { ...tg.recipients, [newChatId.trim()]: { label: newLabel.trim() || 'Penerima' } } });
    setNewLabel('');
    setNewChatId('');
  }

  function removeRecipient(chatId: string) {
    const next = { ...tg.recipients };
    delete next[chatId];
    setTg({ ...tg, recipients: next });
  }

  async function handleTest() {
    if (recipientList.length === 0) return;
    setTesting(true);
    setTestResults(null);
    const results = await testRecipients(tg.bot_token, recipientList);
    setTestResults(results);
    setTesting(false);
  }

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoverError(null);
    const { chats, error } = await getRecentChats(tg.bot_token);
    setDiscovered(chats);
    setDiscoverError(
      error ??
      (chats.length === 0
        ? 'Bot belum menerima pesan apa pun. Langkah: 1) Buka profil bot Anda di Telegram (klik tautan t.me/username_bot) 2) Tekan tombol START atau kirim pesan apa pun, mis. "halo" 3) Klik "Cek Update" lagi.'
        : null),
    );
    setDiscovering(false);
  }

  function addDiscovered(chat: DiscoveredChat) {
    setTg({
      ...tg,
      recipients: { ...tg.recipients, [chat.id]: { label: chat.name } },
    });
    setDiscovered((prev) => prev?.filter((c) => c.id !== chat.id) ?? null);
  }

  return (
    <div className="space-y-4">
      {/* Bot token */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-slate-200">Bot Token (dari @BotFather)</label>
          <button onClick={() => setShowToken((s) => !s)} className="text-[11px] text-primary-light hover:underline">
            {showToken ? 'Sembunyikan' : 'Tampilkan'}
          </button>
        </div>
        <input
          type={showToken ? 'text' : 'password'}
          value={tg.bot_token}
          onChange={(e) => setTg({ ...tg, bot_token: e.target.value })}
          placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwx"
          className="w-full bg-bg-soft border border-bg-line rounded-lg px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-primary"
        />
        {tg.bot_token !== '' && !tokenValid && (
          <p className="text-[11px] text-warning mt-1">Format token terlihat salah — biasanya &lt;angka&gt;:&lt;kunci&gt;.</p>
        )}
      </div>

      {/* Enabled */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setTg({ ...tg, enabled: !tg.enabled })}
          className={`w-10 h-6 rounded-full transition-colors flex items-center ${tg.enabled ? 'bg-primary' : 'bg-bg-line'}`}
        >
          <span className={`w-4 h-4 rounded-full bg-white transition-transform ml-1 ${tg.enabled ? 'translate-x-4' : ''}`} />
        </button>
        <span className="text-sm text-slate-300">{tg.enabled ? 'Notifikasi AKTIF' : 'Notifikasi NONAKTIF'}</span>
      </div>

      {/* Recipients */}
      <div>
        <label className="block text-sm font-medium text-slate-200 mb-1.5">Penerima ({recipientList.length})</label>
        <div className="space-y-1.5 mb-2">
          {recipientList.map((r) => (
            <div key={r.chat_id} className="flex items-center gap-2 rounded-lg border border-bg-line bg-bg-soft px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{r.label}</div>
                <div className="text-xs text-slate-500 font-mono">{r.chat_id}</div>
              </div>
              <button
                onClick={() => removeRecipient(r.chat_id)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-danger hover:bg-bg-line transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {recipientList.length === 0 && (
            <p className="text-xs text-slate-500 py-2">Belum ada penerima. Tambahkan Chat ID di bawah, atau klik "Cek Update".</p>
          )}
        </div>

        {/* Add form — grid agar tidak overflow di layar sempit */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_auto] gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (mis. Ayah)"
            className="min-w-0 w-full bg-bg-soft border border-bg-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
          />
          <input
            value={newChatId}
            onChange={(e) => setNewChatId(e.target.value)}
            placeholder="Chat ID (mis. 612345678)"
            inputMode="numeric"
            className="min-w-0 w-full bg-bg-soft border border-bg-line rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-primary"
          />
          <button
            onClick={addRecipient}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Tambah
          </button>
        </div>
        {addError && <p className="text-[11px] text-danger mt-1">{addError}</p>}
      </div>

      {/* Test & discover */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !tokenValid || recipientList.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Kirim Uji
        </button>
        <button
          onClick={handleDiscover}
          disabled={discovering || !tokenValid}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-line text-slate-300 text-sm hover:text-white transition-colors disabled:opacity-40"
        >
          {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Cek Update
        </button>
      </div>

      {/* Test results */}
      {testResults && (
        <div className="space-y-1">
          {testResults.map((r) => (
            <div key={r.chat_id} className="flex items-center gap-2 text-xs">
              {r.ok ? <CheckCircle2 className="w-4 h-4 text-safe" /> : <XCircle className="w-4 h-4 text-danger" />}
              <span className="font-semibold text-slate-200">{r.label}</span>
              <span className="text-slate-500 font-mono">{r.chat_id}</span>
              {!r.ok && (
                <span className="text-danger">
                  {/chat not found/i.test(r.error ?? '')
                    ? `${r.error} — penerima belum pernah chat bot (tekan START dulu)`
                    : /unauthorized/i.test(r.error ?? '')
                      ? `${r.error} — token salah`
                      : r.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Discovered chats */}
      {discovered && discovered.length > 0 && (
        <div className="rounded-lg border border-bg-line bg-bg-soft p-2 space-y-1">
          <p className="text-[11px] text-slate-400 px-1">Chat yang ditemukan — klik untuk menambahkan:</p>
          {discovered.map((c) => (
            <button
              key={c.id}
              onClick={() => addDiscovered(c)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-bg-line transition-colors text-left"
            >
              <span className="text-sm text-white">{c.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">{c.id}</span>
                <Plus className="w-4 h-4 text-primary-light" />
              </span>
            </button>
          ))}
        </div>
      )}
      {discoverError && <p className="text-[11px] text-slate-400">{discoverError}</p>}

      {/* BotFather how-to */}
      <div className="rounded-lg border border-bg-line bg-bg-soft">
        <button onClick={() => setShowHelp((s) => !s)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
          <HelpCircle className="w-4 h-4 text-primary-light" />
          <span className="text-xs font-semibold text-white flex-1">Cara membuat bot & mendapat Chat ID (via @BotFather)</span>
          <span className="text-[10px] text-slate-500">{showHelp ? '▲' : '▼'}</span>
        </button>
        {showHelp && (
          <div className="text-[11px] text-slate-400 px-4 pb-3">
            <ol className="space-y-1.5 list-decimal list-inside">
              <li>Buka Telegram → cari <strong className="text-slate-200">@BotFather</strong> → kirim <TgCmd>/newbot</TgCmd></li>
              <li>Beri nama bot & username berakhiran <em>_bot</em> → salin <strong className="text-slate-200">token</strong> ke kolom Bot Token di atas</li>
              <li>Tiap penerima: buka profil bot di Telegram → tekan <TgCmd>/start</TgCmd> (bot tak bisa memulai chat sendiri) → klik <WebBtn icon={<RefreshCw className="w-3 h-3" />}>Cek Update</WebBtn> → chat muncul → klik untuk menambahkan</li>
              <li>Cara manual Chat ID: cari <strong className="text-slate-200">@userinfobot</strong> → kirim <TgCmd>/start</TgCmd> → salin angka <em>Id</em> → tambahkan lewat kolom Label + Chat ID</li>
              <li>Grup: tambahkan bot ke grup → kirim <TgCmd>/setprivacy</TgCmd> ke @BotFather → <strong className="text-slate-200">Disable</strong> → kirim pesan di grup → <WebBtn icon={<RefreshCw className="w-3 h-3" />}>Cek Update</WebBtn> → ID grup (negatif) muncul</li>
              <li>Klik <WebBtn icon={<Send className="w-3 h-3" />}>Kirim Uji</WebBtn> → pastikan semua penerima ✅ → <WebBtn icon={<Save className="w-3 h-3" />}>Simpan</WebBtn></li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/** Chip perintah yang diketik di Telegram (mis. /start). */
function TgCmd({ children }: { children: React.ReactNode }) {
  return (
    <code className="inline-flex items-center rounded bg-slate-700/60 border border-slate-600 px-1.5 py-0.5 font-mono text-[10px] text-warning">
      {children}
    </code>
  );
}

/** Chip tombol yang ada di web ini — tampil seperti tombol aslinya. */
function WebBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-primary/50 bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary-light align-baseline">
      {icon}
      {children}
    </span>
  );
}
