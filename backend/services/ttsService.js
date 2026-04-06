const axios = require("axios");

const AZURE_VOICE_NAME = process.env.AZURE_SPEECH_VOICE || "vi-VN-HoaiMyNeural";
const AZURE_OUTPUT_FORMAT =
  process.env.AZURE_SPEECH_FORMAT || "audio-24khz-48kbitrate-mono-mp3";

function escapeSsml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildSsml(text) {
  const escaped = escapeSsml(text);

  return `<speak version='1.0' xml:lang='vi-VN'>
  <voice xml:lang='vi-VN' name='${AZURE_VOICE_NAME}'>
    <prosody rate='-8%' pitch='+2%'>${escaped}</prosody>
  </voice>
</speak>`;
}

function buildExpressiveSsml(input) {
  const name = escapeSsml(input?.name || "");
  const mood = String(input?.mood || "mysterious").trim();
  const verdict = String(input?.verdict || "").trim();
  const parts = {
    hook: String(input?.hook || "").trim(),
    insight: String(input?.insight || "").trim(),
    warningOrOpportunity: String(input?.warningOrOpportunity || "").trim(),
    action: String(input?.action || "").trim(),
    luckyHint: String(input?.luckyHint || "").trim(),
    funnyLine: String(input?.funnyLine || "")
      .trim()
  };

  const hasStructured = Object.values(parts).some(Boolean);
  if (!hasStructured) {
    const plain = [name, String(input?.text || "").trim()].filter(Boolean).join(", ");
    return buildSsml(plain);
  }

  let baseRate = "-8%";
  let basePitch = "+2%";
  if (mood === "warning") {
    baseRate = "-12%";
    basePitch = "-2%";
  } else if (mood === "positive") {
    baseRate = "-4%";
    basePitch = "+6%";
  }

  const blocks = [];
  if (name) {
    blocks.push(`<prosody rate='-8%' pitch='+3%'><emphasis level='moderate'>${name}</emphasis>,</prosody>`);
  }
  if (verdict) {
    blocks.push(
      `<break time='160ms'/><prosody rate='-14%' pitch='-2%'><emphasis level='strong'>${escapeSsml(verdict)}</emphasis></prosody>`
    );
  }
  if (parts.hook) {
    blocks.push(
      `<break time='120ms'/><prosody rate='${baseRate}' pitch='${basePitch}'><emphasis level='moderate'>${escapeSsml(parts.hook)}</emphasis></prosody>`
    );
  }
  if (parts.insight) {
    blocks.push(
      `<break time='160ms'/><prosody rate='-8%' pitch='+1%'>${escapeSsml(parts.insight)}</prosody>`
    );
  }
  if (parts.warningOrOpportunity) {
    blocks.push(
      `<break time='180ms'/><prosody rate='-12%' pitch='-4%'><emphasis level='reduced'>${escapeSsml(parts.warningOrOpportunity)}</emphasis></prosody>`
    );
  }
  if (parts.action) {
    blocks.push(
      `<break time='140ms'/><prosody rate='-6%' pitch='+2%'>Lời khuyên hành động: ${escapeSsml(parts.action)}</prosody>`
    );
  }
  if (parts.luckyHint) {
    blocks.push(
      `<break time='140ms'/><prosody rate='-2%' pitch='+8%'>Dấu hiệu may mắn: ${escapeSsml(parts.luckyHint)}</prosody>`
    );
  }
  if (parts.funnyLine) {
    blocks.push(
      `<break time='120ms'/><prosody rate='0%' pitch='+10%'><emphasis level='moderate'>${escapeSsml(parts.funnyLine)}</emphasis></prosody>`
    );
  }

  return `<speak version='1.0' xml:lang='vi-VN'>
  <voice xml:lang='vi-VN' name='${AZURE_VOICE_NAME}'>
    ${blocks.join("\n    ")}
  </voice>
</speak>`;
}

async function synthesizeWithAzure(input) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) return null;

  const ssml =
    typeof input === "string"
      ? buildSsml(input)
      : buildExpressiveSsml(input || {});

  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const response = await axios.post(url, ssml, {
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AZURE_OUTPUT_FORMAT,
      "User-Agent": "akool-astro-avatar"
    },
    responseType: "arraybuffer",
    timeout: 30000
  });

  const buffer = Buffer.from(response.data);
  if (!buffer.length) return null;
  return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
}

/**
 * ZipVoice-style API: POST /tts, application/x-www-form-urlencoded
 * (vd. Swagger: https://unoverlooked-soulfully-rayna.ngrok-free.dev/docs )
 */
function zipVoiceBaseUrl() {
  const raw = (process.env.ZIPVOICE_TTS_URL || "").trim().replace(/\/+$/, "");
  return raw || null;
}

function mimeToDataPrefix(mime) {
  const m = (mime || "").split(";")[0].trim().toLowerCase();
  if (m.includes("mpeg") || m === "audio/mp3") return "data:audio/mpeg;base64,";
  if (m.includes("wav")) return "data:audio/wav;base64,";
  if (m.includes("ogg")) return "data:audio/ogg;base64,";
  return "data:audio/mpeg;base64,";
}

async function synthesizeWithZipVoice(plainText) {
  const base = zipVoiceBaseUrl();
  if (!base) return null;

  const text = String(plainText || "").trim();
  if (!text) return null;

  const params = new URLSearchParams();
  params.set("text", text);
  params.set("voice", process.env.ZIPVOICE_VOICE || "ref5");
  params.set("num_step", String(process.env.ZIPVOICE_NUM_STEP || "16"));
  params.set("first_chunk_words", String(process.env.ZIPVOICE_FIRST_CHUNK_WORDS || "10"));
  params.set("min_chunk_words", String(process.env.ZIPVOICE_MIN_CHUNK_WORDS || "15"));
  params.set("batch_size", String(process.env.ZIPVOICE_BATCH_SIZE || "2"));
  params.set("no_warmup", process.env.ZIPVOICE_NO_WARMUP === "false" ? "false" : "true");

  const url = `${base}/tts`;
  const response = await axios.post(url, params.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "ngrok-skip-browser-warning": "true",
      "User-Agent": "akool-astro-backend"
    },
    responseType: "arraybuffer",
    timeout: Number(process.env.ZIPVOICE_TTS_TIMEOUT_MS) || 180000
  });

  const buffer = Buffer.from(response.data);
  if (!buffer.length) return null;

  const ct = response.headers["content-type"] || "";
  const prefix = mimeToDataPrefix(ct);
  return `${prefix}${buffer.toString("base64")}`;
}

function ttsPlainTextFromInput(input) {
  if (typeof input === "string") return String(input || "").trim();
  return String(input?.text || "").trim();
}

/**
 * Ưu tiên ZipVoice nếu có ZIPVOICE_TTS_URL; lỗi thì fallback Azure (nếu cấu hình).
 */
async function synthesizeSpeech(input) {
  const plain = ttsPlainTextFromInput(input);
  if (!plain) return null;

  if (zipVoiceBaseUrl()) {
    try {
      const zip = await synthesizeWithZipVoice(plain);
      if (zip) return zip;
    } catch (e) {
      console.warn("[TTS] ZipVoice failed:", e.message || e);
    }
  }

  return synthesizeWithAzure(input);
}

module.exports = {
  synthesizeWithAzure,
  synthesizeWithZipVoice,
  synthesizeSpeech
};
