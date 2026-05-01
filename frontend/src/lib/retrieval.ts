import dataset from "../data/collectionDataset.json";
import type { Dataset, TrainingExample, CallScenario } from "./training";

const data: Dataset = dataset as unknown as Dataset;

export interface IndexedExample extends TrainingExample {
  docId: number;
  tokens: string[];
}

export interface IndexedScenario extends CallScenario {
  docId: number;
  tokens: string[];
}

export interface RetrievalResult {
  examples: IndexedExample[];
  scenarios: IndexedScenario[];
  totalTokensSaved: number;
}

// Stopwords to ignore in both Hindi and English
const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","must","shall","can","need","dare","ought","used","to","of","in","for","on","with","at","by","from","as","into","through","during","before","after","above","below","between","under","again","further","then","once","here","there","when","where","why","how","all","each","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","just","and","but","if","or","because","until","while","what","which","who","whom","this","that","these","those","am","it","its","itself","they","them","their","theirs","themselves","you","your","yours","yourself","yourselves","he","him","his","himself","she","her","hers","herself","we","us","our","ours","ourselves","i","me","my","myself","mine",
  "main","mera","mein","hoon","hai","hain","tha","thi","the","ho","ga","gi","ge","ka","ki","ke","ko","se","par","tak","bhi","aur","ya","lekin","magar","kyunki","jab","tak","agar","toh","hi","ne","ki","ne","nahi","na","kuch","koi","sab","bahut","zyada","kam","yeh","woh","yahan","wahan","idhar","udhar","abhi","pehle","baad","aaj","kal","din","raat","baar","ek","do","teen"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\u0900-\u097Fa-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function buildExampleIndex(): IndexedExample[] {
  return data.examples.map((ex, idx) => ({
    ...ex,
    docId: idx,
    tokens: tokenize(ex.intent + " " + ex.customer + " " + ex.agent),
  }));
}

function buildScenarioIndex(): IndexedScenario[] {
  return data.scenarios.map((sc, idx) => {
    const conversationText = sc.conversation.map((t) => t.text).join(" ");
    return {
      ...sc,
      docId: idx + 10000, // offset to avoid collision
      tokens: tokenize(sc.outcome + " " + sc.notes + " " + conversationText),
    };
  });
}

// Inverse Document Frequency
function computeIdf(docs: { tokens: string[] }[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  const N = docs.length;

  for (const doc of docs) {
    const unique = new Set(doc.tokens);
    for (const term of unique) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, freq] of docFreq) {
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }
  return idf;
}

// BM25-lite scoring
function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  idf: Map<string, number>,
  k1 = 1.5,
  b = 0.75
): number {
  const docLen = docTokens.length;
  const avgDocLen = 20; // approximate average for our dataset
  const freqMap = new Map<string, number>();
  for (const t of docTokens) {
    freqMap.set(t, (freqMap.get(t) || 0) + 1);
  }

  let score = 0;
  for (const q of queryTokens) {
    const idfVal = idf.get(q) || 0;
    const f = freqMap.get(q) || 0;
    if (f === 0) continue;
    const numerator = f * (k1 + 1);
    const denominator = f + k1 * (1 - b + b * (docLen / avgDocLen));
    score += idfVal * (numerator / denominator);
  }
  return score;
}

// Intent-boosted scoring: if query explicitly mentions an intent, boost those docs
function intentBoostScore(
  queryTokens: string[],
  example: IndexedExample
): number {
  const intentSynonyms: Record<string, string[]> = {
    no_money: ["paisa", "paise", "money", "salary", "fund", "financial", "paise", "paisa", "nahi", "nahi hai", "empty", "zero"],
    call_later: ["baad", "later", "busy", "meeting", "call", "baadmein", "time nahi", "abhi nahi"],
    angry: ["gussa", "angry", "disturb", "harassment", "irritate", "baarbaar", "abuse", "galiya", "bevakoof", "pagal", "chu", "bhosd", "madarch", "chutiya", "gaali", "shut up", "chup"],
    negotiation: ["partial", "installment", "kam", "negotiate", "settlement", "waiver", "time", "aadha", "thoda", "kuch", "percent"],
    refuse: ["nahi", "refuse", "mana", "interest", "kuch", "paynahi", "nahi dunga", "matlab nahi", "case", "legal", "court"],
    delay: ["delay", "week", "month", "din", "baad", "time", "kal", "next", "baadmein", "thoda", "time", "date", "baad mein"],
    paid: ["paid", "pay", "kiya", "kar", "transaction", "verify", "haan", "thik hai", "batao", "kaise", "ready", "karunga"],
    confirmation: ["aaj", "kal", "try", "confirm", "commitment", "promise", "pakka", "fix", "lock"],
    payment_push: ["link", "payment", "complete", "abhi", "now", "immediately", "aaj", "done"],
    urgency: ["urgent", "charges", "extra", "complications", "abhi", "warning", "cibil", "score"],
    closing: ["bye", "thank", "shubh", "update", "dhanyawaad", "done", "complete"],
    jobless_hardship: ["job", "naukri", "unemployed", "kaam nahi", "job gayi", "job chali", "business band", "income nahi", "jobless", "fired", "layoff", "nikala", "nikali", "ghar baitha", "berozgar", "rozgar nahi", "paisa nahi job", "kuch nahi chal raha"],
    third_party_answered: ["pati", "husband", "wife", "bhai", "sister", "roommate", "cousin", "relative", "family", "kaun", "who", "speaking", "bol raha", "unka", "unki"],
    customer_unavailable: ["ghar nahi", "bahar", "available nahi", "nahi hain", "so rahe", "kaam par", "unavailable"],
    callback_scheduling: ["kal call", "subah call", "shaam call", "callback", "schedule", "morning", "evening", "tomorrow"],
    customer_abroad: ["bahar desh", "foreign", "abroad", "kuwait", "dubai", "gulf", "out of country"],
    deceased_customer: ["nahi rahe", "mar gaye", "intekaal", "death", "passed away", "deceased"],
  };

  let boost = 0;
  const synonyms = intentSynonyms[example.intent] || [];
  for (const token of queryTokens) {
    if (example.intent.includes(token)) boost += 3;
    if (synonyms.some((s) => token.includes(s) || s.includes(token))) boost += 1.5;
  }
  return boost;
}

export function retrieveRelevant(
  query: string,
  topKExamples = 6,
  topKScenarios = 2
): RetrievalResult {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { examples: [], scenarios: [], totalTokensSaved: 0 };
  }

  const exampleDocs = buildExampleIndex();
  const scenarioDocs = buildScenarioIndex();

  const exampleIdf = computeIdf(exampleDocs);
  const scenarioIdf = computeIdf(scenarioDocs);

  // Score and rank examples
  const scoredExamples = exampleDocs.map((doc) => {
    const bm25 = bm25Score(queryTokens, doc.tokens, exampleIdf);
    const intentBoost = intentBoostScore(queryTokens, doc);
    return { doc, score: bm25 + intentBoost };
  });

  scoredExamples.sort((a, b) => b.score - a.score);

  // Deduplicate by intent: keep top 2 per intent
  const intentCount = new Map<string, number>();
  const selectedExamples: IndexedExample[] = [];
  for (const { doc } of scoredExamples) {
    const count = intentCount.get(doc.intent) || 0;
    if (count < 2 && selectedExamples.length < topKExamples) {
      selectedExamples.push(doc);
      intentCount.set(doc.intent, count + 1);
    }
  }

  // Score and rank scenarios
  const scoredScenarios = scenarioDocs.map((doc) => {
    const score = bm25Score(queryTokens, doc.tokens, scenarioIdf);
    return { doc, score };
  });

  scoredScenarios.sort((a, b) => b.score - a.score);
  const selectedScenarios = scoredScenarios
    .slice(0, topKScenarios)
    .map((s) => s.doc);

  // Estimate token savings
  const fullExampleTokens = exampleDocs.length * 40; // ~40 tokens per example
  const retrievedExampleTokens = selectedExamples.length * 40;
  const saved = fullExampleTokens - retrievedExampleTokens;

  return {
    examples: selectedExamples,
    scenarios: selectedScenarios,
    totalTokensSaved: Math.max(0, saved),
  };
}

export function generateQueryFromProfile(profile: {
  name: string;
  overdue: string;
  dpd: number;
  personaNotes?: string;
}): string {
  const parts: string[] = [];
  if (profile.personaNotes) {
    parts.push(profile.personaNotes);
  }
  if (profile.dpd > 90) {
    parts.push("refuse angry abusive negotiation settlement waiver high dpd nahi dunga gussa");
  } else if (profile.dpd > 60) {
    parts.push("delay partial installment time kal next week negotiation settlement");
  } else if (profile.dpd > 30) {
    parts.push("reminder confirmation paid willing haan thik hai delay kal");
  } else {
    parts.push("confirmation paid closing willing quick close haan ready");
  }
  return parts.join(" ");
}
