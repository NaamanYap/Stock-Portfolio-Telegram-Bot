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
      'Write concise, factual, non-hype bullet points for a personal portfolio briefing.',
      'Use the provided market, portfolio, news, alert, and macro inputs to formulate the brief.',
      'Holdings span several markets and asset classes: each holding\'s price and positionValue are in its own currency field; portfolioStats and positionValueBase are in portfolioStats.baseCurrency. Never add values across currencies yourself.',
      'Only write companyUpdates for listed stocks and ETFs in holdings; skip cash. Crypto may be included when it moved materially.',
      'Avoid long paragraphs, repeated facts, generic filler, and empty-section wording.',

      'For each companyUpdate item, structure the response explicitly:',
      '- whyMoved must sound like "Today\'s Critical News: [Content]"',
      '- outlook must NOT contain emojis. It will be prefixed by the script.',
      '- risks must sound like "Key Risks & Alerts: [Content]"',

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
              risks: { type: 'STRING' }        
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