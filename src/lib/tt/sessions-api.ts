// Local-only session browser client. The backing endpoint retains the raw
// session id and local project path so the dashboard can offer one-click
// resume; it is never served from the cloud account view.
import { copy } from "./copy.ts";

const SLUG = "tokentracker-sessions";

export type SessionSource = "claude" | "codex" | "grok";

export interface SessionRow {
  session_hash: string;
  session_id: string | null;
  title: string | null;
  source: SessionSource;
  project_key: string;
  project_ref: string | null;
  model: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number;
  turns: number;
  edit_turns: number;
  retry_turns: number;
  subagent_calls: number;
  total_tokens: number;
  cost_usd: number;
  productive: boolean;
  first_pass: boolean;
  resume_command: string | null;
}

export interface SessionsResponse {
  from: string;
  to: string;
  available: boolean;
  session_count: number;
  returned_count: number;
  sessions: SessionRow[];
  provenance?: Record<string, unknown>;
  error?: string;
}

interface FetchOptions {
  from?: string;
  to?: string;
  limit?: number;
  refresh?: boolean;
}

// 本机 TokenTracker 数据代理（scripts/tt-local-proxy.mjs）：云端部署时浏览器
// 优先读取本机实时会话数据，代理未启动/不可用时回退到云端接口。
const LOCAL_PROXY_ORIGIN = "http://127.0.0.1:18788";
const LOCAL_PROXY_TIMEOUT_MS = 3000;

function isRemoteHost() {
  return (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  );
}

function buildSessionsUrl(origin: string, options: FetchOptions): URL {
  const url = new URL(`/functions/${SLUG}`, origin);
  if (options.from) url.searchParams.set("from", options.from);
  if (options.to) url.searchParams.set("to", options.to);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.refresh) url.searchParams.set("refresh", "1");
  return url;
}

async function readSessionsJson(url: URL, timeoutMs?: number): Promise<SessionsResponse> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const init: RequestInit = {
      headers: { Accept: "application/json" },
      cache: "no-store",
    };
    if (timer) init.signal = controller.signal;
    if (timeoutMs) {
      // Chrome 私有网络访问（PNA/LNA）：声明目标是环回地址，配合代理返回的
      // Access-Control-Allow-Private-Network: true，可避免额外的网络权限预检。
      (init as any).targetAddressSpace = "loopback";
    }
    const response = await fetch(url.toString(), init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      // A 404 here means the local server predates this endpoint — i.e. a desktop
      // app whose bundled EmbeddedServer is older than the dashboard it hosts.
      // "HTTP 404" tells the user nothing actionable; "update the app" does.
      const fallback =
        response.status === 404
          ? copy("sessions.error.outdated_app")
          : `Request failed with HTTP ${response.status}`;
      const err = new Error(payload?.error || fallback) as Error & {
        status?: number;
      };
      err.status = response.status;
      throw err;
    }
    return payload as SessionsResponse;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getSessions(options: FetchOptions = {}): Promise<SessionsResponse> {
  if (isRemoteHost()) {
    try {
      return await readSessionsJson(buildSessionsUrl(LOCAL_PROXY_ORIGIN, options), LOCAL_PROXY_TIMEOUT_MS);
    } catch {
      // 本机代理未启动/不可用 → 回退云端接口
    }
  }
  return readSessionsJson(buildSessionsUrl(window.location.origin, options));
}

