const Gemini = (() => {
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
  // Time an attempt must have left before it's started.
  const MIN_MS_PER_ATTEMPT = 90 * 1000;

  function generateDailyBriefing(payload) {
    const body = {
      system_instruction: {
        parts: [{ text: buildSystemPrompt() }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: JSON.stringify(payload) }]
        }
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: briefingSchema(),
        temperature: 0.2
      }
    };

    const response = callGenerateContent(body);
    return JSON.parse(extractOutputText(response));
  }

  function callGenerateContent(body) {
    const model = Config.all().geminiModel;
    const key = encodeURIComponent(Config.requireValue('GEMINI_API_KEY'));
    const url = `${BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${key}`;

    AppLogger.incrementApi('Gemini');

    let response;
    let status;
    let text;
    const maxRetries = 5;
    let delay = 2000;

    for (let i = 0; i < maxRetries; i++) {
      // A generation can take a minute or more. Rather than start one the
      // execution may be killed in the middle of, stop here and let the run
      // resume in a fresh execution (see Utils.setDeadline).
      Utils.checkDeadline(MIN_MS_PER_ATTEMPT);
      try {
        response = UrlFetchApp.fetch(url, {
          method: 'post',
          muteHttpExceptions: true,
          contentType: 'application/json',
          payload: JSON.stringify(body)
        });

        status = response.getResponseCode();
        text = response.getContentText();

        if (status === 503 || status === 429) {
          throw new Error(`Transient error ${status}`);
        }

        if (status < 200 || status >= 300) {
          throw new Error(`Gemini HTTP ${status}: ${text.slice(0, 1000)}`);
        }

        break; 
        
      } catch (error) {
        if (i === maxRetries - 1 || !error.message.includes('Transient error')) {
          throw new Error(error.message.includes('Transient error') ? `Gemini HTTP ${status}: ${text.slice(0, 1000)}` : error);
        }
        Utils.checkDeadline(delay + MIN_MS_PER_ATTEMPT);
        Utilities.sleep(delay);
        delay *= 2;
      }
    }

    const parsed = JSON.parse(text);
    const usage = parsed.usageMetadata || {};
    AppLogger.addTokens(usage.totalTokenCount || usage.promptTokenCount || 0);
    return parsed;
  }

  function extractOutputText(response) {
    try {
      return response.candidates[0].content.parts[0].text;
    } catch (e) {
      throw new Error('Failed to extract text from Gemini response');
    }
  }

  function buildSystemPrompt() {
    return [
      'You are Portfolio Intelligence Bot, a cautious investment research assistant.',
      'Write a detailed, factual, non-hype personal portfolio briefing. Be specific: cite the numbers you were given (percent moves, prices, P/E, distance from the 52-week high and low, volume versus average, earnings dates, position weight and P/L) and name the companies, sources and events behind each point.',
      'Use the provided market, portfolio, news, alert, and macro inputs to formulate the brief.',
      'portfolioSummary: 4-6 bullets on the whole portfolio today - the overall move, which holdings contributed and detracted most, sector and market concentration, and anything that changes the portfolio\'s risk.',
      'upcomingEvents: bullets for earnings dates and other dated catalysts in the inputs over the next two weeks, each with the ticker and date.',
      'Holdings span several markets and asset classes: each holding\'s price and positionValue are in its own currency field; portfolioStats and positionValueBase are in portfolioStats.baseCurrency. Never add values across currencies yourself.',
      'Only write companyUpdates for listed stocks and ETFs in holdings; skip cash. Crypto may be included when it moved materially.',
      'Avoid repeated facts, generic filler, and empty-section wording. Each field may be 2-4 sentences; say less only when the inputs have little to say.',

      'For each companyUpdate item, structure the response explicitly:',
      '- whyMoved must sound like "Today\'s Critical News: [Content]" - what happened, from which source, and how it likely relates to the move',
      '- outlook must NOT contain emojis. It will be prefixed by the script. Cover the near-term setup and what to watch next.',
      '- risks must sound like "Key Risks & Alerts: [Content]"',
      '- positioning: where the price sits in its 52-week range, volume versus average, valuation (P/E) and the holding\'s weight and unrealised P/L in the portfolio',
      '- catalysts: upcoming dated events for this holding (earnings, product, regulatory), or an empty string if none are in the inputs',

      'For macroOverview, divide findings neatly by categories using clean markdown arrays.',

      'Do not claim certainty about causation; say "likely" or "may" when inferring why a stock moved.',
      'Do not give personalized financial advice or direct buy/sell instructions.',
      'Return valid JSON matching the requested schema.'
    ].join(' ');
  }

  function briefingSchema() {
    return {
      type: 'OBJECT',
      required: [
        'date',
        'companyUpdates',
        'macroOverview',
        'todaysRisks',
        'todaysOpportunities'
      ],
      properties: {
        date: { type: 'STRING' },
        portfolioSummary: { type: 'ARRAY', items: { type: 'STRING' } },
        upcomingEvents: { type: 'ARRAY', items: { type: 'STRING' } },
        companyUpdates: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            required: ['ticker', 'priceChange', 'isBull', 'whyMoved', 'outlook', 'risks'],
            properties: {
              ticker: { type: 'STRING' },
              priceChange: { type: 'STRING' }, 
              isBull: { type: 'BOOLEAN' },     
              whyMoved: { type: 'STRING' },    
              outlook: { type: 'STRING' },     
              risks: { type: 'STRING' },
              positioning: { type: 'STRING' },
              catalysts: { type: 'STRING' }
            }
          }
        },
        macroOverview: {
          type: 'OBJECT',
          properties: {
            oil: { type: 'ARRAY', items: { type: 'STRING' } },
            fed: { type: 'ARRAY', items: { type: 'STRING' } },
            forexGold: { type: 'ARRAY', items: { type: 'STRING' } },
            technology: { type: 'ARRAY', items: { type: 'STRING' } },
            geopolitics: { type: 'ARRAY', items: { type: 'STRING' } },
            markets: { type: 'ARRAY', items: { type: 'STRING' } }
          }
        },
        todaysRisks: { type: 'ARRAY', items: { type: 'STRING' } },
        todaysOpportunities: { type: 'ARRAY', items: { type: 'STRING' } }
      }
    };
  }

  return {
    generateDailyBriefing
  };
})();