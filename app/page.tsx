"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
  private: boolean;
  fork: boolean;
  archived: boolean;
  homepage: string | null;
  default_branch: string;
  watchers_count: number;
}

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  followers: number;
  following: number;
  bio: string | null;
  location: string | null;
  blog: string | null;
  twitter_username: string | null;
}

type Category = "product" | "project" | "experiment";
type SortOption = "score" | "stars" | "updated" | "name";
type FilterOption = "all" | Category | "showcase" | "private";

interface ScoreBreakdown {
  stars: number;
  activity: number;
  completeness: number;
  community: number;
  total: number;
}

interface AnalyzedRepo extends GitHubRepo {
  category: Category;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  showcaseRecommended: boolean;
  daysSincePush: number;
}

type AIStatus = "pending" | "analyzing" | "done" | "error";
type AICategory = "Product" | "Project" | "Experiment" | "Learning";

interface AIRepoReview {
  repoId: number;
  repoName: string;
  status: AIStatus;
  category: AICategory | null;
  aiScore: number | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  showcasePotential: "High" | "Medium" | "Low" | null;
  techStack: string[];
  error: string | null;
}

interface GeminiAIResult {
  category: AICategory;
  aiScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  showcasePotential: "High" | "Medium" | "Low";
  techStack: string[];
}

interface GitHubErrorResponse {
  message?: string;
}

type PageTab = "normal" | "ai";

// ═══════════════════════════════════════════════════════════════════
// GITHUB API
// ═══════════════════════════════════════════════════════════════════

async function parseGitHubError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as GitHubErrorResponse;
    const msg = body.message ?? res.statusText;
    if (res.status === 401) return new Error("Token is invalid or expired. Please generate a new token.");
    if (res.status === 403) return new Error("Access denied. Check your token permissions.");
    if (res.status === 404) return new Error("User not found. Please double-check the username.");
    if (res.status === 422) return new Error(`Validation error: ${msg}. Try regenerating your token.`);
    if (res.status === 429) return new Error("Rate limit hit. Please try again in a moment.");
    return new Error(`GitHub API error ${res.status}: ${msg}`);
  } catch {
    return new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }
}

function buildHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function fetchAllRepos(username: string, token: string): Promise<GitHubRepo[]> {
  const cleanToken = token.trim();
  const cleanUser = username.trim();
  if (!cleanUser) throw new Error("Please enter a GitHub username.");
  const headers = buildHeaders(cleanToken);
  const all: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/users/${cleanUser}/repos?per_page=100&page=${page}&type=all&sort=updated`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw await parseGitHubError(res);
    const batch = (await res.json()) as GitHubRepo[];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function fetchUser(username: string, token: string): Promise<GitHubUser> {
  const cleanToken = token.trim();
  const cleanUser = username.trim();
  if (!cleanUser) throw new Error("Please enter a GitHub username.");
  const headers = buildHeaders(cleanToken);
  const url = `https://api.github.com/users/${cleanUser}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw await parseGitHubError(res);
  return res.json() as Promise<GitHubUser>;
}

async function fetchReadme(repo: GitHubRepo, token: string): Promise<string> {
  try {
    const headers = buildHeaders(token.trim());
    const res = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, { headers });
    if (!res.ok) return "";
    const data = (await res.json()) as { content?: string };
    if (!data.content) return "";
    return atob(data.content.replace(/\n/g, "")).slice(0, 3000);
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════
// NORMAL SCORING
// ═══════════════════════════════════════════════════════════════════

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function scoreRepo(repo: GitHubRepo): ScoreBreakdown {
  const stars = Math.min(repo.stargazers_count * 5, 40);
  const daysOld = daysSince(repo.pushed_at);
  const activity = Math.max(0, 25 - Math.floor(daysOld / 15) * 2);
  const completeness =
    (repo.description ? 8 : 0) +
    (repo.homepage ? 7 : 0) +
    (repo.topics.length >= 3 ? 5 : repo.topics.length > 0 ? 3 : 0) +
    (repo.language ? 3 : 0) +
    (repo.size > 50 ? 2 : 0);
  const community = Math.min(repo.forks_count * 3 + repo.watchers_count, 20);
  const total = Math.min(stars + activity + completeness + community, 100);
  return { stars, activity, completeness, community, total };
}

function categorize(repo: GitHubRepo, bd: ScoreBreakdown): Category {
  if (repo.archived) return "experiment";
  if (bd.total >= 50 || (repo.homepage !== null && repo.stargazers_count >= 2) || (repo.topics.length >= 3 && bd.total >= 40)) return "product";
  if (bd.total >= 22 || repo.stargazers_count >= 1 || daysSince(repo.pushed_at) < 60) return "project";
  return "experiment";
}

function analyzeRepos(raw: GitHubRepo[]): AnalyzedRepo[] {
  return raw
    .filter((r) => !r.fork)
    .map((repo) => {
      const bd = scoreRepo(repo);
      return {
        ...repo,
        score: bd.total,
        scoreBreakdown: bd,
        category: categorize(repo, bd),
        showcaseRecommended: bd.total >= 38 || repo.stargazers_count >= 3 || (repo.homepage !== null && bd.total >= 20),
        daysSincePush: daysSince(repo.pushed_at),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════════
// GROQ AI (Llama 3.3 70B)
// ═══════════════════════════════════════════════════════════════════

async function analyzeRepoWithAI(repo: GitHubRepo, readme: string, key: string): Promise<GeminiAIResult> {
  const prompt = `You are a senior software engineer reviewing a GitHub repository. Analyze and return ONLY valid JSON.

Repository:
- Name: ${repo.name}
- Description: ${repo.description ?? "None"}
- Language: ${repo.language ?? "Unknown"}
- Stars: ${repo.stargazers_count}, Forks: ${repo.forks_count}
- Topics: ${repo.topics.join(", ") || "None"}
- Live Demo: ${repo.homepage ?? "No"}
- Last Updated: ${daysSince(repo.pushed_at)} days ago
- Size: ${repo.size}kb
- Private: ${repo.private}
- README: ${readme || "No README"}

Return ONLY this JSON (no markdown):
{
  "category": "Product"|"Project"|"Experiment"|"Learning",
  "aiScore": <0-100>,
  "summary": "<2-3 sentence honest review>",
  "strengths": ["<s1>","<s2>","<s3>"],
  "improvements": ["<i1>","<i2>","<i3>"],
  "showcasePotential": "High"|"Medium"|"Low",
  "techStack": ["<tech1>","<tech2>"]
}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Groq error ${res.status}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as GeminiAIResult;
  } catch {
    throw new Error("AI returned invalid JSON.");
  }
}

// ═══════════════════════════════════════════════════════════════════
// SHARED UI UTILS
// ═══════════════════════════════════════════════════════════════════

const CAT_STYLE: Record<Category, { color: string; ring: string; emoji: string }> = {
  product:    { color: "text-blue-400", ring: "ring-blue-400/30 bg-blue-400/[0.07]", emoji: "📦" },
  project:    { color: "text-blue-400",  ring: "ring-blue-400/30 bg-blue-400/[0.07]",  emoji: "🛠️" },
  experiment: { color: "text-amber-400",   ring: "ring-amber-400/30 bg-amber-400/[0.07]",   emoji: "🧪" },
};

const AI_CAT_STYLE: Record<AICategory, { color: string; ring: string; emoji: string }> = {
  Product:    { color: "text-blue-400", ring: "ring-blue-400/30 bg-blue-400/[0.07]", emoji: "📦" },
  Project:    { color: "text-blue-400",  ring: "ring-blue-400/30 bg-blue-400/[0.07]",  emoji: "🛠️" },
  Experiment: { color: "text-amber-400",   ring: "ring-amber-400/30 bg-amber-400/[0.07]",   emoji: "🧪" },
  Learning:   { color: "text-sky-400",     ring: "ring-sky-400/30 bg-sky-400/[0.07]",       emoji: "📚" },
};

function scoreColor(s: number): string {
  return s >= 60 ? "#3b82f6" : s >= 35 ? "#60a5fa" : "#fbbf24";
}

function formatAge(days: number): string {
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const c = scoreColor(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.16,1,0.3,1)" }} />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fill={c}
        fontSize={size < 48 ? 9 : 11} fontWeight={800} fontFamily="'Fira Code',monospace">{score}</text>
    </svg>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("en-US");
}

function StatTile({ value, label, accent }: { value: number | string; label: string; accent: string }) {
  const display = typeof value === "number" ? formatNum(value) : value;
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-4 px-2 rounded-2xl bg-white/[0.025] ring-1 ring-white/[0.06]">
      <span className="text-xl sm:text-2xl font-black font-mono leading-none" style={{ color: accent }}>{display}</span>
      <span className="text-[9px] sm:text-[10px] text-zinc-600 uppercase tracking-widest text-center leading-tight">{label}</span>
    </div>
  );
}

// Shared credentials form
interface CredFormProps {
  onSubmit: (username: string, token: string) => void;
  loading: boolean;
  error: string;
  label: string;
  accentClass: string;
  extra?: React.ReactNode;
}

function CredForm({ onSubmit, loading, error, label, accentClass, extra }: CredFormProps) {
  const [u, setU] = useState<string>("");
  const [t, setT] = useState<string>("");
  const [showT, setShowT] = useState<boolean>(false);

  return (
    <div className="rounded-2xl bg-white/[0.025] ring-1 ring-white/[0.07] p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.15em] font-mono">GitHub Username</label>
        <input type="text" value={u} onChange={(e) => setU(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(u, t)}
          placeholder="e.g. torvalds" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          className="w-full bg-[#0a0d14] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-zinc-700 ring-1 ring-white/[0.08] focus:ring-blue-400/40 outline-none transition-shadow" />
        <div className="flex gap-2 flex-wrap items-center mt-1 text-xs">
          <span className="text-zinc-600">Try:</span>
          {["torvalds", "gaearon", "Rahul200512"].map((name) => (
            <button key={name} type="button" onClick={() => setU(name)}
              className="px-3 py-1 rounded-full bg-zinc-800 hover:bg-blue-500/20 border border-zinc-700 hover:border-blue-500 text-zinc-400 hover:text-blue-300 transition-all">
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.15em] font-mono">
          GitHub Token <span className="ml-1 text-[9px] font-bold text-amber-300 bg-amber-400/10 ring-1 ring-amber-400/30 rounded px-1.5 py-0.5 align-middle">OPTIONAL</span> <span className="text-zinc-400 normal-case font-normal tracking-normal">— raises rate limit 60 → 5,000/hr</span>
        </label>
        <div className="flex gap-2">
          <input type={showT ? "text" : "password"} value={t} onChange={(e) => setT(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autoComplete="off" spellCheck={false}
            className="flex-1 min-w-0 bg-[#0a0d14] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-zinc-700 ring-1 ring-white/[0.08] focus:ring-blue-400/40 outline-none transition-shadow" />
          <button type="button" onClick={() => setShowT((s) => !s)}
            className="flex-shrink-0 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-xl px-3.5 text-zinc-500 hover:text-zinc-300 text-lg transition-colors">
            {showT ? "🙈" : "👁"}
          </button>
        </div>
      </div>
      {extra}
      <button type="button" onClick={() => onSubmit(u, t)} disabled={loading}
        className={`w-full rounded-xl py-3.5 text-sm font-black tracking-wider font-mono transition-all duration-200 active:scale-[0.97] ${loading ? "bg-zinc-900 text-zinc-700 cursor-not-allowed" : `${accentClass} text-black hover:brightness-110 cursor-pointer`}`}>
        {loading ? "⟳  Processing…" : label}
      </button>
      {error && (
        <div className="bg-red-500/[0.07] ring-1 ring-red-500/20 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <span className="text-red-400 text-base flex-shrink-0 mt-0.5">⚠</span>
          <p className="text-red-400 text-sm leading-relaxed font-mono">{error}</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 1 — NORMAL ANALYZE
// ═══════════════════════════════════════════════════════════════════

function MiniBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-mono">{label}</span>
        <span className="text-[9px] text-zinc-500 font-mono">{value}/{max}</span>
      </div>
      <div className="h-[3px] rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function NormalCard({ repo, rank }: { repo: AnalyzedRepo; rank: number }) {
  const cat = CAT_STYLE[repo.category];
  const sc = scoreColor(repo.score);
  const isTop = rank <= 3;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <article
      className={`group relative flex flex-col gap-4 rounded-2xl p-5 border transition-all duration-300 hover:-translate-y-1 ${isTop ? "bg-gradient-to-br from-white/[0.04] to-white/[0.01]" : "bg-white/[0.02]"} ${repo.showcaseRecommended ? "border-white/10" : "border-white/[0.06]"}`}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 20px 60px ${sc}12`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      {isTop && <div className="absolute top-0 left-0 right-0 h-px rounded-t-2xl"
        style={{ background: `linear-gradient(90deg,transparent,${sc}60,transparent)` }} />}

      <div className="flex items-start gap-3">
        <ScoreRing score={repo.score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1.5">
            {isTop && <span className="text-base">{medals[rank - 1]}</span>}
            <a href={repo.html_url} target="_blank" rel="noreferrer"
              className="font-bold text-[14px] text-white hover:text-blue-400 transition-colors font-mono truncate max-w-[150px] sm:max-w-[200px]">
              {repo.name}
            </a>
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ring-1 font-mono ${cat.ring} ${cat.color}`}>
              {cat.emoji} {repo.category}
            </span>
            {repo.private && <span className="text-[10px] text-zinc-500 bg-white/[0.05] ring-1 ring-white/10 px-2 py-0.5 rounded-full font-mono">🔒</span>}
            {repo.showcaseRecommended && <span className="text-[10px] text-pink-400 bg-pink-400/[0.07] ring-1 ring-pink-400/20 px-2 py-0.5 rounded-full font-mono">💎</span>}
            {repo.daysSincePush < 30 && !repo.archived && <span className="text-[10px] text-blue-400 bg-blue-400/[0.07] ring-1 ring-blue-400/20 px-2 py-0.5 rounded-full font-mono">✦</span>}
          </div>
          {repo.description
            ? <p className="text-[12px] text-zinc-500 leading-relaxed line-clamp-2">{repo.description}</p>
            : <p className="text-[11px] text-zinc-700 italic">No description</p>}
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-zinc-500">
        <span className="font-mono">⭐ {formatNum(repo.stargazers_count)}</span>
        <span className="font-mono">🍴 {formatNum(repo.forks_count)}</span>
        {repo.language && <span className="text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-lg font-mono text-[11px]">{repo.language}</span>}
        {repo.homepage && <a href={repo.homepage} target="_blank" rel="noreferrer" className="text-blue-400 font-mono text-[11px]">🌐 Live</a>}
        <span className="ml-auto text-zinc-700 font-mono text-[11px]">{formatAge(repo.daysSincePush)}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniBar value={repo.scoreBreakdown.stars} max={40} color={sc} label="Stars" />
        <MiniBar value={repo.scoreBreakdown.activity} max={25} color={sc} label="Activity" />
        <MiniBar value={repo.scoreBreakdown.completeness} max={25} color={sc} label="Complete" />
        <MiniBar value={repo.scoreBreakdown.community} max={20} color={sc} label="Community" />
      </div>

      {repo.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {repo.topics.slice(0, 5).map((t) => (
            <span key={t} className="text-[10px] text-zinc-600 bg-white/[0.03] ring-1 ring-white/[0.07] px-2 py-0.5 rounded-full font-mono">{t}</span>
          ))}
          {repo.topics.length > 5 && <span className="text-[10px] text-zinc-700 font-mono">+{repo.topics.length - 5}</span>}
        </div>
      )}
    </article>
  );
}

function NormalTab() {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<AnalyzedRepo[]>([]);
  const [filter, setFilter] = useState<FilterOption>("all");
  const [sort, setSort] = useState<SortOption>("score");
  const [search, setSearch] = useState<string>("");
  const ref = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(async (username: string, token: string) => {
    if (!username.trim()) { setError("Please enter a GitHub username!"); return; }
    setLoading(true); setError(""); setRepos([]); setUser(null);
    try {
      const u = await fetchUser(username.trim(), token.trim());
      const r = await fetchAllRepos(username.trim(), token.trim());
      setUser(u);
      setRepos(analyzeRepos(r));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (repos.length > 0) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [repos.length]);

  const counts: Record<FilterOption, number> = {
    all: repos.length,
    product: repos.filter((r) => r.category === "product").length,
    project: repos.filter((r) => r.category === "project").length,
    experiment: repos.filter((r) => r.category === "experiment").length,
    showcase: repos.filter((r) => r.showcaseRecommended).length,
    private: repos.filter((r) => r.private).length,
  };

  const topLang = (() => {
    const f: Record<string, number> = {};
    repos.forEach((r) => { if (r.language) f[r.language] = (f[r.language] ?? 0) + 1; });
    return Object.entries(f).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  })();

  const avgScore = repos.length ? Math.round(repos.reduce((s, r) => s + r.score, 0) / repos.length) : 0;
  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);

  const filtered = repos
    .filter((r) => {
      const mf = filter === "all" ? true : filter === "showcase" ? r.showcaseRecommended : filter === "private" ? r.private : r.category === filter;
      const q = search.toLowerCase();
      const ms = !q || r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q);
      return mf && ms;
    })
    .sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      if (sort === "stars") return b.stargazers_count - a.stargazers_count;
      if (sort === "updated") return new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime();
      return a.name.localeCompare(b.name);
    });

  const TABS: { key: FilterOption; label: string }[] = [
    { key: "all", label: "All" }, { key: "product", label: "📦 Product" },
    { key: "project", label: "🛠️ Project" }, { key: "experiment", label: "🧪 Experiment" },
    { key: "showcase", label: "💎 Showcase" }, { key: "private", label: "🔒 Private" },
  ];

  return (
    <div className="space-y-8">
      <div className="max-w-xl mx-auto">
        <CredForm onSubmit={handleSubmit} loading={loading} error={error}
          label="✦  Analyze Portfolio" accentClass="bg-gradient-to-r from-blue-500 to-blue-400" />
      </div>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer-card rounded-2xl" style={{ height: 180, animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      )}

      {user && repos.length > 0 && (
        <div ref={ref} className="space-y-6 animate-fade-up">
          {/* Profile */}
          <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.05]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatar_url} alt={user.login} width={48} height={48}
              className="w-12 h-12 rounded-full ring-2 ring-blue-400/30 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base text-white">{user.name ?? user.login}</p>
              <p className="text-xs text-zinc-500 font-mono">@{user.login}{user.followers > 0 && ` · ${formatNum(user.followers)} followers`}{user.location && ` · ${user.location}`}</p>
              {user.bio && <p className="text-xs text-zinc-600 mt-0.5 line-clamp-1">{user.bio}</p>}
            </div>
            <button type="button" onClick={() => { setUser(null); setRepos([]); setFilter("all"); setSearch(""); }}
              className="text-xs text-zinc-600 hover:text-zinc-300 bg-white/[0.03] ring-1 ring-white/[0.07] rounded-xl px-3 py-2 font-mono transition-colors">
              ↩ Reset
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
            <StatTile value={repos.length} label="Total" accent="#60a5fa" />
            <StatTile value={counts.product} label="Products" accent="#3b82f6" />
            <StatTile value={counts.project} label="Projects" accent="#60a5fa" />
            <StatTile value={counts.experiment} label="Experiments" accent="#fbbf24" />
            <StatTile value={counts.showcase} label="Showcase" accent="#f472b6" />
            <StatTile value={totalStars} label="Stars" accent="#fbbf24" />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <StatTile value={avgScore} label="Avg Score" accent="#3b82f6" />
            <StatTile value={topLang} label="Top Lang" accent="#7dd3fc" />
            <StatTile value={counts.private} label="Private" accent="#a1a1aa" />
          </div>

          {/* Top 3 */}
          {repos.length >= 3 && (
            <div className="rounded-2xl bg-gradient-to-br from-blue-400/[0.04] to-blue-400/[0.04] ring-1 ring-blue-400/15 p-5">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em] font-mono mb-4">🏆 Top Projects</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {repos.slice(0, 3).map((r, i) => (
                  <a key={r.id} href={r.html_url} target="_blank" rel="noreferrer"
                    className={`flex flex-col gap-2 p-4 rounded-xl ring-1 transition-all hover:brightness-110 ${i === 0 ? "bg-blue-400/[0.06] ring-blue-400/20" : i === 1 ? "bg-blue-400/[0.05] ring-blue-400/20" : "bg-amber-400/[0.04] ring-amber-400/15"}`}>
                    <span className="text-xl">{["🥇", "🥈", "🥉"][i]}</span>
                    <span className="font-bold text-sm text-white font-mono">{r.name}</span>
                    <div className="flex items-center gap-2">
                      <ScoreRing score={r.score} size={34} />
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ring-1 font-mono ${CAT_STYLE[r.category].color} ${CAT_STYLE[r.category].ring}`}>
                        {r.category}
                      </span>
                    </div>
                    {r.description && <p className="text-[11px] text-zinc-500 line-clamp-2">{r.description}</p>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 flex-1">
              {TABS.map(({ key, label }) => (
                <button key={key} type="button" onClick={() => setFilter(key)}
                  className={`flex-shrink-0 text-[11px] font-bold font-mono px-3 py-1.5 rounded-lg ring-1 whitespace-nowrap transition-all ${filter === key ? "bg-blue-400/15 ring-blue-400/35 text-blue-300" : "bg-white/[0.03] ring-white/[0.06] text-zinc-500 hover:text-zinc-300"}`}>
                  {label} <span className="ml-1 opacity-50">{counts[key]}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                className="flex-1 sm:w-32 bg-[#0a0d14] ring-1 ring-white/[0.07] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:text-zinc-700 focus:ring-blue-400/40 outline-none" />
              <select value={sort} onChange={(e) => setSort(e.target.value as SortOption)}
                className="bg-[#0a0d14] ring-1 ring-white/[0.07] rounded-xl px-3 py-2 text-sm text-zinc-400 font-mono outline-none">
                <option value="score">Score</option>
                <option value="stars">Stars</option>
                <option value="updated">Updated</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          <p className="text-[11px] text-zinc-700 font-mono">{filtered.length} of {repos.length} repos · Forks excluded</p>

          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((repo, i) => (
                <NormalCard key={repo.id} repo={repo}
                  rank={sort === "score" && filter === "all" ? repos.findIndex((r) => r.id === repo.id) + 1 : i + 1} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-20 text-zinc-700 gap-3">
              <span className="text-4xl">🔍</span>
              <p className="text-sm font-mono">No repos found.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 2 — DEEP AI
// ═══════════════════════════════════════════════════════════════════

function AICard({ review, repo }: { review: AIRepoReview; repo: GitHubRepo }) {
  const [expanded, setExpanded] = useState<boolean>(false);

  if (review.status === "pending") {
    return (
      <div className="rounded-2xl bg-white/[0.01] ring-1 ring-white/[0.04] p-4 opacity-40">
        <p className="text-sm text-zinc-500 font-mono">{repo.name}</p>
        <p className="text-xs text-zinc-700 font-mono mt-1">Waiting in queue...</p>
      </div>
    );
  }

  if (review.status === "analyzing") {
    return (
      <div className="rounded-2xl bg-blue-500/[0.04] ring-1 ring-blue-500/20 p-4 flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full flex-shrink-0"
          style={{ animation: "spin 0.8s linear infinite" }} />
        <div>
          <p className="text-sm text-white font-mono font-bold">{repo.name}</p>
          <p className="text-xs text-blue-400 font-mono">AI analyzing...</p>
        </div>
      </div>
    );
  }

  if (review.status === "error") {
    return (
      <div className="rounded-2xl bg-red-500/[0.04] ring-1 ring-red-500/15 p-4">
        <p className="text-sm text-white font-mono font-bold mb-1">{repo.name}</p>
        <p className="text-xs text-red-400 font-mono">{review.error}</p>
      </div>
    );
  }

  const catStyle = review.category ? AI_CAT_STYLE[review.category] : null;
  const aiScore = review.aiScore ?? 0;
  const sc = scoreColor(aiScore);

  return (
    <article className="rounded-2xl overflow-hidden bg-white/[0.025] ring-1 ring-white/[0.07] transition-all hover:ring-white/15"
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 16px 48px ${sc}12`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
      <div className="h-px" style={{ background: `linear-gradient(90deg,transparent,${sc}50,transparent)` }} />
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <ScoreRing score={aiScore} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1.5">
              <a href={repo.html_url} target="_blank" rel="noreferrer"
                className="font-bold text-[14px] text-white hover:text-blue-400 transition-colors font-mono truncate max-w-[150px] sm:max-w-[200px]">
                {repo.name}
              </a>
              {catStyle && review.category && (
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ring-1 font-mono ${catStyle.ring} ${catStyle.color}`}>
                  {catStyle.emoji} {review.category}
                </span>
              )}
              {review.showcasePotential && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 font-mono ${review.showcasePotential === "High" ? "text-blue-400 bg-blue-400/[0.07] ring-blue-400/25" : review.showcasePotential === "Medium" ? "text-amber-400 bg-amber-400/[0.07] ring-amber-400/25" : "text-zinc-500 bg-zinc-500/[0.07] ring-zinc-500/25"}`}>
                  💎 {review.showcasePotential}
                </span>
              )}
              {repo.private && <span className="text-[10px] text-zinc-500 bg-white/[0.05] ring-1 ring-white/10 px-2 py-0.5 rounded-full font-mono">🔒</span>}
            </div>
            {review.summary && <p className="text-[12px] text-zinc-400 leading-relaxed">{review.summary}</p>}
          </div>
        </div>

        {review.techStack.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {review.techStack.map((t) => (
              <span key={t} className="text-[10px] text-sky-400 bg-sky-400/[0.07] ring-1 ring-sky-400/20 px-2 py-0.5 rounded-full font-mono">{t}</span>
            ))}
          </div>
        )}

        <button type="button" onClick={() => setExpanded((s) => !s)}
          className="text-[11px] text-zinc-600 hover:text-zinc-300 font-mono text-left transition-colors">
          {expanded ? "▲ Collapse" : "▼ Strengths & Improvements"}
        </button>

        {expanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-white/[0.05]">
            <div>
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest font-mono mb-2">✓ Strengths</p>
              <ul className="space-y-1.5">
                {review.strengths.map((s, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 flex gap-2">
                    <span className="text-blue-400 flex-shrink-0">→</span>{s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest font-mono mb-2">⚡ Improve</p>
              <ul className="space-y-1.5">
                {review.improvements.map((s, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 flex gap-2">
                    <span className="text-amber-400 flex-shrink-0">→</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function AITab() {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [groqKey, setGroqKey] = useState<string>("");
  const [showKey, setShowKey] = useState<boolean>(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reviews, setReviews] = useState<AIRepoReview[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [aiFilter, setAiFilter] = useState<"all" | AICategory | "High">("all");
  const ref = useRef<HTMLDivElement>(null);
  const abortRef = useRef<boolean>(false);

  const handleSubmit = useCallback(async (username: string, token: string) => {
    if (!username.trim()) { setError("Please enter a GitHub username!"); return; }
    if (!groqKey.trim()) { setError("Please enter your Groq API key!"); return; }
    abortRef.current = false;
    setLoading(true); setError(""); setReviews([]); setRepos([]);
    try {
      const rawRepos = await fetchAllRepos(username.trim(), token.trim());
      const nonFork = rawRepos.filter((r) => !r.fork);
      setRepos(nonFork);
      const initial: AIRepoReview[] = nonFork.map((r) => ({
        repoId: r.id, repoName: r.name, status: "pending",
        category: null, aiScore: null, summary: null,
        strengths: [], improvements: [], showcasePotential: null,
        techStack: [], error: null,
      }));
      setReviews(initial);
      setProgress({ done: 0, total: nonFork.length });

      for (let i = 0; i < nonFork.length; i++) {
        if (abortRef.current) break;
        const repo = nonFork[i];
        setReviews((prev) => prev.map((rv) => rv.repoId === repo.id ? { ...rv, status: "analyzing" } : rv));
        try {
          const readme = await fetchReadme(repo, token.trim());
          const result = await analyzeRepoWithAI(repo, readme, groqKey.trim());
          setReviews((prev) => prev.map((rv) => rv.repoId === repo.id ? {
            ...rv, status: "done", category: result.category, aiScore: result.aiScore,
            summary: result.summary, strengths: result.strengths, improvements: result.improvements,
            showcasePotential: result.showcasePotential, techStack: result.techStack,
          } : rv));
        } catch (e: unknown) {
          setReviews((prev) => prev.map((rv) => rv.repoId === repo.id ? {
            ...rv, status: "error", error: e instanceof Error ? e.message : "Error",
          } : rv));
        }
        setProgress({ done: i + 1, total: nonFork.length });
        if (i < nonFork.length - 1 && !abortRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 6000));
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch repos.");
    } finally {
      setLoading(false);
    }
  }, [groqKey]);

  useEffect(() => {
    if (reviews.length > 0) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [reviews.length]);

  const done = reviews.filter((r) => r.status === "done");
  const avgAI = done.length ? Math.round(done.reduce((s, r) => s + (r.aiScore ?? 0), 0) / done.length) : 0;

  const aiCounts = {
    Product: done.filter((r) => r.category === "Product").length,
    Project: done.filter((r) => r.category === "Project").length,
    Experiment: done.filter((r) => r.category === "Experiment").length,
    Learning: done.filter((r) => r.category === "Learning").length,
    High: done.filter((r) => r.showcasePotential === "High").length,
  };

  const filtered = reviews.filter((r) => {
    if (aiFilter === "all") return true;
    if (aiFilter === "High") return r.showcasePotential === "High";
    return r.category === aiFilter;
  });

  const groqField = (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.15em] font-mono">
        Groq API Key <span className="ml-1 text-[9px] font-bold text-red-300 bg-red-400/10 ring-1 ring-red-400/30 rounded px-1.5 py-0.5 align-middle">REQUIRED</span> <span className="text-zinc-400 normal-case font-normal tracking-normal">— get a free key at console.groq.com/keys</span>
      </label>
      <div className="flex gap-2">
        <input type={showKey ? "text" : "password"} value={groqKey} onChange={(e) => setGroqKey(e.target.value)}
          placeholder="gsk_..." autoComplete="off" spellCheck={false}
          className="flex-1 min-w-0 bg-[#0a0d14] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-zinc-700 ring-1 ring-white/[0.08] focus:ring-blue-400/40 outline-none transition-shadow" />
        <button type="button" onClick={() => setShowKey((s) => !s)}
          className="flex-shrink-0 bg-white/[0.04] ring-1 ring-white/[0.08] rounded-xl px-3.5 text-zinc-500 hover:text-zinc-300 text-lg transition-colors">
          {showKey ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="rounded-2xl bg-blue-500/[0.05] ring-1 ring-blue-500/15 p-4 sm:p-5 flex gap-4 items-start">
        <span className="text-2xl flex-shrink-0">🤖</span>
        <div>
          <p className="font-bold text-sm text-blue-300 mb-1">Deep AI Analysis — Llama 3.3 70B via Groq (Free & Fast)</p>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Reads each repo&apos;s README and generates an honest AI review. Free tier limit is <strong className="text-zinc-400">15 req/min</strong> — a 4-second delay is added between calls automatically.
          </p>
        </div>
      </div>

      <div className="max-w-xl mx-auto">
        <CredForm onSubmit={handleSubmit} loading={loading} error={error}
          label="🤖  Start Deep AI Analysis" accentClass="bg-gradient-to-r from-blue-500 to-blue-400"
          extra={groqField} />
      </div>

      {/* Progress */}
      {(loading || reviews.length > 0) && progress.total > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-zinc-500">Analyzing repos...</span>
            <span className="text-blue-400 font-bold">{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
              style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          {loading && (
            <button type="button" onClick={() => { abortRef.current = true; setLoading(false); }}
              className="text-xs text-red-400 hover:text-red-300 font-mono transition-colors">
              ✕ Stop
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {reviews.length > 0 && (
        <div ref={ref} className="space-y-6 animate-fade-up">
          {done.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
              <StatTile value={avgAI} label="AI Avg" accent="#a78bfa" />
              <StatTile value={aiCounts.Product} label="Products" accent="#3b82f6" />
              <StatTile value={aiCounts.Project} label="Projects" accent="#60a5fa" />
              <StatTile value={aiCounts.Experiment} label="Experiments" accent="#fbbf24" />
              <StatTile value={aiCounts.Learning} label="Learning" accent="#38bdf8" />
              <StatTile value={aiCounts.High} label="High Potential" accent="#f472b6" />
            </div>
          )}

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {([
              { k: "all", l: `All ${reviews.length}` },
              { k: "Product", l: `📦 ${aiCounts.Product}` },
              { k: "Project", l: `🛠️ ${aiCounts.Project}` },
              { k: "Experiment", l: `🧪 ${aiCounts.Experiment}` },
              { k: "Learning", l: `📚 ${aiCounts.Learning}` },
              { k: "High", l: `💎 High ${aiCounts.High}` },
            ] as { k: typeof aiFilter; l: string }[]).map(({ k, l }) => (
              <button key={k} type="button" onClick={() => setAiFilter(k)}
                className={`flex-shrink-0 text-[11px] font-bold font-mono px-3 py-1.5 rounded-lg ring-1 whitespace-nowrap transition-all ${aiFilter === k ? "bg-blue-400/15 ring-blue-400/35 text-blue-300" : "bg-white/[0.03] ring-white/[0.06] text-zinc-500 hover:text-zinc-300"}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((review) => {
              const repo = repos.find((r) => r.id === review.repoId);
              if (!repo) return null;
              return <AICard key={review.repoId} review={review} repo={repo} />;
            })}
          </div>
        </div>
      )}

      {reviews.length === 0 && !loading && (
        <div className="flex flex-col items-center py-20 text-zinc-700 gap-4">
          <span className="text-5xl">🤖</span>
          <p className="text-sm font-mono text-center max-w-xs">Enter your GitHub token + Groq API key to start deep AI analysis.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════

export default function DevScanPage() {
  const [tab, setTab] = useState<PageTab>("normal");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=Fira+Code:wght@400;500;700&family=Outfit:wght@400;500;700&display=swap');
        :root{--font-display:'Syne',sans-serif;--font-mono:'Fira Code',monospace;--font-body:'Outfit',sans-serif}
        *{box-sizing:border-box} body{font-family:var(--font-body);background:#07090e}
        .font-mono{font-family:var(--font-mono)!important}
        ::-webkit-scrollbar{width:5px;height:5px} ::-webkit-scrollbar-track{background:#0a0d14}
        ::-webkit-scrollbar-thumb{background:#1e2130;border-radius:4px}
        input::placeholder{color:#3f3f46}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .animate-fade-up{animation:fadeUp 0.5s ease both}
        .shimmer-card{background:linear-gradient(90deg,#0e1118 0%,#161b27 50%,#0e1118 100%);background-size:200% 100%;animation:shimmer 1.6s ease infinite}
      `}</style>

      <main className="min-h-screen bg-[#07090e] text-zinc-200" style={{ fontFamily: "var(--font-body)" }}>

        {/* Hero */}
        <header className="relative overflow-hidden border-b border-white/[0.04]">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse 70% 55% at 50% -5%,rgba(99,120,255,0.09),transparent)" }} />
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-18 text-center">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold text-blue-400 tracking-[0.25em] uppercase font-mono mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Built by Rahul
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-[1.0] mb-3"
              style={{ fontFamily: "var(--font-display)", background: "linear-gradient(135deg,#ffffff 20%,#93c5fd 55%,#3b82f6 90%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              DevScan<br />GitHub Analyzer
            </h1>
            <p className="text-zinc-500 text-sm max-w-sm mx-auto">Paste any GitHub username and get an instant AI-powered breakdown of their dev profile — languages, top repos, activity, and more.</p>
          </div>
        </header>

        {/* Sticky tab bar */}
        <div className="sticky top-0 z-10 bg-[#07090e]/90 backdrop-blur-md border-b border-white/[0.04]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex">
            <button type="button" onClick={() => setTab("normal")}
              className={`flex items-center justify-center gap-2 flex-1 sm:flex-none px-5 sm:px-8 py-4 text-sm font-bold font-mono border-b-2 transition-all ${tab === "normal" ? "text-blue-400 border-blue-400" : "text-zinc-600 border-transparent hover:text-zinc-400"}`}>
              <span>📊</span>
              <span className="hidden sm:inline">Normal Analyze</span>
              <span className="sm:hidden">Normal</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${tab === "normal" ? "bg-blue-400/15 text-blue-400" : "bg-white/[0.04] text-zinc-600"}`}>
                Metadata
              </span>
            </button>

            <button type="button" onClick={() => setTab("ai")}
              className={`flex items-center justify-center gap-2 flex-1 sm:flex-none px-5 sm:px-8 py-4 text-sm font-bold font-mono border-b-2 transition-all ${tab === "ai" ? "text-blue-400 border-blue-400" : "text-zinc-600 border-transparent hover:text-zinc-400"}`}>
              <span>🤖</span>
              <span className="hidden sm:inline">Deep AI Analyze</span>
              <span className="sm:hidden">Deep AI</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${tab === "ai" ? "bg-blue-400/15 text-blue-400" : "bg-white/[0.04] text-zinc-600"}`}>
                Groq
              </span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {tab === "normal" ? <NormalTab /> : <AITab />}
        </div>

        <footer className="mt-8 py-6 border-t border-white/[0.04] text-center text-zinc-500 text-sm">
          Built by{" "}
          <a href="https://github.com/Rahul200512" target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors">
            Rahul
          </a>
          {" · "}
          <a href="https://www.linkedin.com/in/rahul-reddy-avula-37572b328/" target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors">
            LinkedIn
          </a>
        </footer>

      </main>
    </>
  );
}
