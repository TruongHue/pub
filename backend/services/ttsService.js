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
    <prosody rate='0%' pitch='+2%'>${escaped}</prosody>
  </voice>
</speak>`;
}

function buildExpressiveSsml(input) {
  const name = escapeSsml(input?.name || "");
  const mood = String(input?.mood || "mysterious").trim();
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

  let baseRate = "-1%";
  let basePitch = "+2%";
  if (mood === "warning") {
    baseRate = "-4%";
    basePitch = "-2%";
  } else if (mood === "positive") {
    baseRate = "+2%";
    basePitch = "+6%";
  }

  const blocks = [];
  if (name) {
    blocks.push(`<prosody rate='-2%' pitch='+3%'><emphasis level='moderate'>${name}</emphasis>,</prosody>`);
  }
  if (parts.hook) {
    blocks.push(
      `<break time='120ms'/><prosody rate='${baseRate}' pitch='${basePitch}'><emphasis level='moderate'>${escapeSsml(parts.hook)}</emphasis></prosody>`
    );
  }
  if (parts.insight) {
    blocks.push(
      `<break time='160ms'/><prosody rate='-2%' pitch='+1%'>${escapeSsml(parts.insight)}</prosody>`
    );
  }
  if (parts.warningOrOpportunity) {
    blocks.push(
      `<break time='180ms'/><prosody rate='-7%' pitch='-4%'><emphasis level='reduced'>${escapeSsml(parts.warningOrOpportunity)}</emphasis></prosody>`
    );
  }
  if (parts.action) {
    blocks.push(
      `<break time='140ms'/><prosody rate='+1%' pitch='+2%'>Loi khuyen hanh dong: ${escapeSsml(parts.action)}</prosody>`
    );
  }
  if (parts.luckyHint) {
    blocks.push(
      `<break time='140ms'/><prosody rate='+4%' pitch='+8%'>Dau hieu may man: ${escapeSsml(parts.luckyHint)}</prosody>`
    );
  }
  if (parts.funnyLine) {
    blocks.push(
      `<break time='120ms'/><prosody rate='+6%' pitch='+10%'><emphasis level='moderate'>${escapeSsml(parts.funnyLine)}</emphasis></prosody>`
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

module.exports = { synthesizeWithAzure };
