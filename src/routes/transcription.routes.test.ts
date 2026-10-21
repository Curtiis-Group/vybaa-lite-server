import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createTranscriptionRouter } from "./transcription.routes";
import { TranscriptionService } from "../services/transcription.service";
import type { AuthRequest } from "../middleware/auth.middleware";

test("transcription HTTP route accepts binary recordings, rejects invalid requests and keeps results private", async () => {
  let calls = 0;
  const service = new TranscriptionService(async () => {
    calls++;
    return { text: "Spoken words", language: "eng" };
  });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api/v1/transcriptions",
    createTranscriptionRouter(service, (req: AuthRequest, _res, next) => {
      if (req.header("authorization") === "Bearer test")
        req.userId = "user-one";
      next();
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/transcriptions`;
  const id = randomUUID();
  const options = {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "audio/wav",
      "x-transcription-id": id,
    },
    body: Buffer.from("RIFF0000WAVEfmt data"),
  };
  try {
    assert.equal((await fetch(url, { ...options, headers: {} })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          ...options,
          headers: { ...options.headers, "x-transcription-id": "bad" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(url, { ...options, body: Buffer.from("not audio") })).status,
      415,
    );
    const response = await fetch(url, options);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      msg: "Recording transcribed",
      data: { text: "Spoken words", language: "eng" },
    });
    assert.equal((await fetch(url, options)).status, 200);
    assert.equal(calls, 1);
    assert.equal(
      (
        await fetch(url, {
          ...options,
          body: Buffer.from("RIFF0000WAVEchanged data"),
        })
      ).status,
      409,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
