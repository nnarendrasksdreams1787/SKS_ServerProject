
async function checkElevenLabsConnection() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    throw new Error("ElevenLabs API configuration missing");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
    {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();

    console.error("ElevenLabs API error:", {
      status: response.status,
      details: errorBody.slice(0, 1000),
    });

    throw new Error(`ElevenLabs API returned HTTP ${response.status}`);
  }

  const voice = await response.json();

  return {
    connected: true,
    voiceId: voice.voice_id,
    voiceName: voice.name,
  };
}

async function generateKanhaSpeech(text, voice = "kanha") {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const voiceIds = {
    kanha: process.env.ELEVENLABS_VOICE_ID,
    male: process.env.ELEVENLABS_MALE_VOICE_ID,
    female: process.env.ELEVENLABS_FEMALE_VOICE_ID,
  };

  if (!Object.prototype.hasOwnProperty.call(voiceIds, voice)) {
    throw new Error("Invalid voice selection");
  }

  const voiceId = voiceIds[voice];

  if (!apiKey || !voiceId) {
    throw new Error("ElevenLabs API configuration missing");
  }

  const mantra = String(text || "").trim();

  if (!mantra || mantra.length > 150) {
    throw new Error("Invalid mantra text");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: mantra,
        model_id: "eleven_multilingual_v2",
        output_format: "mp3_44100_128",
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();

    console.error("ElevenLabs TTS failed:", {
      status: response.status,
      details: errorBody.slice(0, 500),
    });

    throw new Error(`ElevenLabs TTS returned HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  checkElevenLabsConnection,
  generateKanhaSpeech,
};
