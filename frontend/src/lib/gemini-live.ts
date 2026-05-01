import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

export interface LiveSessionConfig {
  apiKey: string;
  systemInstruction: string;
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private session: any = null;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private _isConnected = false;
  private nextScheduleTime = 0;
  private activeAudioSources: AudioBufferSourceNode[] = [];

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  get isConnected() {
    return this._isConnected;
  }

  async connect(config: { systemInstruction: string; onMessage: (text: string) => void; onStatusChange: (status: string) => void }) {
    if (this.isConnected) return;

    try {
      config.onStatusChange("Initializing Audio...");
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      // Ensure AudioContext is active (required by browsers)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.nextScheduleTime = 0;

      config.onStatusChange("Requesting Microphone...");
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      config.onStatusChange("Connecting to Gemini Live...");
      
      // Use a very generous timeout for establishes (45s)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Connection Timeout (45s): No response from Gemini Live. This is usually caused by an invalid API key, regional restrictions, or an expired AI Studio session (401 error). Please refresh the page and verify your API Key in Settings.")), 45000);
      });

      console.log("Initiating live.connect with model: gemini-3.1-flash-live-preview");
      const sessionPromise = this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log("Gemini Live WebSocket Opened Successfully");
            config.onStatusChange("Connected");
            this._isConnected = true;
            this.startMicStreamingWhenReady();
          },
          onmessage: async (message: LiveServerMessage) => {
            // Log raw messages for debugging
            if ((message as any).serverContent?.inputAudioTranscription) {
              console.log("User Transcript:", (message as any).serverContent.inputAudioTranscription.transcript);
            }
            
            // Handle User Interruption
            if (message.serverContent?.interrupted) {
              console.log("Agent Interrupted by User");
              this.nextScheduleTime = 0;
              // Stop all currently playing and queued audio immediately
              this.activeAudioSources.forEach(source => {
                try { source.stop(); } catch (e) { /* already stopped */ }
              });
              this.activeAudioSources = [];
              return;
            }

            // Handle User Transcription
            const inputTranscription = (message as any).serverContent?.inputAudioTranscription;
            if (inputTranscription?.transcript) {
              config.onMessage(`User: ${inputTranscription.transcript}`);
            }

            // Handle Model Response (Audio & Text)
            const modelParts = message.serverContent?.modelTurn?.parts;
            if (modelParts) {
              for (const part of modelParts) {
                if (part.text) {
                  config.onMessage(`Isha: ${part.text}`);
                }
                if (part.inlineData?.data) {
                  this.playAudio(part.inlineData.data);
                }
              }
            }
          },
          onclose: (event: any) => {
            console.log("Gemini Live WebSocket Closed:", event);
            config.onStatusChange("Disconnected");
            this._isConnected = false;
            this.stop();
          },
          onerror: (error) => {
            console.error("Live API Protocol Error:", error);
            // Check for common network errors
            let errorMsg = error.message || "Unknown WebSocket Error";
            if (errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
              errorMsg = "Session Expired (401). Please refresh the page.";
            } else if (errorMsg.includes("403")) {
              errorMsg = "Access Denied (403). Check if your API Key supports Live API.";
            }
            config.onStatusChange("Error: " + errorMsg);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: config.systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      });

      this.session = await (Promise.race([sessionPromise, timeoutPromise]) as Promise<any>);
      
      if (this.isConnected && this.session) {
        console.log("Nudging AI to initiate greeting...");
        this.session.sendRealtimeInput({ 
          text: "System: You are now connected to the customer on a phone call. Greet them naturally like a real person. Do NOT sound robotic. Be warm, pause naturally, and respond to what they actually say." 
        });
      }

      return this.session;
    } catch (error) {
      console.error("Failed to connect to Live API", error);
      const msg = error instanceof Error ? error.message : String(error);
      config.onStatusChange("Connection Failed: " + msg);
      throw error;
    }
  }

  private async startMicStreamingWhenReady() {
    // Wait for session to be assigned if onopen fired first
    let attempts = 0;
    while (!this.session && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (this.session) {
      this.startMicStreaming();
    } else {
      console.error("Session failed to initialize in time for mic streaming.");
    }
  }

  private startMicStreaming() {
    if (!this.audioContext || !this.micStream || !this.session) {
      console.warn("Cannot start streaming: missing audioContext, micStream, or session");
      return;
    }

    const source = this.audioContext.createMediaStreamSource(this.micStream);
    // Using ScriptProcessorNode for simplicity of implementation in this context
    // Though it's deprecated, it's easier to set up without separate worker files
    this.micProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.micProcessor.onaudioprocess = (e) => {
      if (!this.isConnected) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = this.float32ToPcm(inputData);
      const base64Data = this.arrayBufferToBase64(pcmData);
      
      this.session.sendRealtimeInput({
        audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
      });
    };

    source.connect(this.micProcessor);
    this.micProcessor.connect(this.audioContext.destination);
  }

  private playAudio(base64Data: string) {
    if (!this.audioContext) return;

    const buffer = this.base64ToArrayBuffer(base64Data);
    const float32Data = this.pcmToFloat32(buffer);
    
    const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, 24000); // Live API usually outputs 24kHz
    audioBuffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    this.activeAudioSources.push(source);
    source.onended = () => {
      const idx = this.activeAudioSources.indexOf(source);
      if (idx > -1) this.activeAudioSources.splice(idx, 1);
    };

    // Dynamic queueing using nextScheduleTime
    const now = this.audioContext.currentTime;
    const startTime = Math.max(now, this.nextScheduleTime);
    
    source.start(startTime);
    this.nextScheduleTime = startTime + audioBuffer.duration;
  }

  private float32ToPcm(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  private pcmToFloat32(arrayBuffer: ArrayBuffer): Float32Array {
    const view = new DataView(arrayBuffer);
    const length = arrayBuffer.byteLength / 2;
    const float32Array = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      float32Array[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    return float32Array;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  stop() {
    this._isConnected = false;
    try {
      if (this.micProcessor) {
        this.micProcessor.disconnect();
        this.micProcessor = null;
      }
    } catch (e) { console.warn("Mic processor cleanup error:", e); }
    try {
      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
      }
    } catch (e) { console.warn("Mic stream cleanup error:", e); }
    try {
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
    } catch (e) { console.warn("Audio context cleanup error:", e); }
    try {
      if (this.session) {
        this.session.close();
        this.session = null;
      }
    } catch (e) { console.warn("Session cleanup error:", e); }
  }
}
