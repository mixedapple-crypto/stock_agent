import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

async function safeInvoke(cmd, args) {
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    const routeMap = {
      "extract_ticker_with_ai": "extract-ticker",
      "fetch_finnhub": "finnhub",
      "coordinator_agent": "coordinator",
      "call_agent": "call-agent",
      "get_summary": "summary"
    };
    const res = await fetch(`/api/${routeMap[cmd]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args || {})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP error ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }
  return invoke(cmd, args);
}

const AGENTS = {
  macro: {
    name: "거시경제 분석가",
    emoji: "🌍",
    color: "#378ADD",
    bgVar: "rgba(55,138,221,0.08)",
  },
  technical: {
    name: "기술적 분석가",
    emoji: "📈",
    color: "#1D9E75",
    bgVar: "rgba(29,158,117,0.08)",
  },
  fundamental: {
    name: "기본적 분석가",
    emoji: "📋",
    color: "#BA7517",
    bgVar: "rgba(186,117,23,0.08)",
  },
  sentiment: {
    name: "시장심리 분석가",
    emoji: "🎭",
    color: "#E24B4A",
    bgVar: "rgba(226,75,74,0.08)",
  },
  risk: {
    name: "리스크 관리자",
    emoji: "🛡️",
    color: "#7F77DD",
    bgVar: "rgba(127,119,221,0.08)",
  },
};

const PRESETS = [
  "삼성전자 (005930) 투자 분석",
  "애플 (AAPL) 향후 실적 전망",
  "엔비디아 (NVDA) AI 반도체 섹터 전망",
  "테슬라 (TSLA) 최신 동향 및 기술적 분석",
  "인텔 (INTC) 실적 및 턴어라운드 분석",
];

const TICKER_MAP = {
  "애플": "AAPL",
  "인텔": "INTC",
  "테슬라": "TSLA",
  "엔비디아": "NVDA",
  "마이크로소프트": "MSFT",
  "구글": "GOOGL",
  "아마존": "AMZN",
  "메타": "META",
  "넷플릭스": "NFLX",
  "에이엠디": "AMD",
  "삼성전자": "005930",
  "SK하이닉스": "000660",
  "현대차": "005380",
};

const VERDICT_STYLES = {
  매수: { bg: "#e6f7ef", color: "#0a6640" },
  보유: { bg: "#fff7e0", color: "#7a5400" },
  매도: { bg: "#fdecea", color: "#9b1c1c" },
  관망: { bg: "#e8f0fc", color: "#1a4fa0" },
};

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13,
      border: "1.5px solid #ccc", borderTopColor: "#555",
      borderRadius: "50%", animation: "spin 0.8s linear infinite",
      verticalAlign: "middle", marginRight: 6,
    }} />
  );
}

// ⚡ ConflictBadge: 에이전트 의견 충돌 시각화 (PRD §HITL)
function ConflictBadge({ conflicts }) {
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <span title={conflicts.map(c => `${c.agents?.join(" vs ")}: ${c.reason}`).join("\n")} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 10,
      background: "rgba(226,75,74,0.1)", border: "0.5px solid #E24B4A",
      fontSize: 11, color: "#E24B4A", fontWeight: 500, marginLeft: 8,
      cursor: "help",
    }}>
      ⚡ {conflicts.length}건 의견 충돌
    </span>
  );
}

// ⚠️ HitlWarning: 고위험 Verdict 시 표시 (PRD §HITL)
function HitlWarning({ show, reason, onDismiss }) {
  if (!show) return null;
  return (
    <div style={{
      background: "#fff8e1", border: "1px solid #f5c518",
      borderRadius: 10, padding: "12px 16px", marginBottom: 12,
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#7a5400", marginBottom: 3 }}>
          Human-in-the-Loop 경고
        </div>
        <div style={{ fontSize: 12, color: "#555", lineHeight: 1.55 }}>{reason}</div>
      </div>
      <button
        onClick={onDismiss}
        style={{ background: "none", border: "none", cursor: "pointer",
                 fontSize: 16, color: "#bbb", padding: 0, flexShrink: 0 }}
      >✕</button>
    </div>
  );
}

function AgentBlock({ agentKey, result, status }) {
  const agent = AGENTS[agentKey];
  return (
    <div style={{ border: "0.5px solid #e0e0e0", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: agent.bgVar, borderBottom: "0.5px solid #e0e0e0" }}>
        <span style={{ fontSize: 16 }}>{agent.emoji}</span>
        <span style={{ fontWeight: 500, fontSize: 13 }}>{agent.name}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: status === "done" ? "#1D9E75" : status === "thinking" ? "#BA7517" : status === "error" ? "#E24B4A" : "#999" }}>
          {status === "done" ? "✓ 완료" : status === "thinking" ? "분석 중..." : status === "error" ? "✗ 오류" : "대기"}
        </span>
      </div>
      <div style={{ padding: "14px", background: "#fff", fontSize: 13, lineHeight: 1.7, color: "#222" }}>
        {status === "idle" && <span style={{ color: "#aaa" }}>준비 중...</span>}
        {status === "thinking" && <><Spinner />분석 중입니다...</>}
        {status === "done" && result && (
          <div style={{ whiteSpace: "pre-wrap" }}>{result}</div>
        )}
        {status === "error" && <span style={{ color: "#E24B4A" }}>분석 중 오류가 발생했습니다.</span>}
      </div>
    </div>
  );
}

function SummaryBlock({ summary, loading, conflicts }) {
  if (loading) {
    return (
      <div style={{ background: "#f5f5f5", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", color: "#888", marginBottom: 8 }}>종합 의견 (수석 전략가)</div>
        <Spinner /><span style={{ fontSize: 13, color: "#999" }}>전문가 분석 완료 후 생성됩니다...</span>
      </div>
    );
  }
  if (!summary) return null;
  const vs = VERDICT_STYLES[summary.verdict] || VERDICT_STYLES["관망"];
  return (
    <div style={{ background: "#f5f5f5", borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", color: "#888", marginBottom: 10 }}>
        종합 의견 (수석 전략가)
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ padding: "3px 12px", borderRadius: 12, fontSize: 13, fontWeight: 500, background: vs.bg, color: vs.color }}>
          {summary.verdict}
        </span>
        <span style={{ fontSize: 12, color: "#888" }}>신뢰도: {summary.confidence} | {summary.timeframe}</span>
        <ConflictBadge conflicts={conflicts} />
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.65, marginBottom: 12, color: "#222" }}>{summary.summary}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "상승 요인", val: summary.upside, color: "#1D9E75" },
          { label: "하락 요인", val: summary.downside, color: "#E24B4A" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ flex: 1, background: "#fff", border: "0.5px solid #e0e0e0", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12, color }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [finnhubData, setFinnhubData] = useState(null);
  const [finnhubStatus, setFinnhubStatus] = useState("idle");

  const [activeAgents, setActiveAgents] = useState(Object.fromEntries(Object.keys(AGENTS).map(k => [k, true])));
  const [agentStatus, setAgentStatus] = useState({});
  const [agentResults, setAgentResults] = useState({});
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false);

  // Coordinator + HITL state
  const [coordinatorGuideline, setCoordinatorGuideline] = useState(null);
  const [coordinatorLoading, setCoordinatorLoading] = useState(false);
  const [showHitlWarning, setShowHitlWarning] = useState(false);
  const [hitlReason, setHitlReason] = useState("");
  const [conflicts, setConflicts] = useState([]);
  const [pipelineError, setPipelineError] = useState(null);

  const toggleAgent = (key) => {
    if (running) return;
    setActiveAgents(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const runAnalysis = async () => {
    const q = query.trim();
    if (!q || running) return;
    const selected = Object.keys(activeAgents).filter(k => activeAgents[k]);
    if (!selected.length) return;

    setRunning(true);
    setAnalysisStarted(true);
    setSummary(null);
    setSummaryLoading(true);
    setAgentResults({});
    setAgentStatus(Object.fromEntries(selected.map(k => [k, "idle"])));
    setFinnhubData(null);
    setCoordinatorGuideline(null);
    setShowHitlWarning(false);
    setHitlReason("");
    setConflicts([]);
    setPipelineError(null);

    // ── Step 1: Ticker extraction + Finnhub data ──────────────────────────
    let fetchedData = null;
    let finalTicker = null;

    setFinnhubStatus("fetching");
    let upperQ = q.toUpperCase();

    Object.entries(TICKER_MAP).forEach(([korName, ticker]) => {
      if (upperQ.includes(korName.toUpperCase())) {
        upperQ += ` ${ticker}`;
      }
    });

    const matches = upperQ.match(/\b([A-Z]{2,5}(?:[\.\-][A-Z]{1,2})?|[0-9]{6})\b/g);
    if (matches) {
      const potentialTickers = matches.filter(t => !["THE", "AND", "FOR", "AI"].includes(t));
      if (potentialTickers.length > 0) {
        finalTicker = potentialTickers[0];
        if (finalTicker.length === 6 && !isNaN(finalTicker)) finalTicker += ".KS";
      }
    }

    if (!finalTicker) {
      try {
        finalTicker = await safeInvoke("extract_ticker_with_ai", { query: q });
      } catch (e) {
        console.error("Ticker extraction failed", e);
      }
    }

    if (finalTicker) {
      try {
        const data = await safeInvoke("fetch_finnhub", { ticker: finalTicker });
        if (data && data.quote && data.quote.c) {
          fetchedData = data;
          setFinnhubData(data);
        }
      } catch (e) {
        console.error("Finnhub fetch error", e);
      }
    }
    setFinnhubStatus("done");

    // ── Step 2: Coordinator ───────────────────────────────────────────────
    let guideline = null;
    setCoordinatorLoading(true);
    try {
      guideline = await safeInvoke("coordinator_agent", { query: q, contextData: fetchedData });
      setCoordinatorGuideline(guideline);
    } catch (e) {
      console.error("Coordinator error (non-fatal)", e);
    }
    setCoordinatorLoading(false);

    // ── Step 3: 5 agents — Promise.allSettled (single failure ≠ pipeline abort) ──
    const results = {};
    const settledResults = await Promise.allSettled(
      selected.map(async (key) => {
        setAgentStatus(prev => ({ ...prev, [key]: "thinking" }));
        const result = await safeInvoke("call_agent", {
          agentKey: key,
          query: q,
          contextData: fetchedData,
          coordinatorGuideline: guideline,
        });
        results[key] = result;
        setAgentResults(prev => ({ ...prev, [key]: result }));
        setAgentStatus(prev => ({ ...prev, [key]: "done" }));
        return result;
      })
    );

    // Mark failed agents as error
    settledResults.forEach((r, i) => {
      if (r.status === "rejected") {
        const key = selected[i];
        setAgentStatus(prev => ({ ...prev, [key]: "error" }));
        console.error(`Agent ${key} failed:`, r.reason);
      }
    });

    // Failure threshold: ≥3 failures → abort pipeline
    const failedCount = settledResults.filter(r => r.status === "rejected").length;
    if (failedCount >= 3) {
      const msg = `에이전트 ${failedCount}개가 응답하지 않았습니다. 분석을 완료할 수 없습니다.`;
      setPipelineError(msg);
      setSummary({ verdict: "관망", confidence: "낮음", summary: msg, upside: "—", downside: "—", timeframe: "—" });
      setShowHitlWarning(true);
      setHitlReason("과반수 에이전트가 실패했습니다. 결과의 신뢰도가 매우 낮습니다.");
      setSummaryLoading(false);
      setRunning(false);
      return;
    }

    // ── Step 4: Synthesizer ───────────────────────────────────────────────
    setSummaryLoading(true);
    try {
      const summaryResult = await safeInvoke("get_summary", {
        query: q,
        resultsMap: results,
        contextData: fetchedData,
      });
      setSummary(summaryResult);

      // HITL check (PRD §HITL)
      if (summaryResult.verdict === "매도" || summaryResult.confidence === "낮음") {
        setShowHitlWarning(true);
        setHitlReason(
          summaryResult.verdict === "매도"
            ? "AI가 매도 의견을 제시했습니다. 전문가 의견을 병행 확인하세요."
            : "분석 확신도가 낮습니다. 추가 정보 수집을 권장합니다."
        );
      }

      // ConflictBadge data
      if (summaryResult.conflicts && summaryResult.conflicts.length > 0) {
        setConflicts(summaryResult.conflicts);
      }
    } catch (e) {
      console.error("Summary error", e);
      setSummary({ verdict: "관망", confidence: "낮음", summary: "종합 분석 생성에 실패했습니다.", upside: "—", downside: "—", timeframe: "—" });
    }
    setSummaryLoading(false);
    setRunning(false);
  };

  const selectedKeys = Object.keys(activeAgents).filter(k => activeAgents[k]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "20px auto", background: "#fff", borderRadius: 16, border: "0.5px solid #e0e0e0", overflow: "hidden", minHeight: "90vh" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ padding: "18px 20px 14px", borderBottom: "0.5px solid #e0e0e0" }}>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 3 }}>📊 Stock Agent Team</div>
        <div style={{ fontSize: 12, color: "#888" }}>Claude AI + Finnhub 실시간 데이터 — Rust 백엔드 구동</div>
      </div>

      {/* Agent selector */}
      <div style={{ display: "flex", gap: 7, padding: "12px 20px", borderBottom: "0.5px solid #e0e0e0", flexWrap: "wrap" }}>
        {Object.entries(AGENTS).map(([key, a]) => {
          const on = activeAgents[key];
          return (
            <button key={key} onClick={() => toggleAgent(key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 13px", borderRadius: 20, border: on ? `0.5px solid ${a.color}` : "0.5px solid #ddd", background: on ? a.bgVar : "#f5f5f5", color: on ? a.color : "#888", fontSize: 12, fontWeight: 500, cursor: running ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
              <span style={{ fontSize: 14 }}>{a.emoji}</span>{a.name}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div style={{ padding: "12px 20px", borderBottom: "0.5px solid #e0e0e0" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && runAnalysis()}
            placeholder="분석할 주식, 섹터, 또는 경제 이슈를 입력하세요"
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "0.5px solid #ccc", fontSize: 13, outline: "none", color: "#222", background: "#fff" }}
          />
          <button onClick={runAnalysis} disabled={running || !query.trim() || !selectedKeys.length} style={{ padding: "8px 18px", borderRadius: 8, border: "0.5px solid #ccc", background: running ? "#f0f0f0" : "#fff", fontSize: 13, fontWeight: 500, cursor: running ? "not-allowed" : "pointer", color: running ? "#aaa" : "#222", whiteSpace: "nowrap" }}>
            {running ? "분석 중..." : "분석 시작 ↗"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {PRESETS.map(p => (
            <button key={p} onClick={() => setQuery(p)} style={{ padding: "3px 10px", borderRadius: 12, border: "0.5px solid #ddd", background: "transparent", fontSize: 11, color: "#888", cursor: "pointer" }}>{p}</button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ padding: "16px 20px", maxHeight: 580, overflowY: "auto" }}>
        {!analysisStarted ? (
          <div style={{ textAlign: "center", padding: "48px 16px", color: "#aaa" }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6, color: "#555" }}>에이전트 팀이 준비되었습니다</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Claude AI로 구동되는 7개 에이전트가 실시간 Finnhub 데이터를 분석합니다.<br />
              코디네이터 → 5개 병렬 분석 → 수석 전략가 종합
            </div>
          </div>
        ) : (
          <>
            {/* Finnhub data banner */}
            {finnhubStatus === "fetching" && (
              <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                <Spinner /> Finnhub 실시간 데이터 수집 중...
              </div>
            )}
            {finnhubData && finnhubData.quote && (
              <div style={{ background: "#e8f4fd", borderRadius: 10, padding: "12px 16px", marginBottom: 12, border: "1px solid #cce5ff" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0056b3", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                  <span>⚡ Finnhub 데이터 ({finnhubData.symbol})</span>
                  <span style={{ fontWeight: 400, color: "#555" }}>{finnhubData.profile?.finnhubIndustry || "섹터 정보 없음"}</span>
                </div>
                <div style={{ fontSize: 12, color: "#333", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <span>
                    <strong>현재가:</strong>{" "}
                    {finnhubData.symbol.endsWith(".KS") ? "₩" : "$"}{finnhubData.quote.c}{" "}
                    <span style={{ color: finnhubData.quote.dp > 0 ? "#1D9E75" : "#E24B4A" }}>
                      ({finnhubData.quote.dp?.toFixed(2)}%)
                    </span>
                  </span>
                  <span><strong>PER:</strong> {finnhubData.metrics?.peTTM?.toFixed(2) || "-"}</span>
                  <span><strong>ROE:</strong> {finnhubData.metrics?.roeTTM?.toFixed(2) || "-"}%</span>
                  <span><strong>Beta:</strong> {finnhubData.metrics?.beta?.toFixed(2) || "-"}</span>
                </div>
              </div>
            )}

            {/* Coordinator guideline */}
            {coordinatorLoading && (
              <div style={{ fontSize: 12, color: "#C9A84C", marginBottom: 10, padding: "6px 10px", background: "rgba(201,168,76,0.06)", borderRadius: 6, border: "0.5px solid rgba(201,168,76,0.25)" }}>
                <Spinner /> 👑 코디네이터 분석 지침 생성 중...
              </div>
            )}
            {coordinatorGuideline && !coordinatorLoading && (
              <div style={{ fontSize: 12, color: "#7a5400", marginBottom: 12, padding: "8px 12px", background: "rgba(201,168,76,0.08)", borderRadius: 8, border: "0.5px solid rgba(201,168,76,0.3)", lineHeight: 1.55 }}>
                <span style={{ fontWeight: 600, marginRight: 6 }}>👑 코디네이터:</span>{coordinatorGuideline}
              </div>
            )}

            {/* Pipeline error */}
            {pipelineError && (
              <div style={{ background: "#fdecea", border: "1px solid #f5c6cb", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#9b1c1c" }}>
                ✗ {pipelineError}
              </div>
            )}

            {/* HITL warning */}
            <HitlWarning
              show={showHitlWarning}
              reason={hitlReason}
              onDismiss={() => setShowHitlWarning(false)}
            />

            {/* Summary (Synthesizer output) */}
            <SummaryBlock summary={summary} loading={summaryLoading} conflicts={conflicts} />

            {/* Agent cards */}
            {selectedKeys.map(key => (
              <AgentBlock key={key} agentKey={key} result={agentResults[key]} status={agentStatus[key] || "idle"} />
            ))}

            {/* Disclaimer footer */}
            <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 16, paddingTop: 12, borderTop: "0.5px solid #f0f0f0" }}>
              본 분석은 AI가 생성한 정보로 투자 권유가 아닙니다. 투자 결정은 본인 판단과 책임 하에 이루어져야 합니다.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
