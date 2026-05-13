/**
 * GeminiLiveService
 * Uses Gemini Chat API + Gemini TTS + Web SpeechRecognition
 * Works with standard Gemini API keys (no Live API needed)
 */
import { GoogleGenAI } from "@google/genai";

const MODEL_TTS  = "gemini-2.5-flash-preview-tts";
const TTS_VOICE  = "Kore";

// Chat models — tries in order until one works
const CHAT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
];

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private apiKey: string;
  private _isConnected = false;
  private recognition: any = null;
  private audioCtx: AudioContext | null = null;
  private onMessageCb: ((text: string) => void) | null = null;
  private onStatusCb:  ((status: string) => void) | null = null;
  private systemInstruction = "";
  private history: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  private isSpeaking  = false;
  private isListening = false;
  private stopped     = false;
  private activeModel = CHAT_MODELS[0];

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey });
  }

  get isConnected() { return this._isConnected; }

  // ── Old signature (called from App.tsx) ──────────────────────────────────
  async connect(config: {
    systemInstruction: string;
    customerContext?: string;
    trainingSnippet?: string;
    onMessage: (text: string) => void;
    onStatusChange: (status: string) => void;
  }) {
    if (this._isConnected) return;
    this.stopped           = false;
    this.onMessageCb       = config.onMessage;
    this.onStatusCb        = config.onStatusChange;
    this.systemInstruction = config.systemInstruction;
    this.history           = [];

    config.onStatusChange("Initializing...");

    // AudioContext for TTS playback
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
      latencyHint: "interactive",
    });
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

    // Find a working chat model
    config.onStatusChange("Connecting to Gemini...");
    let connected = false;
    for (const model of CHAT_MODELS) {
      try {
        const t = await this.ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: "Reply: OK" }] }],
        });
        if (t.text) { this.activeModel = model; connected = true; break; }
      } catch (e: any) {
        console.warn("[Chat] Model", model, "failed:", e?.message?.slice(0, 50));
      }
    }
    if (!connected) throw new Error("All Gemini models unavailable. Try again in a moment.");

    console.log("[Chat] Using model:", this.activeModel);
    this._isConnected = true;
    config.onStatusChange("Connected");

    // Build initial context
    const startPrompt = [
      config.customerContext || "",
      "Begin the call now. Start with the identity verification greeting in 1-2 short sentences only. Be warm and natural.",
    ].filter(Boolean).join("\n\n");

    await this.aiTurn(startPrompt, true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  private async aiTurn(input: string, isFirst = false): Promise<void> {
    if (this.stopped) return;
    this.onStatusCb?.("Thinking...");

    try {
      let contents: { role: "user" | "model"; parts: { text: string }[] }[];

      if (isFirst) {
        contents = [{ role: "user", parts: [{ text: input }] }];
      } else {
        this.history.push({ role: "user", parts: [{ text: input }] });
        contents = [...this.history];
      }

      const result = await this.ai.models.generateContent({
        model: this.activeModel,
        contents,
        config: {
          systemInstruction: this.systemInstruction,
          temperature: 0.85,
          maxOutputTokens: 100,
        } as any,
      });

      const reply = (result.text || "").trim();
      if (!reply || this.stopped) return;

      this.history.push({ role: "model", parts: [{ text: reply }] });
      this.onMessageCb?.(`Isha: ${reply}`);

      await this.speakWithTTS(reply);
      if (!this.stopped) this.startListening();

    } catch (e: any) {
      console.error("[aiTurn]", e?.message || e);
      this.onStatusCb?.("Connected");
      if (!this.stopped) this.startListening();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  private async speakWithTTS(text: string): Promise<void> {
    if (this.stopped || !this.audioCtx) return;
    this.isSpeaking = true;
    this.onStatusCb?.("Speaking...");

    try {
      const body = JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
        },
      });

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_TTS}:generateContent?key=${this.apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body }
      );

      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;

      if (!part?.data) {
        console.warn("[TTS] No audio:", JSON.stringify(json).slice(0, 150));
        this.isSpeaking = false;
        return;
      }

      // Gemini TTS returns raw PCM: audio/L16;codec=pcm;rate=24000
      const raw = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
      const RATE = 24000;
      const samples = raw.length / 2;
      const float32 = new Float32Array(samples);
      const view = new DataView(raw.buffer);
      for (let i = 0; i < samples; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768;
      }

      const buf = this.audioCtx.createBuffer(1, samples, RATE);
      buf.getChannelData(0).set(float32);

      await new Promise<void>(resolve => {
        if (this.stopped || !this.audioCtx) { resolve(); return; }
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audioCtx.destination);
        src.onended = () => resolve();
        src.start(0);
      });

    } catch (e: any) {
      console.error("[TTS]", e?.message || e);
    } finally {
      this.isSpeaking = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  private startListening(): void {
    if (this.stopped || this.isListening || this.isSpeaking) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      this.onStatusCb?.("Connected (Chrome required for mic)");
      return;
    }

    try {
      this.recognition = new SR();
      this.recognition.lang = "hi-IN";
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.onStatusCb?.("Listening...");
      };

      this.recognition.onresult = async (e: any) => {
        this.isListening = false;
        const text = (e.results[0]?.[0]?.transcript || "").trim();
        if (!text || this.stopped) return;
        console.log("[User]", text);
        this.onMessageCb?.(`User: ${text}`);

        const lower = text.toLowerCase();
        const deathWords = ["mar gaya","mar gayi","death","passed away","nahi rahe","wafaat","chanipoyaru","marichu","mara geche","vaarle"];
        if (deathWords.some(w => lower.includes(w))) {
          await this.speakWithTTS("Bahut dukh hua yeh sunke. Main abhi call disconnect karti hoon. Aapke parivaar ko meri deepest condolences.");
          this.stop();
          return;
        }

        await this.aiTurn(text);
      };

      this.recognition.onerror = (e: any) => {
        this.isListening = false;
        if (this.stopped) return;
        const delay = e.error === "no-speech" ? 150 : 700;
        setTimeout(() => { if (!this.stopped && !this.isSpeaking) this.startListening(); }, delay);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (!this.stopped && !this.isSpeaking) {
          setTimeout(() => { if (!this.stopped && !this.isSpeaking) this.startListening(); }, 200);
        }
      };

      this.recognition.start();
    } catch (e) {
      console.warn("[SR]", e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  stop() {
    this.stopped      = true;
    this._isConnected = false;
    try { this.recognition?.stop(); } catch (_) {}
    try { this.audioCtx?.close(); } catch (_) {}
    this.recognition = null;
    this.audioCtx    = null;
    this.isListening = false;
    this.isSpeaking  = false;
  }
}
