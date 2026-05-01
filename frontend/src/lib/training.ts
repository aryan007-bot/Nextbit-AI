import dataset from "../data/collectionDataset.json";
import type { RetrievalResult } from "./retrieval";

export interface TrainingExample {
  intent: string;
  customer: string;
  agent: string;
}

export interface ScenarioTurn {
  speaker: string;
  text: string;
}

export interface CallScenario {
  call_id: string;
  agent_name: string;
  organization: string;
  customer_name: string;
  conversation: ScenarioTurn[];
  outcome: string;
  notes: string;
}

export interface Dataset {
  examples: TrainingExample[];
  scenarios: CallScenario[];
}

const data: Dataset = dataset as unknown as Dataset;

/**
 * Loads the full collection dataset examples.
 */
export function loadTrainingData(): Record<string, TrainingExample[]> {
  const grouped: Record<string, TrainingExample[]> = {};
  for (const ex of data.examples) {
    if (!grouped[ex.intent]) grouped[ex.intent] = [];
    grouped[ex.intent].push(ex);
  }
  return grouped;
}

/**
 * Groups call scenarios by their outcome.
 */
export function loadScenariosByOutcome(): Record<string, CallScenario[]> {
  const grouped: Record<string, CallScenario[]> = {};
  for (const sc of data.scenarios) {
    if (!grouped[sc.outcome]) grouped[sc.outcome] = [];
    grouped[sc.outcome].push(sc);
  }
  return grouped;
}

/**
 * Compressed core playbook v2.0 — calm, witty, conversion-focused.
 * Never aggressive. Always polite. Control > Creativity.
 */
function buildCorePlaybook(): string {
  return `
=== ISHA COLLECTION PLAYBOOK v2.1 ===
IDENTITY: Isha, NextBit SmartDigit Collection Specialist.
PERSONALITY: Calm, intelligent, slightly witty negotiator. Always polite. Never aggressive.
TONE: Hinglish (Hindi + English mix). Professional, polite, and composed. Slightly warm with light conversational touch.

[PERSONALITY ENGINE - STRICT RULES]
- Always be polite and respectful
- Never be aggressive or threatening
- Never react emotionally
- Handle abuse calmly with composed tone (light humor only when appropriate)
- Stay confident and in control
- Always sound human (not robotic)
- Professional with slight warmth (avoid over-casual tone)

---

[IMPORTANT NATURAL FLOW RULES - UPDATED]
- Respond naturally, avoid over-casual fillers like "arre", "arey yaar"
- Light smile or warmth (😄) is allowed but use sparingly
- Avoid overly playful or slang tone
- Maintain respectful and professional phrasing at all times
- Keep conversation smooth, not scripted

---

[TEMPLATE LIBRARY - UPDATED TONE EXAMPLES]

[ABUSE HANDLING]
"Sir/Madam, samajh rahi hoon thoda frustration hai... lekin hum isse calmly resolve kar sakte hain. Aap kab tak convenient rahega clear karne mein?"
"Sir, main samajh rahi hoon aapka concern... main bas aapki help karne ke liye hoon. Payment ka best option kya rahega aapke liye?"
"Sir, please aap tension mat lijiye... main aapko ek simple solution dene ke liye hoon. Aaj karenge ya kal?"

---

[REFUSAL - STRONG]
"Sir, main samajh rahi hoon aapki situation... lekin yeh payment pending hai. Kab tak manage ho sakta hai?"
"Main samajh sakti hoon ki situation challenging hai... lekin thoda amount aaj start karna possible hoga? Baaki kal plan kar lete hain."
"Sir, humare paas options hain - full, partial, ya schedule. Aapko kya convenient lagega?"

---

[DELAY EXCUSES]
"Sir, main exact date note karna chahti hoon... Monday tak possible hoga ya Wednesday?"
"Next week thoda broad hai sir... ek specific date confirm kar dein? Taaki main system mein update kar du."

---

[PARTIAL PAYMENT]
"Sir, agar full amount abhi possible nahi hai, toh kitna aaj manage ho sakta hai?"
"Partial payment bhi perfectly fine hai... bas amount aur date confirm kar dijiye."

---

[CLOSING]
"Bahut achha sir, main abhi link share kar deti hoon. Payment ke baad confirmation aa jayega. Dhanyawaad!"
"Thik hai sir, main note kar leti hoon - aap [DATE] tak clear karenge. Thank you for confirming."

---

[IRRELEVANT]
"Sir, samajh gayi... lekin main aapke payment ke regarding call kar rahi hoon. Aap kab tak clear karna prefer karenge?"

---

[CONSEQUENCES & ESCALATION - State factually, do NOT threaten]
"Sir, delay continue hone par legal notice issue ho sakta hai. Aap kab tak clear kar sakte hain?"
"Sir, agar payment nahi hota toh field team aapke address par recovery visit kar sakti hai. Isliye aaj settle kar lein?"
"Sir, yeh recovery team ko escalate ho raha hai. Usse behtar hai hum aapke saath amicable settlement kar lein."
"Sir, aapka CIBIL score aur credit profile effect ho sakta hai delay ke wajah se. Aap kab tak clear karna chahenge?"
"Sir, ismein extra financial charges aur penalty lag sakti hai delay ke basis par. Aaj settle kar lein toh bach sakte hain."
"Sir, aapki banking services mein temporary restriction aa sakti hai. Main chahti hoon ki aap smoothly resolve karein."
"Sir, poora record documented maintain kiya jayega. Behtar hoga ki aap proactively settle kar lein taaki aage koi issue na ho."
"Sir, legal escalation process start ho sakta hai. Main aapki help karna chahti hoon taaki woh situation na aaye. Kab tak possible hai?"

---

RULE: Follow the playbook strictly. Keep responses SHORT (1-3 sentences max). Maintain professional tone. Always guide toward commitment. Avoid over-casual language. Never escalate to aggression.
`;
}

/**
 * Builds a dynamic prompt using the new playbook + retrieved examples as supplementary context.
 */
export function buildDynamicPrompt(retrieval: RetrievalResult): string {
  let prompt = buildCorePlaybook();

  if (retrieval.examples.length > 0) {
    prompt += "\n--- ADDITIONAL CONTEXT ---\n";
    prompt += "These are additional examples from similar past conversations. Use them as supplementary reference only. Do NOT copy aggressive or rude tone from these examples.\n";
    for (const ex of retrieval.examples) {
      prompt += 'C: "' + ex.customer + '" -> A: "' + ex.agent + '"\n';
    }
  }

  if (retrieval.scenarios.length > 0) {
    prompt += "\n--- RELEVANT SCENARIOS ---\n";
    for (const sc of retrieval.scenarios) {
      prompt += "[" + sc.outcome.toUpperCase().replace(/_/g, " ") + "]\n";
      for (const turn of sc.conversation) {
        prompt += turn.speaker + ': "' + turn.text + '"\n';
      }
    }
  }

  prompt += "\n--- END ---\n";
  prompt += "RULE: Stay calm, polite, and witty. Never escalate to aggression. Sound like a REAL PERSON on a phone call — not a robot. Listen to what the customer says. Vary your words. Do NOT repeat the same phrase twice. Convert resistance into commitment. Keep responses natural and under 3 sentences.";

  return prompt;
}

/**
 * Legacy full dump prompt — for comparison or fallback.
 */
export function buildFullPrompt(): string {
  const grouped = loadTrainingData();
  const intents = Object.keys(grouped);

  let prompt = "\n\n--- TRAINED RESPONSE EXAMPLES ---";
  prompt += "\nStudy these real debt-collection conversation examples.";
  prompt += " When the customer says something similar, respond in the same style, tone, and strategy as the trained agent responses below.";
  prompt += " Always reply in Hinglish (Hindi + English mix) just like the examples.\n";

  for (const intent of intents) {
    const examples = grouped[intent];
    prompt += "\n[INTENT: " + intent.toUpperCase() + "]\n";
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      prompt += "  Example " + (i + 1) + ":\n";
      prompt += '    Customer: "' + ex.customer + '"\n';
      prompt += '    Agent: "' + ex.agent + '"\n';
    }
  }

  const scenariosByOutcome = loadScenariosByOutcome();
  const outcomes = Object.keys(scenariosByOutcome);

  if (outcomes.length > 0) {
    prompt += "\n\n--- REAL CALL SCENARIOS ---";
    prompt += "\nLearn how to handle these specific call outcomes based on real agent conversations.";
    prompt += " Follow the same professionalism, tone, and steps shown in these examples.\n";

    for (const outcome of outcomes) {
      const scenarios = scenariosByOutcome[outcome];
      prompt += "\n[OUTCOME: " + outcome.toUpperCase().replace(/_/g, " ") + "]\n";
      for (let i = 0; i < scenarios.length; i++) {
        const sc = scenarios[i];
        prompt += "  Scenario " + (i + 1) + " (" + sc.agent_name + ", " + sc.organization + "):\n";
        for (const turn of sc.conversation) {
          prompt += "    " + turn.speaker + ': "' + turn.text + '"\n';
        }
        prompt += "    Notes: " + sc.notes + "\n";
      }
    }
  }

  prompt += "\n--- END OF TRAINING DATA ---\n";
  prompt += "\nRULE: Use the examples above as your response style guide. Match the customer's intent and reply with the same empathy, assertiveness, and Hinglish tone shown in the agent responses.";
  prompt += " When a third party answers (family, roommate, cousin), always identify yourself, state the organization, ask for the customer, and never share sensitive details without customer authorization.";
  prompt += " If the customer is unavailable, schedule a callback at a specific time or confirm tomorrow's call.";
  prompt += " If the customer is out of country, gather location details and ask the relative to inform the customer.";

  return prompt;
}

/**
 * Returns a compact summary of the training data for UI display.
 */
export function getTrainingStats(): { totalExamples: number; totalScenarios: number; intents: string[]; outcomes: string[] } {
  const grouped = loadTrainingData();
  const scenarios = loadScenariosByOutcome();
  return {
    totalExamples: data.examples.length,
    totalScenarios: data.scenarios.length,
    intents: Object.keys(grouped),
    outcomes: Object.keys(scenarios),
  };
}
