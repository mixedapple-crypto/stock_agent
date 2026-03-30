import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
  "현대차": "005380"
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

function AgentBlock({ agentKey, result, status }) {
  const agent = AGENTS[agentKey];
  return (
    <div style={{ border: "0.5px solid #e0e0e0", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: agent.bgVar, borderBottom: "0.5px solid #e0e0e0" }}>
        <span style={{ fontSize: 16 }}>{agent.emoji}</span>
        <span style={{ fontWeight: 500, fontSize: 13 }}>{agent.name}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: status === "done" ? "#1D9E75" : status === "thinking" ? "#BA7517" : "#999" }}>
          {status === "done" ? "✓ 완료" : status === "thinking" ? "분석 중..." : "대기"}
        </span>
      </div>
      <div style={{ padding: "14px", background: "#fff", fontSize: 13, lineHeight: 1.7, color: "#222" }}>
        {status === "idle" && <span style={{ color: "#aaa" }}>준비 중...</span>}
        {status === "thinking" && <><Spinner />분석을 시작합니다...</>}
        {status === "done" && result && <div dangerouslySetInnerHTML={{ __html: result }} />}
        {status === "error" && <span style={{ color: "#E24B4A" }}>분석 중 오류가 발생했습니다.</span>}
      </div>
    </div>
  );
}

function SummaryBlock({ summary, loading }) {
  if (loading) {
    return (
      <div style={{ background: "#f5f5f5", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", color: "#888", marginBottom: 8 }}>종합 의견</div>
        <Spinner /><span style={{ fontSize: 13, color: "#999" }}>전문가 분석 완료 후 생성됩니다...</span>
      </div>
    );
  }
  if (!summary) return null;
  const vs = VERDICT_STYLES[summary.verdict] || VERDICT_STYLES["관망"];
  return (
    <div style={{ background: "#f5f5f5", borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", color: "#888", marginBottom: 10 }}>종합 의견</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ padding: "3px 12px", borderRadius: 12, fontSize: 13, fontWeight: 500, background: vs.bg, color: vs.color }}>{summary.verdict}</span>
        <span style={{ fontSize: 12, color: "#888" }}>신뢰도: {summary.confidence} | {summary.timeframe}</span>
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

    let fetchedData = null;
    let finalTicker = null;

    setFinnhubStatus("fetching");
    let upperQ = q.toUpperCase();

    Object.entries(TICKER_MAP).forEach(([korName, ticker]) => {
      if (upperQ.includes(korName)) {
        upperQ += ` ${ticker}`;
      }
    });

    const matches = upperQ.match(/\b([A-Z]{1,5}(?:[\.\-][A-Z]{1,2})?|[0-9]{6})\b/g);
    if (matches) {
      const potentialTickers = matches.filter(t => !["I", "A"].includes(t));
      if (potentialTickers.length > 0) {
        finalTicker = potentialTickers[0];
        if (finalTicker.length === 6 && !isNaN(finalTicker)) finalTicker += ".KS";
      }
    }

    if (!finalTicker) {
      try {
        finalTicker = await invoke("extract_ticker_with_ai", { query: q });
      } catch (e) {
        console.error("Failed to extract ticker from Rust", e);
      }
    }

    if (finalTicker) {
      try {
        const data = await invoke("fetch_finnhub", { ticker: finalTicker });
        if (data && data.quote && data.quote.c) {
          fetchedData = data;
          setFinnhubData(data);
        }
      } catch (e) {
        console.error("Finnhub fetch error", e);
      }
    }
    setFinnhubStatus("done");

    const results = {};
    await Promise.all(selected.map(async (key) => {
      setAgentStatus(prev => ({ ...prev, [key]: "thinking" }));
      try {
        const result = await invoke("call_agent", { agentKey: key, query: q, contextData: fetchedData });
        results[key] = result;
        setAgentResults(prev => ({ ...prev, [key]: result }));
        setAgentStatus(prev => ({ ...prev, [key]: "done" }));
      } catch (e) {
        console.error("Agent error", e);
        setAgentStatus(prev => ({ ...prev, [key]: "error" }));
      }
    }));

    setSummaryLoading(true);
    try {
      const summaryResult = await invoke("get_summary", { query: q, resultsMap: results, contextData: fetchedData });
      setSummary(summaryResult);
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
      <div style={{ padding: "18px 20px 14px", borderBottom: "0.5px solid #e0e0e0" }}>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 3 }}>🦀 Rust Stock Agent Team (Tauri Desktop)</div>
        <div style={{ fontSize: 12, color: "#888" }}>API 키는 백엔드(.env)가 관리하여 안전하게 실행됩니다.</div>
      </div>
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
      <div style={{ padding: "16px 20px", maxHeight: 540, overflowY: "auto" }}>
        {!analysisStarted ? (
          <div style={{ textAlign: "center", padding: "48px 16px", color: "#aaa" }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6, color: "#555" }}>에이전트 팀이 준비되었습니다</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>Rust 백엔드로 구동되는 네이티브 데스크톱 앱입니다.<br />모든 통신과 데이터 파싱은 메인 프로세스(Rust)에서 안전하게 이뤄집니다.</div>
          </div>
        ) : (
          <>
            {finnhubStatus === "fetching" && <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}><Spinner /> Rust 백엔드에서 실시간 재무 데이터 수집 중...</div>}
            {finnhubData && finnhubData.quote && (
              <div style={{ background: "#e8f4fd", borderRadius: 10, padding: "12px 16px", marginBottom: 16, border: "1px solid #cce5ff" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0056b3", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                  <span>⚡ Finnhub 데이터 로드 완료 ({finnhubData.symbol})</span>
                  <span style={{ fontWeight: 400, color: "#555" }}>{finnhubData.profile?.finnhubIndustry || "섹터 정보 없음"}</span>
                </div>
                <div style={{ fontSize: 12, color: "#333", display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: 8 }}>
                  <span><strong>현재가:</strong> {finnhubData.symbol.endsWith(".KS") ? "₩" : "$"}{finnhubData.quote.c} <span style={{ color: finnhubData.quote.dp > 0 ? "#1D9E75" : "#E24B4A" }}>({finnhubData.quote.dp?.toFixed(2)}%)</span></span>
                  <span><strong>PER:</strong> {finnhubData.metrics?.peTTM?.toFixed(2) || "-"}</span>
                  <span><strong>ROE:</strong> {finnhubData.metrics?.roeTTM?.toFixed(2) || "-"}%</span>
                </div>
              </div>
            )}
            <SummaryBlock summary={summary} loading={summaryLoading} />
            {selectedKeys.map(key => <AgentBlock key={key} agentKey={key} result={agentResults[key]} status={agentStatus[key] || "idle"} />)}
          </>
        )}
      </div>
    </div>
  );
}
