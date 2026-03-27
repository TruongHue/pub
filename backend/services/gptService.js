const axios = require("axios");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
/** Model thứ hai (tùy chọn): thử khi model chính 429 / lỗi — ví dụ model trả phí hoặc slug khác. */
const OPENROUTER_FALLBACK_MODEL = (process.env.OPENROUTER_FALLBACK_MODEL || "").trim();
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 60_000;

const DRAMATIC_LINES = [
  "Lá số này đang rung động theo cách rất hiếm...",
  "Bạn đang đứng trước một cánh cửa năng lượng lớn.",
  "Một dấu hiệu mạnh đang xuất hiện quanh bạn."
];

const HOOK_LINES = [
  "Điều này không phải ai cũng nhận ra...",
  "Có một năng lượng đang ảnh hưởng đến bạn...",
  "Vũ trụ đang gửi một tín hiệu rất mạnh tới bạn..."
];

const ADVICE_LINES = [
  "Hãy hành động chậm mà chắc trong 3 ngày tới.",
  "Đừng trì hoãn quyết định quan trọng nữa.",
  "Tin vào trực giác của bạn, nhưng vẫn giữ đầu lạnh.",
  "Bạn cần cắt bỏ một điều cũ để đón cơ hội mới."
];

const LUCKY_SIGNS = ["2", "7", "9", "14", "22", "Moon", "Venus", "Blue", "Purple"];
const FUNNY_LINES = [
  "Nếu vũ trụ có nút 'skip drama' thì hôm nay bạn vừa bấm trúng rồi.",
  "Bạn không toxic đâu, chỉ là Mercury đang trêu bạn xíu thôi.",
  "Tôi thấy năng lượng bạn mạnh đến mức người cũ cũng phải xem lại lịch.",
  "Hôm nay thần thái bạn đang ở level: 'main character' thật sự."
];

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildFallback(input) {
  const moodPool = ["mysterious", "warning", "positive"];
  const mood = randomOf(moodPool);
  const hook = randomOf(HOOK_LINES);
  const dramatic = randomOf(DRAMATIC_LINES);
  const advice = randomOf(ADVICE_LINES);
  const luckySign = randomOf(LUCKY_SIGNS);
  const funnyLine = randomOf(FUNNY_LINES);
  const tensionLine =
    mood === "warning"
      ? "Có một tín hiệu cảnh báo nhỏ: đừng vội vàng ký kết hoặc tin người quá nhanh trong tuần này."
      : "Một cửa sổ cơ hội đang mở ra, nhưng chỉ dành cho người dám đi bước đầu tiên.";
  const insight = `${dramatic} Nhịp năng lượng của bạn hiện tại nghiêng về quyết định lớn liên quan đến "${input.question}".`;
  const text = `${hook} ${input.name}, ${insight} ${tensionLine} Lời khuyên hành động: ${advice} Dấu hiệu may mắn hôm nay của bạn: ${luckySign}. ${funnyLine}`;

  return {
    moDau: hook,
    phanTich: insight,
    canhBaoHoacCoHoi: tensionLine,
    loiKhuyen: advice,
    dauHieuMayMan: luckySign,
    cauHaiHuoc: funnyLine,
    noiDung: text,
    tamTrang: mood
  };
}

function buildPrompt({ name, birthDate, birthTime, question }) {
  const bonusLine = DRAMATIC_LINES[Math.floor(Math.random() * DRAMATIC_LINES.length)];
  return `Bạn là host livestream “tử vi / vibe check” kiểu Gen Z Việt Nam: năng lượng cao, hơi toxic vui, không giảng đời.

PHONG CÁCH (bắt buộc):
- Nói như bạn thân cap (capture) drama trên live: gọn, mạnh, có nhịp, vài câu hơi over nhưng không sến.
- Trộn tự nhiên từ lóng mạng VN + tí tiếng Anh Gen Z khi hợp ngữ cảnh (ví dụ: vibe, energy, toxic, main character, lowkey, highkey, real, slay, era…) — đừng lạm dụng, khoảng vài từ trong cả bài là đủ.
- Có thể: “không cap”, “chốt hạ”, “đúng là …”, “xứng đáng”, “tới công chuyện”, “ổn không ổn”, icon cảm xúc kiểu text nhẹ (1–2 chỗ) như “💀”, “✨” (chỉ trong chuỗi JSON, không line break thừa).
- Tránh văn giấy tờ, tránh “kính gửi”, tránh câu dài hun hút; ưu tiên đoạn ngắn, đánh vào câu hỏi của họ.
- Vẫn giữ aura thần bí livestream: hook mạnh ở đầu, có twist nhẹ, không biến thành meme list vô nghĩa.

NỘI DUNG:
- Gắn ngày sinh + câu hỏi vào câu chữ, cảm giác “đọc riêng cho ${name}”.
- 5–8 câu ngắn (kiểu nói), dễ đọc cho TTS.
- “moDau”: 1–2 câu hook kiểu Gen Z (bất ngờ / flex nhẹ vibe vũ trụ).
- “phanTich”: chốt năng lượng + góc nhìn “đồng điệu” với câu hỏi.
- “canhBaoHoacCoHoi”: một hướng red flag hoặc green flag ngắn, không dọa dẫm.
- “loiKhuyen”: lời khuyên hành động kiểu “làm thế này là ổn nhất”.
- “dauHieuMayMan”: 1 cụm may mắn kiểu Gen Z (số, màu, thời điểm trong ngày, hoặc “sign” vui).
- “cauHaiHuoc”: 1 câu trêu nhẹ, meta, không đụng giới tính/dạng người/tôn giáo, không hate.

“noiDung”: ghép toàn bộ thành một bản đọc liền mạch, cùng tone Gen Z (có thể lặp ý ngắt nhịp cho hay tai).

“tamTrang”: chỉ một trong ba: mysterious | warning | positive

Trả về ĐÚNG một JSON (không markdown, không \`\`\`), cấu trúc:
{
  "moDau": "...",
  "phanTich": "...",
  "canhBaoHoacCoHoi": "...",
  "loiKhuyen": "...",
  "dauHieuMayMan": "...",
  "cauHaiHuoc": "...",
  "noiDung": "...",
  "tamTrang": "mysterious | warning | positive"
}

Gợi năng lượng kịch (có thể lồng ý, không copy nguyên): ${bonusLine}

Profile:
- Tên: ${name}
- Ngày sinh: ${birthDate}
- Giờ sinh: ${birthTime || "chưa rõ, lowkey đoán vibe theo ngày"}
- Câu hỏi: ${question}`;
}

function tryParseJson(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (nestedError) {
      return null;
    }
  }
}

function toSingleText(result) {
  if (!result || typeof result !== "object") return "";
  const combined = result.noiDung || result.text;
  if (typeof combined === "string" && combined.trim()) return combined.trim();

  const parts = [
    result.moDau || result.hook,
    result.phanTich || result.insight,
    result.canhBaoHoacCoHoi || result.warningOrOpportunity,
    (result.loiKhuyen || result.action) ? `Lời khuyên hành động: ${result.loiKhuyen || result.action}` : "",
    (result.dauHieuMayMan || result.luckyHint) ? `Dấu hiệu may mắn: ${result.dauHieuMayMan || result.luckyHint}` : ""
  ]
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim());

  return parts.join(" ");
}

function normalizeHoroscopeResult(parsed, fallbackMood = "mysterious") {
  if (!parsed || typeof parsed !== "object") return null;
  const text = toSingleText(parsed);
  if (!text) return null;

  return {
    hook: typeof (parsed.moDau || parsed.hook) === "string" ? (parsed.moDau || parsed.hook).trim() : "",
    insight: typeof (parsed.phanTich || parsed.insight) === "string" ? (parsed.phanTich || parsed.insight).trim() : "",
    warningOrOpportunity:
      typeof (parsed.canhBaoHoacCoHoi || parsed.warningOrOpportunity) === "string"
        ? (parsed.canhBaoHoacCoHoi || parsed.warningOrOpportunity).trim()
        : "",
    action: typeof (parsed.loiKhuyen || parsed.action) === "string" ? (parsed.loiKhuyen || parsed.action).trim() : "",
    luckyHint: typeof (parsed.dauHieuMayMan || parsed.luckyHint) === "string" ? (parsed.dauHieuMayMan || parsed.luckyHint).trim() : "",
    funnyLine: typeof (parsed.cauHaiHuoc || parsed.funnyLine) === "string" ? (parsed.cauHaiHuoc || parsed.funnyLine).trim() : "",
    text,
    mood: parsed.tamTrang || parsed.mood || fallbackMood
  };
}

function fromParsedOrRaw(raw, fallbackMood = "mysterious") {
  const parsed = tryParseJson(raw);
  const normalized = normalizeHoroscopeResult(parsed, fallbackMood);
  if (normalized) {
    return normalized;
  }

  const rawText = typeof raw === "string" ? raw.trim() : "";
  if (rawText) {
    return {
      hook: "",
      insight: "",
      warningOrOpportunity: "",
      action: "",
      luckyHint: "",
      funnyLine: "",
      text: rawText,
      mood: fallbackMood
    };
  }

  return null;
}

function buildOpenRouterPayload(input, model) {
  return {
    model,
    messages: [
      {
        role: "system",
        content:
          "You must only return valid JSON, no markdown. All user-facing strings must be Vietnamese, Gen Z livestream host tone as in the user instructions."
      },
      { role: "user", content: buildPrompt(input) }
    ],
    temperature: 0.9
  };
}

async function askOpenRouterWithModel(input, model) {
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    console.warn("[gptService] OPENROUTER_KEY missing; using local fallback horoscope.");
    return null;
  }

  const response = await axios.post(OPENROUTER_URL, buildOpenRouterPayload(input, model), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost:4200",
      "X-Title": process.env.OPENROUTER_APP_TITLE || "AI Astrology Avatar"
    },
    timeout: OPENROUTER_TIMEOUT_MS
  });

  const raw = response.data?.choices?.[0]?.message?.content || "{}";
  return fromParsedOrRaw(raw);
}

function logOpenRouter429(model, reason) {
  console.warn(
    `[gptService] OpenRouter 429 (het limit) — model: "${model}". ${reason || ""} ` +
      "Cach xu ly: (1) Nap credit / mua goi tren https://openrouter.ai/ " +
      "(2) Doi OPENROUTER_MODEL sang model tra phi hoac quota rieng " +
      "(3) Dat OPENROUTER_FALLBACK_MODEL la model khac " +
      "(4) Doi app sang ban horoscope noi bo." +
      " Xem thêm: https://openrouter.ai/docs/api/reference/overview"
  );
}

async function generateHoroscope(input) {
  const fallback = buildFallback(input);
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    return fallback;
  }

  const chain = [];
  if (OPENROUTER_MODEL) chain.push(OPENROUTER_MODEL);
  if (OPENROUTER_FALLBACK_MODEL && OPENROUTER_FALLBACK_MODEL !== OPENROUTER_MODEL) {
    chain.push(OPENROUTER_FALLBACK_MODEL);
  }

  let lastError = null;
  for (const model of chain) {
    try {
      const openRouterResult = await askOpenRouterWithModel(input, model);
      if (openRouterResult?.text) {
        if (model !== OPENROUTER_MODEL) {
          console.warn(`[gptService] OpenRouter OK voi model du phong: "${model}".`);
        }
        return openRouterResult;
      }
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const reason = error?.response?.data?.error?.message || error.message;
      if (status === 429) {
        logOpenRouter429(model, reason);
        continue;
      }
      console.warn(`[gptService] OpenRouter failed (${status || "no-status"}) model "${model}": ${reason}`);
      continue;
    }
  }

  if (lastError) {
    console.warn("[gptService] OpenRouter khong tra ve ket qua sau khi thu tat ca model; dung ban fallback noi bo.");
  }

  return fallback;
}

module.exports = { generateHoroscope };
