const axios = require("axios");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
/** Model thứ hai (tùy chọn): thử khi model chính 429 / lỗi — ví dụ model trả phí hoặc slug khác. */
const OPENROUTER_FALLBACK_MODEL = (process.env.OPENROUTER_FALLBACK_MODEL || "").trim();
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 60_000;

const PSY_HOOK_LINES = [
  "Nói thật, có một điều bạn chưa nhận ra là bạn đang tự đặt áp lực lên mình nhiều hơn là chuyện thật sự cần.",
  "Thật ra mình thấy bạn không hề lơ đãng đâu, bạn chỉ đang mệt vì cố giữ mọi thứ trông ổn.",
  "Có một pattern nhỏ: mỗi khi bạn lo, bạn lại đi giải thích cho người khác nghe thay vì tự hỏi mình cần gì."
];

const PSY_ANALYSIS_FRAGMENTS = [
  "Nhịp tâm lý của bạn đang hơi nghiêng về kiểu 'suy nhiều hơn làm'.",
  "Bạn hay tự lý hoá cảm xúc, nên đôi khi tưởng là ổn nhưng bên trong vẫn còn vướng.",
  "Bạn không thiếu quyết đoán, bạn chỉ cần một lý do đủ rõ để chọn thay vì chọn cho xong."
];

const ADVICE_LINES = [
  "Hôm nay thử viết ra một dòng: mình đang sợ điều gì nhất, rồi làm ngược lại một bước rất nhỏ.",
  "Đừng bắt mình phải chốt hết trong một ngày; chọn một việc duy nhất và làm xong nó là đủ.",
  "Khi đầu on, hạ nhịp lại: uống nước, đi vài phút, rồi mới nhắn hoặc quyết định.",
  "Nói thật với một người bạn tin được một câu bạn đang né, đừng cần drama."
];

const LUCKY_SIGNS = [
  "Thứ tư hoặc tối muộn, màu xanh ngọc hoặc be, số 3 và 7.",
  "Sáng sớm, màu lavender, nhắn một tin ngắn thay vì im lặng suy diễn.",
  "Cuối tuần, đồ ấm, một cuộc gọi 5 phút thay vì stalk feed."
];

const FUNNY_LINES = [
  "Brain của bạn đôi khi như tab Chrome mở 40 cái, đóng được một cái là đã đỡ rồi.",
  "Không phải lowkey toxic, chỉ là overthinking có bằng cấp thôi.",
  "Vũ trụ không ghost bạn đâu, có khi bạn đang ghost chính mình."
];

const VERDICT_LINES = ["Nên.", "Không nên.", "Có.", "Không.", "Nên, nhưng đừng vội.", "Chưa nên.", "Có, nhưng có điều kiện."];

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildFallback(input) {
  const moodPool = ["mysterious", "warning", "positive"];
  const mood = randomOf(moodPool);
  const hook = `${randomOf(PSY_HOOK_LINES)} Mình đang nói chuyện với ${input.name} về chuyện: ${input.question}.`;
  const analysis = `${randomOf(PSY_ANALYSIS_FRAGMENTS)} Có thể bạn đang lặp lại một vòng suy nghĩ quen thuộc quanh câu hỏi này.`;
  const tensionLine =
    mood === "warning"
      ? "Cảnh báo nhẹ: đừng để FOMO hoặc sợ bị đánh giá đẩy bạn chốt vội một điều chưa rõ ranh giới."
      : "Cơ hội nằm ở chỗ bạn dám nói thật một nhu cầu nhỏ với chính mình, không cần phải hoàn hảo trước.";
  const advice = randomOf(ADVICE_LINES);
  const luckySign = randomOf(LUCKY_SIGNS);
  const funnyLine = randomOf(FUNNY_LINES);
  const cauChotHa = randomOf(VERDICT_LINES);
  const text = `${cauChotHa} ${hook} ${analysis} ${tensionLine} ${advice} Dấu hiệu may mắn: ${luckySign}. ${funnyLine}`;

  return {
    verdict: cauChotHa,
    hook,
    insight: analysis,
    warningOrOpportunity: tensionLine,
    action: advice,
    luckyHint: luckySign,
    funnyLine,
    text,
    mood,
    cauChotHa,
    moDau: hook,
    phanTich: analysis,
    canhBaoHoacCoHoi: tensionLine,
    loiKhuyen: advice,
    dauHieuMayMan: luckySign,
    cauHaiHuoc: funnyLine,
    noiDung: text,
    tamTrang: mood
  };
}

function buildPrompt({ name, birthDate, birthTime, question }) {
  return `
Bạn không phải thầy bói. Bạn là một người bạn thân nói chuyện rất thật, rất đời, kiểu Gen Z – giống như đang ngồi tám chuyện.

MỤC TIÊU:
Nghe tự nhiên như người thật nói, nhưng vẫn phải “đọc vị tâm lý” khiến người đọc thấy bị hiểu.

NGÔN NGỮ (BẮT BUỘC):
- Toàn bộ nội dung PHẢI là tiếng Việt 100%
- Không dùng bất kỳ từ tiếng Anh nào (ví dụ: ok, yes, no, vibe, stress, deadline...)
- Không trộn ngôn ngữ
- Viết như đang nói chuyện ngoài đời

STYLE:
- Xưng: "mình - bạn"
- Giọng: thân, gần gũi, hơi cà khịa nhẹ
- Có thể dùng:
  - "Nói thiệt nha..."
  - "Có đó bà ơi..."
  - "Mình nói cái này hơi đau nha..."
  - "Nghe nè..."
- Không được viết kiểu trang trọng
- Không dùng từ học thuật
- Không emoji

QUAN TRỌNG NHẤT:
- Phải có ít nhất 1 câu khiến người đọc kiểu:
  → “Ủa sao nó biết vậy?”
- Không được nói chung chung
- Phải bám vào câu hỏi để suy ra tâm lý

LOGIC:
Từ câu hỏi → đoán ra:
- bạn đang phân vân nhưng thật ra nghiêng về 1 phía
- bạn sợ sai hoặc sợ mất
- bạn đang cần ai đó xác nhận giúp

OUTPUT:
{
  "cau_chot_ha": "Có đó bà ơi." | "Không nha." | "Nên á." | "Đừng nha." | "Cũng được, mà khoan.",
  
  "hook": "mở đầu kiểu văn nói, tự nhiên",

  "analysis": "phân tích tâm lý, nói như đang tâm sự",

  "warning_or_opportunity": "cảnh báo hoặc cơ hội",

  "advice": "lời khuyên đơn giản, thực tế",

  "lucky_sign": "chi tiết đời thường (ngày, thời điểm, hành động nhỏ)",

  "fun_line": "1 câu cà khịa nhẹ",

  "tam_trang": "mysterious | warning | positive"
}

QUY TẮC CUỐI:
- Không được thêm bất kỳ chữ tiếng Anh nào
- Không giải thích
- Không thêm text ngoài JSON

---

THÔNG TIN:
Tên: ${name}
Ngày sinh: ${birthDate}
Giờ sinh: ${birthTime || "không rõ"}
Câu hỏi: ${question}
`;
}

function cleanForTts(text) {
  if (typeof text !== "string") return "";
  let out = text.trim();
  if (!out) return "";

  // Remove common emoji/icon blocks that often make TTS awkward.
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ");

  // Remove noisy decorative symbols while keeping Vietnamese punctuation.
  out = out.replace(/[【】「」『』《》•·★☆✦✧✩✪◆◇■□▪◾◽]/g, " ");

  // Normalize repeated punctuation and separators.
  out = out
    .replace(/[~`^*_+=|\\<>]+/g, " ")
    .replace(/[!?]{2,}/g, ".")
    .replace(/[.]{2,}/g, ".")
    .replace(/[,]{2,}/g, ",")
    .replace(/\s*\/\s*/g, ", ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  return out;
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
  const combined =
    result.full_reading || result.fullReading || result.noiDung || result.text;
  if (typeof combined === "string" && combined.trim()) return combined.trim();

  const verdictRaw = result.cau_chot_ha || result.cauChotHa || result.verdict || "";
  const verdict = typeof verdictRaw === "string" ? verdictRaw.trim() : "";

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const parts = [
    verdict,
    str(result.hook || result.moDau),
    str(result.analysis || result.phanTich || result.insight),
    str(result.warning_or_opportunity || result.warningOrOpportunity || result.canhBaoHoacCoHoi),
    str(result.advice || result.loiKhuyen || result.action),
    str(result.lucky_sign || result.luckySign || result.dauHieuMayMan || result.luckyHint),
    str(result.fun_line || result.funLine || result.cauHaiHuoc)
  ].filter(Boolean);

  return parts.join(" ");
}

function normalizeHoroscopeResult(parsed, fallbackMood = "mysterious") {
  if (!parsed || typeof parsed !== "object") return null;
  const verdictRaw = parsed.cau_chot_ha || parsed.cauChotHa || parsed.verdict;
  const verdict = typeof verdictRaw === "string" ? cleanForTts(verdictRaw) : "";
  let text = cleanForTts(toSingleText(parsed));
  if (!text) return null;
  if (verdict && text && !text.startsWith(verdict)) {
    text = `${verdict} ${text}`;
  }

  const moodRaw = String(parsed.tam_trang || parsed.tamTrang || parsed.mood || fallbackMood || "")
    .trim()
    .toLowerCase();
  const mood = ["mysterious", "warning", "positive"].includes(moodRaw) ? moodRaw : fallbackMood;

  return {
    verdict,
    hook:
      typeof (parsed.hook || parsed.moDau) === "string" ? cleanForTts(parsed.hook || parsed.moDau) : "",
    insight:
      typeof (parsed.analysis || parsed.phanTich || parsed.insight) === "string"
        ? cleanForTts(parsed.analysis || parsed.phanTich || parsed.insight)
        : "",
    warningOrOpportunity:
      typeof (parsed.warning_or_opportunity || parsed.warningOrOpportunity || parsed.canhBaoHoacCoHoi) === "string"
        ? cleanForTts(
            parsed.warning_or_opportunity || parsed.warningOrOpportunity || parsed.canhBaoHoacCoHoi
          )
        : "",
    action:
      typeof (parsed.advice || parsed.loiKhuyen || parsed.action) === "string"
        ? cleanForTts(parsed.advice || parsed.loiKhuyen || parsed.action)
        : "",
    luckyHint:
      typeof (parsed.lucky_sign || parsed.luckySign || parsed.dauHieuMayMan || parsed.luckyHint) === "string"
        ? cleanForTts(parsed.lucky_sign || parsed.luckySign || parsed.dauHieuMayMan || parsed.luckyHint)
        : "",
    funnyLine:
      typeof (parsed.fun_line || parsed.funLine || parsed.cauHaiHuoc || parsed.funnyLine) === "string"
        ? cleanForTts(parsed.fun_line || parsed.funLine || parsed.cauHaiHuoc || parsed.funnyLine)
        : "",
    text,
    mood
  };
}

function fromParsedOrRaw(raw, fallbackMood = "mysterious") {
  const parsed = tryParseJson(raw);
  const normalized = normalizeHoroscopeResult(parsed, fallbackMood);
  if (normalized) {
    return normalized;
  }

  const rawText = typeof raw === "string" ? cleanForTts(raw) : "";
  if (rawText) {
    return {
      verdict: "",
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
          "You are a behavioral-psychology-informed voice in TikTok Gen Z Vietnamese. Output valid JSON only, no markdown or code fences. All user-facing strings: Vietnamese, natural 1:1 tone, no emoji."
      },
      { role: "user", content: buildPrompt(input) }
    ],
    temperature: 1.0
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
