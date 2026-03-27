const { generateHoroscope } = require("../services/gptService");
const { synthesizeWithAzure } = require("../services/ttsService");

async function runPipeline(payload) {
  const horoscope = await generateHoroscope(payload);
  const personalizedText = `${payload.name}, ${horoscope.text}`.trim();
  let audioUrl = null;
  try {
    audioUrl = await synthesizeWithAzure({
      name: payload.name,
      mood: horoscope.mood,
      hook: horoscope.hook,
      insight: horoscope.insight,
      warningOrOpportunity: horoscope.warningOrOpportunity,
      action: horoscope.action,
      luckyHint: horoscope.luckyHint,
      funnyLine: horoscope.funnyLine,
      text: personalizedText
    });
  } catch (error) {
    audioUrl = null;
  }

  return {
    // JSON key Viet (uu tien cho API moi)
    noiDung: personalizedText,
    amThanh: audioUrl,
    tamTrang: horoscope.mood,
    moDau: horoscope.hook || "",
    phanTich: horoscope.insight || "",
    canhBaoHoacCoHoi: horoscope.warningOrOpportunity || "",
    loiKhuyen: horoscope.action || "",
    dauHieuMayMan: horoscope.luckyHint || "",
    cauHaiHuoc: horoscope.funnyLine || "",
    // JSON key cu (giu tuong thich frontend hien tai)
    text: personalizedText,
    audioUrl,
    mood: horoscope.mood,
    hook: horoscope.hook || "",
    insight: horoscope.insight || "",
    warningOrOpportunity: horoscope.warningOrOpportunity || "",
    action: horoscope.action || "",
    luckyHint: horoscope.luckyHint || "",
    funnyLine: horoscope.funnyLine || ""
  };
}

async function getHoroscope(req, res) {
  try {
    const { name, birthDate, birthTime, question } = req.body;
    if (!name || !birthDate || !question) {
      return res.status(400).json({
        error: "Missing required fields: name, birthDate, question"
      });
    }

    const result = await runPipeline({ name, birthDate, birthTime, question });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate horoscope",
      details: error.message
    });
  }
}

module.exports = { getHoroscope, runPipeline };
