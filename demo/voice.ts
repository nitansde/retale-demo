// A static site has no microphone pipeline, ASR or TTS, so only those boundaries are
// simulated: a silent microphone, scripted speech and pre-generated Fish clips.
// VoiceCall, capture and playback stay upstream ReTale. This patches fetch in the page
// because MSW buffers streamed responses where streams are not transferable, which
// would leave a Safari call waiting forever.
import { DEFAULT_VOICE_SETTINGS, DEFAULT_VOICES, type VoiceEvent } from "@/lib/voice-chat";
import type { Locale } from "@/lib/i18n/messages";
import clips from "./voice-clips.json";

const SAMPLE_RATE = 24000;
const AUDIO_EVENT_BYTES = 16_384;
const scriptedSpeech = {
  zh: ["你现在说话方便吗？", "那接下来我们该怎么做？", "好，我听你的。"],
  en: ["Is now a good time to talk?", "So what should we do next?", "All right. I trust you."],
};
const voiceClips: Record<string, Record<string, string>> = clips;
const isSecret = (key: string) => /apikey$|^clear_/i.test(key);
const withoutSecrets = (values: object) =>
  Object.fromEntries(Object.entries(values).filter(([key]) => !isSecret(key)));
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });

function eventStream(run: (send: (event: VoiceEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: VoiceEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        run(send).then(() => controller.close(), (error) => controller.error(error));
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

async function decodeClip(bytes: ArrayBuffer) {
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  const samples = decoded.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
  return new Uint8Array(pcm.buffer);
}

export function installDemoVoice(basePath: string, getLocale: () => Locale) {
  const realFetch = window.fetch.bind(window);
  // Secrets typed into the settings form are dropped here and never stored.
  let settings: Record<string, unknown> = withoutSecrets(DEFAULT_VOICE_SETTINGS);
  // Unset, each line uses the voice that suits its character.
  let chosenVoice: string | undefined;
  let replying = false;
  const currentVoice = () => chosenVoice ?? DEFAULT_VOICES[getLocale() === "en" ? 1 : 0].id;
  const publicSettings = () => ({ ...settings, voiceId: currentVoice(), sonioxConfigured: true, qwenConfigured: true, fishConfigured: true });

  const saveSettings = (body: Record<string, unknown>) => {
    settings = { ...settings, ...withoutSecrets(body) };
    if (typeof body.voiceId === "string" && body.voiceId !== currentVoice()) chosenVoice = body.voiceId;
    return publicSettings();
  };

  const clipFor = (text: string) => {
    const voices = voiceClips[text.trim()];
    if (!voices) return null;
    return `${basePath}/voice/${(chosenVoice && voices[chosenVoice]) || Object.values(voices)[0]}`;
  };

  const transcribe = (signal: AbortSignal) =>
    eventStream(async (send) => {
      send({ type: "ready", sessionId: "demo" });
      for (const line of scriptedSpeech[getLocale() === "en" ? "en" : "zh"]) {
        do await wait(1500, signal); while (replying);
        for (let end = 2; end < line.length; end += 2) {
          send({ type: "transcript", text: line.slice(0, end), final: false });
          await wait(120, signal);
        }
        send({ type: "transcript", text: line, final: true });
      }
      // VoiceCall treats a closed stream as a lost connection, so stay open until it ends.
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });

  const reply = (body: string, signal: AbortSignal) => {
    replying = true;
    const finish = (ms: number) => setTimeout(() => { replying = false; }, ms);
    signal.addEventListener("abort", () => finish(0), { once: true });
    return eventStream(async (send) => {
      try {
        // The text mock already picks the scripted line for this book and turn.
        const generated = await realFetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...JSON.parse(body), recoverableRewriteJob: false }),
          signal,
        });
        const { result } = await generated.json();
        const text: string = JSON.parse(result.content).blocks.find((block: { type: string }) => block.type === "counterpart").text;
        const clip = clipFor(text);
        // A line without a clip, such as a custom partner's, is shown but not voiced.
        send({ type: "text", segment: 0, text, ...(clip ? {} : { silent: true }) });
        let seconds = 0;
        if (clip) {
          const pcm = await decodeClip(await (await realFetch(clip, { signal })).arrayBuffer());
          seconds = pcm.length / 2 / SAMPLE_RATE;
          for (let offset = 0; offset < pcm.length; offset += AUDIO_EVENT_BYTES) {
            const audio = btoa(String.fromCharCode(...pcm.subarray(offset, offset + AUDIO_EVENT_BYTES)));
            send({ type: "audio", segment: 0, sampleRate: SAMPLE_RATE, audio });
          }
          send({ type: "segment-end", segment: 0 });
        }
        send({ type: "done" });
        finish(seconds * 1000);
      } catch (error) {
        finish(0);
        throw error;
      }
    });
  };

  const speak = (body: string) => {
    const clip = clipFor(JSON.parse(body).text);
    if (clip) return realFetch(clip);
    const error = getLocale() === "en" ? "The demo only has sample voices for scripted lines." : "演示版只提供预设台词的样例语音。";
    return Response.json({ error }, { status: 400 });
  };

  const route = (path: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const signal = init?.signal ?? new AbortController().signal;
    if (path === "/api/settings/voice") return Response.json(init?.method === "POST" ? saveSettings(JSON.parse(body)) : publicSettings());
    if (path === "/api/roleplay/voice/transcribe") return transcribe(signal);
    if (path === "/api/roleplay/voice/reply") return reply(body, signal);
    if (path === "/api/roleplay/voice/speak") return speak(body);
    // Silent audio uploads, hang-up and debug traces need no answer.
    if (path.startsWith("/api/roleplay/voice/")) return Response.json({ ok: true });
    return null;
  };

  window.fetch = async (input, init) => {
    const source = input instanceof Request ? input.url : String(input);
    return (await route(new URL(source, window.location.href).pathname, init)) ?? realFetch(input, init);
  };

  // No permission prompt: the "microphone" is one silent graph, cloned per capture.
  // It goes on the prototype because WebKit can collect the navigator.mediaDevices
  // wrapper, and an own property with it, which would reach for the real microphone.
  let silence: MediaStreamAudioDestinationNode | undefined;
  if (navigator.mediaDevices) {
    MediaDevices.prototype.getUserMedia = async () => (silence ??= new AudioContext().createMediaStreamDestination()).stream.clone();
  }
}
