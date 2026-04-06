// api/tts/index.js
// TTS endpoint with S3 caching.
// Provider selection: Azure Neural TTS when AZURE_SPEECH_KEY is set, otherwise Amazon Polly.
//
// Request JSON:
//   - text (string, required)
//   - voiceId (string, optional)      // Azure voice short name (e.g. "en-US-AriaNeural") or Polly voice id
//   - voiceVariant (string, optional) // 'male' | 'female' — maps to env var defaults
//   - engine (string, optional)       // Polly only: 'neural' | 'standard'
//   - speechMarks (string, optional)  // Polly only: 'sentence' to request timing marks
//   - nocache (bool, optional)        // bypass S3 cache (dev use)
//   - debug (bool, optional)          // return extra metadata
//
// Response JSON:
//   - url (string)        // presigned S3 URL for the mp3
//   - cacheHit (boolean)
//   - provider (string)   // 'azure' | 'polly'
//
// Azure env vars:
//   AZURE_SPEECH_KEY      (required for Azure)
//   AZURE_SPEECH_REGION   (required for Azure, e.g. "eastus")
//   AZURE_VOICE_FEMALE    (default female voice, e.g. "en-US-AriaNeural")
//   AZURE_VOICE_MALE      (default male voice, e.g. "en-US-RyanNeural")

import crypto from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json, withCors, readJsonBody } from "../_lib/http.js";

function requiredEnv(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function toSafePrefix(prefix) {
  let p = String(prefix || "").trim();
  if (!p) return "tts/";
  if (!p.endsWith("/")) p += "/";
  p = p.replace(/\.+\//g, "");
  return p;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseSpeechMarksLines(buf) {
  const text = buf.toString("utf8").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const marks = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === "sentence") {
        marks.push({
          time: Number(obj.time) || 0,
          start: Number(obj.start) || 0,
          end: Number(obj.end) || 0,
          value: String(obj.value || ""),
        });
      }
    } catch (_) {}
  }
  marks.sort((a, b) => a.time - b.time);
  return marks;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Azure Neural TTS synthesis ────────────────────────────────────────────────
// Azure Cognitive Services Speech REST API.
// Uses SSML for voice selection with slight rate reduction for reading clarity.
// Returns raw audio/mpeg at 24kHz.
//
// Curated English narration voices:
//   Female: en-US-AriaNeural, en-US-JennyNeural, en-US-SaraNeural,
//           en-GB-SoniaNeural, en-AU-NatashaNeural
//   Male:   en-US-RyanNeural, en-US-GuyNeural, en-US-DavisNeural,
//           en-GB-RyanNeural, en-AU-WilliamNeural

async function azureSynthesize(text, voiceName) {
  const key    = requiredEnv("AZURE_SPEECH_KEY");
  const region = requiredEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set");

  const voice = voiceName || "en-US-AriaNeural";

  // rate="0.95" — slight reduction for reading comprehension clarity
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="0.95">${escapeXml(text)}</prosody>
  </voice>
</speak>`;

  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "ReadingTrainer/1.0",
    },
    body: ssml,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Azure TTS error ${res.status}: ${detail}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "null",
  ];
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);
    const text = String(body?.text ?? "").trim();
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;
    const nocache = body?.nocache === true || String(body?.nocache ?? "").trim() === "1";
    const speechMarks = String(body?.speechMarks ?? "").trim().toLowerCase();
    const wantSentenceMarks = speechMarks === "sentence" || speechMarks === "1" || body?.speechMarks === true;

    if (!text) return json(res, 400, { error: "Missing text" });
    if (text.length > 8000) return json(res, 400, { error: "Text too long", detail: "Max 8000 characters." });

    const awsRegion = requiredEnv("AWS_REGION") || requiredEnv("AWS_DEFAULT_REGION");
    const bucket = requiredEnv("AWS_S3_BUCKET");
    if (!awsRegion || !bucket) {
      return json(res, 500, { error: "Missing AWS S3 configuration", detail: "Set AWS_REGION and AWS_S3_BUCKET." });
    }

    // ── Provider selection ────────────────────────────────────────────────────
    const useAzure = Boolean(requiredEnv("AZURE_SPEECH_KEY"));
    const voiceVariant = String(body?.voiceVariant ?? "").trim().toLowerCase();

    let resolvedVoiceId;
    let provider;
    let providerRequested;

    if (useAzure) {
      provider = "azure";
      providerRequested = "azure";
      const envFemale = requiredEnv("AZURE_VOICE_FEMALE") || "en-US-AriaNeural";
      const envMale   = requiredEnv("AZURE_VOICE_MALE")   || "en-US-RyanNeural";
      resolvedVoiceId = String(body?.voiceId || (voiceVariant === "male" ? envMale : envFemale)).trim();
    } else {
      provider = "polly";
      providerRequested = "polly";
      const envStandard   = requiredEnv("POLLY_ENGINE_STANDARD") || requiredEnv("POLLY_ENGINE") || "standard";
      const envPremium    = requiredEnv("POLLY_ENGINE_PREMIUM")  || requiredEnv("POLLY_ENGINE") || "neural";
      const engine        = (debug ? envPremium : envStandard) === "standard" ? "standard" : "neural";
      const envFemale     = requiredEnv("POLLY_VOICE_ID_FEMALE") || requiredEnv("POLLY_VOICE_ID");
      const envMaleStd    = requiredEnv("POLLY_VOICE_ID_MALE")   || requiredEnv("POLLY_VOICE_ID");
      const envMaleNeural = requiredEnv("POLLY_VOICE_ID_MALE_2") || envMaleStd;
      resolvedVoiceId = String(body?.voiceId || (voiceVariant === "male"
        ? (engine === "standard" ? envMaleStd : envMaleNeural)
        : envFemale
      ) || "Joanna").trim();
    }

    // ── S3 caching ────────────────────────────────────────────────────────────
    const prefix    = toSafePrefix(requiredEnv("AWS_S3_PREFIX"));
    const identity  = JSON.stringify({ provider, voiceId: resolvedVoiceId, text });
    const hash      = sha256Hex(identity);
    const objectKey = `${prefix}${hash}.mp3`;
    const marksKey  = `${prefix}${hash}.sentence.json`;

    const s3 = new S3Client({ region: awsRegion });

    let cacheHit = false;
    if (!nocache) {
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey })); cacheHit = true; }
      catch (_) { cacheHit = false; }
    }

    // ── Synthesis ─────────────────────────────────────────────────────────────
    if (!cacheHit) {
      let audioBuf;
      if (useAzure) {
        audioBuf = await azureSynthesize(text, resolvedVoiceId);
      } else {
        const engineRaw = String(body?.engine || (debug ? "neural" : "standard")).trim().toLowerCase();
        const engine = engineRaw === "standard" ? "standard" : "neural";
        const cmd = new SynthesizeSpeechCommand({
          OutputFormat: "mp3", Text: text, VoiceId: resolvedVoiceId,
          Engine: engine, TextType: "text",
        });
        const out = await (new PollyClient({ region: awsRegion })).send(cmd);
        if (!out?.AudioStream) return json(res, 502, { error: "Polly synthesis failed" });
        audioBuf = await streamToBuffer(out.AudioStream);
      }

      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: objectKey, Body: audioBuf,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }));
    }

    // ── Sentence marks (Polly only — Azure SSML word boundaries not implemented) ──
    let sentenceMarks = null;
    if (wantSentenceMarks && !useAzure) {
      let marksCacheHit = false;
      if (!nocache) {
        try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: marksKey })); marksCacheHit = true; }
        catch (_) {}
      }
      try {
        if (!marksCacheHit) {
          const polly = new PollyClient({ region: awsRegion });
          const engineRaw = String(body?.engine || (debug ? "neural" : "standard")).trim().toLowerCase();
          const engine = engineRaw === "standard" ? "standard" : "neural";
          const marksCmd = new SynthesizeSpeechCommand({
            OutputFormat: "json", Text: text, VoiceId: resolvedVoiceId,
            Engine: engine, TextType: "text", SpeechMarkTypes: ["sentence"],
          });
          const marksOut = await polly.send(marksCmd);
          if (marksOut?.AudioStream) {
            const marksBuf = await streamToBuffer(marksOut.AudioStream);
            sentenceMarks = parseSpeechMarksLines(marksBuf);
            await s3.send(new PutObjectCommand({
              Bucket: bucket, Key: marksKey,
              Body: Buffer.from(JSON.stringify(sentenceMarks), "utf8"),
              ContentType: "application/json; charset=utf-8",
              CacheControl: "public, max-age=31536000, immutable",
            }));
          } else { sentenceMarks = []; }
        } else {
          const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: marksKey }));
          const buf = got?.Body ? await streamToBuffer(got.Body) : Buffer.from("[]");
          try { sentenceMarks = JSON.parse(buf.toString("utf8")); } catch(_) { sentenceMarks = []; }
        }
      } catch(_) { sentenceMarks = null; }
    }

    // ── Response ──────────────────────────────────────────────────────────────
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 * 60 }
    );

    const payload = { url, cacheHit, provider };
    if (wantSentenceMarks && Array.isArray(sentenceMarks)) payload.sentenceMarks = sentenceMarks;
    if (debug) payload.debug = { providerRequested: providerRequested || provider, providerResolved: provider, voiceId: resolvedVoiceId, objectKey, textLength: text.length, cacheHit };
    return json(res, 200, payload);

  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
