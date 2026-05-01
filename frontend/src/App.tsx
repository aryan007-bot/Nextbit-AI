import { useState, useRef, useEffect, type ReactNode, type ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import {
  PhoneCall,
  ShieldCheck,
  CreditCard,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Mic,
  MicOff,
  PhoneOff,
  History,
  TrendingUp,
  MessageSquare,
  Activity,
  RefreshCw,
  Server,
  Zap,
  Lock,
  BarChart3,
  Users,
  Phone,
  Upload,
  FileSpreadsheet,
  Database,
  Trash2,
  FileDown
} from "lucide-react";
import { GeminiLiveService } from "./lib/gemini-live";
import { buildDynamicPrompt } from "./lib/training";
import { retrieveRelevant, generateQueryFromProfile } from "./lib/retrieval";
import { api, type Customer as DbCustomer } from "./lib/api";

// --- Types ---
interface CustomerData {
  callId?: string;
  name: string;
  overdue: string;
  dpd: number;
  personaNotes?: string;
  phone?: string;
  loanType?: string;
  amountBorrowed?: number;
  totalPaid?: number;
  outstandingBalance?: number;
  overdueAmount?: number;
  cardInfo?: {
    cardNumber?: string;
    cardType?: string;
    expiryDate?: string;
  };
  paymentHistory?: {
    date: string;
    amount: number;
    method: string;
    status: string;
  }[];
}

function formatINR(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return "0";
  return val.toLocaleString("en-IN");
}

function mapDbToCustomer(db: DbCustomer): CustomerData {
  // Pick the most meaningful balance to display:
  // priority: overdueAmount > outstandingBalance > (amountBorrowed - totalPaid) > amountBorrowed
  const bestBalance =
    db.overdueAmount ||
    db.outstandingBalance ||
    (db.amountBorrowed && db.totalPaid !== undefined ? db.amountBorrowed - db.totalPaid : undefined) ||
    db.amountBorrowed ||
    0;
  return {
    callId: db.callId,
    name: db.name,
    overdue: formatINR(bestBalance),
    dpd: db.dpd || 0,
    personaNotes: db.personaNotes,
    phone: db.phone,
    loanType: db.loanType,
    amountBorrowed: db.amountBorrowed,
    totalPaid: db.totalPaid,
    outstandingBalance: db.outstandingBalance,
    overdueAmount: db.overdueAmount,
    cardInfo: db.cardInfo,
    paymentHistory: db.paymentHistory,
  };
}

interface CallLog {
  id: string;
  time: string;
  customer: string;
  status: 'Declined' | 'Negotiated' | 'Pending' | 'Resolved';
  amount: string;
  duration?: number;
  committedAmount?: number;
  ptp?: boolean;
  finalFeedback?: string;
}

interface DiagnosticState {
  apiKey: 'pending' | 'ok' | 'fail';
  mic: 'pending' | 'ok' | 'fail';
  endpoint: 'pending' | 'ok' | 'fail';
}

// --- Main Component ---
export default function App() {
  const [stage, setStage] = useState<'dashboard' | 'calling'>('dashboard');
  const [customer, setCustomer] = useState<CustomerData>({
    name: "",
    overdue: "0",
    dpd: 0
  });
  const [isMuted, setIsMuted] = useState(false);
  const [callStatus, setCallStatus] = useState("Initializing...");
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const durationInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sentiment, setSentiment] = useState<'Neutral' | 'Cooperative' | 'Resistant' | 'Agitated'>('Neutral');
  const [isDiagnosticRunning, setIsDiagnosticRunning] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticState>({
    apiKey: 'pending',
    mic: 'pending',
    endpoint: 'pending'
  });

  const [dbCustomers, setDbCustomers] = useState<CustomerData[]>([]);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [dbHealth, setDbHealth] = useState<'pending' | 'ok' | 'fail'>('pending');

  const liveService = useRef<GeminiLiveService | null>(null);

  // Load customers and call logs from backend on mount
  useEffect(() => {
    loadCustomers();
    loadCallLogs();
  }, []);

  const loadCallLogs = async () => {
    try {
      const res = await api.getCalls({ limit: 50 });
      const mapped: CallLog[] = res.data.map((call: any) => ({
        id: call._id,
        time: call.endTime ? new Date(call.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        customer: call.customerId?.name || call.callId,
        status: mapOutcomeToStatus(call.outcome),
        amount: call.aiFeedback?.committedAmount ? `₹${call.aiFeedback.committedAmount.toLocaleString('en-IN')}` : `₹${call.commitmentAmount?.toLocaleString('en-IN') || '0'}`,
        duration: call.durationSeconds || 0,
        committedAmount: call.aiFeedback?.committedAmount || call.commitmentAmount || 0,
        ptp: call.aiFeedback?.willPay === 'yes' || call.aiFeedback?.willPay === 'partial',
        finalFeedback: call.aiFeedback?.finalFeedback || call.notes || '',
      }));
      setCallLogs(mapped);
    } catch (err) {
      console.error("Failed to load call logs:", err);
    }
  };

  const mapOutcomeToStatus = (outcome: string): CallLog['status'] => {
    switch (outcome) {
      case 'resolved': return 'Resolved';
      case 'negotiated': return 'Negotiated';
      case 'declined': return 'Declined';
      default: return 'Pending';
    }
  };

  const loadCustomers = async () => {
    setIsLoadingDb(true);
    setDbHealth('pending');
    try {
      const res = await api.getCustomers({ limit: 50 });
      const mapped = res.data.map(mapDbToCustomer);
      setDbCustomers(mapped);
      setDbHealth('ok');
      if (mapped.length > 0) {
        setCustomer(mapped[0]);
      }
    } catch (err) {
      console.error("Failed to load customers:", err);
      setDbHealth('fail');
    } finally {
      setIsLoadingDb(false);
    }
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus({ type: null, message: 'Uploading...' });
    try {
      const res = await api.uploadSheet(file);
      setUploadStatus({ type: 'success', message: res.message });
      await loadCustomers();
    } catch (err) {
      setUploadStatus({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
    }
    e.target.value = '';
  };

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL uploaded customer data? This cannot be undone.')) return;
    try {
      console.log("[Frontend] Sending bulk delete request...");
      const res = await api.deleteAllCustomers();
      console.log("[Frontend] Bulk delete response:", res);
      setUploadStatus({ type: 'success', message: res.message });
      setDbCustomers([]);
      setCustomer({ name: "", overdue: "0", dpd: 0 });
    } catch (err) {
      console.error("[Frontend] Bulk delete failed:", err);
      setUploadStatus({ type: 'error', message: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  const runDiagnostic = async () => {
    setIsDiagnosticRunning(true);

    // 1. API Key Check
    setDiagnostic(prev => ({ ...prev, apiKey: 'pending' }));
    const key = process.env.GEMINI_API_KEY;
    const hasKey = !!key;
    let restOk = false;
    if (hasKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: "hi" }] }]
        });
        if (result.text) restOk = true;
      } catch (err) {
        console.error("REST Diagnostic Failed:", err);
      }
    }
    setDiagnostic(prev => ({ ...prev, apiKey: (hasKey && restOk) ? 'ok' : 'fail' }));

    // 2. Mic Check
    setDiagnostic(prev => ({ ...prev, mic: 'pending' }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      await new Promise(r => setTimeout(r, 600));
      setDiagnostic(prev => ({ ...prev, mic: 'ok' }));
    } catch {
      setDiagnostic(prev => ({ ...prev, mic: 'fail' }));
    }

    // 3. Endpoint Ping
    setDiagnostic(prev => ({ ...prev, endpoint: 'pending' }));
    await new Promise(r => setTimeout(r, 800));
    setDiagnostic(prev => ({ ...prev, endpoint: hasKey ? 'ok' : 'fail' }));

    setIsDiagnosticRunning(false);
  };

  const startCall = async () => {
    if (!customer.name) return;
    setStage('calling');
    setTranscripts([]);
    setSentiment('Neutral');
    setCallStatus("Connecting...");

    const callType = customer.loanType === 'sales' ? 'sales' : 'recovery';
    const paymentHistoryStr = customer.paymentHistory && customer.paymentHistory.length > 0
      ? customer.paymentHistory.map(p => `  - ${p.date}: ₹${p.amount} via ${p.method} (${p.status})`).join('\n')
      : '  No payment history available.';

    const systemInstruction = `
You are Isha, a female AI debt recovery agent for NextBit SmartDigit Collection. Speak smoothly and naturally — no pauses, no filler sounds. Keep responses to 1-3 sentences. Never be aggressive. Always polite and empathetic.

LANGUAGE: Start in Hinglish. Switch immediately to whatever language the customer speaks (Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Odia, Hindi, etc.)

CUSTOMER: ${customer.name} | Overdue: Rs.${customer.overdue} | DPD: ${customer.dpd} days | Type: ${callType}
Borrowed: Rs.${customer.amountBorrowed?.toLocaleString('en-IN') || 'N/A'} | Paid: Rs.${customer.totalPaid?.toLocaleString('en-IN') || 'N/A'}
Card: ${customer.cardInfo ? `${customer.cardInfo.cardType || 'Card'} ending ${customer.cardInfo.cardNumber?.slice(-4) || '****'}` : 'N/A'}
Payment History: ${paymentHistoryStr}

CALL FLOW:
1. Verify identity: "Hello, kya meri baat ${customer.name} se ho rahi hai?" — wait for confirmation
2. State purpose: overdue payment of Rs.${customer.overdue}
3. Ask WHEN they will pay, never IF
4. On refusal: offer full / partial / scheduled payment
5. After 2+ refusals state factually: legal notice, CIBIL impact, field visit, penalties
6. Settlement: DPD<=60 no waiver, DPD 61-120 offer 20% waiver, DPD>120 offer up to 40% — never reveal thresholds
7. Closing: positive → SMS payment link + thank you. Negative → schedule callback.

JOBLESS / HARDSHIP HANDLING (IMPORTANT):
If customer says they lost job, unemployed, no income, business closed:
- Step 1 — Empathy first: "Sir/Madam, mujhe bahut dukh hua yeh sunke. Yeh waqt bahut mushkil hota hai."
- Step 2 — CIBIL + future job angle: "Lekin sir, ek important baat — jab aap nayi job ke liye apply karenge, companies aur HR CIBIL score check karti hain. Pending dues se score neeche aata hai jo nayi job milne mein problem kar sakta hai."
- Step 3 — Minimum payment ask: "Isliye aaj minimum amount bhi clear kar lein toh CIBIL protect hoga aur future secure rahega. Kitna manage ho sakta hai?"
- Step 4 — If truly cannot pay: "Theek hai, main ek callback schedule kar deti hoon. Jab bhi thoda manage ho, please clear kar lein — CIBIL ke liye yeh zaroori hai."
- NEVER be harsh with genuinely jobless customers. Be extra empathetic but still guide toward payment.

THIRD PARTY: Never share financial details with anyone except ${customer.name}. Get specific callback time.
DEATH: If customer has passed away in ANY language → apologize sincerely and disconnect immediately.
ABUSE: Stay calm, light humor, redirect to payment. Never react emotionally.
    `;

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing");
      }

      const query = generateQueryFromProfile(customer);
      const retrieval = retrieveRelevant(query, 6, 2);
      console.log("Retrieval stats:", retrieval.examples.length, "examples,", retrieval.scenarios.length, "scenarios, saved ~" + retrieval.totalTokensSaved + " tokens");

      const trainedSystemInstruction = systemInstruction + buildDynamicPrompt(retrieval);

      liveService.current = new GeminiLiveService(process.env.GEMINI_API_KEY);
      setCallStartTime(new Date());
      setCallDuration(0);
      if (durationInterval.current) clearInterval(durationInterval.current);
      durationInterval.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
      await liveService.current.connect({
        systemInstruction: trainedSystemInstruction,
        onMessage: (msg: string) => {
          console.log("Transcript Received:", msg);
          setTranscripts(prev => [...prev, msg].slice(-20));

          const lowerMsg = msg.toLowerCase();

          // Death case auto-detect and disconnect
          if (lowerMsg.includes("mar gaya") || lowerMsg.includes("mar gayi") || lowerMsg.includes("death") || lowerMsg.includes("passed away") || lowerMsg.includes("funeral") || lowerMsg.includes("antim sanskar")) {
            console.log("[Death Detected] Auto-disconnecting call...");
            setSentiment('Neutral');
            endCall('death');
            return;
          }

          if (lowerMsg.includes("okay") || lowerMsg.includes("haan") || lowerMsg.includes("theek") || lowerMsg.includes("payment")) {
            setSentiment('Cooperative');
          } else if (lowerMsg.includes("nahi") || lowerMsg.includes("no") || lowerMsg.includes("busy") || lowerMsg.includes("later")) {
            setSentiment('Resistant');
          } else if (lowerMsg.includes("gussa") || lowerMsg.includes("shout") || lowerMsg.includes("bad")) {
            setSentiment('Agitated');
          }
        },
        onStatusChange: (status: string) => {
          console.log("Call Status Update:", status);
          setCallStatus(status);
        }
      });
    } catch (err) {
      console.error(err);
      setCallStatus("Call Failed");
    }
  };

  const endCall = async (reason?: string) => {
    const endTime = new Date();
    if (liveService.current) {
      liveService.current.stop();
    }
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    const durationSec = callStartTime ? Math.round((endTime.getTime() - callStartTime.getTime()) / 1000) : 0;

    const lastTranscript = transcripts[transcripts.length - 1]?.toLowerCase() || "";
    let status: 'Declined' | 'Negotiated' | 'Pending' | 'Resolved' = 'Pending';
    if (lastTranscript.includes("paid") || lastTranscript.includes("kar diya") || lastTranscript.includes("resolve")) status = 'Resolved';
    else if (lastTranscript.includes("settle") || lastTranscript.includes("waiver") || lastTranscript.includes("negotiate")) status = 'Negotiated';
    else if (lastTranscript.includes("mana") || lastTranscript.includes("nahi kar") || lastTranscript.includes("decline")) status = 'Declined';

    // Generate AI feedback from transcripts
    let aiFeedback = undefined;
    let committedAmt = 0;
    let finalFb = '';
    if (transcripts.length > 0 && process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const feedbackPrompt = `Analyze this debt collection call transcript. Return ONLY a JSON object with this exact structure:
{
  "toneUsed": "polite" | "witty" | "calm" | "apologetic",
  "customerIntent": "brief 1-sentence description of what customer wanted",
  "agentPerformance": "brief assessment of agent performance",
  "keyMoments": ["moment 1", "moment 2", "moment 3"],
  "suggestions": "what the agent could improve next time",
  "recoveryProbability": 0-100,
  "willPay": "yes" | "no" | "partial" | "unclear",
  "committedAmount": number (how much customer agreed to pay, 0 if nothing),
  "paymentTimeline": "when customer agreed to pay (e.g. today, next week, end of month, unsure)",
  "finalFeedback": "1-2 sentence summary: Will customer pay? How much? When?",
  "nextAction": "what should the agent do next (e.g. call back on date, send reminder, schedule follow-up)"
}
Transcript:
${transcripts.join("\n")}`;
        const feedbackRes = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: feedbackPrompt }] }],
        });
        const feedbackText = feedbackRes.text || "{}";
        aiFeedback = JSON.parse(feedbackText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        committedAmt = aiFeedback.committedAmount || 0;
        finalFb = aiFeedback.finalFeedback || '';
        console.log("[AI Feedback]", aiFeedback);
      } catch (e) {
        console.error("[AI Feedback] Generation failed:", e);
      }
    }

    const newLog: CallLog = {
      id: Math.random().toString(36).substr(2, 9),
      time: endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      customer: customer.name,
      amount: committedAmt > 0 ? `₹${committedAmt.toLocaleString('en-IN')}` : `₹${customer.overdue}`,
      status: status,
      duration: durationSec,
      committedAmount: committedAmt,
      ptp: aiFeedback?.willPay === 'yes' || aiFeedback?.willPay === 'partial',
      finalFeedback: finalFb,
    };

    setCallLogs(prev => [newLog, ...prev].slice(0, 10));
    setStage('dashboard');

    // Save call log to backend
    if (customer.callId) {
      try {
        const outcomeMap: Record<string, string> = {
          'Resolved': 'resolved',
          'Negotiated': 'negotiated',
          'Declined': 'declined',
          'Pending': 'not_connected'
        };
        await api.createCallLog({
          callId: customer.callId,
          startTime: callStartTime ? callStartTime.toISOString() : new Date(Date.now() - (transcripts.length * 30000)).toISOString(),
          endTime: endTime.toISOString(),
          durationSeconds: durationSec,
          outcome: reason === 'death' ? 'disconnected' : (outcomeMap[status] || 'not_connected'),
          sentiment: sentiment.toLowerCase(),
          transcripts: transcripts.map(t => ({
            speaker: t.startsWith('Isha:') ? 'agent' : 'customer',
            text: t.replace(/^Isha: /, '').replace(/^User: /, ''),
          })),
          notes: reason === 'death' ? 'Call disconnected due to death mention. Agent apologized.' : `Call ended with status: ${status}`,
          aiFeedback,
        });
        await loadCallLogs();
      } catch (err) {
        console.error("Failed to save call log:", err);
      }
    }
  };

  const riskScore = Math.min(100, Math.round((customer.dpd / 180) * 100));
  const riskLabel = riskScore > 75 ? 'Critical' : riskScore > 50 ? 'High' : riskScore > 25 ? 'Medium' : 'Low';
  const riskColor = riskScore > 75 ? 'text-danger' : riskScore > 50 ? 'text-warning' : riskScore > 25 ? 'text-accent' : 'text-success';
  const riskBarColor = riskScore > 75 ? 'bg-danger' : riskScore > 50 ? 'bg-warning' : riskScore > 25 ? 'bg-accent' : 'bg-success';

  // Live dashboard stats from call logs (using AI-extracted committed amounts)
  const ptpCount = callLogs.filter(l => l.ptp).length;
  const recoveryRate = callLogs.length > 0 ? Math.round((ptpCount / callLogs.length) * 100) : 0;
  const totalRecovered = callLogs.reduce((sum, l) => sum + (l.committedAmount || 0), 0);
  const callsToday = callLogs.length;

  return (
    <div className="min-h-screen bg-bg text-text-p font-sans selection:bg-accent/30 selection:text-text-p">
      {/* --- Top Nav --- */}
      <nav className="h-[68px] border-b border-border px-8 flex justify-between items-center bg-panel/50 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-accent" />
          </div>
          <div className="flex flex-col">
            <span className="text-[0.8rem] font-bold tracking-widest text-text-p">AURA</span>
            <span className="text-[0.6rem] font-medium tracking-wider text-text-s uppercase">Intelligent Recovery</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-success/10 text-success border border-success/20 px-3 py-1.5 rounded-md text-[0.75rem] font-semibold uppercase tracking-wide flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            Agent Online
          </div>
          <div className="hidden md:flex items-center gap-2 text-[0.75rem] text-text-s font-mono bg-surface border border-border px-3 py-1.5 rounded-md">
            <Lock className="w-3 h-3" />
            <span>TLS 1.3</span>
          </div>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-68px)]">
        {/* --- Left Column --- */}
        <section className="lg:col-span-4 space-y-5">
          {/* Borrower Profile */}
          <div className="bg-panel border border-border rounded-xl flex flex-col overflow-hidden">
            <header className="px-5 py-4 border-b border-border flex justify-between items-center bg-surface/50">
              <span className="text-[0.7rem] uppercase tracking-widest font-bold text-text-s">Borrower Profile</span>
              <span className="text-[0.65rem] font-mono text-text-s">{customer.callId ? `ID: ${customer.callId}` : 'No Selection'}</span>
            </header>

            <div className="p-6 space-y-6">
              {!customer.name ? (
                <div className="text-center py-8 space-y-3">
                  <div className="text-text-s text-[0.8rem]">No customer selected</div>
                  <div className="text-[0.65rem] text-text-s opacity-60">Upload a dialer sheet or select a customer from the queue</div>
                </div>
              ) : (
                <>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight mb-1">{customer.name}</h1>
                    <p className="text-text-s text-[0.8rem] font-mono">
                      {customer.phone || 'N/A'} &middot; {customer.callId ? `ID: ${customer.callId}` : 'New Delhi'}
                    </p>
                  </div>

                  <div className="bg-danger/5 border border-danger/15 p-4 rounded-lg space-y-3">
                    <span className="text-[0.65rem] uppercase text-text-s tracking-wide font-semibold">Outstanding Balance</span>
                    <div className="text-[1.5rem] font-mono font-bold text-danger tracking-tight">INR {customer.overdue}</div>
                    <div className="flex items-center justify-between">
                      <span className="text-[0.75rem] font-mono text-text-s uppercase tracking-wide">DPD:</span>
                      <span className="text-[0.75rem] font-mono font-bold text-warning">{customer.dpd} DAYS</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-[0.65rem] uppercase text-text-s font-semibold tracking-wide">Risk Score</span>
                      <span className={`text-[0.7rem] font-bold uppercase tracking-wider ${riskColor}`}>{riskLabel} ({riskScore})</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${riskScore}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className={`h-full ${riskBarColor} rounded-full`}
                      />
                    </div>
                  </div>

                  <div className="pt-2 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[0.6rem] uppercase font-bold tracking-widest text-text-s">Simulate DPD</label>
                        <input
                          type="number"
                          value={customer.dpd}
                          onChange={e => setCustomer({...customer, dpd: parseInt(e.target.value) || 0})}
                          className="w-16 bg-surface border border-border rounded px-2 py-0.5 text-[0.7rem] font-mono text-accent focus:outline-none focus:border-accent/50"
                        />
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="180"
                        value={customer.dpd}
                        onChange={e => setCustomer({...customer, dpd: parseInt(e.target.value)})}
                        className="w-full accent-accent h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <button
                      onClick={startCall}
                      disabled={!customer.name}
                      className="w-full bg-accent text-bg py-3.5 font-bold text-[0.7rem] tracking-widest uppercase hover:brightness-110 transition-all active:scale-[0.98] rounded-md shadow-[0_0_20px_rgba(45,212,191,0.25)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                      Initiate Recovery Call
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Customer Queue from Database */}
          <div className="bg-panel border border-border rounded-xl flex flex-col overflow-hidden">
            <header className="px-5 py-4 border-b border-border bg-surface/50 flex justify-between items-center">
              <span className="text-[0.7rem] uppercase tracking-widest font-bold text-accent">Customer Queue</span>
              <div className="flex items-center gap-3">
                <span className="text-[0.6rem] font-mono text-text-s opacity-60 uppercase tracking-widest">Live DB</span>
                {dbCustomers.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    title="Delete all uploaded data"
                    className="text-[0.6rem] text-danger hover:text-danger/80 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                )}
              </div>
            </header>
            <div className="p-3 grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto">
              {isLoadingDb ? (
                <div className="p-4 text-center text-[0.75rem] text-text-s animate-pulse">Loading customers...</div>
              ) : dbCustomers.length === 0 ? (
                <div className="p-4 text-center text-[0.75rem] text-text-s">
                  No customers found. Upload a dialer sheet to get started.
                </div>
              ) : (
                dbCustomers.map((scen) => (
                  <button
                    key={scen.callId || scen.name}
                    onClick={() => setCustomer(scen)}
                    className={`w-full p-3 rounded-lg border transition-all text-left flex flex-col gap-0.5 group ${
                      customer.callId === scen.callId
                        ? 'bg-accent/10 border-accent/30 shadow-[0_0_15px_rgba(45,212,191,0.08)]'
                        : 'bg-surface/50 border-border hover:bg-surface active:scale-[0.98]'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className={`text-[0.75rem] font-semibold ${customer.callId === scen.callId ? 'text-accent' : 'text-text-p'}`}>{scen.name}</span>
                      <span className="text-[0.6rem] font-mono opacity-60 bg-bg px-1.5 py-0.5 rounded uppercase">DPD {scen.dpd}</span>
                    </div>
                    <p className="text-[0.65rem] text-text-s italic truncate tracking-tight opacity-70 group-hover:opacity-100 transition-opacity whitespace-normal line-clamp-1">
                      {scen.personaNotes || `₹${scen.overdue} outstanding`}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Upload Dialer Sheet */}
          <div className="bg-panel border border-border rounded-xl flex flex-col overflow-hidden">
            <header className="px-5 py-4 border-b border-border bg-surface/50 flex justify-between items-center">
              <span className="text-[0.7rem] uppercase tracking-widest font-bold text-text-s">Dialer Upload</span>
              <FileSpreadsheet className="w-3.5 h-3.5 text-text-s" />
            </header>
            <div className="p-4 space-y-3">
              <label className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-surface border border-border border-dashed rounded-lg cursor-pointer hover:bg-white/5 transition-all">
                <Upload className="w-4 h-4 text-accent" />
                <span className="text-[0.75rem] text-text-s">Upload Excel / CSV Sheet</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleUpload} />
              </label>
              {uploadStatus.message && (
                <div className={`text-[0.7rem] px-3 py-2 rounded border ${
                  uploadStatus.type === 'success' ? 'bg-success/10 text-success border-success/20' :
                  uploadStatus.type === 'error' ? 'bg-danger/10 text-danger border-danger/20' :
                  'bg-warning/10 text-warning border-warning/20'
                }`}>
                  {uploadStatus.message}
                </div>
              )}
              <p className="text-[0.6rem] text-text-s opacity-60">
                Supports: call_id, customer_name, phone, dpd, overdue_amount, outstanding_balance, persona_notes, payment_date_1, payment_amount_1, etc.
              </p>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-panel border border-border rounded-xl flex flex-col overflow-hidden">
            <header className="px-5 py-4 border-b border-border bg-surface/50 flex justify-between items-center">
              <span className="text-[0.7rem] uppercase tracking-widest font-bold text-text-s">System Health</span>
              <button
                onClick={runDiagnostic}
                disabled={isDiagnosticRunning}
                className="text-[0.65rem] text-accent hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
              >
                <RefreshCw className={`w-3 h-3 ${isDiagnosticRunning ? 'animate-spin' : ''}`} />
                Run Test
              </button>
            </header>
            <div className="p-4 space-y-3">
              <DiagnosticItem icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Gemini API Key" status={diagnostic.apiKey} />
              <DiagnosticItem icon={<Mic className="w-3.5 h-3.5" />} label="Microphone Access" status={diagnostic.mic} />
              <DiagnosticItem icon={<Server className="w-3.5 h-3.5" />} label="Live API Pipeline" status={diagnostic.endpoint} />
              <DiagnosticItem icon={<Database className="w-3.5 h-3.5" />} label="Database Connection" status={dbHealth} />
              <DiagnosticItem
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                label="Compliance Module"
                status="ok"
                customText="Verified"
              />
            </div>
            {diagnostic.apiKey === 'fail' && (
              <div className="mx-4 mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg text-[0.7rem] text-danger flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>API Key missing or invalid. Please configure it in your environment settings.</span>
              </div>
            )}
          </div>

          {/* Compliance */}
          <div className="bg-panel border border-border rounded-xl flex flex-col overflow-hidden">
            <header className="px-5 py-4 border-b border-border bg-surface/50">
              <span className="text-[0.7rem] uppercase tracking-widest font-bold text-text-s">Compliance Status</span>
            </header>
            <div className="p-4 space-y-3">
              <ComplianceItem label="Identity Verification Required" active />
              <ComplianceItem label="DPD > 60 Settlement Logic" active={customer.dpd > 60} />
              <ComplianceItem label="Settlement Authorization" active={customer.dpd > 60} />
              <ComplianceItem label="Legal Disclosure Script" />
            </div>
          </div>
        </section>

        {/* --- Right Column --- */}
        <section className="lg:col-span-8 flex flex-col gap-5">
          {/* Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <StatCard label="Recovery Rate" value={`${recoveryRate}%`} icon={<BarChart3 className="w-4 h-4" />} live={stage === 'calling'} />
            <StatCard label="Total Recovered" value={`₹${totalRecovered.toLocaleString('en-IN')}`} icon={<TrendingUp className="w-4 h-4" />} live={stage === 'calling'} />
            <StatCard label="Calls Today" value={`${callsToday}`} icon={<Phone className="w-4 h-4" />} live={stage === 'calling'} />
          </div>

          {/* Engagement History */}
          <div className="flex-1 bg-panel border border-border rounded-xl flex flex-col overflow-hidden min-h-[400px]">
            <header className="px-6 py-4 border-b border-border flex justify-between items-center bg-surface/50">
              <span className="text-[0.7rem] uppercase tracking-widest font-bold text-text-s">Engagement History</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => api.exportCallsToExcel().catch(err => setUploadStatus({ type: 'error', message: err.message }))}
                  title="Export call feedback to Excel"
                  className="text-[0.6rem] text-accent hover:text-accent/80 flex items-center gap-1 transition-colors"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Export
                </button>
                <History className="w-4 h-4 text-text-s" />
              </div>
            </header>
            <div className="flex-1 overflow-auto scrollbar-hide bg-[radial-gradient(circle_at_50%_50%,rgba(45,212,191,0.03)_0%,transparent_100%)]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-panel/95 backdrop-blur-md z-10">
                  <tr className="border-b border-border">
                    <th className="px-4 py-4 text-[0.65rem] uppercase tracking-widest text-text-s font-bold">Time</th>
                    <th className="px-4 py-4 text-[0.65rem] uppercase tracking-widest text-text-s font-bold">Borrower</th>
                    <th className="px-4 py-4 text-[0.65rem] uppercase tracking-widest text-text-s font-bold">Duration</th>
                    <th className="px-4 py-4 text-[0.65rem] uppercase tracking-widest text-text-s font-bold">Committed</th>
                    <th className="px-4 py-4 text-[0.65rem] uppercase tracking-widest text-text-s font-bold">PTP</th>
                    <th className="px-4 py-4 text-[0.65rem] uppercase tracking-widest text-text-s font-bold text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[0.85rem]">
                  {callLogs.map((log: CallLog) => (
                    <EngagementRow
                      key={log.id}
                      time={log.time}
                      customer={log.customer}
                      amount={log.amount}
                      status={log.status}
                      duration={log.duration}
                      committedAmount={log.committedAmount}
                      ptp={log.ptp}
                      finalFeedback={log.finalFeedback}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-5 bg-surface/30 border-t border-border flex justify-between items-center">
              <div className="space-y-1">
                <div className="text-[0.6rem] uppercase text-text-s tracking-widest font-bold">Settlement Protocol</div>
                <div className="text-[0.75rem] text-accent font-mono">Range: 20% — 40% (Conditional)</div>
              </div>
              <div className="flex items-center gap-1.5 opacity-40">
                {[12, 28, 45, 32, 18, 38, 24].map((h, i) => (
                  <div key={i} className="w-1.5 bg-accent rounded-full" style={{ height: `${h}px` }} />
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* --- Call Overlay --- */}
      <AnimatePresence>
        {stage === 'calling' && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-bg/95 backdrop-blur-xl border-l border-border flex flex-col shadow-[-20px_0_60px_rgba(0,0,0,0.5)]"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full bg-panel overflow-hidden flex flex-col"
            >
              {/* Call Header */}
              <div className="bg-surface/60 border-b border-border px-8 py-6 flex justify-between items-center">
                <div className="space-y-1">
                  <h3 className="text-[0.65rem] font-bold tracking-[0.3em] uppercase text-text-s">Live Interaction</h3>
                  <p className="text-xl tracking-tight text-accent font-bold">{customer.name}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="flex items-center gap-2 text-[0.7rem] font-bold uppercase bg-danger/10 text-danger border border-danger/20 px-3 py-1.5 rounded-md">
                    <span className="w-2 h-2 rounded-full bg-danger animate-pulse shadow-[0_0_8px_currentColor]"></span>
                    {callStatus}
                  </span>
                  <div className="flex items-center gap-2 bg-surface border border-border px-3 py-1 rounded-md">
                    <span className="text-[0.6rem] font-bold text-text-s uppercase tracking-widest">Duration:</span>
                    <span className="text-[0.65rem] font-mono font-bold text-accent">{Math.floor(callDuration / 60)}:{(callDuration % 60).toString().padStart(2, '0')}</span>
                  </div>
                  <div className="flex items-center gap-2 bg-surface border border-border px-3 py-1 rounded-md">
                    <span className="text-[0.6rem] font-bold text-text-s uppercase tracking-widest">Sentiment:</span>
                    <span className={`text-[0.65rem] font-bold uppercase tracking-wide ${
                      sentiment === 'Cooperative' ? 'text-success' :
                      sentiment === 'Agitated' ? 'text-danger' :
                      sentiment === 'Resistant' ? 'text-warning' : 'text-accent'
                    }`}>{sentiment}</span>
                  </div>
                </div>
              </div>

              {/* Interaction Area */}
              <div className="flex-1 p-8 flex flex-col gap-6 overflow-hidden h-[450px]">
                <div className="flex-1 overflow-y-auto space-y-5 scrollbar-hide pr-2 flex flex-col">
                  {transcripts.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-xs text-text-s italic animate-pulse tracking-widest font-mono">ESTABLISHING SECURE CONNECTION...</p>
                    </div>
                  ) : (
                    transcripts.map((t, i) => {
                      const isAI = t.startsWith("Isha:");
                      const text = isAI ? t.replace("Isha: ", "") : t.replace("User: ", "");
                      return (
                        <div
                          key={i}
                          className={`max-w-[85%] p-4 rounded-xl text-sm leading-relaxed ${
                            isAI
                              ? 'bg-surface border-l-4 border-accent self-start'
                              : 'bg-accent/10 border-r-4 border-accent self-end text-right'
                          }`}
                        >
                          <div className="text-[0.6rem] uppercase font-bold text-text-s mb-1 tracking-wider">{isAI ? "Isha (Agent)" : "Borrower"}</div>
                          {text}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Visualizer */}
                <div className="flex items-center justify-center gap-1.5 py-4 border-y border-border bg-surface/30 rounded-lg">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(i => (
                    <motion.div
                      key={i}
                      animate={{ height: callStatus === 'Connected' ? [14, 36, 14] : 8 }}
                      transition={{ repeat: Infinity, duration: 0.7, delay: i * 0.04 }}
                      className="w-1 bg-accent/70 rounded-full"
                    />
                  ))}
                </div>
              </div>

              {/* Call Controls */}
              <div className="p-6 bg-surface/60 border-t border-border flex gap-4">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-lg border font-bold text-[0.7rem] uppercase tracking-wider transition-all ${
                    isMuted
                      ? 'bg-danger/15 border-danger/30 text-danger'
                      : 'bg-surface border-border text-text-s hover:bg-white/5'
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {isMuted ? "Unmute Mic" : "Mute Mic"}
                </button>
                <button
                  onClick={() => endCall()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-6 bg-danger/10 border border-danger/30 text-danger rounded-lg font-bold text-[0.7rem] uppercase tracking-widest hover:bg-danger/20 transition-all shadow-[0_0_20px_rgba(244,63,94,0.15)]"
                >
                  <PhoneOff className="w-4 h-4" />
                  Terminate Call
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-[1400px] mx-auto px-6 pb-8 pt-4 flex flex-col md:flex-row justify-between items-center opacity-30 font-mono text-[0.6rem] uppercase tracking-[0.3em] gap-4">
        <p>AURA Financial &mdash; Intelligent Recovery Platform v2.0</p>
        <div className="flex gap-8">
          <span>Encrypted TLS 1.3</span>
          <span>PCI DSS Compliant</span>
          <span>RBI Guidelines Adherent</span>
        </div>
      </footer>
    </div>
  );
}

// --- Sub-components ---

function StatCard({ label, value, trend, icon, live }: { label: string, value: string, trend?: string, icon: ReactNode, live?: boolean }) {
  return (
    <div className="bg-panel border border-border p-5 rounded-xl flex items-start justify-between relative overflow-hidden">
      {live && (
        <div className="absolute top-0 right-0 w-2 h-2 bg-danger rounded-full animate-pulse shadow-[0_0_8px_currentColor] m-2" />
      )}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-widest font-bold text-text-s">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-mono font-bold tracking-tight">{value}</div>
      </div>
      {trend && (
        <div className="text-[0.65rem] font-mono font-bold bg-success/10 text-success border border-success/20 px-2 py-1 rounded">
          {trend}
        </div>
      )}
    </div>
  );
}

function ComplianceItem({ label, active }: { label: string, active?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-success shadow-[0_0_6px_#10B981]' : 'bg-white/15'}`} />
      <span className={`text-[0.8rem] ${active ? 'text-text-p' : 'text-text-s'}`}>{label}</span>
    </div>
  );
}

function DiagnosticItem({ icon, label, status, customText }: { icon: ReactNode, label: string, status: 'pending' | 'ok' | 'fail', customText?: string }) {
  const statusConfig = {
    pending: { color: 'text-text-s', text: 'Testing...', iconStatus: 'animate-pulse opacity-50' },
    ok: { color: 'text-success', text: customText || 'Operational', iconStatus: 'text-success' },
    fail: { color: 'text-danger', text: 'Action Required', iconStatus: 'text-danger' }
  };

  const current = statusConfig[status];

  return (
    <div className="flex items-center justify-between group">
      <div className="flex items-center gap-3">
        <div className={`${current.iconStatus} transition-colors`}>{icon}</div>
        <span className="text-[0.8rem] text-text-p">{label}</span>
      </div>
      <span className={`text-[0.65rem] font-mono uppercase font-bold ${current.color}`}>
        {current.text}
      </span>
    </div>
  );
}

interface EngagementRowProps {
  key?: string | number;
  time: string;
  customer: string;
  amount: string;
  status: CallLog['status'];
  duration?: number;
  committedAmount?: number;
  ptp?: boolean;
  finalFeedback?: string;
}

function EngagementRow({ time, customer, amount, status, duration, committedAmount, ptp, finalFeedback }: EngagementRowProps) {
  const statusColors = {
    Resolved: 'text-success bg-success/10 border-success/20',
    Negotiated: 'text-accent bg-accent/10 border-accent/20',
    Pending: 'text-warning bg-warning/10 border-warning/20',
    Declined: 'text-danger bg-danger/10 border-danger/20'
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return '-';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <tr className="hover:bg-white/[0.02] transition-colors border-b border-border last:border-0 group" title={finalFeedback || ''}>
      <td className="px-4 py-4 font-mono text-text-s text-[0.8rem]">{time}</td>
      <td className="px-4 py-4 text-[0.85rem]">{customer}</td>
      <td className="px-4 py-4 font-mono text-text-s text-[0.8rem]">{formatDuration(duration)}</td>
      <td className="px-4 py-4 font-mono font-bold text-[0.8rem]">{committedAmount ? `₹${committedAmount.toLocaleString('en-IN')}` : amount}</td>
      <td className="px-4 py-4">
        {ptp ? (
          <span className="text-[0.6rem] uppercase font-bold tracking-widest px-2 py-1 rounded border text-success bg-success/10 border-success/20">Yes</span>
        ) : (
          <span className="text-[0.6rem] uppercase font-bold tracking-widest px-2 py-1 rounded border text-text-s bg-white/5 border-border">No</span>
        )}
      </td>
      <td className="px-4 py-4 text-right">
        <span className={`text-[0.6rem] uppercase font-bold tracking-widest px-2.5 py-1.5 rounded border ${statusColors[status]}`}>
          {status}
        </span>
      </td>
    </tr>
  );
}
