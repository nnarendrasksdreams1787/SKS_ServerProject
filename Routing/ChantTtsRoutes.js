const express = require("express");
const requireUser = require("../Middleware/requireUser");

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  generateKanhaSpeech,
} = require("../Services/elevenLabsService");

const router = express.Router();

// Protect all Chant TTS endpoints
router.use(requireUser);

// Temporary endpoint to verify authentication
// No ElevenLabs credits are consumed here.
router.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Kanha TTS route authenticated successfully",
    userId: req.user.userId,
    voiceConfigured: Boolean(process.env.ELEVENLABS_VOICE_ID),
    apiKeyConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
  });
});

const {
  checkElevenLabsConnection,
} = require("../Services/elevenLabsService");

router.get("/test-voice", async (req, res) => {
  try {
    const result = await checkElevenLabsConnection();

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("ElevenLabs connection test failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to verify ElevenLabs voice",
    });
  }
});


// Cache generated audio on the backend.
const CACHE_DIR = path.join(__dirname, "../Cache/chant-audio");

// Temporary protection against duplicate concurrent generation.
const pendingGenerations = new Map();

router.post("/speak", async (req, res) => {
  try {
    const text = req.body?.text;

    const voice = req.body?.voice ?? "kanha";

const voiceIds = {
  kanha: process.env.ELEVENLABS_VOICE_ID,
  male: process.env.ELEVENLABS_MALE_VOICE_ID,
  female: process.env.ELEVENLABS_FEMALE_VOICE_ID,
};

if (
  typeof voice !== "string" ||
  !Object.prototype.hasOwnProperty.call(voiceIds, voice)
) {
  return res.status(400).json({
    success: false,
    message: "Invalid voice selection",
  });
}

const selectedVoiceId = voiceIds[voice];

console.log("CHANT TTS VOICE DEBUG:", {
  selectedVoice: voice,
  selectedVoiceId,
  mantra: text,
});

if (!selectedVoiceId) {
  return res.status(503).json({
    success: false,
    message: "Selected voice is not configured",
  });
}

    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid mantra text is required (maximum 150 characters)",
      });
    }

    const mantra = text.trim();

    // Include model and voice in cache identity.
    const cacheKey = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          text: mantra,
          voiceId: selectedVoiceId,
          model: "eleven_multilingual_v2",
          format: "mp3_44100_128",
        })
      )
      .digest("hex");

    const filePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    await fs.mkdir(CACHE_DIR, { recursive: true });

    let audio;

    try {
      audio = await fs.readFile(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;

      // Only one generation per mantra at a time.
      if (!pendingGenerations.has(cacheKey)) {
        const generation = (async () => {
          const generated = await generateKanhaSpeech(mantra, voice);

          // Save before returning so subsequent requests use cache.
          await fs.writeFile(filePath, generated);

          return generated;
        })();

        pendingGenerations.set(cacheKey, generation);

        generation.finally(() => {
          pendingGenerations.delete(cacheKey);
        }).catch(() => {});
      }

      audio = await pendingGenerations.get(cacheKey);
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");

    return res.status(200).send(audio);
  } catch (error) {
    console.error("Kanha TTS generation failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to generate mantra audio",
    });
  }
});

module.exports = router;