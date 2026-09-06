import WebSocket from "ws";
import type { ElevenLabsRewindVoiceConfig } from "./rewind-voice-provider.service";

const ELEVENLABS_SIGNED_URL_ENDPOINT =
  "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";
const ELEVENLABS_REQUEST_TIMEOUT_MS = 10_000;

type ElevenLabsJsonRecord = Record<string, unknown>;

export type ElevenLabsRewindLiveHandlers = {
  onAgentResponse: (content: string) => void;
  onAgentResponseComplete: () => void;
  onAudio: (data: string, mimeType: string) => void;
  onClose: (code: number, reason: string) => void;
  onError: (message: string) => void;
  onInterrupted: () => void;
  onReady: (conversationId: string | null) => void;
  onUserTranscript: (content: string) => void;
};

export type ElevenLabsRewindLiveOptions = {
  agentId: string;
  apiKey: string;
  dynamicVariables: Record<string, string>;
  firstMessage: string;
  handlers: ElevenLabsRewindLiveHandlers;
  prompt: string;
  voiceConfig: ElevenLabsRewindVoiceConfig;
};

function isRecord(value: unknown): value is ElevenLabsJsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNestedString(
  value: ElevenLabsJsonRecord,
  containerKey: string,
  fieldKey: string,
): string | null {
  const container = value[containerKey];
  if (!isRecord(container)) return null;
  const field = container[fieldKey];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

export function getElevenLabsPcmMimeType(format: unknown): string | null {
  if (typeof format !== "string") return null;
  const match = /^pcm_(8000|16000|22050|24000|44100|48000)$/.exec(format);
  return match ? `audio/pcm;rate=${match[1]}` : null;
}

export function isTrustedElevenLabsSignedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isTrustedHost =
      url.hostname === "api.elevenlabs.io" ||
      /^api\.(eu|in|sg)\.residency\.elevenlabs\.io$/.test(url.hostname);
    return url.protocol === "wss:" && isTrustedHost;
  } catch {
    return false;
  }
}

export function buildElevenLabsInitiationPayload(options: {
  dynamicVariables: Record<string, string>;
  firstMessage: string;
  prompt: string;
  voiceConfig: ElevenLabsRewindVoiceConfig;
}): ElevenLabsJsonRecord {
  return {
    conversation_config_override: {
      agent: {
        first_message: options.firstMessage,
        language: "en",
        prompt: { prompt: options.prompt },
      },
      tts: {
        similarity_boost: options.voiceConfig.similarityBoost,
        speed: options.voiceConfig.speed,
        stability: options.voiceConfig.stability,
        voice_id: options.voiceConfig.voiceId,
      },
    },
    custom_llm_extra_body: {
      max_tokens: 512,
      temperature: 0.8,
    },
    dynamic_variables: options.dynamicVariables,
    type: "conversation_initiation_client_data",
  };
}

export async function getElevenLabsSignedUrl(options: {
  agentId: string;
  apiKey: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ELEVENLABS_REQUEST_TIMEOUT_MS,
  );
  try {
    const endpoint = new URL(ELEVENLABS_SIGNED_URL_ENDPOINT);
    endpoint.searchParams.set("agent_id", options.agentId);
    const response = await (options.fetcher ?? fetch)(endpoint, {
      headers: { "xi-api-key": options.apiKey },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `ElevenLabs signed URL request failed (${response.status})`,
      );
    }

    const payload: unknown = await response.json();
    const signedUrl =
      isRecord(payload) && typeof payload.signed_url === "string"
        ? payload.signed_url.trim()
        : "";
    if (!signedUrl || !isTrustedElevenLabsSignedUrl(signedUrl)) {
      throw new Error("ElevenLabs returned an invalid signed URL");
    }
    return signedUrl;
  } finally {
    clearTimeout(timeout);
  }
}

export class ElevenLabsRewindLiveConnection {
  private outputMimeType = "audio/pcm;rate=16000";
  private socket: WebSocket | null = null;

  public constructor(private readonly options: ElevenLabsRewindLiveOptions) {}

  public async connect(): Promise<void> {
    const signedUrl = await getElevenLabsSignedUrl({
      agentId: this.options.agentId,
      apiKey: this.options.apiKey,
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(signedUrl);
      this.socket = socket;

      socket.once("open", () => {
        settled = true;
        socket.send(
          JSON.stringify(
            buildElevenLabsInitiationPayload({
              dynamicVariables: this.options.dynamicVariables,
              firstMessage: this.options.firstMessage,
              prompt: this.options.prompt,
              voiceConfig: this.options.voiceConfig,
            }),
          ),
        );
        resolve();
      });
      socket.on("message", (data) => {
        this.handleMessage(data.toString());
      });
      socket.on("close", (code, reason) => {
        this.socket = null;
        this.options.handlers.onClose(code, reason.toString());
      });
      socket.on("error", (error) => {
        const message =
          error instanceof Error ? error.message : "Connection error";
        this.options.handlers.onError(message);
        if (!settled) reject(error);
      });
    });
  }

  public close(): void {
    this.socket?.close(1000, "Vybaa Rewind connection closed");
    this.socket = null;
  }

  public sendAudio(data: string): void {
    this.send({ user_audio_chunk: data });
  }

  public sendUserMessage(text: string): void {
    this.send({ text, type: "user_message" });
  }

  private handleMessage(raw: string): void {
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      this.options.handlers.onError("ElevenLabs returned malformed JSON");
      return;
    }
    if (!isRecord(event) || typeof event.type !== "string") return;

    if (event.type === "conversation_initiation_metadata") {
      const metadata = event.conversation_initiation_metadata_event;
      if (!isRecord(metadata)) {
        this.options.handlers.onError(
          "ElevenLabs omitted conversation metadata",
        );
        return;
      }
      const outputMimeType = getElevenLabsPcmMimeType(
        metadata.agent_output_audio_format,
      );
      const inputMimeType = getElevenLabsPcmMimeType(
        metadata.user_input_audio_format,
      );
      if (!outputMimeType || inputMimeType !== "audio/pcm;rate=16000") {
        this.options.handlers.onError(
          "ElevenLabs agent audio must use 16 kHz PCM input and PCM output",
        );
        this.close();
        return;
      }
      this.outputMimeType = outputMimeType;
      this.options.handlers.onReady(
        typeof metadata.conversation_id === "string"
          ? metadata.conversation_id
          : null,
      );
      return;
    }

    if (event.type === "ping") {
      const ping = event.ping_event;
      if (isRecord(ping) && typeof ping.event_id === "number") {
        this.send({ event_id: ping.event_id, type: "pong" });
      }
      return;
    }

    if (event.type === "audio") {
      const audio = getNestedString(event, "audio_event", "audio_base_64");
      if (audio) this.options.handlers.onAudio(audio, this.outputMimeType);
      return;
    }

    if (event.type === "user_transcript") {
      const transcript = getNestedString(
        event,
        "user_transcription_event",
        "user_transcript",
      );
      if (transcript) this.options.handlers.onUserTranscript(transcript);
      return;
    }

    if (event.type === "agent_response") {
      const response = getNestedString(
        event,
        "agent_response_event",
        "agent_response",
      );
      if (response) this.options.handlers.onAgentResponse(response);
      return;
    }

    if (event.type === "agent_response_correction") {
      const correction = getNestedString(
        event,
        "agent_response_correction_event",
        "corrected_agent_response",
      );
      if (correction) this.options.handlers.onAgentResponse(correction);
      return;
    }

    if (event.type === "agent_response_complete") {
      this.options.handlers.onAgentResponseComplete();
      return;
    }

    if (event.type === "interruption") {
      this.options.handlers.onInterrupted();
      return;
    }

    if (event.type === "client_error") {
      const message =
        getNestedString(event, "client_error", "message") ??
        "ElevenLabs reported a conversation error";
      this.options.handlers.onError(message);
    }
  }

  private send(payload: ElevenLabsJsonRecord): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }
}
