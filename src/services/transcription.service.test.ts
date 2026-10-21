import assert from "node:assert/strict";
import test from "node:test";
import { transcriptionConfig } from "../config/transcription.config";
import {
  TranscriptionError,
  TranscriptionService,
  transcribeAudio,
  validateTranscriptionAudio,
} from "./transcription.service";

const audio = validateTranscriptionAudio(
  Buffer.from("RIFF0000WAVEfmt test"),
  "audio/wav",
);

test("transcription validates size, MIME and container instead of trusting a filename", () => {
  assert.throws(
    () => validateTranscriptionAudio(undefined, "audio/wav"),
    /non-empty/,
  );
  assert.throws(
    () => validateTranscriptionAudio(Buffer.from("not audio"), "audio/wav"),
    /audio file/,
  );
  assert.throws(
    () => validateTranscriptionAudio(Buffer.from("ID3mp3"), "text/plain"),
    /audio file/,
  );
  assert.throws(
    () =>
      validateTranscriptionAudio(
        Buffer.alloc(transcriptionConfig.maxBytes + 1),
        "audio/wav",
      ),
    /12 MB/,
  );
  assert.equal(
    validateTranscriptionAudio(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      "audio/webm;codecs=opus",
    ).extension,
    "webm",
  );
  assert.equal(
    validateTranscriptionAudio(Buffer.from("0000ftypM4A test"), "audio/aac")
      .extension,
    "m4a",
  );
  assert.equal(
    validateTranscriptionAudio(Buffer.from("OggSdata"), "audio/ogg").extension,
    "ogg",
  );
  assert.equal(
    validateTranscriptionAudio(Buffer.from("ID3data"), "audio/mpeg").extension,
    "mp3",
  );
  assert.equal(
    validateTranscriptionAudio(Buffer.from("fLaCdata"), "audio/flac").extension,
    "flac",
  );
});

test("transcription sends actual audio multipart data with server-only credentials", async () => {
  let called = false;
  const result = await transcribeAudio(audio, undefined, {
    apiKey: "server-secret",
    fetcher: async (url, options) => {
      called = true;
      assert.equal(url, transcriptionConfig.endpoint);
      assert.equal(
        new Headers(options?.headers).get("xi-api-key"),
        "server-secret",
      );
      assert.ok(options?.body instanceof FormData);
      assert.equal(options.body.get("model_id"), "scribe_v2");
      assert.equal(options.body.get("diarize"), "false");
      const file = options.body.get("file");
      assert.ok(file instanceof Blob);
      assert.equal(
        Buffer.from(await file.arrayBuffer()).toString(),
        audio.bytes.toString(),
      );
      return Response.json({
        text: "  My actual words.  ",
        language_code: "eng",
      });
    },
  });
  assert.equal(called, true);
  assert.deepEqual(result, { text: "My actual words.", language: "eng" });
});

test("transcription reports no speech, malformed responses and upstream failures safely", async () => {
  for (const payload of [{ text: "  " }, { text: 42 }]) {
    await assert.rejects(
      transcribeAudio(audio, undefined, {
        apiKey: "secret",
        fetcher: async () => Response.json(payload),
      }),
      TranscriptionError,
    );
  }
  await assert.rejects(
    transcribeAudio(audio, undefined, {
      apiKey: "secret",
      fetcher: async () =>
        new Response("private upstream details", { status: 401 }),
    }),
    (error: unknown) =>
      error instanceof TranscriptionError &&
      error.status === 503 &&
      !error.message.includes("private"),
  );
  await assert.rejects(
    transcribeAudio(audio, undefined, {
      apiKey: "",
      fetcher: async () => {
        throw new Error("must not request");
      },
    }),
    (error: unknown) =>
      error instanceof TranscriptionError &&
      error.code === "TRANSCRIPTION_UNAVAILABLE",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribeAudio(audio, controller.signal, {
      apiKey: "secret",
      fetcher: async () => {
        throw new DOMException("Aborted", "AbortError");
      },
    }),
    (error: unknown) =>
      error instanceof TranscriptionError && error.code === "CANCELLED",
  );
});

test("transcription deduplicates retries by account and recording without leaking another account's result", async () => {
  let calls = 0;
  const service = new TranscriptionService(async () => ({
    text: `Result ${++calls}`,
    language: null,
  }));
  const first = await service.create("one", "request", audio);
  assert.deepEqual(await service.create("one", "request", audio), first);
  assert.equal(calls, 1);
  await assert.rejects(
    service.create("one", "request", {
      ...audio,
      bytes: Buffer.from("different"),
    }),
    (error: unknown) =>
      error instanceof TranscriptionError && error.status === 409,
  );
  assert.equal(
    (await service.create("two", "request", audio)).text,
    "Result 2",
  );
});

test("transcription rejects overlapping work and permits a failed request to be retried", async () => {
  let resolve: (value: { text: string; language: null }) => void = () =>
    undefined;
  const service = new TranscriptionService(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = service.create("one", "request", audio);
  await assert.rejects(
    service.create("one", "request", audio),
    (error: unknown) =>
      error instanceof TranscriptionError &&
      error.code === "TRANSCRIPTION_IN_PROGRESS",
  );
  resolve({ text: "saved", language: null });
  await pending;
  let attempts = 0;
  const failing = new TranscriptionService(async () => {
    if (++attempts === 1) throw new Error("temporary failure");
    return { text: "retried", language: null };
  });
  await assert.rejects(failing.create("one", "same", audio));
  assert.equal((await failing.create("one", "same", audio)).text, "retried");
});

test("transcription bounds per-account paid requests", async () => {
  let calls = 0;
  const service = new TranscriptionService(async () => {
    calls++;
    return { text: "words", language: null };
  });
  for (let index = 0; index < transcriptionConfig.requestsPerWindow; index++)
    await service.create("one", String(index), audio);
  await assert.rejects(
    service.create("one", "too-many", audio),
    (error: unknown) =>
      error instanceof TranscriptionError && error.status === 429,
  );
  assert.equal(calls, transcriptionConfig.requestsPerWindow);
});
