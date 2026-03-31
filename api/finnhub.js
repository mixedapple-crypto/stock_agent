export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Finnhub API key not configured' });

  try {
    const today = new Date();
    const toDate = today.toISOString().split('T')[0];
    const dt = new Date(today);
    dt.setDate(dt.getDate() - 7);
    const fromDate = dt.toISOString().split('T')[0];

    const [qRes, pRes, mRes, nRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${fromDate}&to=${toDate}&token=${apiKey}`)
    ]);

    const quote = await qRes.json().catch(() => ({}));
    const profile = await pRes.json().catch(() => ({}));
    const metricsRaw = await mRes.json().catch(() => ({}));
    let newsRaw = await nRes.json().catch(() => []);

    const metrics = metricsRaw.metric || {};
    newsRaw = Array.isArray(newsRaw) ? newsRaw.slice(0, 3) : [];

    res.status(200).json({
      data: {
        symbol: ticker,
        quote,
        profile,
        metrics,
        news: newsRaw
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
