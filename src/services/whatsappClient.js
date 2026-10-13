import fs from 'fs';
import path from 'path';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import config from '../config/index.js';
import messageStore from './messageStore.js';
import messageProcessor from './messageProcessor.js';
import eventHub from './eventHub.js';

/**
 * Helper untuk menormalisasi JID WhatsApp menjadi format kanonikal Baileys
 * (@s.whatsapp.net untuk user/pribadi, @g.us untuk grup)
 */
export function normalizeJid(rawJid) {
  if (!rawJid || typeof rawJid !== 'string') return '';
  let jid = rawJid.trim();

  // Bersihkan penanda device jika ada (misal: "628123:1@s.whatsapp.net" -> "628123@s.whatsapp.net")
  if (jid.includes(':') && jid.includes('@')) {
    jid = jid.replace(/:[0-9]+@/, '@');
  }

  // Konversi format domain whatsapp-web.js lama (@c.us) ke standar Baileys (@s.whatsapp.net)
  if (jid.endsWith('@c.us')) {
    jid = jid.replace('@c.us', '@s.whatsapp.net');
  }

  // Jika tanpa domain dan bukan grup, tambahkan default @s.whatsapp.net
  if (!jid.includes('@')) {
    jid = `${jid}@s.whatsapp.net`;
  }

  return jidNormalizedUser(jid);
}

/**
 * Singleton WhatsApp Client Manager berbasis Baileys (WebSocket murni, hemat CPU & RAM)
 * Mengelola lifecycle koneksi, autentikasi multi-file persisten, QR code (visual terminal & DataURL PNG base64),
 * reconnection otomatis, serta penerimaan dan pengiriman pesan WhatsApp.
 */
class WhatsAppService {
  constructor() {
    this.sock = null;
    // Status resmi: 'disconnected' | 'initializing' | 'qr_required' | 'authenticated' | 'ready' | 'auth_failure'
    this.status = 'disconnected';
    this.qr = null;
    this.qrDataUrl = null;
    this.qrGeneratedAt = null;
    this.qrExpiresAt = null;
    this.authenticatedAt = null;
    this.connectedAt = null;
    this.lastError = null;
    this.userInfo = null;
    this.isInitializing = false;
    this._hasLoggedAuthenticated = false;
    this._manualDisconnect = false;
    this._reconnectTimer = null;
  }

  /**
   * Helper untuk mengupdate status dan memancarkan event SSE
   */
  _setStatus(newStatus, errorMsg = null) {
    this.status = newStatus;
    if (errorMsg) {
      this.lastError = errorMsg;
    }
    eventHub.emitStatusChange(newStatus, {
      status: this.status,
      lastError: this.lastError,
      user: this.userInfo,
      qrAvailable: this.status === 'qr_required' && Boolean(this.qrDataUrl),
      engine: 'baileys',
    });
  }

  /**
   * Mendapatkan path direktori penyimpanan auth state Baileys
   */
  _getSessionDir() {
    return path.join(config.whatsapp.sessionPath, `baileys-${config.whatsapp.clientId}`);
  }

  /**
   * Memulai koneksi atau inisialisasi client WhatsApp via Baileys
   */
  async connect() {
    // 1. Jika sudah siap dan terhubung
    if (this.status === 'ready' && this.sock) {
      return {
        success: true,
        message: 'WhatsApp client sudah terhubung dan siap digunakan.',
        status: this.status,
      };
    }

    // 2. Jika sedang inisialisasi atau QR siap dipindai
    if (this.isInitializing || this.status === 'initializing' || this.status === 'qr_required') {
      return {
        success: true,
        message: 'Inisialisasi WhatsApp sedang berlangsung. Silakan periksa status atau QR.',
        status: this.status,
      };
    }

    // 3. Jika sedang terautentikasi dan menunggu koneksi terbuka
    if (this.status === 'authenticated') {
      return {
        success: true,
        message: 'WhatsApp telah terautentikasi dan sedang memuat koneksi data.',
        status: this.status,
      };
    }

    // 4. Bersihkan instance lama jika ada
    if (this.sock) {
      await this._cleanupClient();
    }

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._manualDisconnect = false;
    this.isInitializing = true;
    this._setStatus('initializing');
    this.lastError = null;
    this.qr = null;
    this.qrDataUrl = null;
    this.qrGeneratedAt = null;
    this.qrExpiresAt = null;
    this._hasLoggedAuthenticated = false;

    const sessionDir = this._getSessionDir();
    console.log(`[WHATSAPP-BAILEYS] Inisialisasi Baileys dimulai (auth dir: ${sessionDir})...`);

    try {
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      // Muat kredensial sesi multi-file Baileys
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      // Logger Baileys diatur ke 'silent' agar tidak membocorkan auth tokens atau noise berlebih
      const logger = pino({ level: 'silent' });

      // Buat socket Baileys dengan konfigurasi efisien
      this.sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: ['Callista Persona Studio', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
      });

      // Pasang listener event Baileys
      this._attachEventListeners(saveCreds);

      return {
        success: true,
        message: 'Inisialisasi client WhatsApp Baileys berhasil dimulai.',
        status: this.status,
      };
    } catch (err) {
      this._handleInitError(err);
      return {
        success: false,
        message: this.lastError || 'Gagal memulai inisialisasi WhatsApp client.',
        status: this.status,
      };
    }
  }

  /**
   * Pasang listener event Baileys: creds.update, connection.update, messages.upsert
   */
  _attachEventListeners(saveCreds) {
    if (!this.sock) return;

    // 1. Simpan pembaruan kredensial sesi ke disk
    this.sock.ev.on('creds.update', saveCreds);

    // 2. Pembaruan status koneksi dan QR code
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Event QR Code aktual dari Baileys
      if (qr) {
        this.isInitializing = false;
        this.qr = qr;
        const now = new Date();
        this.qrGeneratedAt = now.toISOString();
        this.qrExpiresAt = new Date(now.getTime() + config.whatsapp.qrTimeoutMs).toISOString();

        try {
          this.qrDataUrl = await QRCode.toDataURL(qr, {
            margin: 2,
            scale: 7,
            errorCorrectionLevel: 'M',
          });
        } catch (qrErr) {
          console.error('[WHATSAPP-BAILEYS] Gagal mengonversi QR ke Data URL:', qrErr.message);
          this.qrDataUrl = null;
        }

        this._setStatus('qr_required');

        console.log('\n================================================================================');
        console.log('[WHATSAPP-BAILEYS] QR CODE AUTENTIKASI TERSEDIA — PINDAI DENGAN PONSEL ANDA');
        console.log('================================================================================');
        console.log('Langkah-langkah Pemindaian:');
        console.log('1. Buka aplikasi WhatsApp pada ponsel Anda.');
        console.log('2. Buka menu Perangkat Tertaut (Linked Devices):');
        console.log('   - Android: Ketuk ikon titik tiga di kanan atas > Perangkat Tertaut');
        console.log('   - iPhone: Masuk ke Pengaturan (Settings) > Perangkat Tertaut');
        console.log('3. Ketuk tombol "Tautkan Perangkat" ("Link a Device").');
        console.log('4. Arahkan kamera ponsel Anda ke QR code terminal berikut:');
        console.log('--------------------------------------------------------------------------------');
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (err) {
          console.error('[WHATSAPP-BAILEYS] Gagal merender visual QR di terminal:', err.message);
        }
        console.log('--------------------------------------------------------------------------------');
        console.log(`[WHATSAPP-BAILEYS] QR code berlaku selama ${Math.floor(config.whatsapp.qrTimeoutMs / 1000)} detik.`);
        console.log('[WHATSAPP-BAILEYS] Klien frontend dapat mengambil gambar QR melalui GET /api/whatsapp/qr');
        console.log('================================================================================\n');
      }

      // Koneksi terbuka / berhasil terhubung
      if (connection === 'open') {
        this.isInitializing = false;
        this.qr = null;
        this.qrDataUrl = null;
        this.qrGeneratedAt = null;
        this.qrExpiresAt = null;
        this.authenticatedAt = this.authenticatedAt || new Date().toISOString();
        this.connectedAt = new Date().toISOString();
        this.lastError = null;

        try {
          const rawId = this.sock?.user?.id;
          const userJid = rawId ? jidNormalizedUser(rawId) : null;
          this.userInfo = {
            id: userJid,
            name: this.sock?.user?.name || this.sock?.user?.notify || 'Callista Persona',
            platform: 'baileys',
          };
        } catch (_e) {
          this.userInfo = null;
        }

        this._setStatus('ready');
        const accountName = this.userInfo?.name || 'User';
        const accountId = this.userInfo?.id || 'ID Unknown';
        console.log(`[WHATSAPP-BAILEYS] Koneksi WhatsApp siap! Terhubung sebagai: ${accountName} (${accountId})`);
      }

      // Koneksi ditutup
      if (connection === 'close') {
        this.isInitializing = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const reasonStr = lastDisconnect?.error?.message || `Kode status: ${statusCode || 'unknown'}`;

        console.log(`[WHATSAPP-BAILEYS] Koneksi terputus: ${reasonStr}`);

        if (isLoggedOut) {
          console.warn('[WHATSAPP-BAILEYS] Sesi telah logout dari WhatsApp. Menghapus folder auth sesi lama...');
          this.userInfo = null;
          this.qr = null;
          this.qrDataUrl = null;
          this._setStatus('auth_failure', 'Sesi telah logout dari WhatsApp. Perlu pemindaian ulang.');

          // Hapus sesi disk agar koneksi berikutnya bersih dan meminta QR baru
          try {
            const sessionDir = this._getSessionDir();
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          } catch (rmErr) {
            console.error('[WHATSAPP-BAILEYS] Gagal menghapus folder sesi:', rmErr.message);
          }
          await this._cleanupClient();
        } else if (!this._manualDisconnect) {
          // Koneksi terputus sementara (jaringan/server WA restart), jadwalkan auto-reconnect
          this._setStatus('disconnected', `Koneksi terputus (${reasonStr}). Menjadwalkan penyambungan kembali...`);
          await this._cleanupClient();

          console.log('[WHATSAPP-BAILEYS] Mencoba menyambung kembali dalam 4 detik...');
          this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this._manualDisconnect) {
              this.connect().catch((recErr) => {
                console.error('[WHATSAPP-BAILEYS] Gagal reconnect otomatis:', recErr?.message || recErr);
              });
            }
          }, 4000);
        } else {
          // Pemutusan manual via POST /api/whatsapp/disconnect
          this.userInfo = null;
          this.qr = null;
          this.qrDataUrl = null;
          this._setStatus('disconnected');
          await this._cleanupClient();
        }
      }
    });

    // 3. Event Pesan Masuk Nyata (Incoming Messages via messages.upsert)
    this.sock.ev.on('messages.upsert', async ({ messages, type: upsertType }) => {
      try {
        if (!Array.isArray(messages) || messages.length === 0) return;

        for (const m of messages) {
          if (!m.message) continue;

          // Filter 1: Hindari memproses pesan yang dibuat oleh akun bot sendiri (mencegah loop)
          if (m.key?.fromMe) continue;

          const rawChatId = m.key?.remoteJid;
          // Abaikan status broadcast atau notifikasi sistem
          if (!rawChatId || rawChatId === 'status@broadcast' || rawChatId.endsWith('@broadcast')) {
            continue;
          }

          // Normalisasi chatId
          const chatId = normalizeJid(rawChatId);
          const isGroup = chatId.endsWith('@g.us');

          // Normalisasi senderId
          let senderId = chatId;
          if (isGroup) {
            const rawParticipant = m.key?.participant || m.participant;
            senderId = rawParticipant ? normalizeJid(rawParticipant) : chatId;
          }

          const senderName = m.pushName || null;

          // Ekstraksi teks pesan dari beragam tipe pesan Baileys
          const msgContent = m.message;
          const text = (
            msgContent.conversation ||
            msgContent.extendedTextMessage?.text ||
            msgContent.imageMessage?.caption ||
            msgContent.videoMessage?.caption ||
            msgContent.documentMessage?.caption ||
            msgContent.buttonsResponseMessage?.selectedButtonId ||
            msgContent.templateButtonReplyMessage?.selectedId ||
            msgContent.listResponseMessage?.singleSelectReply?.selectedRowId ||
            ''
          ).trim();

          // Ekstraksi metadata kutipan pesan (quoted message)
          const contextInfo =
            msgContent.extendedTextMessage?.contextInfo ||
            msgContent.imageMessage?.contextInfo ||
            msgContent.videoMessage?.contextInfo ||
            msgContent.documentMessage?.contextInfo;

          let quotedMessageId = null;
          let quotedParticipant = null;
          if (contextInfo) {
            quotedMessageId = contextInfo.stanzaId || null;
            if (contextInfo.participant) {
              quotedParticipant = normalizeJid(contextInfo.participant);
            }
          }

          const messageId = m.key.id;
          const timestamp = m.messageTimestamp
            ? new Date(Number(m.messageTimestamp) * 1000).toISOString()
            : new Date().toISOString();

          // Format pesan ternormalisasi yang kompatibel dengan messageStore & pipeline Step 1-6
          const parsedMessage = {
            id: messageId,
            chatId,
            isGroup,
            senderId,
            senderName,
            text,
            type: 'chat',
            timestamp,
            quotedMessageId,
            quotedParticipant,
            fromMe: false,
          };

          const savedMessage = messageStore.addIncomingMessage(parsedMessage);
          if (savedMessage) {
            console.log(`[WHATSAPP-BAILEYS] Pesan masuk diterima dari ${senderId} di chat ${chatId} (ID: ${messageId})`);
            eventHub.emitMessageReceived(savedMessage);

            // Pemicu alur otomatis klasifikasi intent dan balasan persona Callista
            messageProcessor.processIncomingMessage(savedMessage, this).catch((procErr) => {
              console.error('[WHATSAPP-BAILEYS] Terjadi kesalahan pada pipeline pemrosesan pesan:', procErr?.message || procErr);
            });
          }
        }
      } catch (err) {
        console.error('[WHATSAPP-BAILEYS] Gagal memproses event messages.upsert:', err?.message || err);
      }
    });
  }

  /**
   * Kirim pesan teks manual ke akun pribadi atau grup WhatsApp
   */
  async sendMessage(chatId, text, quotedMessageId = null) {
    if (this.status !== 'ready' || !this.sock) {
      const err = new Error(`WhatsApp client belum siap (status saat ini: ${this.status}). Tidak dapat mengirim pesan.`);
      err.statusCode = 409;
      throw err;
    }

    if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
      const err = new Error('Parameter chatId wajib diisi.');
      err.statusCode = 400;
      throw err;
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      const err = new Error('Teks pesan tidak boleh kosong.');
      err.statusCode = 400;
      throw err;
    }

    const targetJid = normalizeJid(chatId);
    const isGroup = targetJid.endsWith('@g.us');

    // Bangun opsi kutipan jika quotedMessageId diberikan
    const sendOptions = {};
    if (quotedMessageId && typeof quotedMessageId === 'string' && quotedMessageId.trim()) {
      const trimmedQuotedId = quotedMessageId.trim();
      const quotedMsg = messageStore.getMessageById(trimmedQuotedId);

      sendOptions.quoted = {
        key: {
          remoteJid: targetJid,
          id: trimmedQuotedId,
          fromMe: quotedMsg ? Boolean(quotedMsg.fromMe) : false,
          participant: quotedMsg?.senderId ? normalizeJid(quotedMsg.senderId) : undefined,
        },
        message: {
          conversation: quotedMsg?.text || '',
        },
      };
    }

    try {
      console.log(`[WHATSAPP-BAILEYS] Mengirim pesan ke ${targetJid}...`);
      let sentResult = null;

      try {
        sentResult = await this.sock.sendMessage(targetJid, { text: text.trim() }, sendOptions);
      } catch (sendErr) {
        // Jika pengiriman dengan quoted gagal, coba ulang sekali tanpa quoted
        if (sendOptions.quoted) {
          console.warn(`[WHATSAPP-BAILEYS] Pengiriman dengan kutipan gagal (${sendErr?.message}), mencoba ulang tanpa kutipan...`);
          sentResult = await this.sock.sendMessage(targetJid, { text: text.trim() });
        } else {
          throw sendErr;
        }
      }

      let messageId = sentResult?.key?.id;
      let timestamp = new Date().toISOString();
      if (sentResult?.messageTimestamp) {
        timestamp = new Date(Number(sentResult.messageTimestamp) * 1000).toISOString();
      }

      if (!messageId) {
        messageId = `true_${targetJid}_${Date.now()}`;
      }

      const outgoingMessage = {
        id: messageId,
        chatId: targetJid,
        isGroup,
        senderId: this.userInfo?.id || 'me',
        senderName: this.userInfo?.name || 'Callista Persona',
        text: text.trim(),
        type: 'chat',
        timestamp,
        quotedMessageId: quotedMessageId || null,
        fromMe: true,
      };

      messageStore.addOutgoingMessage(outgoingMessage);
      eventHub.emitMessageSent(outgoingMessage);

      console.log(`[WHATSAPP-BAILEYS] Pesan berhasil dikirim ke ${targetJid} (ID: ${messageId})`);
      return outgoingMessage;
    } catch (err) {
      console.error(`[WHATSAPP-BAILEYS] Gagal mengirim pesan ke ${targetJid}:`, err?.message || err);
      messageStore.recordSendFailure(targetJid, text, err);
      const errorObj = new Error(`Pengiriman pesan gagal: ${err?.message || 'Kesalahan WhatsApp Baileys'}`);
      errorObj.statusCode = 500;
      throw errorObj;
    }
  }

  /**
   * Tangani error inisialisasi
   */
  _handleInitError(err) {
    this.isInitializing = false;
    const rawMessage = err?.message || String(err);
    const errorMsg = `Inisialisasi gagal: ${rawMessage}`;

    this._setStatus('auth_failure', errorMsg);
    console.error(`[WHATSAPP-BAILEYS] Proses gagal: ${errorMsg}`);
    this._cleanupClient();
  }

  /**
   * Putus koneksi secara terkontrol
   */
  async disconnect() {
    this._manualDisconnect = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.status === 'disconnected' && !this.sock) {
      return {
        success: true,
        message: 'WhatsApp client sudah dalam keadaan terputus.',
        status: 'disconnected',
      };
    }

    try {
      if (this.sock) {
        console.log('[WHATSAPP-BAILEYS] Client Baileys dihentikan secara terkontrol...');
        this.sock.end(new Error('Manual disconnect'));
      }
    } catch (err) {
      console.error('[WHATSAPP-BAILEYS] Peringatan saat menutup client:', err?.message || err);
    } finally {
      await this._cleanupClient();
      this.qr = null;
      this.qrDataUrl = null;
      this.userInfo = null;
      this.isInitializing = false;
      this._setStatus('disconnected');
    }

    console.log('[WHATSAPP-BAILEYS] Client Baileys dihentikan.');
    return {
      success: true,
      message: 'Koneksi WhatsApp berhasil diputus secara terkontrol.',
      status: 'disconnected',
    };
  }

  /**
   * Bersihkan referensi instance socket internal
   */
  async _cleanupClient() {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
      } catch (_e) {
        // Abaikan
      }
      this.sock = null;
    }
  }

  /**
   * Dapatkan status aktual koneksi WhatsApp
   */
  getStatus() {
    return {
      status: this.status, // 'disconnected' | 'initializing' | 'qr_required' | 'authenticated' | 'ready' | 'auth_failure'
      isInitialized: Boolean(this.sock),
      hasActiveSession: Boolean(this.authenticatedAt),
      isReady: this.status === 'ready',
      qrAvailable: this.status === 'qr_required' && Boolean(this.qrDataUrl),
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      user: this.userInfo,
      timestamp: new Date().toISOString(),
      engine: 'baileys',
    };
  }

  /**
   * Dapatkan status dan gambar QR data URL yang sedang berlaku
   */
  getQr() {
    // 1. Jika QR siap dan masih aktif berlaku
    if (this.status === 'qr_required' && this.qrDataUrl) {
      const isExpired = this.qrExpiresAt && new Date() > new Date(this.qrExpiresAt);
      if (isExpired) {
        return {
          status: 'qr_not_available',
          qrAvailable: false,
          qrDataUrl: null,
          authStatus: 'qr_expired',
          message: 'QR code telah kedaluwarsa. Menunggu regenerasi QR code baru dari WhatsApp.',
        };
      }

      return {
        status: 'qr_required',
        qrAvailable: true,
        qrDataUrl: this.qrDataUrl,
        generatedAt: this.qrGeneratedAt,
        expiresAt: this.qrExpiresAt,
        authStatus: 'qr_required',
        message: 'QR code tersedia untuk dipindai melalui aplikasi WhatsApp.',
      };
    }

    // 2. Jika QR belum tersedia atau sudah tidak diperlukan
    let message = `WhatsApp client dalam status ${this.status}. QR belum tersedia.`;
    if (this.status === 'ready') {
      message = 'WhatsApp sudah siap dan terhubung. QR tidak diperlukan.';
    } else if (this.status === 'authenticated') {
      message = 'WhatsApp telah terautentikasi dan sedang memuat data akun.';
    } else if (this.status === 'disconnected') {
      message = 'WhatsApp client belum diinisialisasi. Panggil POST /api/whatsapp/connect terlebih dahulu.';
    } else if (this.status === 'initializing') {
      message = 'WhatsApp client sedang dalam tahap koneksi ke server. QR code belum siap.';
    }

    return {
      status: 'qr_not_available',
      qrAvailable: false,
      qrDataUrl: null,
      authStatus: this.status,
      message,
    };
  }
}

// Ekspor instance singleton
const whatsappService = new WhatsAppService();
export default whatsappService;
