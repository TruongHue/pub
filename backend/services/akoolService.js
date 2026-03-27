const axios = require("axios");

const AKOOL_BASE_URL = process.env.AKOOL_BASE_URL || "https://openapi.akool.com";
const AVATAR_ID = process.env.AKOOL_AVATAR_ID || "default-avatar";

function buildMockVideoUrl(mood = "mysterious") {
  const colorMap = {
    mysterious: "5B2CFF",
    warning: "EF4444",
    positive: "22C55E"
  };
  const color = colorMap[mood] || colorMap.mysterious;
  return `https://placehold.co/720x1280/${color}/FFFFFF?text=AKOOL+Fallback+Avatar`;
}

async function generateAvatarVideo(audioUrl, mood = "mysterious") {
  if (!audioUrl || audioUrl.startsWith("data:")) {
    return buildMockVideoUrl(mood);
  }

  const apiKey = process.env.AKOOL_KEY;
  if (!apiKey) {
    return buildMockVideoUrl(mood);
  }

  try {
    const response = await axios.post(
      `${AKOOL_BASE_URL}/api/open/v3/live-avatar/lip-sync`,
      {
        avatar_id: AVATAR_ID,
        audio_url: audioUrl
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    return (
      response.data?.data?.video_url ||
      response.data?.data?.stream_url ||
      buildMockVideoUrl(mood)
    );
  } catch (error) {
    return buildMockVideoUrl(mood);
  }
}

module.exports = { generateAvatarVideo };
