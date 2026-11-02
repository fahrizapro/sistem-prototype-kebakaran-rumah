/**
 * Integrasi Telegram Bot API (dipanggil langsung dari browser;
 * api.telegram.org mengizinkan CORS).
 */

export interface RecipientInput {
  chat_id: string;
  label: string;
}

export interface SendResult {
  chat_id: string;
  label: string;
  ok: boolean;
  error?: string;
}

export interface DiscoveredChat {
  id: string;
  name: string;
}

function api(token: string, method: string): string {
  return `https://api.telegram.org/bot${token.trim()}/${method}`;
}

export function isValidToken(token: string): boolean {
  return /^\d{5,}:[\w-]{20,}$/.test(token.trim());
}

export function isValidChatId(id: string): boolean {
  return /^-?\d{3,}$/.test(id.trim());
}

/** Kirim satu pesan ke satu chat. */
export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(api(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      return { ok: false, error: String(json?.description ?? `HTTP ${res.status}`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Gagal terhubung' };
  }
}

/** Kirim pesan uji ke semua penerima, laporkan hasil per penerima. */
export async function testRecipients(token: string, recipients: RecipientInput[]): Promise<SendResult[]> {
  const text = '🧪 <b>Sistem Prototype Kebakaran Rumah</b>\nUji notifikasi berhasil — bot siap menerima laporan kebakaran.';
  const results = await Promise.all(
    recipients.map((r) => sendTelegramMessage(token, r.chat_id, text)),
  );
  return results.map((res, i) => ({
    chat_id: recipients[i].chat_id,
    label: recipients[i].label,
    ok: res.ok,
    error: res.error,
  }));
}

/**
 * Baca getUpdates untuk menemukan chat yang pernah mengirim pesan ke bot.
 * Catatan: getUpdates hanya mengembalikan pesan 24 jam terakhir & kosong
 * bila belum ada yang meng-chat bot.
 */
export async function getRecentChats(token: string): Promise<{ chats: DiscoveredChat[]; error?: string }> {
  try {
    const res = await fetch(api(token, 'getUpdates'));
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      const desc = String(json?.description ?? `HTTP ${res.status}`);
      return { chats: [], error: await explainTelegramError(token, res.status, desc) };
    }
    const chats = new Map<string, DiscoveredChat>();
    for (const upd of json.result ?? []) {
      for (const key of ['message', 'channel_post', 'edited_message'] as const) {
        const chat = upd[key]?.chat;
        if (chat?.id != null) {
          const id = String(chat.id);
          if (!chats.has(id)) {
            chats.set(id, {
              id,
              name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || id,
            });
          }
        }
      }
    }
    return { chats: [...chats.values()] };
  } catch (e) {
    return { chats: [], error: e instanceof Error ? e.message : 'Gagal terhubung' };
  }
}

/** Terjemahkan error Telegram ke panduan perbaikan yang jelas. */
async function explainTelegramError(token: string, status: number, desc: string): Promise<string> {
  if (status === 401 || desc.toLowerCase().includes('unauthorized')) {
    return 'Token salah (401 Unauthorized). Salin ulang token lengkap dari @BotFather — format: 123456789:ABCdef...';
  }
  if (status === 409 || desc.toLowerCase().includes('conflict')) {
    // Cek webhook aktif — penyebab paling umum 409
    try {
      const res = await fetch(api(token, 'getWebhookInfo'));
      const json = await res.json().catch(() => null);
      const url = String(json?.result?.webhook_url ?? '');
      if (url) {
        return `Bot terhubung webhook lain (${url}) — itu sebabnya Cek Update gagal (409). Perbaiki: buka di browser https://api.telegram.org/bot<TOKEN>/deleteWebhook (ganti <TOKEN> dengan token bot), lalu coba lagi.`;
      }
    } catch { /* abaikan */ }
    return 'Konflik getUpdates (409): pastikan tidak ada aplikasi/script lain yang membaca bot ini bersamaan.';
  }
  if (status === 404 || desc.toLowerCase().includes('not found')) {
    return 'Bot tidak ditemukan (404) — token salah atau bot sudah dihapus. Cek ulang @BotFather.';
  }
  if (status === 429) {
    return 'Terlalu banyak permintaan (429) — tunggu beberapa detik lalu coba lagi.';
  }
  return `Gagal: ${desc}`;
}

