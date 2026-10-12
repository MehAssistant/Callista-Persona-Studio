import fs from 'fs';
import path from 'path';
import pkg from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import config from '../config/index.js';
import messageStore from './messageStore.js';
import messageProcessor from './messageProcessor.js';
import eventHub from './eventHub.js';

const { Client, LocalAuth } = pkg;

/**
 * Singleton WhatsApp Client Manager
 * Mengelola lifecycle koneksi, autentikasi LocalAuth, QR code (visual terminal & DataURL PNG base64),
 * browser Puppeteer, serta penerimaan dan pengiriman pesan WhatsApp aktual.
 */
class WhatsAppService {
  constructor() {
    this.client = null;
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
    });
  }

  /**
   * Cek apakah direktori sesi sedang terkunci oleh proses lain
   */
  _checkSessionLock() {
    try {
      const sessionDir = path.join(config.whatsapp.sessionPath, `session-${config.whatsapp.clientId}`);
      if (!fs.existsSync(sessionDir)) {
        return false;
      }

      const lockPath = path.join(sessionDir, 'SingletonLock');
      if (fs.existsSync(lockPath)) {
        try {
          const target = fs.readlinkSync(lockPath);
          const parts = target.split('-');
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && !isNaN(pid)) {
            try {
              process.kill(pid, 0);
              if (pid !== process.pid) {
                return true;
              }
            } catch (_e) {
              return false;
            }
          }
        } catch (_e) {
          // Abaikan
        }
      }
      return false;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Memulai inisialisasi client WhatsApp jika belum berjalan
   */
  async connect() {
    // 1. Jika sudah siap dan terhubung
    if (this.status === 'ready' && this.client) {
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

    // 3. Jika sedang terautentikasi dan menunggu ready
    if (this.status === 'authenticated') {
      return {
        success: true,
        message: 'WhatsApp telah terautentikasi dan sedang memuat data akun.',
        status: this.status,
      };
    }

    // 4. Deteksi potensi konflik sesi yang sedang dipakai browser lain
    if (this._checkSessionLock()) {
      const errorMsg = 'Konflik direktori sesi: Folder sesi sedang digunakan oleh proses browser lain.';
      this._setStatus('auth_failure', errorMsg);
      console.error(`[WHATSAPP] ${errorMsg}`);
      return {
        success: false,
        message: errorMsg,
        status: this.status,
      };
    }

    // 5. Bersihkan instance lama jika ada sebelum membuat baru
    if (this.client) {
      await this._cleanupClient();
    }

    this.isInitializing = true;
    this._setStatus('initializing');
    this.lastError = null;
    this.qr = null;
    this.qrDataUrl = null;
    this.qrGeneratedAt = null;
    this.qrExpiresAt = null;
    this._hasLoggedAuthenticated = false;

    console.log(`[WHATSAPP] Inisialisasi client dimulai (session: ${config.whatsapp.sessionPath})...`);

    try {
      if (!fs.existsSync(config.whatsapp.sessionPath)) {
        fs.mkdirSync(config.whatsapp.sessionPath, { recursive: true });
      }

      const puppeteerArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ];

      const puppeteerOptions = {
        headless: config.whatsapp.headless,
        args: puppeteerArgs,
      };

      if (config.whatsapp.puppeteerExecutablePath) {
        puppeteerOptions.executablePath = config.whatsapp.puppeteerExecutablePath;
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.whatsapp.sessionPath,
          clientId: config.whatsapp.clientId,
        }),
        puppeteer: puppeteerOptions,
      });

      this._attachEventListeners();

      // Inisialisasi asynchronous tanpa memblokir request HTTP
      this.client.initialize().catch((err) => {
        this._handleInitError(err);
      });

      return {
        success: true,
        message: 'Inisialisasi client WhatsApp berhasil dimulai.',
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
   * Pasang listener event library whatsapp-web.js
   * Hanya dipasang satu kali per instance client
   */
  _attachEventListeners() {
    // 1. Event QR Code Aktual
    this.client.on('qr', async (qr) => {
      this.isInitializing = false;
      this.qr = qr;
      const now = new Date();
      this.qrGeneratedAt = now.toISOString();
      this.qrExpiresAt = new Date(now.getTime() + config.whatsapp.qrTimeoutMs).toISOString();

      // Hasilkan base64 PNG Data URL aktual dari string QR
      try {
        this.qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 2,
          scale: 7,
          errorCorrectionLevel: 'M',
        });
      } catch (qrErr) {
        console.error('[WHATSAPP] Gagal mengonversi QR ke Data URL:', qrErr.message);
        this.qrDataUrl = null;
      }

      this._setStatus('qr_required');

      // Tampilkan QR autentikasi langsung pada terminal
      console.log('\n================================================================================');
      console.log('[WHATSAPP] QR CODE AUTENTIKASI TERSEDIA — PINDAI DENGAN PONSEL ANDA');
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
        console.error('[WHATSAPP] Gagal merender visual QR di terminal:', err.message);
      }
      console.log('--------------------------------------------------------------------------------');
      console.log(`[WHATSAPP] QR code berlaku selama ${Math.floor(config.whatsapp.qrTimeoutMs / 1000)} detik.`);
      console.log('[WHATSAPP] Klien frontend dapat mengambil gambar QR melalui GET /api/whatsapp/qr');
      console.log('================================================================================\n');
    });

    // 2. Event Autentikasi Berhasil
    this.client.on('authenticated', () => {
      // Hapus data QR dari memori setelah autentikasi berhasil
      this.qr = null;
      this.qrDataUrl = null;
      this.qrGeneratedAt = null;
      this.qrExpiresAt = null;
      this.authenticatedAt = new Date().toISOString();

      this._setStatus('authenticated');

      if (!this._hasLoggedAuthenticated) {
        this._hasLoggedAuthenticated = true;
        console.log('[WHATSAPP] Autentikasi sesi WhatsApp berhasil! Menginisialisasi koneksi data...');
      }
    });

    // 3. Event Koneksi Siap Digunakan (ready)
    this.client.on('ready', () => {
      this.isInitializing = false;
      this.connectedAt = new Date().toISOString();
      this.lastError = null;

      try {
        const info = this.client.info;
        this.userInfo = {
          id: info?.wid?._serialized || null,
          name: info?.pushname || null,
          platform: info?.platform || null,
        };
      } catch (_e) {
        this.userInfo = null;
      }

      this._setStatus('ready');
      const accountName = this.userInfo?.name || 'User';
      const accountId = this.userInfo?.id || 'ID Unknown';
      console.log(`[WHATSAPP] Koneksi WhatsApp siap! Terhubung sebagai: ${accountName} (${accountId})`);
    });

    // 4. Event Gagal Autentikasi
    this.client.on('auth_failure', (msg) => {
      this.isInitializing = false;
      this.qr = null;
      this.qrDataUrl = null;
      const errorMsg = `Autentikasi gagal: ${msg || 'Kredensial sesi tidak valid atau kedaluwarsa'}`;
      this._setStatus('auth_failure', errorMsg);
      console.error(`[WHATSAPP] Proses gagal: ${errorMsg}`);
    });

    // 5. Event Terputus
    this.client.on('disconnected', (reason) => {
      console.log(`[WHATSAPP] Koneksi terputus: ${reason}`);
      this.isInitializing = false;
      this.qr = null;
      this.qrDataUrl = null;
      this.userInfo = null;
      this._setStatus('disconnected');
      this._cleanupClient();
    });

    // 6. Event Perubahan State
    this.client.on('change_state', (state) => {
      console.log(`[WHATSAPP] Perubahan state koneksi: ${state}`);
      if (state === 'CONFLICT' || state === 'UNPAIRED') {
        this.qr = null;
        this.qrDataUrl = null;
        this._setStatus('disconnected');
      } else if (state === 'CONNECTED') {
        this._setStatus('ready');
      } else if (state === 'OPENING') {
        this._setStatus('initializing');
      }
    });

    // 7. Event Pesan Masuk Nyata (Incoming Messages)
    this.client.on('message', async (msg) => {
      try {
        if (msg.fromMe) return;

        const messageId = msg.id?._serialized || msg.id?.id;
        const chatId = msg.from;
        const isGroup = Boolean(chatId && chatId.endsWith('@g.us'));
        const senderId = isGroup ? (msg.author || msg.from) : msg.from;
        const senderName = msg._data?.notifyName || null;
        const text = msg.body || '';
        const type = msg.type || 'chat';
        const timestamp = msg.timestamp
          ? new Date(msg.timestamp * 1000).toISOString()
          : new Date().toISOString();

        let quotedMessageId = null;
        let quotedParticipant = null;
        if (msg.hasQuotedMsg) {
          quotedMessageId = msg._data?.quotedStanzaID || msg.quotedMsgId || null;
          quotedParticipant = msg._data?.quotedParticipant || null;
        }

        const parsedMessage = {
          id: messageId,
          chatId,
          isGroup,
          senderId,
          senderName,
          text,
          type,
          timestamp,
          quotedMessageId,
          quotedParticipant,
          fromMe: false,
        };

        const savedMessage = messageStore.addIncomingMessage(parsedMessage);
        if (savedMessage) {
          console.log(`[WHATSAPP] Pesan masuk diterima dari ${senderId} di chat ${chatId} (tipe: ${type})`);
          eventHub.emitMessageReceived(savedMessage);

          // Pemicu alur otomatis klasifikasi intent dan balasan persona Callista
          messageProcessor.processIncomingMessage(savedMessage, this).catch((procErr) => {
            console.error('[WHATSAPP] Terjadi kesalahan pada pipeline pemrosesan pesan:', procErr?.message || procErr);
          });
        }
      } catch (err) {
        console.error('[WHATSAPP] Gagal memproses pesan masuk:', err?.message || err);
      }
    });
  }

  /**
   * Kirim pesan teks manual ke akun/grup WhatsApp
   */
  async sendMessage(chatId, text, quotedMessageId = null) {
    if (this.status !== 'ready' || !this.client) {
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

    // 1. Normalisasi targetChatId sesuai konvensi whatsapp-web.js
    let targetChatId = chatId.trim();
    // Hapus device specifier (misal: "628123456789:0@c.us" -> "628123456789@c.us")
    if (targetChatId.includes(':') && targetChatId.includes('@')) {
      targetChatId = targetChatId.replace(/:[0-9]+@/, '@');
    }
    // Ganti domain server lama ke format standar @c.us jika bukan grup
    if (targetChatId.endsWith('@s.whatsapp.net')) {
      targetChatId = targetChatId.replace('@s.whatsapp.net', '@c.us');
    }
    // Tambahkan domain default @c.us jika belum memiliki domain
    if (!targetChatId.includes('@')) {
      targetChatId = `${targetChatId}@c.us`;
    }

    // 2. Dapatkan objek chat menggunakan API resmi whatsapp-web.js jika tersedia
    let chat = null;
    try {
      if (typeof this.client.getChatById === 'function') {
        chat = await this.client.getChatById(targetChatId);
      }
    } catch (getChatErr) {
      console.warn(`[WHATSAPP] Gagal mengambil model chat '${targetChatId}' via getChatById:`, getChatErr?.message || getChatErr);
    }

    // Tentukan ID obrolan kanonikal dari objek chat jika ditemukan, atau gunakan targetChatId yang telah dinormalisasi
    const resolvedChatId = (chat && chat.id && chat.id._serialized) ? chat.id._serialized : targetChatId;
    const isGroup = Boolean((chat && chat.isGroup) || resolvedChatId.endsWith('@g.us'));

    // 3. Konfigurasi opsi pengiriman
    const options = {};
    if (quotedMessageId && typeof quotedMessageId === 'string' && quotedMessageId.trim()) {
      options.quotedMessageId = quotedMessageId.trim();
    }

    try {
      console.log(`[WHATSAPP] Mengirim pesan ke ${resolvedChatId}...`);
      let sentResult = null;

      // Prioritaskan pengiriman via objek chat yang telah divalidasi, atau fallback ke client.sendMessage
      if (chat && typeof chat.sendMessage === 'function') {
        try {
          sentResult = await chat.sendMessage(text.trim(), options);
        } catch (chatSendErr) {
          // Jika gagal karena kutipan (quotedMessageId tidak valid di cache WA), coba kirim langsung tanpa kutipan
          if (options.quotedMessageId) {
            console.warn(`[WHATSAPP] Pengiriman dengan kutipan via chat model gagal (${chatSendErr?.message}), mencoba ulang tanpa kutipan...`);
            sentResult = await chat.sendMessage(text.trim());
          } else {
            throw chatSendErr;
          }
        }
      } else {
        try {
          sentResult = await this.client.sendMessage(resolvedChatId, text.trim(), options);
        } catch (clientSendErr) {
          if (options.quotedMessageId) {
            console.warn(`[WHATSAPP] Pengiriman dengan kutipan via client gagal (${clientSendErr?.message}), mencoba ulang tanpa kutipan...`);
            sentResult = await this.client.sendMessage(resolvedChatId, text.trim());
          } else {
            throw clientSendErr;
          }
        }
      }

      // 4. Tangani bentuk hasil pengiriman berdasarkan versi library whatsapp-web.js (v1.34.7)
      // Pada versi ini, jika internal WhatsApp Web belum mengindeks Msg.get(), sentResult dapat bernilai undefined meskipun pesan telah terkirim
      let messageId = null;
      let timestamp = new Date().toISOString();

      if (sentResult && typeof sentResult === 'object') {
        if (sentResult.id) {
          messageId = typeof sentResult.id === 'object'
            ? (sentResult.id._serialized || sentResult.id.id)
            : String(sentResult.id);
        }
        if (sentResult.timestamp) {
          timestamp = new Date(sentResult.timestamp * 1000).toISOString();
        }
      }

      // Fallback ID yang deterministik jika library tidak mengembalikan model pesan
      if (!messageId) {
        messageId = `true_${resolvedChatId}_${Date.now()}`;
      }

      const outgoingMessage = {
        id: messageId,
        chatId: resolvedChatId,
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

      console.log(`[WHATSAPP] Pesan berhasil dikirim ke ${resolvedChatId} (ID: ${messageId})`);
      return outgoingMessage;
    } catch (err) {
      console.error(`[WHATSAPP] Gagal mengirim pesan ke ${resolvedChatId}:`, err?.message || err);
      messageStore.recordSendFailure(resolvedChatId, text, err);
      const errorObj = new Error(`Pengiriman pesan gagal: ${err?.message || 'Kesalahan WhatsApp Web'}`);
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
    let errorMsg = `Inisialisasi gagal: ${rawMessage}`;

    if (
      rawMessage.includes('SingletonLock') ||
      rawMessage.includes('profile appears to be in use') ||
      rawMessage.includes('ProcessSingleton') ||
      rawMessage.includes('EBUSY')
    ) {
      errorMsg = 'Konflik direktori sesi: Folder sesi sedang digunakan oleh browser lain.';
    }

    this._setStatus('auth_failure', errorMsg);
    console.error(`[WHATSAPP] Proses gagal: ${errorMsg}`);
    this._cleanupClient();
  }

  /**
   * Putus koneksi secara terkontrol
   */
  async disconnect() {
    if (this.status === 'disconnected' && !this.client) {
      return {
        success: true,
        message: 'WhatsApp client sudah dalam keadaan terputus.',
        status: 'disconnected',
      };
    }

    try {
      if (this.client) {
        console.log('[WHATSAPP] Client dihentikan secara terkontrol...');
        await this.client.destroy();
      }
    } catch (err) {
      console.error('[WHATSAPP] Peringatan saat menutup client:', err?.message || err);
    } finally {
      await this._cleanupClient();
      this.qr = null;
      this.qrDataUrl = null;
      this.userInfo = null;
      this.isInitializing = false;
      this._setStatus('disconnected');
    }

    console.log('[WHATSAPP] Client dihentikan.');
    return {
      success: true,
      message: 'Koneksi WhatsApp berhasil diputus secara terkontrol.',
      status: 'disconnected',
    };
  }

  /**
   * Bersihkan referensi instance client internal
   */
  async _cleanupClient() {
    if (this.client) {
      try {
        this.client.removeAllListeners();
      } catch (_e) {
        // Abaikan
      }
      this.client = null;
    }
  }

  /**
   * Dapatkan status aktual koneksi WhatsApp
   */
  getStatus() {
    return {
      status: this.status, // 'disconnected' | 'initializing' | 'qr_required' | 'authenticated' | 'ready' | 'auth_failure'
      isInitialized: Boolean(this.client),
      hasActiveSession: Boolean(this.authenticatedAt),
      isReady: this.status === 'ready',
      qrAvailable: this.status === 'qr_required' && Boolean(this.qrDataUrl),
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      user: this.userInfo,
      timestamp: new Date().toISOString(),
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
      message = 'WhatsApp client sedang dalam tahap inisialisasi browser. QR code belum siap.';
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
