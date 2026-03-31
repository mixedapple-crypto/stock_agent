#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Client;
use serde_json::json;
use std::collections::HashMap;

// --- Helper ---

fn get_env(key: &str) -> String {
    match key {
        "ANTHROPIC_API_KEY" => option_env!("ANTHROPIC_API_KEY")
            .map(|s| s.to_string())
            .unwrap_or_else(|| std::env::var(key).unwrap_or_else(|_| "".to_string())),
        "FINNHUB_API_KEY" => option_env!("FINNHUB_API_KEY")
            .map(|s| s.to_string())
            .unwrap_or_else(|| std::env::var(key).unwrap_or_else(|_| "".to_string())),
        _ => std::env::var(key).unwrap_or_else(|_| "".to_string()),
    }
}

// --- Claude API helpers ---

async fn call_claude(
    client: &Client,
    system_instruction: &str,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let api_key = get_env("ANTHROPIC_API_KEY");
    if api_key.is_empty() {
        return Err("ANTHROPIC_API_KEY is not set in .env".to_string());
    }

    let payload = json!({
        "model": "claude-sonnet-4-5",
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "system": system_instruction,
        "messages": [{ "role": "user", "content": prompt }]
    });

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Claude API error {}: {}", status, text));
    }

    let json_res: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    json_res["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to parse Claude response".to_string())
}

// Claude Tool Use — forces structured JSON output via function calling
async fn call_claude_tool_use(
    client: &Client,
    system_instruction: &str,
    prompt: &str,
    tool_name: &str,
    tool_description: &str,
    input_schema: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let api_key = get_env("ANTHROPIC_API_KEY");
    if api_key.is_empty() {
        return Err("ANTHROPIC_API_KEY is not set in .env".to_string());
    }

    let payload = json!({
        "model": "claude-sonnet-4-5",
        "max_tokens": 1024,
        "temperature": 0.2,
        "system": system_instruction,
        "tools": [{
            "name": tool_name,
            "description": tool_description,
            "input_schema": input_schema
        }],
        "tool_choice": { "type": "tool", "name": tool_name },
        "messages": [{ "role": "user", "content": prompt }]
    });

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Claude API error {}: {}", status, text));
    }

    let json_res: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let tool_use = json_res["content"]
        .as_array()
        .and_then(|arr| arr.iter().find(|b| b["type"] == "tool_use"));

    match tool_use {
        Some(block) => Ok(block["input"].clone()),
        None => Err("No tool_use block in Claude response".to_string()),
    }
}

// --- Tauri Commands ---

#[tauri::command]
async fn extract_ticker_with_ai(query: String) -> Result<String, String> {
    let client = Client::new();
    let sys = "사용자의 입력에서 가장 핵심이 되는 주식 종목을 찾아 공식 티커(Symbol)를 추출하세요.\n\
        - 미국 주식은 대문자 알파벳 티커 (예: AAPL, PLTR, NVDA)\n\
        - 한국 주식은 6자리 숫자 뒤에 .KS (코스피) 또는 .KQ (코스닥) 부착 (예: 005930.KS)\n\
        - 종목이 없으면 'NONE' 반환\n\
        부가 설명 없이 오직 티커 1개만 출력하세요.";

    let res = call_claude(&client, sys, &query, 20).await?;
    let mut ticker = res.trim().to_uppercase();
    if ticker.contains("NONE") {
        Ok("".to_string())
    } else {
        ticker.retain(|c| c.is_alphanumeric() || c == '.');
        Ok(ticker)
    }
}

#[tauri::command]
async fn fetch_finnhub(ticker: String) -> Result<serde_json::Value, String> {
    let api_key = get_env("FINNHUB_API_KEY");
    if api_key.is_empty() {
        return Err("FINNHUB_API_KEY not set".to_string());
    }

    let client = Client::new();

    let to_date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let from_date = (chrono::Utc::now() - chrono::Duration::days(7))
        .format("%Y-%m-%d")
        .to_string();

    let q_url = format!(
        "https://finnhub.io/api/v1/quote?symbol={}&token={}",
        ticker, api_key
    );
    let p_url = format!(
        "https://finnhub.io/api/v1/stock/profile2?symbol={}&token={}",
        ticker, api_key
    );
    let m_url = format!(
        "https://finnhub.io/api/v1/stock/metric?symbol={}&metric=all&token={}",
        ticker, api_key
    );
    let n_url = format!(
        "https://finnhub.io/api/v1/company-news?symbol={}&from={}&to={}&token={}",
        ticker, from_date, to_date, api_key
    );

    let (q_res, p_res, m_res, n_res) = tokio::join!(
        client.get(&q_url).send(),
        client.get(&p_url).send(),
        client.get(&m_url).send(),
        client.get(&n_url).send()
    );

    let quote: serde_json::Value = q_res
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(json!({}));
    let profile: serde_json::Value = p_res
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(json!({}));
    let metrics_raw: serde_json::Value = m_res
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(json!({}));
    let mut news_raw: Vec<serde_json::Value> = n_res
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or_default();

    let metrics = metrics_raw.get("metric").unwrap_or(&json!({})).clone();
    news_raw.truncate(3);

    Ok(json!({
        "symbol": ticker,
        "quote": quote,
        "profile": profile,
        "metrics": metrics,
        "news": news_raw
    }))
}

// Coordinator: analyzes query + market data → per-agent guideline
#[tauri::command]
async fn coordinator_agent(
    query: String,
    context_data: Option<serde_json::Value>,
) -> Result<String, String> {
    let client = Client::new();

    let sys = "당신은 주식 분석 팀의 수석 코디네이터입니다.\n\
        주어진 금융 데이터와 사용자 쿼리를 분석하여, \
        5개 전문 에이전트(거시경제, 기술적, 기본적, 시장심리, 리스크)가 집중해야 할 \
        핵심 분석 방향을 하나의 지침으로 요약하세요.\n\
        200자 이내, 한국어, 핵심만 서술하세요.";

    let mut ctx = format!("분석 요청: {}\n", query);

    if let Some(data) = context_data {
        let q = &data["quote"];
        let p = &data["profile"];
        let m = &data["metrics"];
        let symbol = data["symbol"].as_str().unwrap_or("-");
        let price = q["c"].as_f64().unwrap_or(0.0);
        let change_pct = q["dp"].as_f64().unwrap_or(0.0);
        let industry = p["finnhubIndustry"].as_str().unwrap_or("-");
        let pe = m["peTTM"].as_f64().unwrap_or(0.0);
        let beta = m["beta"].as_f64().unwrap_or(0.0);

        ctx.push_str(&format!(
            "종목: {} | 현재가: {:.2} ({:+.2}%)\n섹터: {}\nPER: {:.1} | Beta: {:.2}\n",
            symbol, price, change_pct, industry, pe, beta
        ));

        if let Some(news) = data["news"].as_array() {
            if !news.is_empty() {
                ctx.push_str("최근 뉴스:\n");
                for item in news.iter().take(2) {
                    if let Some(headline) = item["headline"].as_str() {
                        ctx.push_str(&format!("• {}\n", headline));
                    }
                }
            }
        }
    }

    ctx.push_str("\n이번 분석의 핵심 초점을 지침으로 정리해주세요.");

    call_claude(&client, sys, &ctx, 300).await
}

#[tauri::command]
async fn call_agent(
    agent_key: String,
    query: String,
    context_data: Option<serde_json::Value>,
    coordinator_guideline: Option<String>,
) -> Result<String, String> {
    let client = Client::new();

    let base_rules = "\n\n규칙:\n\
        1. 반드시 제공된 데이터 내에서만 추론하라.\n\
        2. 데이터에 없는 내용은 '데이터 없음'으로 명시하고 추측하지 마라.\n\
        3. 응답은 한국어로, 불릿(•) 3~5개, 500자 이내.";

    let persona = match agent_key.as_str() {
        "macro" => "당신은 거시경제 전문가입니다. GDP 성장률, 금리, 인플레이션, 환율 등 거시경제 지표 측면에서 분석합니다.",
        "technical" => "당신은 기술적 분석 전문가입니다. 차트 패턴, 이동평균선, 거래량 등 기술적 지표를 활용합니다.",
        "fundamental" => "당신은 기본적 분석 전문가입니다. PER, PBR, ROE 등을 분석합니다.",
        "sentiment" => "당신은 시장심리 전문가입니다. 최신 뉴스 바탕으로 뉴스 센티멘트를 분석합니다.",
        "risk" => "당신은 리스크 관리자입니다. 시장 리스크, 신용 리스크 등을 분석합니다.",
        _ => "당신은 주식 분석가입니다.",
    };

    let system = format!("{}{}", persona, base_rules);

    let mut ctx_str = String::new();

    if let Some(guideline) = coordinator_guideline {
        ctx_str.push_str(&format!("[코디네이터 지침]\n{}\n\n", guideline));
    }

    if let Some(data) = context_data {
        let symbol = data["symbol"].as_str().unwrap_or("");
        if !symbol.is_empty() {
            ctx_str.push_str(&format!("[Finnhub 실시간 데이터 — {}]\n", symbol));

            let q = &data["quote"];
            ctx_str.push_str(&format!(
                "현재가: {} | 변동: {}% | 당일 고점: {} | 저점: {}\n",
                q["c"], q["dp"], q["h"], q["l"]
            ));

            let p = &data["profile"];
            let market_cap = p["marketCapitalization"]
                .as_f64()
                .map(|v| format!("{:.1}B USD", v / 1000.0))
                .unwrap_or("-".to_string());
            ctx_str.push_str(&format!(
                "섹터: {} | 시가총액: {}\n",
                p["finnhubIndustry"].as_str().unwrap_or("-"),
                market_cap
            ));

            let m = &data["metrics"];
            let pe = m["peTTM"].as_f64().map(|v| format!("{:.1}", v)).unwrap_or("-".to_string());
            let roe = m["roeTTM"].as_f64().map(|v| format!("{:.1}", v)).unwrap_or("-".to_string());
            let beta = m["beta"].as_f64().map(|v| format!("{:.2}", v)).unwrap_or("-".to_string());
            ctx_str.push_str(&format!(
                "PER(TTM): {} | ROE(TTM): {}% | Beta: {}\n",
                pe, roe, beta
            ));

            // Sentiment agent additionally gets news
            if agent_key == "sentiment" {
                if let Some(news) = data["news"].as_array() {
                    ctx_str.push_str("\n[최근 뉴스]\n");
                    for (i, item) in news.iter().take(3).enumerate() {
                        let headline = item["headline"].as_str().unwrap_or("-");
                        let source = item["source"].as_str().unwrap_or("-");
                        ctx_str.push_str(&format!("{}. [{}] {}\n", i + 1, source, headline));
                    }
                }
            }
        }
    }

    let prompt = format!(
        "분석 주제: {}\n\n{}전문가 관점에서 분석해주세요.",
        query, ctx_str
    );

    call_claude(&client, &system, &prompt, 1000).await
}

#[tauri::command]
async fn get_summary(
    query: String,
    results_map: HashMap<String, String>,
    context_data: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let client = Client::new();

    let mut combined = String::new();
    for (k, v) in &results_map {
        combined.push_str(&format!(
            "[{}]: {}\n\n",
            k,
            v.chars().take(400).collect::<String>()
        ));
    }

    let mut ctx_str = String::new();
    if let Some(data) = context_data {
        let q = &data["quote"];
        ctx_str = format!("[현재가: {}, 변동: {}%]\n", q["c"], q["dp"]);
    }

    let sys = "당신은 수석 투자 전략가입니다. \
        여러 전문가의 분석을 종합하여 최종 투자 의견을 submit_verdict 도구로 제출하세요. \
        에이전트 간 의견이 충돌하는 경우 conflicts 필드에 반드시 기록하세요.";

    let prompt = format!(
        "분석 주제: {} {}\n\n[에이전트 분석 결과]\n{}",
        query, ctx_str, combined
    );

    let schema = json!({
        "type": "object",
        "required": ["verdict", "confidence", "summary", "upside", "downside", "timeframe", "conflicts"],
        "properties": {
            "verdict": {
                "type": "string",
                "enum": ["매수", "보유", "매도", "관망"],
                "description": "최종 투자 의견"
            },
            "confidence": {
                "type": "string",
                "enum": ["높음", "보통", "낮음"],
                "description": "분석 확신도"
            },
            "summary": {
                "type": "string",
                "description": "2문장 이내 종합 의견"
            },
            "upside": {
                "type": "string",
                "description": "주요 상승 촉매 요인"
            },
            "downside": {
                "type": "string",
                "description": "주요 하락 위험 요인"
            },
            "timeframe": {
                "type": "string",
                "enum": ["단기(1-3개월)", "중기(3-6개월)", "장기(6개월+)"],
                "description": "분석 시계"
            },
            "conflicts": {
                "type": "array",
                "description": "의견이 충돌하는 에이전트 쌍 목록 (없으면 빈 배열)",
                "items": {
                    "type": "object",
                    "required": ["agents", "reason"],
                    "properties": {
                        "agents": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "충돌하는 에이전트 키 (예: [\"technical\", \"risk\"])"
                        },
                        "reason": {
                            "type": "string",
                            "description": "충돌 이유"
                        }
                    }
                }
            }
        }
    });

    // 1 retry on failure (2 attempts total) per CLAUDE.md spec
    let mut last_err = String::new();
    for attempt in 1..=2 {
        match call_claude_tool_use(
            &client,
            sys,
            &prompt,
            "submit_verdict",
            "5개 에이전트 분석을 종합한 최종 투자 의견을 구조화된 형식으로 제출",
            schema.clone(),
        )
        .await
        {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_err = e;
                if attempt == 1 {
                    eprintln!("Synthesizer attempt 1 failed: {}, retrying...", last_err);
                }
            }
        }
    }

    Err(format!("Synthesizer failed after 2 attempts: {}", last_err))
}

fn main() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            extract_ticker_with_ai,
            fetch_finnhub,
            coordinator_agent,
            call_agent,
            get_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
