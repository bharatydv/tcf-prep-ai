
import axios from "axios";
// Use a relative path /api so it talks to the same domain (https://monfrançais.com/api)
const baseURL = "/api"; 
export const api = axios.create({ baseURL, withCredentials: true });
//const baseURL = "http://34.70.223.49:5000";
//https://xn--monfranais-u6a.com/api
//export const api = axios.create({ baseURL, withCredentials: true });

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

// POST + read an SSE stream (fetch-based, since EventSource is GET-only)
export async function streamAnalyze(payload, { onStage, onComplete, onError }) {
  const resp = await fetch(`${baseURL}/analyze/stream`, {
  //const resp = await fetch(`${baseURL}/api/analyze/stream`, {
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

// Aliases used across pages/components
export const errMsg = errorMessage;
export const CATEGORY_META = CATEGORIES;

// French accent toolbar characters
export const ACCENTS = ["é", "è", "ê", "ë", "à", "â", "ç", "î", "ï", "ô", "û", "ù", "ü", "œ", "«", "»", "’"];
