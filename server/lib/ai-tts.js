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
//   - cacheHit (boolean)  // legacy audio-cache convenience; prefer capability.cache.audio.status
//   - provider (string)   // 'azure' | 'polly'
//   - sentenceMarks?      // present only when requested and included in this response
//   - capability (object) // backend-owned precise-seek and cache truth for this artifact

import crypto from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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

const TTS_ARTIFACT_VERSION = "v3-s3-sidecar-sentence-marks-trailing-ranges";
const TTS_SENTENCE_SPLITTER_VERSION = "sentence-splitter-preserve-trailing-text-v1";
const TTS_BOOKMARK_MARKS_TIMING_SOURCE = "azure-bookmark-reached";
const TTS_WB_MARKS_TIMING_SOURCE = "azure-word-boundary";
const TTS_BOOKMARK_MARKS_KEY_SUFFIX = ".sentence.json";
// Separate S3 key suffix for wordBoundary-derived marks so bookmarkReached and
// wordBoundary sidecars can never be confused or silently substituted.
const TTS_WB_MARKS_KEY_SUFFIX = ".sentence-wb.json";

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
  const source = String(text || "");
  const sentenceRegex = /[^.!?]*[.!?]+["']?\s*/g;
  const ranges = [];
  let match;
  let lastEnd = 0;
  while ((match = sentenceRegex.exec(source)) !== null) {
    const end = match.index + match[0].length;
    ranges.push({ start: match.index, end });
    lastEnd = end;
  }
  // Preserve trailing visible text even when the page ends without terminal
  // punctuation. Form rows and labels may be final readable content.
  if (lastEnd < source.length) ranges.push({ start: lastEnd, end: source.length });
  if (!ranges.length) ranges.push({ start: 0, end: source.length });
  return ranges.filter((range) => range.end > range.start);
}

function jsIndexToUtf8ByteOffset(str, jsIndex) {
  return Buffer.byteLength(String(str || "").slice(0, Math.max(0, Number(jsIndex) || 0)), "utf8");
}

function bookmarkAudioOffsetMs(audioOffsetTicks) {
  return Math.max(0, Number((Number(audioOffsetTicks || 0) + 5000) / 10000) || 0);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function hasCompleteAzureBookmarkOffsets(sentencePlan, bookmarkOffsets) {
  return !sentencePlan.length || sentencePlan.every((entry) => bookmarkOffsets.has(entry.bookmark));
}

function extractAzureSsmlBookmarkIds(ssml) {
  const ids = [];
  const re = /<bookmark\s+mark=["']([^"']+)["']\s*\/>/g;
  let match;
  while ((match = re.exec(String(ssml || ""))) !== null) ids.push(String(match[1] || ""));
  return ids.filter(Boolean);
}

function firstOrNull(values) {
  return Array.isArray(values) && values.length ? values[0] : null;
}

function lastOrNull(values) {
  return Array.isArray(values) && values.length ? values[values.length - 1] : null;
}

async function waitForAzureBookmarkOffsets(sentencePlan, bookmarkOffsets) {
  if (hasCompleteAzureBookmarkOffsets(sentencePlan, bookmarkOffsets)) return;

  // Azure bookmarkReached callbacks can land just after speakSsmlAsync resolves.
  // Yield briefly before deciding the artifact has incomplete timing data.
  const deadline = Date.now() + 250;
  while (!hasCompleteAzureBookmarkOffsets(sentencePlan, bookmarkOffsets) && Date.now() < deadline) {
    await delay(25);
  }
}

function previewDiagnosticText(value, maxLength = 160) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function buildAzureServerDiagnostics({
  text,
  sentencePlan,
  ssml,
  bookmarkOffsets,
  voiceName,
  meta,
  sentenceMarks = null,
  validationReason = "not-evaluated",
  // wordBoundary fallback diagnostics — all optional
  wordBoundaryRawCount = null,
  wordBoundaryDedupedCount = null,
  wordBoundaryBoundaryTypeDistribution = null,
  wordBoundaryMappedMarkCount = null,
  wordBoundaryFinalBlockCovered = null,
  wordBoundaryAllBlocksCovered = null,
  selectedTimingSource = null,
  timingSourceRejectionReason = null,
}) {
  const source = String(text || "");
  const plan = Array.isArray(sentencePlan) ? sentencePlan : buildAzureSentencePlan(source);
  const ssmlBookmarkIds = extractAzureSsmlBookmarkIds(ssml);
  const hasAzureBookmarkObservation = bookmarkOffsets instanceof Map;
  const reachedIds = hasAzureBookmarkObservation ? Array.from(bookmarkOffsets.keys()) : [];
  const reachedSet = new Set(reachedIds);
  const ssmlSet = new Set(ssmlBookmarkIds);
  const missingFromSsml = plan.filter((entry) => !ssmlSet.has(entry.bookmark));
  const missingFromReached = hasAzureBookmarkObservation
    ? plan.filter((entry) => !reachedSet.has(entry.bookmark))
    : [];
  const firstMissing = firstOrNull(missingFromReached) || firstOrNull(missingFromSsml);
  const returnedMarksCount = Array.isArray(sentenceMarks) ? sentenceMarks.length : reachedIds.length;
  const expectedCount = plan.length;
  const validationPassed = Array.isArray(sentenceMarks) && isValidAzureSentenceMarks(source, sentenceMarks);
  const backendTextHash = sha256Hex(source);
  const sidecarAvailable = !!meta?.sidecarAvailable;
  const bookmarkReachedSource = hasAzureBookmarkObservation
    ? "azure-synthesis"
    : (meta?.bookmarkReachedSource || "not-invoked");
  const serverMarksValidationReason = validationPassed ? "complete" : validationReason;

  return {
    diagnosticVersion: "azure-full-page-promotion-server-diagnostics-v2",
    backendTextHash,
    backendTextPreview: previewDiagnosticText(source),
    requestVoiceId: voiceName || meta?.requestVoiceId || null,
    requestVoiceVariant: meta?.requestVoiceVariant || null,
    requestSpeechMarks: meta?.requestSpeechMarks ?? null,
    requestMode: meta?.requestMode || null,
    provider: meta?.provider || "azure",
    artifactHash: meta?.artifactHash || null,
    artifactVersion: meta?.artifactVersion || TTS_ARTIFACT_VERSION,
    sentenceSplitterVersion: meta?.sentenceSplitterVersion || TTS_SENTENCE_SPLITTER_VERSION,

    sentencePlanLength: plan.length,
    firstPlannedSentenceExcerpt: plan[0] ? previewDiagnosticText(plan[0].value) : null,
    lastPlannedSentenceExcerpt: plan.length ? previewDiagnosticText(plan[plan.length - 1].value) : null,
    firstPlannedStartByte: plan[0]?.startByte ?? null,
    firstPlannedEndByte: plan[0]?.endByte ?? null,
    lastPlannedStartByte: plan.length ? plan[plan.length - 1].startByte : null,
    lastPlannedEndByte: plan.length ? plan[plan.length - 1].endByte : null,
    firstMissingPlannedStartByte: firstMissing?.startByte ?? null,
    firstMissingPlannedEndByte: firstMissing?.endByte ?? null,
    firstMissingPlannedExcerpt: firstMissing ? previewDiagnosticText(firstMissing.value) : null,

    plannedBookmarkCount: plan.length,
    ssmlBookmarkCount: ssmlBookmarkIds.length,
    firstBookmarkId: firstOrNull(ssmlBookmarkIds),
    lastBookmarkId: lastOrNull(ssmlBookmarkIds),
    missingSsmlBookmarkIds: missingFromSsml.slice(0, 24).map((entry) => entry.bookmark),
    missingBookmarkIds: missingFromReached.slice(0, 24).map((entry) => entry.bookmark),

    bookmarkReachedSource,
    bookmarkReachedObserved: hasAzureBookmarkObservation,
    bookmarkReachedCount: hasAzureBookmarkObservation ? reachedIds.length : null,
    firstBookmarkReachedId: hasAzureBookmarkObservation ? firstOrNull(reachedIds) : null,
    lastBookmarkReachedId: hasAzureBookmarkObservation ? lastOrNull(reachedIds) : null,
    missingBookmarkCount: hasAzureBookmarkObservation ? missingFromReached.length : null,

    audioCacheStatus: meta?.audioCacheStatus || null,
    marksCacheStatus: meta?.marksCacheStatus || null,
    audioArtifactHash: meta?.audioArtifactHash || null,
    marksArtifactHash: meta?.marksArtifactHash || null,
    sidecarIdentitySource: sidecarAvailable ? "expected-from-current-cache-key" : "none",
    sidecarMetadataRead: false,
    expectedSidecarTextHash: sidecarAvailable ? backendTextHash : null,
    expectedSidecarSplitterVersion: sidecarAvailable ? (meta?.sentenceSplitterVersion || TTS_SENTENCE_SPLITTER_VERSION) : null,
    expectedSidecarArtifactVersion: sidecarAvailable ? (meta?.artifactVersion || TTS_ARTIFACT_VERSION) : null,

    serverReturnedMarksCount: returnedMarksCount,
    serverExpectedSentencePlanLength: expectedCount,
    serverMarksValidationPassed: !!validationPassed,
    serverMarksValidationReason,

    // wordBoundary fallback diagnostics
    wordBoundaryRawCount,
    wordBoundaryDedupedCount,
    wordBoundaryBoundaryTypeDistribution,
    wordBoundaryMappedMarkCount,
    wordBoundaryFinalBlockCovered,
    wordBoundaryAllBlocksCovered,
    selectedTimingSource,
    timingSourceRejectionReason,
  };
}

function makeAzureBookmarkError(diagnostics) {
  const err = new Error("Azure synthesis returned incomplete bookmark offsets");
  err.ttsDiagnostics = diagnostics;
  return err;
}

function logAzureServerDiagnostics(label, diagnostics) {
  try {
    console.warn(label, JSON.stringify(diagnostics));
  } catch (_) {}
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

const AZURE_LEADING_DECORATIVE_MARKER_RUN_RE = /^(\s*[\*#_~`|\\\/@\^=+<>\[\]\{\}•·○●◦▪▫■□]+\s+)/u;
const AZURE_ALPHANUMERIC_RE = /[\p{L}\p{N}]/u;

function splitAzureLeadingDecorativeMarker(value) {
  const source = String(value || "");
  const match = source.match(AZURE_LEADING_DECORATIVE_MARKER_RUN_RE);
  if (!match) return { prefix: "", body: source };

  const prefix = match[1];
  const body = source.slice(prefix.length);
  if (!AZURE_ALPHANUMERIC_RE.test(body)) return { prefix: "", body: source };
  return { prefix, body };
}

function buildAzureSsmlSentence(entry) {
  const { prefix, body } = splitAzureLeadingDecorativeMarker(entry?.value);
  return `${escapeXml(prefix)}<bookmark mark="${entry.bookmark}"/>${escapeXml(body)}`;
}

function buildAzureSsml(text, voiceName, sentencePlan) {
  const source = String(text || "");
  const body = Array.isArray(sentencePlan) && sentencePlan.length
    ? sentencePlan.map((entry) => buildAzureSsmlSentence(entry)).join("")
    : escapeXml(source);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voiceName}"><prosody rate="0.95">${body}</prosody></voice></speak>`;
}

// Compute the SSML character span for each sentencePlan entry using the exact
// same construction path as buildAzureSsml / buildAzureSsmlSentence. The span
// covers the full fragment emitted for that entry (bookmark tag + escaped body).
// Used to map wordBoundary textOffset values to their planned sentence block.
function buildAzureSsmlSentenceSpans(sentencePlan, voiceName) {
  const header = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voiceName}"><prosody rate="0.95">`;
  const spans = [];
  let offset = header.length;
  for (const entry of sentencePlan) {
    const fragment = buildAzureSsmlSentence(entry);
    spans.push({
      planIndex: entry.index,
      bookmark: entry.bookmark,
      ssmlStart: offset,
      ssmlEnd: offset + fragment.length,
    });
    offset += fragment.length;
  }
  return spans;
}

// Map collected wordBoundary events to the sentencePlan using SSML-span ranges.
// For each planned block, the earliest event whose textOffset falls inside that
// block's SSML span becomes the block's provider timing mark.
// Returns a sentenceMarks array in the same shape as bookmarkReached marks,
// or null if any planned block has no provider event or times are not monotonic.
function mapWordBoundaryToSentencePlan(sentencePlan, rawEvents, ssmlSpans) {
  if (!rawEvents.length || !sentencePlan.length || !ssmlSpans.length) return null;
  if (ssmlSpans.length !== sentencePlan.length) return null;

  // Dedupe on the event identity tuple that matters for timing.
  const seen = new Set();
  const events = [];
  for (const ev of rawEvents) {
    const k = `${ev.audioOffset}:${ev.textOffset}:${ev.wordLength}:${ev.boundaryType}`;
    if (!seen.has(k)) { seen.add(k); events.push(ev); }
  }
  events.sort((a, b) => a.audioOffset - b.audioOffset);

  const marks = [];
  let prevTime = -1;
  for (let i = 0; i < sentencePlan.length; i++) {
    const entry = sentencePlan[i];
    const span = ssmlSpans[i];
    // Find the earliest wordBoundary event whose textOffset falls within this
    // block's SSML span. This is the exact span emitted by buildAzureSsmlSentence
    // for this entry — no loose search, no cross-block ambiguity.
    let earliest = null;
    for (const ev of events) {
      if (ev.textOffset >= span.ssmlStart && ev.textOffset < span.ssmlEnd) {
        if (!earliest || ev.audioOffset < earliest.audioOffset) earliest = ev;
      }
    }
    if (!earliest) return null; // no provider event for this block → reject
    const timeMs = earliest.audioOffsetMs;
    if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs < prevTime) return null;
    prevTime = timeMs;
    marks.push({
      time: timeMs,
      start: entry.startByte,
      end: entry.endByte,
      value: entry.value,
    });
  }
  return marks.length === sentencePlan.length ? marks : null;
}

function isIncompleteAzureBookmarkError(err) {
  return String(err?.message || err || "").includes("Azure synthesis returned incomplete bookmark offsets");
}

function isValidAzureSentenceMarks(text, sentenceMarks) {
  if (!Array.isArray(sentenceMarks)) return false;

  const sentencePlan = buildAzureSentencePlan(text);
  if (sentenceMarks.length !== sentencePlan.length) return false;

  let previousTime = -1;
  return sentencePlan.every((entry, index) => {
    const mark = sentenceMarks[index];
    const time = Number(mark?.time);
    const start = Number(mark?.start);
    const end = Number(mark?.end);
    const valid = Number.isFinite(time)
      && time >= 0
      && time >= previousTime
      && start === entry.startByte
      && end === entry.endByte
      && String(mark?.value || "") === entry.value;
    if (valid) previousTime = time;
    return valid;
  });
}

async function deleteS3ObjectQuietly(s3, bucket, key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (_) {}
}

async function readJsonS3Object(s3, bucket, key, fallback = null) {
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buf = got?.Body ? await streamToBuffer(got.Body) : Buffer.from(JSON.stringify(fallback));
    return JSON.parse(buf.toString("utf8"));
  } catch (_) {
    return fallback;
  }
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

function buildCapabilityReason({ preciseSeekCapable, policy, wantSentenceMarks, marksAvailable }) {
  if (preciseSeekCapable) return "timed-marks-sidecar-available";
  if (policy?.provider === "azure") return "timed-marks-sidecar-unavailable";
  if (wantSentenceMarks) return marksAvailable ? "timed-marks-sidecar-available" : "timed-marks-requested-but-unavailable";
  return "timed-marks-not-requested";
}

function buildCapabilityPayload({
  artifactVersion,
  sentenceSplitterVersion,
  hash,
  policy,
  wantSentenceMarks,
  sentenceMarks,
  preciseSeekCapable,
  audioCacheStatus,
  marksCacheStatus,
  marksProvenance,
  marksTimingSource = null,
}) {
  const marksIncludedInResponse = Array.isArray(sentenceMarks);
  // Include provider-level timing labels only when coverage is complete.
  // These are informational for tracing; runtime does not key off them.
  const providerPreciseMarks = preciseSeekCapable && marksTimingSource !== null ? true : undefined;
  const marksPrecision = preciseSeekCapable && marksTimingSource !== null ? "provider-timed" : undefined;
  return {
    provider: policy?.provider || null,
    preciseSeek: {
      available: !!preciseSeekCapable,
      reason: buildCapabilityReason({ preciseSeekCapable, policy, wantSentenceMarks, marksAvailable: marksIncludedInResponse }),
      provenance: preciseSeekCapable ? marksProvenance : "none",
      includedInResponse: marksIncludedInResponse,
    },
    marks: {
      requested: !!wantSentenceMarks,
      includedInResponse: marksIncludedInResponse,
      provenance: marksIncludedInResponse || preciseSeekCapable ? marksProvenance : "none",
      cacheStatus: marksCacheStatus,
      ...(marksTimingSource !== null ? { timingSource: marksTimingSource } : {}),
      ...(marksPrecision !== undefined ? { precision: marksPrecision } : {}),
      ...(providerPreciseMarks !== undefined ? { providerPreciseMarks } : {}),
    },
    cache: {
      audio: { status: audioCacheStatus },
      marks: { status: marksCacheStatus },
    },
    artifact: {
      version: artifactVersion,
      sentenceSplitterVersion,
      hash,
    },
  };
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
//
// Mark source priority:
//   1. bookmarkReached — if all planned bookmarks arrive, use those marks.
//   2. wordBoundary    — if bookmarkReached is incomplete, attempt SSML-span
//                        mapping of wordBoundary events as provider timing.
//   3. Reject Phase 2  — if neither source yields complete, monotonic coverage.
async function azureSynthesizeArtifact(text, voiceName, meta = {}) {
  const key = requiredEnv("AZURE_SPEECH_KEY");
  const region = requiredEnv("AZURE_SPEECH_REGION");
  if (!key || !region) throw new Error("AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set");

  const voice = voiceName || "en-US-AriaNeural";
  const sentencePlan = buildAzureSentencePlan(text);
  const ssml = buildAzureSsml(text, voice, sentencePlan);
  const speechConfig = speechsdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisOutputFormat = speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3;

  const bookmarkOffsets = new Map();
  const wordBoundaryRaw = []; // all captured events, deduped later in mapper
  let synthesizer = null;
  try {
    synthesizer = new speechsdk.SpeechSynthesizer(speechConfig, null);

    // Primary: bookmarkReached (existing behavior, unchanged)
    synthesizer.bookmarkReached = (_sender, event) => {
      const mark = String(event?.text || "");
      if (mark) bookmarkOffsets.set(mark, bookmarkAudioOffsetMs(event?.audioOffset));
    };

    // Fallback: wordBoundary — capture all events before synthesis completes.
    // Subscribed before speakSsmlAsync so no events are missed.
    synthesizer.wordBoundary = (_sender, event) => {
      wordBoundaryRaw.push({
        audioOffset: Number(event?.audioOffset ?? 0),
        // Pre-convert to ms using the same formula as bookmarkAudioOffsetMs so
        // the mapper never recomputes from raw ticks.
        audioOffsetMs: bookmarkAudioOffsetMs(event?.audioOffset),
        duration: Number(event?.duration ?? 0),
        text: String(event?.text ?? ""),
        textOffset: Number(event?.textOffset ?? 0),
        wordLength: Number(event?.wordLength ?? 0),
        boundaryType: String(event?.boundaryType ?? ""),
      });
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
    await waitForAzureBookmarkOffsets(sentencePlan, bookmarkOffsets);

    // ── Priority 1: bookmarkReached ─────────────────────────────────────────
    if (hasCompleteAzureBookmarkOffsets(sentencePlan, bookmarkOffsets)) {
      const sentenceMarks = sentencePlan.map((entry) => ({
        time: bookmarkOffsets.get(entry.bookmark),
        start: entry.startByte,
        end: entry.endByte,
        value: entry.value,
      }));
      const diagnostics = buildAzureServerDiagnostics({
        text,
        sentencePlan,
        ssml,
        bookmarkOffsets,
        voiceName: voice,
        meta,
        sentenceMarks,
        validationReason: "complete",
        wordBoundaryRawCount: wordBoundaryRaw.length,
        selectedTimingSource: TTS_BOOKMARK_MARKS_TIMING_SOURCE,
      });
      return { audioBuf, sentenceMarks, diagnostics, timingSource: TTS_BOOKMARK_MARKS_TIMING_SOURCE };
    }

    // ── Priority 2: wordBoundary fallback ───────────────────────────────────
    // bookmarkReached is incomplete. Attempt to map wordBoundary events using
    // SSML spans built from the exact same construction path as synthesis.
    // This ensures textOffset alignment is unambiguous — each event is assigned
    // to the entry whose emitted SSML fragment contains that textOffset.
    const ssmlSpans = buildAzureSsmlSentenceSpans(sentencePlan, voice);

    // Collect wordBoundary diagnostic data before attempting the mapping.
    const wbDedupSeen = new Set();
    const wbDeduped = [];
    const wbTypeCounts = {};
    for (const ev of wordBoundaryRaw) {
      const k = `${ev.audioOffset}:${ev.textOffset}:${ev.wordLength}:${ev.boundaryType}`;
      if (!wbDedupSeen.has(k)) {
        wbDedupSeen.add(k);
        wbDeduped.push(ev);
      }
      wbTypeCounts[ev.boundaryType] = (wbTypeCounts[ev.boundaryType] || 0) + 1;
    }

    // Check per-block coverage for diagnostics before the strict mapping pass.
    const wbBlockCoverage = sentencePlan.map((entry, i) => {
      const span = ssmlSpans[i];
      return span ? wbDeduped.some((ev) => ev.textOffset >= span.ssmlStart && ev.textOffset < span.ssmlEnd) : false;
    });
    const wbAllBlocksCovered = wbBlockCoverage.every(Boolean);
    const wbFinalBlockCovered = wbBlockCoverage.length ? wbBlockCoverage[wbBlockCoverage.length - 1] : false;

    const wbMarks = mapWordBoundaryToSentencePlan(sentencePlan, wordBoundaryRaw, ssmlSpans);
    const wbComplete = wbMarks !== null;

    if (wbComplete) {
      const diagnostics = buildAzureServerDiagnostics({
        text,
        sentencePlan,
        ssml,
        bookmarkOffsets,
        voiceName: voice,
        meta,
        sentenceMarks: wbMarks,
        validationReason: "complete",
        wordBoundaryRawCount: wordBoundaryRaw.length,
        wordBoundaryDedupedCount: wbDeduped.length,
        wordBoundaryBoundaryTypeDistribution: wbTypeCounts,
        wordBoundaryMappedMarkCount: wbMarks.length,
        wordBoundaryFinalBlockCovered: wbFinalBlockCovered,
        wordBoundaryAllBlocksCovered: wbAllBlocksCovered,
        selectedTimingSource: TTS_WB_MARKS_TIMING_SOURCE,
      });
      return { audioBuf, sentenceMarks: wbMarks, diagnostics, timingSource: TTS_WB_MARKS_TIMING_SOURCE };
    }

    // ── Priority 3: reject ─────────────────────────────────────────────────
    // Neither provider source yielded complete, monotonic coverage.
    const rejectReason = wbAllBlocksCovered
      ? "word-boundary-non-monotonic-or-invalid"
      : `word-boundary-missing-blocks:${wbBlockCoverage.map((v, i) => (!v ? `s${i}` : "")).filter(Boolean).slice(0, 8).join(",")}`;

    const diagnostics = buildAzureServerDiagnostics({
      text,
      sentencePlan,
      ssml,
      bookmarkOffsets,
      voiceName: voice,
      meta,
      validationReason: "azure-incomplete-provider-marks",
      wordBoundaryRawCount: wordBoundaryRaw.length,
      wordBoundaryDedupedCount: wbDeduped.length,
      wordBoundaryBoundaryTypeDistribution: wbTypeCounts,
      wordBoundaryMappedMarkCount: null,
      wordBoundaryFinalBlockCovered: wbFinalBlockCovered,
      wordBoundaryAllBlocksCovered: wbAllBlocksCovered,
      selectedTimingSource: null,
      timingSourceRejectionReason: rejectReason,
    });
    logAzureServerDiagnostics("[ai-tts] incomplete Azure provider marks (bookmark+wordBoundary)", diagnostics);
    // Do not cache partial provider data as precise S3 sidecar truth.
    throw makeAzureBookmarkError(diagnostics);
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
    const parsed = await readJsonS3Object(s3, bucket, marksKey, null);
    return isValidAzureSentenceMarks(text, parsed) ? parsed : null;
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
    const requestMode = ["block-window", "full-page"].includes(String(body?.requestMode ?? "").trim())
      ? String(body.requestMode).trim()
      : "full-page";

    if (!text) return json(res, 400, { error: "Missing text" });
    if (text.length > 8000) return json(res, 400, { error: "Text too long", detail: "Max 8000 characters." });

    const awsRegion = requiredEnv("AWS_REGION") || requiredEnv("AWS_DEFAULT_REGION");
    const bucket = requiredEnv("AWS_S3_BUCKET");
    if (!awsRegion || !bucket) {
      return json(res, 500, { error: "Missing AWS S3 configuration", detail: "Set AWS_REGION and AWS_S3_BUCKET." });
    }

    const policy = resolveCloudPolicy(body, debug);

    const prefix = toSafePrefix(requiredEnv("AWS_S3_PREFIX"));
    const artifactVersion = TTS_ARTIFACT_VERSION;
    const sentenceSplitterVersion = TTS_SENTENCE_SPLITTER_VERSION;
    const identity = JSON.stringify({ artifactVersion, sentenceSplitterVersion, provider: policy.provider, voiceId: policy.voiceId, text });
    const hash = sha256Hex(identity);
    const objectKey = `${prefix}${hash}.mp3`;
    const bookmarkMarksKey = `${prefix}${hash}${TTS_BOOKMARK_MARKS_KEY_SUFFIX}`;
    const wordBoundaryMarksKey = `${prefix}${hash}${TTS_WB_MARKS_KEY_SUFFIX}`;
    let marksKey = bookmarkMarksKey;
    let marksTimingSource = null;

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
    const audioCacheHitInitial = cacheHit;

    const shouldMaintainTimedMarks = policy.provider === "azure" || wantSentenceMarks;
    let marksCacheHit = false;
    if (!nocache && shouldMaintainTimedMarks) {
      if (policy.provider === "azure") {
        const azureMarksCandidates = [
          { key: bookmarkMarksKey, timingSource: TTS_BOOKMARK_MARKS_TIMING_SOURCE },
          { key: wordBoundaryMarksKey, timingSource: TTS_WB_MARKS_TIMING_SOURCE },
        ];
        for (const candidate of azureMarksCandidates) {
          try {
            await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: candidate.key }));
          } catch (_) {
            continue;
          }
          const cachedAzureMarks = await readJsonS3Object(s3, bucket, candidate.key, null);
          if (isValidAzureSentenceMarks(text, cachedAzureMarks)) {
            marksKey = candidate.key;
            marksTimingSource = candidate.timingSource;
            marksCacheHit = true;
            break;
          }
          await deleteS3ObjectQuietly(s3, bucket, candidate.key);
        }
      } else {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: marksKey }));
          marksCacheHit = true;
        } catch (_) {
          marksCacheHit = false;
        }
      }
    }
    const marksCacheHitInitial = marksCacheHit;

    let audioCacheStatus = nocache ? "bypass" : (audioCacheHitInitial ? "hit" : "miss");
    let marksCacheStatus = nocache
      ? (shouldMaintainTimedMarks ? "bypass" : "not-requested")
      : (marksCacheHitInitial ? "hit" : (shouldMaintainTimedMarks ? "miss" : "not-requested"));
    let marksProvenance = (shouldMaintainTimedMarks || marksCacheHitInitial) ? "s3-sidecar" : "none";
    let ttsDiagnostics = null;

    if (policy.provider === "azure") {
      if (!audioCacheHitInitial || !marksCacheHitInitial) {
        let artifact;
        try {
          artifact = await azureSynthesizeArtifact(text, policy.voiceId, {
            requestMode,
            requestVoiceId: policy.voiceId,
            requestVoiceVariant: String(body?.voiceVariant ?? "").trim().toLowerCase() || null,
            requestSpeechMarks: body?.speechMarks ?? null,
            provider: policy.provider,
            artifactHash: hash,
            artifactVersion,
            sentenceSplitterVersion,
            audioCacheStatus,
            marksCacheStatus,
            audioArtifactHash: audioCacheHitInitial ? hash : null,
            marksArtifactHash: marksCacheHitInitial ? hash : null,
            sidecarAvailable: marksCacheHitInitial,
          });
        } catch (err) {
          if (isIncompleteAzureBookmarkError(err)) {
            await deleteS3ObjectQuietly(s3, bucket, bookmarkMarksKey);
            await deleteS3ObjectQuietly(s3, bucket, wordBoundaryMarksKey);
            marksCacheHit = false;
            marksTimingSource = null;
            marksKey = bookmarkMarksKey;
            marksCacheStatus = "miss";
            if (err?.ttsDiagnostics) {
              err.ttsDiagnostics.marksCacheStatus = marksCacheStatus;
              err.ttsDiagnostics.marksArtifactHash = null;
              err.ttsDiagnostics.sidecarIdentitySource = "none";
              err.ttsDiagnostics.expectedSidecarTextHash = null;
              err.ttsDiagnostics.expectedSidecarSplitterVersion = null;
              err.ttsDiagnostics.expectedSidecarArtifactVersion = null;
            }
          }
          throw err;
        }
        ttsDiagnostics = artifact.diagnostics || null;
        marksTimingSource = artifact.timingSource || null;
        marksKey = marksTimingSource === TTS_WB_MARKS_TIMING_SOURCE ? wordBoundaryMarksKey : bookmarkMarksKey;
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
        audioCacheStatus = audioCacheHitInitial ? "refreshed" : "miss";
        marksCacheStatus = marksCacheHitInitial ? "hit" : "regenerated";
        if (ttsDiagnostics) {
          ttsDiagnostics.audioCacheStatus = audioCacheStatus;
          ttsDiagnostics.marksCacheStatus = marksCacheStatus;
          ttsDiagnostics.audioArtifactHash = hash;
          ttsDiagnostics.marksArtifactHash = hash;
          ttsDiagnostics.selectedTimingSource = marksTimingSource;
          ttsDiagnostics.marksTimingSource = marksTimingSource;
          ttsDiagnostics.sidecarIdentitySource = "expected-from-current-cache-key";
          ttsDiagnostics.sidecarMetadataRead = false;
          ttsDiagnostics.expectedSidecarTextHash = ttsDiagnostics.backendTextHash;
          ttsDiagnostics.expectedSidecarSplitterVersion = sentenceSplitterVersion;
          ttsDiagnostics.expectedSidecarArtifactVersion = artifactVersion;
        }
      }
    } else if (!audioCacheHitInitial) {
      const audioBuf = await synthesizeCloudAudio({ awsRegion, text, policy });
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: audioBuf,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      audioCacheStatus = "miss";
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
      if (Array.isArray(sentenceMarks)) {
        if (policy.provider === "polly") {
          marksCacheStatus = nocache
            ? "regenerated"
            : (marksCacheHitInitial ? "hit" : "regenerated");
        }
      } else {
        marksCacheStatus = wantSentenceMarks ? "unavailable" : marksCacheStatus;
      }
    }

    if (policy.provider === "azure" && !ttsDiagnostics) {
      const sentencePlan = buildAzureSentencePlan(text);
      const serverMarksValid = Array.isArray(sentenceMarks) && isValidAzureSentenceMarks(text, sentenceMarks);
      ttsDiagnostics = buildAzureServerDiagnostics({
        text,
        sentencePlan,
        ssml: buildAzureSsml(text, policy.voiceId, sentencePlan),
        bookmarkOffsets: null,
        voiceName: policy.voiceId,
        meta: {
          requestMode,
          requestVoiceId: policy.voiceId,
          requestVoiceVariant: String(body?.voiceVariant ?? "").trim().toLowerCase() || null,
          requestSpeechMarks: body?.speechMarks ?? null,
          provider: policy.provider,
          artifactHash: hash,
          artifactVersion,
          sentenceSplitterVersion,
          audioCacheStatus,
          marksCacheStatus,
          audioArtifactHash: cacheHit || audioCacheHitInitial ? hash : null,
          marksArtifactHash: marksCacheHit || marksCacheHitInitial ? hash : null,
          sidecarAvailable: marksCacheHit || marksCacheHitInitial || serverMarksValid,
          marksTimingSource,
          bookmarkReachedSource: (marksCacheHit || marksCacheHitInitial) ? "not-invoked-cache-sidecar" : "not-invoked-no-sidecar",
        },
        sentenceMarks,
        validationReason: serverMarksValid ? "complete" : (wantSentenceMarks ? "marks-unavailable-or-invalid" : "marks-not-requested"),
        selectedTimingSource: serverMarksValid ? marksTimingSource : null,
      });
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 * 60 }
    );

    const preciseSeekCapable = policy.provider === "azure"
      ? !!marksCacheHit && (!wantSentenceMarks || Array.isArray(sentenceMarks))
      : (!!marksCacheHitInitial || (Array.isArray(sentenceMarks) && sentenceMarks.length > 0));
    const capability = buildCapabilityPayload({
      artifactVersion,
      sentenceSplitterVersion,
      hash,
      policy,
      wantSentenceMarks,
      sentenceMarks,
      preciseSeekCapable,
      audioCacheStatus,
      marksCacheStatus,
      marksProvenance,
      marksTimingSource: preciseSeekCapable ? marksTimingSource : null,
    });

    const payload = {
      url,
      cacheHit,
      provider: policy.provider,
      capability,
      cloudCharsRequested: text.length,
      cloudRequestMode: requestMode,
      voiceId: policy.voiceId,
      route: policy.provider,
    };
    if (ttsDiagnostics) payload.ttsDiagnostics = ttsDiagnostics;
    if (wantSentenceMarks && Array.isArray(sentenceMarks)) payload.sentenceMarks = sentenceMarks;
    if (debug) {
      payload.debug = {
        providerResolved: policy.provider,
        voiceId: policy.voiceId,
        objectKey,
        marksKey,
        marksTimingSource,
        textLength: text.length,
        cacheHit,
        sentenceMarksMode: policy.sentenceMarksMode,
        artifactVersion,
        sentenceSplitterVersion,
        capability,
      };
    }
    return json(res, 200, payload);
  } catch (err) {
    console.error("[ai-tts]", err);
    const payload = { error: "Server error", detail: String(err) };
    if (err?.ttsDiagnostics) payload.ttsDiagnostics = err.ttsDiagnostics;
    return json(res, 500, payload);
  }
}