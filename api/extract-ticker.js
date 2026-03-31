export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const sys = "사용자의 입력에서 가장 핵심이 되는 주식 종목을 찾아 공식 티커(Symbol)를 추출하세요.\n- 미국 주식은 대문자 알파벳 티커 (예: AAPL, PLTR, NVDA)\n- 한국 주식은 6자리 숫자 뒤에 .KS (코스피) 또는 .KQ (코스닥) 부착 (예: 005930.KS)\n- 종목이 없으면 'NONE' 반환\n부가 설명 없이 오직 티커 1개만 출력하세요.";
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 20,
        temperature: 0.2,
        system: sys,
        messages: [{ role: "user", content: query }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Claude API error: ${err}` });
    }

    const data = await response.json();
    let ticker = data.content[0].text.trim().toUpperCase();
    if (ticker.includes("NONE")) ticker = "";
    else ticker = ticker.replace(/[^A-Z0-9.]/g, '');

    res.status(200).json({ data: ticker });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
