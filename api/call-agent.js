export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { agentKey, query, contextData, coordinatorGuideline } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const baseRules = "\n\n규칙:\n1. 반드시 제공된 데이터 내에서만 추론하라.\n2. 데이터에 없는 내용은 '데이터 없음'으로 명시하고 추측하지 마라.\n3. 응답은 한국어로, 불릿(•) 3~5개, 500자 이내.";
    let persona = "당신은 주식 분석가입니다.";
    if (agentKey === "macro") persona = "당신은 거시경제 전문가입니다. GDP 성장률, 금리, 인플레이션, 환율 등 거시경제 지표 측면에서 분석합니다.";
    else if (agentKey === "technical") persona = "당신은 기술적 분석 전문가입니다. 차트 패턴, 이동평균선, 거래량 등 기술적 지표를 활용합니다.";
    else if (agentKey === "fundamental") persona = "당신은 기본적 분석 전문가입니다. PER, PBR, ROE 등을 분석합니다.";
    else if (agentKey === "sentiment") persona = "당신은 시장심리 전문가입니다. 최신 뉴스 바탕으로 뉴스 센티멘트를 분석합니다.";
    else if (agentKey === "risk") persona = "당신은 리스크 관리자입니다. 시장 리스크, 신용 리스크 등을 분석합니다.";

    const system = persona + baseRules;

    let ctxStr = "";
    if (coordinatorGuideline) {
      ctxStr += `[코디네이터 지침]\n${coordinatorGuideline}\n\n`;
    }

    if (contextData && contextData.symbol) {
      ctxStr += `[Finnhub 실시간 데이터 — ${contextData.symbol}]\n`;
      const q = contextData.quote || {};
      ctxStr += `현재가: ${q.c || 0} | 변동: ${q.dp || 0}% | 당일 고점: ${q.h || 0} | 저점: ${q.l || 0}\n`;

      const p = contextData.profile || {};
      let marketCap = "-";
      if (p.marketCapitalization) marketCap = (p.marketCapitalization / 1000).toFixed(1) + "B USD";
      ctxStr += `섹터: ${p.finnhubIndustry || '-'} | 시가총액: ${marketCap}\n`;

      const m = contextData.metrics || {};
      const pe = m.peTTM ? m.peTTM.toFixed(1) : "-";
      const roe = m.roeTTM ? m.roeTTM.toFixed(1) : "-";
      const beta = m.beta ? m.beta.toFixed(2) : "-";
      ctxStr += `PER(TTM): ${pe} | ROE(TTM): ${roe}% | Beta: ${beta}\n`;

      if (agentKey === "sentiment" && contextData.news && contextData.news.length > 0) {
        ctxStr += "\n[최근 뉴스]\n";
        for (let i = 0; i < Math.min(3, contextData.news.length); i++) {
          const item = contextData.news[i];
          ctxStr += `${i+1}. [${item.source || '-'}] ${item.headline || '-'}\n`;
        }
      }
    }

    const prompt = `분석 주제: ${query}\n\n${ctxStr}전문가 관점에서 분석해주세요.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        temperature: 0.2,
        system: system,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Claude API error: ${err}` });
    }

    const data = await response.json();
    res.status(200).json({ data: data.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
