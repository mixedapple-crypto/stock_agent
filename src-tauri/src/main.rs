#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Client;
use serde_json::json;
use std::collections::HashMap;

// --- Helper Functions ---

fn get_env(key: &str) -> String {
    match key {
        "GEMINI_API_KEY" => option_env!("GEMINI_API_KEY").map(|s| s.to_string()).unwrap_or_else(|| std::env::var(key).unwrap_or_else(|_| "".to_string())),
        "FINNHUB_API_KEY" => option_env!("FINNHUB_API_KEY").map(|s| s.to_string()).unwrap_or_else(|| std::env::var(key).unwrap_or_else(|_| "".to_string())),
        _ => std::env::var(key).unwrap_or_else(|_| "".to_string()),
    }
}

async fn call_gemini(client: &Client, system_instruction: &str, prompt: &str) -> Result<String, String> {
    let api_key = get_env("GEMINI_API_KEY");
    if api_key.is_empty() { return Err("GEMINI_API_KEY is not set in .env".to_string()); }

    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}", api_key);
    
    let payload = json!({
        "systemInstruction": { "parts": [{ "text": system_instruction }] },
        "contents": [{ "parts": [{ "text": prompt }] }]
    });

    let res = client.post(&url).json(&payload).send().await.map_err(|e| e.to_string())?;
    let json_res: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(text) = json_res["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        Ok(text.to_string())
    } else {
        Err("Failed to parse Gemini response".to_string())
    }
}

async fn call_gemini_json(client: &Client, system_instruction: &str, prompt: &str, schema: serde_json::Value) -> Result<serde_json::Value, String> {
    let api_key = get_env("GEMINI_API_KEY");
    if api_key.is_empty() { return Err("GEMINI_API_KEY is not set in .env".to_string()); }

    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}", api_key);
    
    let payload = json!({
        "systemInstruction": { "parts": [{ "text": system_instruction }] },
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema
        }
    });

    let res = client.post(&url).json(&payload).send().await.map_err(|e| e.to_string())?;
    let json_res: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(text) = json_res["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        let parsed: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        Ok(parsed)
    } else {
        Err("Failed to parse Gemini JSON response".to_string())
    }
}


// --- Tauri Commands ---

#[tauri::command]
async fn extract_ticker_with_ai(query: String) -> Result<String, String> {
    let client = Client::new();
    let sys = "사용자의 입력에서 가장 핵심이 되는 주식 종목을 찾아 공식 티커(Symbol)를 추출하세요.\n- 미국 주식은 대문자 알파벳 티커 (예: AAPL, PLTR, LUNR)\n- 한국 주식은 6자리 숫자 뒤에 .KS (코스피) 또는 .KQ (코스닥) 부착 (예: 005930.KS, 035720.KQ)\n- 종목이 없으면 'NONE' 반환\n부가 설명 없이 오직 티커 1개만 출력하세요.";
    let res = call_gemini(&client, sys, &query).await?;
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
    if api_key.is_empty() { return Err("FINNHUB_API_KEY not set".to_string()); }
    
    let client = Client::new();
    
    // Dates for news
    let to_date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let from_date = (chrono::Utc::now() - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();

    let q_url = format!("https://finnhub.io/api/v1/quote?symbol={}&token={}", ticker, api_key);
    let p_url = format!("https://finnhub.io/api/v1/stock/profile2?symbol={}&token={}", ticker, api_key);
    let m_url = format!("https://finnhub.io/api/v1/stock/metric?symbol={}&metric=all&token={}", ticker, api_key);
    let n_url = format!("https://finnhub.io/api/v1/company-news?symbol={}&from={}&to={}&token={}", ticker, from_date, to_date, api_key);

    let (q_res, p_res, m_res, n_res) = tokio::join!(
        client.get(&q_url).send(),
        client.get(&p_url).send(),
        client.get(&m_url).send(),
        client.get(&n_url).send()
    );

    let quote: serde_json::Value = q_res.map_err(|e| e.to_string())?.json().await.unwrap_or(json!({}));
    let profile: serde_json::Value = p_res.map_err(|e| e.to_string())?.json().await.unwrap_or(json!({}));
    let metrics_raw: serde_json::Value = m_res.map_err(|e| e.to_string())?.json().await.unwrap_or(json!({}));
    let mut news_raw: Vec<serde_json::Value> = n_res.map_err(|e| e.to_string())?.json().await.unwrap_or(vec![]);

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

#[tauri::command]
async fn call_agent(agent_key: String, query: String, context_data: Option<serde_json::Value>) -> Result<String, String> {
    let client = Client::new();
    
    let persona = match agent_key.as_str() {
        "macro" => "당신은 거시경제 전문가입니다. GDP 성장률, 금리, 인플레이션, 환율, 등 거시경제 지표 측면에서 분석합니다.",
        "technical" => "당신은 기술적 분석 전문가입니다. 차트 패턴, 이동평균선, 거래량 등 기술적 지표를 활용합니다.",
        "fundamental" => "당신은 기본적 분석 전문가입니다. PER, PBR, ROE 등을 분석합니다.",
        "sentiment" => "당신은 시장심리 전문가입니다. 최신 뉴스 바탕으로 뉴스 센티멘트를 분석합니다.",
        "risk" => "당신은 리스크 관리자입니다. 시장 리스크, 신용 리스크 등을 분석합니다.",
        _ => "당신은 주식 분석가입니다."
    };

    let mut ctx_str = String::new();
    if let Some(data) = context_data {
        if let Some(symbol) = data.get("symbol") {
            ctx_str.push_str(&format!("\n[Finnhub 데이터 - {}]\n", symbol.as_str().unwrap_or("")));
            
            let q = &data["quote"];
            ctx_str.push_str(&format!("현재가: {} (변동: {}%)\n", q["c"], q["dp"]));
            
            let p = &data["profile"];
            ctx_str.push_str(&format!("섹터: {}\n", p["finnhubIndustry"].as_str().unwrap_or("-")));

            let m = &data["metrics"];
            ctx_str.push_str(&format!("PER(TTM): {}\nROE(TTM): {}%\n", m["peTTM"], m["roeTTM"]));
        }
    }

    let prompt = format!("다음 주제에 대해 전문가 관점에서 분석해주세요: {}\n{}\n분석 시 구체적이고 실용적인 통찰을 제공하고, HTML <p> 태그로 문단을 구분해주세요. <strong> 태그로 핵심 용어를 강조하세요.", query, ctx_str);

    let res = call_gemini(&client, persona, &prompt).await?;
    let cleaned = res.replace("```html", "").replace("```", "");
    Ok(cleaned)
}

#[tauri::command]
async fn get_summary(query: String, results_map: HashMap<String, String>, context_data: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let client = Client::new();

    let mut combined = String::new();
    for (k, v) in results_map {
        let v_clean = v.replace("<p>", " ").replace("</p>", " ").replace("<strong>", "").replace("</strong>", "");
        combined.push_str(&format!("[{}]: {}\n\n", k, v_clean.chars().take(400).collect::<String>()));
    }

    let mut ctx_str = String::new();
    if let Some(data) = context_data {
        let q = &data["quote"];
        ctx_str = format!("[기준가: {}, 변동: {}%]", q["c"], q["dp"]);
    }

    let sys = "당신은 수석 투자 전략가입니다. 여러 전문가의 분석을 종합하여 최종 투자 의견을 반환하세요. JSON 스키마를 엄격히 준수하세요.";
    let prompt = format!("분석 주제: {} {}\n\n[에이전트 분석]\n{}", query, ctx_str, combined);

    let schema = json!({
        "type": "OBJECT",
        "properties": {
            "verdict": { "type": "STRING", "enum": ["매수", "보유", "매도", "관망"] },
            "confidence": { "type": "STRING", "enum": ["높음", "보통", "낮음"] },
            "summary": { "type": "STRING" },
            "upside": { "type": "STRING" },
            "downside": { "type": "STRING" },
            "timeframe": { "type": "STRING", "enum": ["단기(1-3개월)", "중기(3-6개월)", "장기(6개월+)"] }
        },
        "required": ["verdict", "confidence", "summary", "upside", "downside", "timeframe"]
    });

    call_gemini_json(&client, sys, &prompt, schema).await
}

fn main() {
    let _ = dotenvy::dotenv(); // Load .env file

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            extract_ticker_with_ai,
            fetch_finnhub,
            call_agent,
            get_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
