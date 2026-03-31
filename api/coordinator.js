export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { query, contextData } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const sys = "당신은 주식 분석 팀의 수석 코디네이터입니다.\n주어진 금융 데이터와 사용자 쿼리를 분석하여, 5개 전문 에이전트(거시경제, 기술적, 기본적, 시장심리, 리스크)가 집중해야 할 핵심 분석 방향을 하나의 지침으로 요약하세요.\n200자 이내, 한국어, 핵심만 서술하세요.";
    
    let ctxStr = `분석 요청: ${query}\n`;
    if (contextData) {
      const q = contextData.quote || {};
      const p = contextData.profile || {};
      const m = contextData.metrics || {};
      const symbol = contextData.symbol || "-";
      const price = q.c || 0.0;
      const dp = q.dp || 0.0;
      const industry = p.finnhubIndustry || "-";
      const pe = m.peTTM || 0.0;
      const beta = m.beta || 0.0;

      ctxStr += `종목: ${symbol} | 현재가: ${price.toFixed(2)} (${dp > 0 ? '+' : ''}${dp.toFixed(2)}%)\n섹터: ${industry}\nPER: ${pe.toFixed(1)} | Beta: ${beta.toFixed(2)}\n`;

      if (contextData.news && contextData.news.length > 0) {
        ctxStr += "최근 뉴스:\n";
        for (let i = 0; i < Math.min(2, contextData.news.length); i++) {
          ctxStr += `• ${contextData.news[i].headline}\n`;
        }
      }
    }
    ctxStr += "\n이번 분석의 핵심 초점을 지침으로 정리해주세요.";

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 300,
        temperature: 0.2,
        system: sys,
        messages: [{ role: "user", content: ctxStr }]
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
