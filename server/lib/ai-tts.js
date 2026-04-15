// server/lib/ai-tts.js
// Cloud TTS endpoint with S3 caching.
// Provider selection and fallback policy live here, not in browser JS.
// Current provider order:
//   1) Azure Neural TTS when AZURE_SPEECH_KEY + AZURE_SPEECH_REGION are both set
//   2) Amazon Polly otherwise
//
// Request JSON:
//   - text (string, required)
//   - voiceId (string, optional)      // Azure voice short name (e.g. "en-US-AriaNeural") or Polly voice id
//   - voiceVariant (string, optional) // 'male' | 'female' — maps to server defaults
//   - speechMarks (string, optional)  // sentence timing request; fulfilled only when provider supports it
//   - nocache (bool, optional)        // bypass S3 cache (dev use)
//   - debug (bool, optional)          // return extra metadata
//
// Response JSON:
//   - url (string)        // presigned S3 URL for the mp3
//   - cacheHit (boolean)
//   - provider (string)   // 'azure' | 'polly'
//   - sentenceMarks?      // present only when the active provider returned them

import crypto from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json, withCors, readJsonBody } from "./http.js";
import { getAllowedBrowserOrigins } from "./origins.js";
import speechsdk from "microsoft-cognitiveservices-speech-sdk";

function requiredEnv(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function hasAzureCloudTts() {
  return !!(requiredEnv("AZURE_SPEECH_KEY") && requiredEnv("AZURE_SPEECH_REGION"));
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitIntoSentenceRanges(text) {
  const sentenceRegex = /[^.!?]*[.!?]+["']?\s*/g;
  const ranges = [];
  let match;
  while ((match = sentenceRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  if (!ranges.length) ranges.push({ start: 0, end: text.length });
  return ranges;
}

function jsIndexToUtf8ByteOffset(str, jsIndex) {
  return Buffer.byteLength(String(str || "").slice(0, Math.max(0, Number(jsIndex) || 0)), "utf8");
}

function bookmarkAudioOffsetMs(audioOffsetTicks) {
  return Math.max(0, Number((Number(audioOffsetTicks || 0) + 5000) / 10000) || 0);
}

function buildAzureSentencePlan(text) {
  const source = String(text || "");
  return splitIntoSentenceRanges(source).map((range, index) => ({
    index,
    value: source.slice(range.start, range.end),
    startJs: range.start,
    endJs: range.end,
    startByte: jsIndexToUtf8ByteOffset(source, range.start),
    endByte: jsIndexToUtf8ByteOffset(source, range.end),
    bookmark: `s${index}`,
  })).filter((entry) => entry.endJs > entry.startJs);
}

function buildAzureSsml(text, voiceName, sentencePlan) {
  const source = String(text || "");
  const body = Array.isArray(sentencePlan) && sentencePlan.length
    ? sentencePlan.map((entry) => `<bookmark mark="${entry.bookmark}"/>${escapeXml(entry.value)}`).join("")
    : escapeXml(source);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voiceName}"><prosody rate="0.95">${body}</prosody></voice></speak>`;
}

function resolveAzureVoiceId(voiceVariant, explicitVoiceId) {
  if (explicitVoiceId) return String(explicitVoiceId).trim();
  const envFemale = requiredEnv("AZURE_VOICE_FEMALE") || "en-US-AriaNeural";
  const envMale = requiredEnv("AZURE_VOICE_MALE") || "en-US-RyanNeural";
  return String(voiceVariant === "male" ? envMale : envFemale).trim();
}

function resolvePollyDefaults(debug) {
  const envStandard = requiredEnv("POLLY_ENGINE_STANDARD") || requiredEnv("POLLY_ENGINE") || "standard";
  const envPremium = requiredEnv("POLLY_ENGINE_PREMIUM") || requiredEnv("POLLY_ENGINE") || "neural";
  const engine = (debug ? envPremium : envStandard) === "standard" ? "standard" : "neural";
  const envFemale = requiredEnv("POLLY_VOICE_ID_FEMALE") || requiredEnv("POLLY_VOICE_ID") || "Joanna";
  const envMaleStd = requiredEnv("POLLY_VOICE_ID_MALE") || requiredEnv("POLLY_VOICE_ID") || "Matthew";
  const envMaleNeural = requiredEnv("POLLY_VOICE_ID_MALE_2") || envMaleStd;
  return { engine, envFemale, envMaleStd, envMaleNeural };
}

function resolveCloudPolicy(body, debug) {
  const voiceVariant = String(body?.voiceVariant ?? "").trim().toLowerCase();
  const explicitVoiceId = String(body?.voiceId ?? "").trim();

  if (hasAzureCloudTts()) {
    return {
      provider: "azure",
      voiceId: resolveAzureVoiceId(voiceVariant, explicitVoiceId),
      sentenceMarksMode: "provider-sentence-marks-sidecar",
    };
  }

  const pollyDefaults = resolvePollyDefaults(debug);
  const voiceId = explicitVoiceId || (voiceVariant === "male"
    ? (pollyDefaults.engine === "standard" ? pollyDefaults.envMaleStd : pollyDefaults.envMaleNeural)
    : pollyDefaults.envFemale);

  return {
    provider: "polly",
    voiceId: String(voiceId || "Joanna").trim(),
    engine: pollyDefaults.engine,
    sentenceMarksMode: "provider-sentence-marks",
  };
}

// ── Azure Neural TTS synthesis ────────────────────────────────────────────────
// Azure Speech SDK synthesis with bookmark-driven sentence marks.
// Audio and marks are cached as paired S3 artifacts so cache-hit sessions keep
// precise sentence timing instead of falling back to client-estimated marks.
async function azureSynthesizeArtifact(text, voiceName) {
  const key = requiredEnv("AZURE_SPEECH_KEY");
  const region = requiredEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set");

  const voice = voiceName || "en-US-AriaNeural";
  const sentencePlan = buildAzureSentencePlan(text);
  const ssml = buildAzureSsml(text, voice, sentencePlan);
  const speechConfig = speechsdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisOutputFormat = speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3;

  const bookmarkOffsets = new Map();
  let synthesizer = null;
  try {
    synthesizer = new speechsdk.SpeechSynthesizer(speechConfig, null);
    synthesizer.bookmarkReached = (_sender, event) => {
      const mark = String(event?.text || "");
      if (mark) bookmarkOffsets.set(mark, bookmarkAudioOffsetMs(event?.audioOffset));
    };

    const result = await new Promise((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        (synthesisResult) => resolve(synthesisResult),
        (error) => reject(new Error(String(error || "Azure synthesis failed")))
      );
    });

    if (result.reason !== speechsdk.ResultReason.SynthesizingAudioCompleted) {
      const detail = result.errorDetails || result.properties?.getProperty?.(speechsdk.PropertyId.SpeechServiceResponse_JsonResult) || "Azure synthesis failed";
      throw new Error(String(detail));
    }

    const audioBuf = Buffer.from(result.audioData || []);
    const sentenceMarks = sentencePlan.map((entry) => ({
      time: bookmarkOffsets.has(entry.bookmark) ? bookmarkOffsets.get(entry.bookmark) : 0,
      start: entry.startByte,
      end: entry.endByte,
      value: entry.value,
    }));

    if (sentencePlan.length && !sentencePlan.every((entry) => bookmarkOffsets.has(entry.bookmark))) {
      throw new Error("Azure synthesis returned incomplete bookmark offsets");
    }

    return { audioBuf, sentenceMarks };
  } finally {
    try { synthesizer?.close(); } catch (_) {}
  }
}

async function synthesizeCloudAudio({ awsRegion, text, policy }) {
  const cmd = new SynthesizeSpeechCommand({
    OutputFormat: "mp3",
    Text: text,
    VoiceId: policy.voiceId,
    Engine: policy.engine,
    TextType: "text",
  });
  const out = await new PollyClient({ region: awsRegion }).send(cmd);
  if (!out?.AudioStream) throw new Error("Polly synthesis failed");
  return streamToBuffer(out.AudioStream);
}

async function resolveSentenceMarks({ awsRegion, bucket, cacheHit, nocache, marksKey, policy, s3, text }) {
  if (policy.provider === "azure") {
    try {
      const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: marksKey }));
      const buf = got?.Body ? await streamToBuffer(got.Body) : Buffer.from("[]");
      const parsed = JSON.parse(buf.toString("utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return null;
    }
  }

  if (policy.provider !== "polly") return null;

  let marksCacheHit = false;
  if (!nocache) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: marksKey }));
      marksCacheHit = true;
    } catch (_) {}
  }

  try {
    if (!marksCacheHit) {
      const marksCmd = new SynthesizeSpeechCommand({
        OutputFormat: "json",
        Text: text,
        VoiceId: policy.voiceId,
        Engine: policy.engine,
        TextType: "text",
        SpeechMarkTypes: ["sentence"],
      });
      const marksOut = await new PollyClient({ region: awsRegion }).send(marksCmd);
      if (!marksOut?.AudioStream) return [];
      const marksBuf = await streamToBuffer(marksOut.AudioStream);
      const sentenceMarks = parseSpeechMarksLines(marksBuf);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: marksKey,
        Body: Buffer.from(JSON.stringify(sentenceMarks), "utf8"),
        ContentType: "application/json; charset=utf-8",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      return sentenceMarks;
    }

    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: marksKey }));
    const buf = got?.Body ? await streamToBuffer(got.Body) : Buffer.from("[]");
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch (_) {
      return [];
    }
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  const allowed = [...getAllowedBrowserOrigins(), "null"];
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

    const policy = resolveCloudPolicy(body, debug);

    const prefix = toSafePrefix(requiredEnv("AWS_S3_PREFIX"));
    const artifactVersion = "v2-s3-sidecar-sentence-marks";
    const identity = JSON.stringify({ artifactVersion, provider: policy.provider, voiceId: policy.voiceId, text });
    const hash = sha256Hex(identity);
    const objectKey = `${prefix}${hash}.mp3`;
    const marksKey = `${prefix}${hash}.sentence.json`;

    const s3 = new S3Client({ region: awsRegion });

    let cacheHit = false;
    if (!nocache) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        cacheHit = true;
      } catch (_) {
        cacheHit = false;
      }
    }

    const shouldMaintainTimedMarks = policy.provider === "azure" || wantSentenceMarks;
    let marksCacheHit = false;
    if (shouldMaintainTimedMarks && !nocache) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: marksKey }));
        marksCacheHit = true;
      } catch (_) {
        marksCacheHit = false;
      }
    }

    if (policy.provider === "azure") {
      if (!cacheHit || !marksCacheHit) {
        const artifact = await azureSynthesizeArtifact(text, policy.voiceId);
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: artifact.audioBuf,
          ContentType: "audio/mpeg",
          CacheControl: "public, max-age=31536000, immutable",
        }));
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: marksKey,
          Body: Buffer.from(JSON.stringify(artifact.sentenceMarks), "utf8"),
          ContentType: "application/json; charset=utf-8",
          CacheControl: "public, max-age=31536000, immutable",
        }));
        cacheHit = false;
        marksCacheHit = true;
      }
    } else if (!cacheHit) {
      const audioBuf = await synthesizeCloudAudio({ awsRegion, text, policy });
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: audioBuf,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }));
    }

    let sentenceMarks = null;
    if (wantSentenceMarks) {
      sentenceMarks = await resolveSentenceMarks({
        awsRegion,
        bucket,
        cacheHit,
        nocache,
        marksKey,
        policy,
        s3,
        text,
      });
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 * 60 }
    );

    const payload = { url, cacheHit, provider: policy.provider };
    if (wantSentenceMarks && Array.isArray(sentenceMarks)) payload.sentenceMarks = sentenceMarks;
    if (debug) {
      payload.debug = {
        providerResolved: policy.provider,
        voiceId: policy.voiceId,
        objectKey,
        textLength: text.length,
        cacheHit,
        sentenceMarksMode: policy.sentenceMarksMode,
        artifactVersion,
      };
    }
    return json(res, 200, payload);
  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
