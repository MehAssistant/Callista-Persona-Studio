import { GoogleGenAI } from '@google/genai';
import config from '../config/index.js';

// Kategori intent resmi sesuai spesifikasi
export const VALID_INTENTS = Object.freeze([
  'DIRECT_CALL',
  'DIRECT_QUESTION',
  'REPLY_TO_PERSONA',
  'MENTION_ONLY',
  'DISCUSSING_PERSONA',
  'UNRELATED',
  'AMBIGUOUS',
]);

const VALID_INTENTS_SET = new Set(VALID_INTENTS);

/**
 * Service Google Cloud Vertex AI Express Mode
 * Menggunakan SDK resmi @google/genai dengan konfigurasi vertexai: true dan API key
 * untuk analisis pesan WhatsApp, penerapan persona Callista, dan klasifikasi intent.
 */
class VertexAiClassifierService {
  constructor() {
    this._aiClient = null;
    this._cachedApiKey = null;
    this._cachedProject = null;
    this._cachedLocation = null;
  }

  /**
   * Menginisialisasi client @google/genai untuk Vertex AI Express Mode
   */
  _getClient() {
    const currentApiKey = config.vertexAi.apiKey;
    const currentProject = config.vertexAi.project;
    const currentLocation = config.vertexAi.location || 'us-central1';

    // Validasi ketersediaan GOOGLE_API_KEY
    if (!currentApiKey || !currentApiKey.trim()) {
      const err = new Error(
        'Layanan Vertex AI Express Mode belum dikonfigurasi: Variabel lingkungan GOOGLE_API_KEY belum diisi di file .env. ' +
        'Silakan masukkan Google API key Anda pada file .env (GOOGLE_API_KEY=your_key) untuk mengaktifkan klasifikasi AI.'
      );
      err.code = 'VERTEX_AI_KEY_MISSING';
      err.statusCode = 503;
      throw err;
    }

    // Buat client baru jika belum ada atau konfigurasi berubah
    if (
      !this._aiClient ||
      this._cachedApiKey !== currentApiKey ||
      this._cachedProject !== currentProject ||
      this._cachedLocation !== currentLocation
    ) {
      try {
        const clientOptions = {
          vertexai: true,
          apiKey: currentApiKey.trim(),
          project: currentProject.trim(),
          location: currentLocation.trim(),
        };

        this._aiClient = new GoogleGenAI(clientOptions);
        this._cachedApiKey = currentApiKey;
        this._cachedProject = currentProject;
        this._cachedLocation = currentLocation;
      } catch (err) {
        console.error('[VERTEX AI EXPRESS MODE] Gagal menginisialisasi client @google/genai:', err.message);
        const initErr = new Error(`Gagal menginisialisasi Google GenAI Vertex AI Express Mode: ${err.message}`);
        initErr.statusCode = 500;
        throw initErr;
      }
    }

    return this._aiClient;
  }

  /**
   * Membangun prompt analisis dan pembentukan balasan yang memadukan persona Callista
   */
  _buildPrompt({ message, context, personaSettings = config.persona }) {
    const personaName = personaSettings.name || 'Callista';
    const minConfidence = personaSettings.silenceConditions?.minimumConfidence ?? 0.75;

    // Siapkan konteks grup/obrolan (maksimal 10 pesan terakhir, terisolasi per grup)
    let contextText = '(Tidak ada riwayat percakapan sebelumnya)';
    if (Array.isArray(context) && context.length > 0) {
      const slicedContext = context.slice(-10);
      contextText = slicedContext
        .map((m, idx) => {
          const sender = m.senderName || m.senderId || 'Pengirim';
          const isPersona = m.fromMe || sender.toLowerCase().includes(personaName.toLowerCase());
          const roleTag = isPersona ? `[PERSONA: ${personaName}]` : `[PENGGUNA: ${sender}]`;
          return `${idx + 1}. ${roleTag}: "${m.text || ''}" (ID: ${m.id || '-'})`;
        })
        .join('\n');
    }

    const sender = message.senderName || message.senderId || 'Pengirim';
    const isGroupText = message.isGroup ? 'Grup WhatsApp' : 'Chat Pribadi';
    const quotedInfo = message.quotedMessageId
      ? `Membalas/Mengutip pesan ID: ${message.quotedMessageId}`
      : 'Bukan balasan pesan tertentu';

    return `Anda adalah modul analisis intent dan generator respon untuk persona WhatsApp bernama "${personaName}".
Tugas Anda:
1. Menganalisis pesan masuk dan menentukan apakah persona "${personaName}" WAJIB MEMBALAS atau HARUS DIAM.
2. Jika WAJIB MEMBALAS (shouldReply = true), buat draft balasan ("suggestedReply") yang sepenuhnya merefleksikan kepribadian "${personaName}".

PROFIL KEPRIBADIAN "${personaName}" (Sumber Kebenaran Perilaku):
- Paduan Karakter:
  * Sisi Hangat & Ramah (Inspirasi Lucy Heartfilia): Ramah (Friendliness: 70/100), ekspresif (Emotional Expressiveness: 60/100), punya empati tinggi (Empathy: 60/100), peduli pada lawan bicara, bisa bercanda secara natural. Bukan karakter penurut/yes-man yang pasif.
  * Sisi Gengsi & Percaya Diri (Inspirasi Louise Françoise): Percaya diri (Confidence: 70/100), harga diri tinggi, punya aksen tsundere terukur. Terkadang menyamarkan perhatian dengan sedikit protes, ketus ringan, atau menyangkal rasa malu. Tidak selalu mengakui rasa pedulinya secara terang-terangan di awal, namun tetap perhatian dan tulus di situasi yang tepat.
- Sifat tsundere adalah AKSEN KEPRIBADIAN, BUKAN alasan untuk bersikap kasar, bermusuhan, menghina, atau mengubah percakapan menjadi romantis.
- Bahasa & Gaya Bicara:
  * Bahasa Indonesia santai dan alami (Formality: 30/100, Typing Style: casual).
  * Directness: 70/100 (lugas to the point).
  * Emoji: sedang (moderate).
  * Menyesuaikan suasana: bedakan suasana bercanda, serius, sedih, dan teknis/faktual.
- INTEGRITAS FAKTUAL:
  * Kepribadian memengaruhi CARA PENYAMPAIAN, BUKAN MENGUBAH FAKTA!
  * JANGAN PERNAH mengarang fakta atau hal-hal yang tidak didukung data/konteks percakapan. Jika ditanya hal yang belum diketahui (misal jadwal, dokumen tertentu), akui terus terang bahwa belum mengetahuinya.
  * JANGAN mengulang-ulang deskripsi kepribadian Callista dalam jawaban (jangan katakan "sebagai Callista yang tsundere..."). Berbicaralah langsung secara natural sebagai dirinya!

ATURAN KLASIFIKASI INTENT (Pilih Tepat Satu):
- DIRECT_CALL: Pesan secara langsung memanggil nama persona untuk meminta perhatian atau kehadiran (misal: "Callista?", "Hai Callista").
- DIRECT_QUESTION: Pertanyaan yang secara eksplisit atau jelas ditujukan kepada persona (misal: "Callista, apakah kamu tahu materi rapat tadi?").
- REPLY_TO_PERSONA: Balasan langsung (quote reply atau lanjutan dialog) terhadap pesan yang sebelumnya dikirim oleh persona.
- MENTION_ONLY: Hanya menyebut atau menandai nama persona tanpa ada permintaan, pertanyaan, atau ajakan bicara yang jelas.
- DISCUSSING_PERSONA: Sedang membicarakan persona dengan pihak ketiga sebagai subjek obrolan (misal: "Kemarin Callista kirim file ini ke saya").
- UNRELATED: Pesan umum atau percakapan antar anggota lain yang sama sekali tidak berhubungan dengan persona.
- AMBIGUOUS: Maksud atau sasaran pesan tidak jelas, ambigu, atau multitafsir.

ATURAN KEPUTUSAN shouldReply (AMBANG BATAS MINIMUM CONFIDENCE: ${minConfidence}):
- shouldReply HANYA bernilai true jika:
  1. Intent adalah DIRECT_CALL, DIRECT_QUESTION, atau REPLY_TO_PERSONA.
  2. confidence >= ${minConfidence}.
- shouldReply WAJIB false jika:
  * Intent adalah MENTION_ONLY, DISCUSSING_PERSONA, UNRELATED, atau AMBIGUOUS.
  * confidence < ${minConfidence}.
- Jika shouldReply = false, maka suggestedReply WAJIB bernilai null.
- Jika shouldReply = true, maka suggestedReply WAJIB berupa teks balasan bernada persona Callista. Pertanyaan langsung yang ditujukan kepada Callista (DIRECT_QUESTION) atau panggilan langsung (DIRECT_CALL) WAJIB dijawab (shouldReply = true). Bila konteks minim atau belum diketahui, Callista membalas secara natural dan berkarakter (menanyakan kejelasan atau jujur mengakui belum tahu), BUKAN memilih diam!

RIWAYAT PERCAKAPAN TERAKHIR (MAKSIMAL 10 PESAN GRUP):
${contextText}

METADATA PESAN YANG SEDANG DIANALISIS:
- Tipe Chat: ${isGroupText}
- Pengirim: ${sender}
- Konteks Kutipan: ${quotedInfo}
- Teks Pesan: """${message.text || ''}"""

HASILKAN KELUARAN DALAM FORMAT JSON BERIKUT (TANPA MARKDOWN TAMBAHAN):
{
  "intent": "DIRECT_CALL | DIRECT_QUESTION | REPLY_TO_PERSONA | MENTION_ONLY | DISCUSSING_PERSONA | UNRELATED | AMBIGUOUS",
  "shouldReply": boolean,
  "targetMessageId": string atau null,
  "targetPerson": string atau null,
  "confidence": number antara 0.0 sampai 1.0,
  "reason": "Penjelasan ringkas alasan klasifikasi dan keputusan balas/diam",
  "suggestedReply": "Draft balasan berkarakter Callista jika shouldReply=true, atau null jika shouldReply=false",
  "needsMoreContext": boolean
}`;
  }

  /**
   * Validasi dan sanitasi output JSON dari model AI berdasarkan konfigurasi persona
   */
  _validateAndSanitizeOutput(parsed, originalMessage, personaSettings = config.persona) {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Hasil keluaran Vertex AI bukan objek JSON yang valid.');
    }

    const minConfidence = personaSettings.silenceConditions?.minimumConfidence ?? 0.75;

    // 1. Validasi intent
    let intent = String(parsed.intent || '').trim();
    if (!VALID_INTENTS_SET.has(intent)) {
      intent = 'AMBIGUOUS';
    }

    // 2. Validasi confidence
    let confidence = parseFloat(parsed.confidence);
    if (isNaN(confidence) || confidence < 0) confidence = 0.0;
    if (confidence > 1) confidence = 1.0;

    // 3. Validasi boolean flags
    let needsMoreContext = Boolean(parsed.needsMoreContext);
    let shouldReply = Boolean(parsed.shouldReply);

    // 4. Terapkan Aturan Keputusan Konservatif Sesuai persona.json
    // MENTION_ONLY, DISCUSSING_PERSONA, UNRELATED, AMBIGUOUS, dan low confidence (< minConfidence) WAJIB diam
    if (
      intent === 'MENTION_ONLY' ||
      intent === 'DISCUSSING_PERSONA' ||
      intent === 'UNRELATED' ||
      intent === 'AMBIGUOUS' ||
      confidence < minConfidence
    ) {
      shouldReply = false;
    } else if (
      (intent === 'DIRECT_CALL' || intent === 'DIRECT_QUESTION' || intent === 'REPLY_TO_PERSONA') &&
      confidence >= minConfidence
    ) {
      // Sesuai persona.json: replyToDirectQuestions, replyToDirectCalls, replyToReplies = true
      shouldReply = true;
    }

    // 5. Validasi targetMessageId & targetPerson
    const targetMessageId = parsed.targetMessageId && typeof parsed.targetMessageId === 'string'
      ? parsed.targetMessageId
      : (originalMessage?.id || null);

    const targetPerson = parsed.targetPerson && typeof parsed.targetPerson === 'string'
      ? parsed.targetPerson
      : (shouldReply ? (personaSettings.name || 'Callista') : null);

    // 6. Validasi reason
    const reason = parsed.reason && typeof parsed.reason === 'string'
      ? parsed.reason.trim()
      : `Pesan diklasifikasikan sebagai ${intent}.`;

    // 7. Validasi suggestedReply (hanya jika shouldReply true)
    let suggestedReply = null;
    if (shouldReply) {
      if (parsed.suggestedReply && typeof parsed.suggestedReply === 'string' && parsed.suggestedReply.trim()) {
        suggestedReply = parsed.suggestedReply.trim();
      } else {
        suggestedReply = 'Hmm? Ada apa? Kalau mau tanya sesuatu ke aku, jelaskan yang lebih spesifik dong!';
      }
    }

    return {
      intent,
      shouldReply,
      targetMessageId,
      targetPerson,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      suggestedReply,
      needsMoreContext,
    };
  }

  /**
   * Menganalisis pesan masuk menggunakan Google Cloud Vertex AI Express Mode (@google/genai)
   *
   * @param {Object} params
   * @param {Object} params.message - Pesan yang dianalisis
   * @param {Array} [params.context] - Konteks pesan percakapan (maksimal 10)
   * @param {Object} [params.personaSettings] - Konfigurasi persona
   * @returns {Promise<Object>} Hasil klasifikasi tervalidasi
   */
  async classifyMessage({ message, context = [], personaSettings = config.persona }) {
    if (!message || typeof message !== 'object') {
      const err = new Error('Objek message wajib disertakan untuk klasifikasi.');
      err.statusCode = 400;
      throw err;
    }

    if (!message.text || typeof message.text !== 'string' || !message.text.trim()) {
      return {
        intent: 'UNRELATED',
        shouldReply: false,
        targetMessageId: message.id || null,
        targetPerson: null,
        confidence: 1.0,
        reason: 'Pesan tidak memuat teks untuk dianalisis.',
        suggestedReply: null,
        needsMoreContext: false,
        analyzedMessage: {
          id: message.id || null,
          text: message.text || '',
          type: message.type || 'unknown',
          senderId: message.senderId || null,
        },
      };
    }

    const ai = this._getClient();
    const prompt = this._buildPrompt({ message, context, personaSettings });

    try {
      console.log(`[VERTEX AI EXPRESS MODE] Mengirim permintaan klasifikasi pesan (Model: ${config.vertexAi.model}, Project: ${config.vertexAi.project})...`);

      const response = await ai.models.generateContent({
        model: config.vertexAi.model,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });

      const rawText = response.text;
      if (!rawText) {
        throw new Error('Teks respons dari Vertex AI Express Mode kosong.');
      }

      // Parsing JSON
      let parsedJson;
      try {
        parsedJson = JSON.parse(rawText.trim());
      } catch (parseErr) {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error(`Gagal mem-parsing keluaran JSON Vertex AI: ${parseErr.message}`);
        }
      }

      // Validasi dan terapkan aturan konservatif
      const validated = this._validateAndSanitizeOutput(parsedJson, message, personaSettings);

      console.log(`[VERTEX AI EXPRESS MODE] Klasifikasi selesai: Intent=${validated.intent}, shouldReply=${validated.shouldReply}, Confidence=${validated.confidence}`);

      return {
        ...validated,
        analyzedMessage: {
          id: message.id || null,
          text: message.text,
          type: message.type || 'chat',
          senderId: message.senderId || null,
          senderName: message.senderName || null,
          isGroup: Boolean(message.isGroup),
          chatId: message.chatId || null,
        },
      };
    } catch (err) {
      console.error('[VERTEX AI EXPRESS MODE] Kesalahan saat memanggil Vertex AI:', err.message || err);

      const safeMessage = err.message || 'Terjadi kesalahan pada layanan Vertex AI Express Mode.';
      const vertexErr = new Error(`Gagal menganalisis pesan melalui Vertex AI Express Mode: ${safeMessage}`);
      vertexErr.statusCode = err.statusCode || 502;
      throw vertexErr;
    }
  }
}

const vertexAiClassifier = new VertexAiClassifierService();
export default vertexAiClassifier;
