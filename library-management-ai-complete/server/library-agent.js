const MAX_TOOL_ROUNDS = 5;

const TOOL_DECLARATIONS = [
  {
    name: 'search_books',
    description: 'Search the library catalogue by title, author, ISBN, or book description and return availability.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'A short book title, author name, ISBN, or topic to search for.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_my_loans',
    description: 'Get the signed-in student’s current and recent loans, statuses, and due dates.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'get_my_unpaid_fines',
    description: 'Get the signed-in student’s total unpaid fine and the associated book titles.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
];

const SYSTEM_INSTRUCTION = [
  'You are LibraryAI, an assistant for a college library.',
  'Use tools for all claims about book catalogue, availability, a student’s loans, due dates, and fines.',
  'Never invent or estimate database facts. If a tool returns no records, say so clearly.',
  'The loan and fine tools are scoped to the authenticated student. Never ask for or infer another student’s private information.',
  'Answer general library questions briefly. For requests outside library help, politely explain your scope.',
].join(' ');

const LOCAL_HELP_ANSWER =
  'I can search the library catalogue and check your loans, due dates, and unpaid fines. Try asking “Is Python Programming available?”, “What books have I borrowed?”, or “How much is my unpaid fine?”.';

function toOllamaParameters(schema) {
  const properties = Object.fromEntries(
    Object.entries(schema.properties || {}).map(([name, property]) => [
      name,
      toOllamaParameters(property),
    ]),
  );
  const result = {
    type: schema.type.toLowerCase(),
    ...(Object.keys(properties).length ? { properties } : {}),
  };
  if (schema.required) result.required = schema.required;
  if (schema.description) result.description = schema.description;
  return result;
}

const OLLAMA_TOOLS = TOOL_DECLARATIONS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: toOllamaParameters(tool.parameters),
  },
}));

class AgentProviderError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getErrorMessage(payload, status, provider = 'Gemini') {
  const message = payload?.error?.message;
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key. Check the configured API key in the project .env file.`;
  }
  if (status === 429) {
    return `${provider} rate limit or quota reached. Check your provider account quota.`;
  }
  return message || `${provider} request failed with HTTP ${status}.`;
}

async function callGemini({ apiKey, model, contents, fetchImpl }) {
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  );
  endpoint.searchParams.set('key', apiKey);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 700,
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AgentProviderError('Could not reach Gemini. Check your internet connection and try again.', 502);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const statusCode = response.status === 429 || response.status === 401 || response.status === 403
      ? 503
      : 502;
    throw new AgentProviderError(getErrorMessage(payload, response.status), statusCode);
  }
  return payload;
}

function getOpenAIErrorMessage(payload, status) {
  const message = payload?.error?.message;
  if (status === 401 || status === 403) {
    return 'OpenAI rejected the API key. Check OPENAI_API_KEY in the project .env file.';
  }
  if (status === 429) {
    return 'OpenAI rate limit or quota reached. Check your OpenAI project quota.';
  }
  return message || `OpenAI request failed with HTTP ${status}.`;
}

async function callOpenAI({ apiKey, model, messages, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: OLLAMA_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AgentProviderError('Could not reach OpenAI. Check your internet connection and try again.', 502);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const statusCode = response.status === 429 || response.status === 401 || response.status === 403
      ? 503
      : 502;
    throw new AgentProviderError(getOpenAIErrorMessage(payload, response.status), statusCode);
  }
  return payload;
}

async function callOllama({ baseUrl, model, messages, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(new URL('/api/chat', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        tools: OLLAMA_TOOLS,
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new AgentProviderError(
      'Could not reach the local AI model. Start Ollama and make sure the configured model is installed.',
      503,
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error || `Ollama request failed with HTTP ${response.status}.`;
    throw new AgentProviderError(message, response.status === 404 ? 503 : 502);
  }
  return payload;
}

async function runTool(name, args, { query, userId }) {
  if (name === 'search_books') {
    const term = String(args?.query || '').trim().slice(0, 120);
    if (!term) return { books: [] };

    const result = await query(
      `SELECT title,author,isbn,category_name,available_copies,total_copies,status
       FROM (
         SELECT b.title,b.author,b.isbn,c.name AS category_name,b.available_copies,b.total_copies,b.status
         FROM books b
         LEFT JOIN categories c ON c.id=b.category_id
         WHERE b.status<>'INACTIVE'
           AND (b.title ILIKE $1 OR b.author ILIKE $1 OR b.isbn ILIKE $1 OR b.description ILIKE $1)
         ORDER BY b.title
         LIMIT 8
       ) matches`,
      [`%${term}%`],
    );
    return { books: result.rows };
  }

  if (name === 'get_my_loans') {
    const result = await query(
      `SELECT b.title,b.author,i.status,i.due_date::text AS due_date,i.return_date::text AS return_date
       FROM book_issues i
       JOIN books b ON b.id=i.book_id
       WHERE i.student_id=$1
       ORDER BY i.created_at DESC
       LIMIT 20`,
      [userId],
    );
    return { loans: result.rows };
  }

  if (name === 'get_my_unpaid_fines') {
    const result = await query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total,
         COALESCE(json_agg(json_build_object('title',b.title,'amount',f.amount,'reason',f.reason))
           FILTER (WHERE f.id IS NOT NULL), '[]'::json) AS fines
       FROM fines f
       JOIN book_issues i ON i.id=f.issue_id
       JOIN books b ON b.id=i.book_id
       WHERE f.student_id=$1 AND f.status='UNPAID'`,
      [userId],
    );
    return result.rows[0];
  }

  throw new Error(`AI provider requested an unsupported library tool: ${name}`);
}

function localBookSearchTerm(message) {
  return message
    .replace(/\b(?:please|can you|could you|would you|tell me|show me|find|search for|search|look for|is there|do you have|is|available|availability|in the library|library|book|books|by|written by|a|an|the|about)\b/gi, ' ')
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function answerWithLocalAgent({ message, query, userId }) {
  const normalized = message.toLowerCase();
  if (/^\s*(hi|hello|hey|help|what can you do)[!.?\s]*$/.test(normalized)) {
    return LOCAL_HELP_ANSWER;
  }

  if (/\b(fine|fines|penalt(?:y|ies)|amount due|owe)\b/.test(normalized)) {
    const result = await runTool('get_my_unpaid_fines', {}, { query, userId });
    const total = Number(result?.total || 0);
    const details = Array.isArray(result?.fines) ? result.fines : [];
    if (!details.length || total <= 0) return 'You have no unpaid fines.';
    const breakdown = details
      .map((fine) => `${fine.title}: ₹${fine.amount}${fine.reason ? ` (${fine.reason})` : ''}`)
      .join('\n');
    return `Your unpaid fines total ₹${total.toFixed(2)}.\n${breakdown}`;
  }

  if (/\b(my loans|my books|books do i have|how many .*books|borrowed|checked out|due date|when.*due|overdue)\b/.test(normalized)) {
    const result = await runTool('get_my_loans', {}, { query, userId });
    const loans = Array.isArray(result?.loans) ? result.loans : [];
    const activeLoans = loans.filter((loan) => ['ISSUED', 'OVERDUE', 'RENEWAL_REQUESTED'].includes(loan.status));
    if (/\bhow many\b/.test(normalized)) {
      return `You currently have ${activeLoans.length} active borrowed book(s).`;
    }
    if (!activeLoans.length) return 'You have no active borrowed books.';
    return activeLoans
      .map((loan) => `${loan.title} — ${loan.status.toLowerCase().replaceAll('_', ' ')}, due ${loan.due_date}.`)
      .join('\n');
  }

  const term = localBookSearchTerm(message);
  if (!term) return LOCAL_HELP_ANSWER;
  const result = await runTool('search_books', { query: term }, { query, userId });
  const books = Array.isArray(result?.books) ? result.books : [];
  if (!books.length) return `I couldn't find books matching “${term}” in the catalogue.`;
  return books
    .map((book) => {
      const availability = Number(book.available_copies) > 0
        ? `${book.available_copies} available`
        : 'currently unavailable';
      return `${book.title} — ${book.author}; ${availability}.`;
    })
    .join('\n');
}

async function answerQuestion({
  apiKey,
  model = 'gemini-2.5-flash',
  message,
  query,
  userId,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error('AI is not configured yet. Add GEMINI_API_KEY to the project .env file and restart the app.');
  }

  const contents = [{ role: 'user', parts: [{ text: message }] }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callGemini({ apiKey, model, contents, fetchImpl });
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('Gemini did not return an answer. Please try rephrasing your question.');
    }

    const functionCalls = candidate.content.parts
      .filter((part) => part.functionCall)
      .map((part) => part.functionCall);
    if (functionCalls.length === 0) {
      const answer = candidate.content.parts
        .filter((part) => typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (!answer) throw new Error('Gemini returned an empty answer. Please try again.');
      return answer;
    }

    contents.push(candidate.content);
    const functionResponses = [];
    for (const call of functionCalls) {
      const result = await runTool(call.name, call.args, { query, userId });
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result },
        },
      });
    }
    contents.push({ role: 'user', parts: functionResponses });
  }

  throw new Error('The assistant could not finish its database lookup. Please try a simpler question.');
}

async function answerWithOpenAI({
  apiKey,
  model = 'gpt-4o-mini',
  message,
  query,
  userId,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new AgentProviderError(
      'OpenAI is selected but not configured. Add OPENAI_API_KEY to the project .env file.',
      503,
    );
  }

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: message },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callOpenAI({ apiKey, model, messages, fetchImpl });
    const assistantMessage = response.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new AgentProviderError('OpenAI did not return an answer. Please try rephrasing your question.', 502);
    }

    const toolCalls = assistantMessage.tool_calls || [];
    if (toolCalls.length === 0) {
      const answer = String(assistantMessage.content || '').trim();
      if (!answer) {
        throw new AgentProviderError('OpenAI returned an empty answer. Please try again.', 502);
      }
      return answer;
    }

    messages.push(assistantMessage);
    for (const toolCall of toolCalls) {
      let args;
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        throw new AgentProviderError('OpenAI returned an invalid library-tool request. Please try again.', 502);
      }
      const result = await runTool(toolCall.function?.name, args, { query, userId });
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  throw new AgentProviderError(
    'The assistant could not finish its database lookup. Please try a simpler question.',
    502,
  );
}

async function answerWithOllama({
  baseUrl = 'http://127.0.0.1:11434',
  model = 'qwen2.5:1.5b',
  message,
  query,
  userId,
  fetchImpl = fetch,
}) {
  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: message },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callOllama({ baseUrl, model, messages, fetchImpl });
    const assistantMessage = response.message;
    if (!assistantMessage) {
      throw new Error('The local model did not return an answer. Please try rephrasing your question.');
    }

    const toolCalls = assistantMessage.tool_calls || [];
    if (toolCalls.length === 0) {
      const answer = String(assistantMessage.content || '').trim();
      if (!answer) throw new Error('The local model returned an empty answer. Please try again.');
      return answer;
    }

    messages.push(assistantMessage);
    for (const toolCall of toolCalls) {
      const name = toolCall.function?.name;
      const result = await runTool(name, toolCall.function?.arguments, { query, userId });
      messages.push({
        role: 'tool',
        tool_name: name,
        content: JSON.stringify(result),
      });
    }
  }

  throw new Error('The assistant could not finish its database lookup. Please try a simpler question.');
}

module.exports = {
  answerQuestion,
  answerWithOpenAI,
  answerWithLocalAgent,
  answerWithOllama,
  AgentProviderError,
};
