import axios from "axios";


// In production (GCP + Nginx), we use relative paths.
// This tells the browser to append the endpoint to the current domain: https://monfrançais.com/api/...
const baseURL = "/api"; 

export const api = axios.create({ 
  baseURL, 
  withCredentials: true 
});

// 👇 FIX: strips the duplicate /api from any call that already includes it.
// This means components calling '/api/dashboard/stats' AND '/dashboard/stats'
// will both correctly resolve to '/api/dashboard/stats'.
api.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith('/api/')) {
    config.url = config.url.slice(4); // remove the leading '/api'
  }
  return config;
});

// Exporting baseURL as BACKEND_URL for consistency
export const BACKEND_URL = baseURL;

// Turn FastAPI error shapes into a readable message
export function errorMessage(err, fallback = "Something went wrong") {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message || fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join("; ");
  }
  if (typeof detail === "object") return detail.msg || JSON.stringify(detail);
  return fallback;
}

export const CATEGORIES = {
  prepositions: { label: "Prépositions", color: "#FEF08A" },
  spelling: { label: "Orthographe", color: "#FECACA" },
  conjugation: { label: "Conjugaison", color: "#FED7AA" },
  gender_number: { label: "Accord en genre et nombre", color: "#BFDBFE" },
  anglicism: { label: "Anglicismes", color: "#E9D5FF" },
  improvement: { label: "Améliorations C1", color: "#BBF7D0" },
};

export const catLabel = (key) => CATEGORIES[key]?.label || key;
export const catColor = (key) => CATEGORIES[key]?.color || "#E5E7EB";

// POST + read an SSE stream
export async function streamAnalyze(payload, { onStage, onComplete, onError }) {
  // Use /analyze/stream because baseURL already includes /api
  const resp = await fetch(`${baseURL}/analyze/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  if (!resp.ok && resp.headers.get("content-type")?.includes("json")) {
    const data = await resp.json();
    onError?.(typeof data.detail === "string" ? data.detail : "Request failed", resp.status);
    return;
  }
  
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop();
    for (const chunk of events) {
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === "stage") onStage?.(parsed.stage);
      else if (event === "complete") onComplete?.(parsed);
      else if (event === "error") onError?.(parsed.detail, parsed.status);
    }
  }
}

export const errMsg = (err, defaultMsg) => {
  return err.response?.data?.detail || err.message || defaultMsg;
};
export const CATEGORY_META = CATEGORIES;
export const ACCENTS = ["é", "è", "ê", "ë", "à", "â", "ç", "î", "ï", "ô", "û", "ù", "ü", "œ", "«", "»", "'"];