const assert = require('node:assert/strict');
const test = require('node:test');
const {
  answerQuestion,
  answerWithOpenAI,
  answerWithLocalAgent,
  answerWithOllama,
} = require('../server/library-agent');

function geminiResponse(parts) {
  return {
    ok: true,
    async json() {
      return { candidates: [{ content: { role: 'model', parts } }] };
    },
  };
}

test('Gemini agent calls the database tool and returns the model answer', async () => {
  const requests = [];
  const queries = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return geminiResponse([{
        functionCall: { name: 'search_books', args: { query: 'Python' } },
      }]);
    }
    return geminiResponse([{ text: 'Python Programming is available.' }]);
  };
  const query = async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ title: 'Python Programming', available_copies: 2 }] };
  };

  const answer = await answerQuestion({
    apiKey: 'test-key',
    message: 'Is there a Python book?',
    query,
    userId: 17,
    fetchImpl,
  });

  assert.equal(answer, 'Python Programming is available.');
  assert.equal(requests.length, 2);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ['%Python%']);
  assert.match(queries[0].sql, /\$1/);
  assert.equal(requests[1].body.contents.at(-1).role, 'user');
  assert.equal(
    requests[1].body.contents.at(-1).parts[0].functionResponse.name,
    'search_books',
  );
});

test('student loan tool is scoped to the authenticated student ID', async () => {
  let calledQuery;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.contents.length === 1) {
      return geminiResponse([{
        functionCall: { name: 'get_my_loans', args: {} },
      }]);
    }
    return geminiResponse([{ text: 'You have one active loan.' }]);
  };

  const answer = await answerQuestion({
    apiKey: 'test-key',
    message: 'What books have I borrowed?',
    query: async (sql, params) => {
      calledQuery = { sql, params };
      return { rows: [] };
    },
    userId: 42,
    fetchImpl,
  });

  assert.equal(answer, 'You have one active loan.');
  assert.match(calledQuery.sql, /student_id=\$1/);
  assert.deepEqual(calledQuery.params, [42]);
});

test('agent reports missing Gemini configuration without calling the network', async () => {
  await assert.rejects(
    answerQuestion({
      apiKey: '',
      message: 'Find a book',
      query: async () => ({ rows: [] }),
      userId: 1,
      fetchImpl: async () => {
        assert.fail('Gemini should not be called without an API key.');
      },
    }),
    /Add GEMINI_API_KEY/,
  );
});

test('OpenAI agent calls the database tool and returns the model answer', async () => {
  const requests = [];
  const queries = [];
  const fetchImpl = async (_url, options) => {
    requests.push({
      authorization: options.headers.Authorization,
      body: JSON.parse(options.body),
    });
    if (requests.length === 1) {
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'call-search-1',
                  type: 'function',
                  function: {
                    name: 'search_books',
                    arguments: JSON.stringify({ query: 'Python' }),
                  },
                }],
              },
            }],
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { role: 'assistant', content: 'Python Programming is available.' } }] };
      },
    };
  };

  const answer = await answerWithOpenAI({
    apiKey: 'test-key',
    message: 'Is there a Python book?',
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ title: 'Python Programming', available_copies: 2 }] };
    },
    userId: 17,
    fetchImpl,
  });

  assert.equal(answer, 'Python Programming is available.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].authorization, 'Bearer test-key');
  assert.equal(requests[0].body.model, 'gpt-4o-mini');
  assert.equal(requests[0].body.tools[0].function.name, 'search_books');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ['%Python%']);
  assert.match(queries[0].sql, /\$1/);
  assert.equal(requests[1].body.messages.at(-1).tool_call_id, 'call-search-1');
});

test('OpenAI agent reports missing configuration without calling the network', async () => {
  await assert.rejects(
    answerWithOpenAI({
      apiKey: '',
      message: 'Find a book',
      query: async () => ({ rows: [] }),
      userId: 1,
      fetchImpl: async () => {
        assert.fail('OpenAI should not be called without an API key.');
      },
    }),
    /Add OPENAI_API_KEY/,
  );
});

test('local Ollama agent calls library tools and returns the model answer', async () => {
  const requests = [];
  const queries = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return {
        ok: true,
        async json() {
          return {
            message: {
              role: 'assistant',
              tool_calls: [{
                function: {
                  name: 'search_books',
                  arguments: { query: 'Python' },
                },
              }],
            },
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { message: { role: 'assistant', content: 'Python Programming is available.' } };
      },
    };
  };

  const answer = await answerWithOllama({
    model: 'qwen2.5:1.5b',
    message: 'Is there a Python book?',
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ title: 'Python Programming', available_copies: 2 }] };
    },
    userId: 17,
    fetchImpl,
  });

  assert.equal(answer, 'Python Programming is available.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.toString(), 'http://127.0.0.1:11434/api/chat');
  assert.equal(requests[0].body.model, 'qwen2.5:1.5b');
  assert.equal(requests[0].body.tools[0].function.parameters.type, 'object');
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /\$1/);
  assert.deepEqual(queries[0].params, ['%Python%']);
  assert.equal(requests[1].body.messages.at(-1).role, 'tool');
});

test('no-key local agent searches books and reports live availability', async () => {
  let calledQuery;
  const answer = await answerWithLocalAgent({
    message: 'Is Python Programming available?',
    query: async (sql, params) => {
      calledQuery = { sql, params };
      return {
        rows: [{
          title: 'Python Programming',
          author: 'Example Author',
          available_copies: 2,
        }],
      };
    },
    userId: 7,
  });

  assert.match(calledQuery.sql, /b\.title ILIKE \$1/);
  assert.deepEqual(calledQuery.params, ['%Python Programming%']);
  assert.match(answer, /Python Programming/);
  assert.match(answer, /2 available/);
});

test('no-key local agent limits loan and fine lookups to the signed-in student', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM book_issues')) {
      return { rows: [{ title: 'Example Book', status: 'ISSUED', due_date: '2026-11-01' }] };
    }
    return {
      rows: [{
        total: '5.00',
        fines: [{ title: 'Example Book', amount: '5.00', reason: 'Late return' }],
      }],
    };
  };

  const loans = await answerWithLocalAgent({
    message: 'What books have I borrowed?',
    query,
    userId: 37,
  });
  const fines = await answerWithLocalAgent({
    message: 'How much is my fine?',
    query,
    userId: 37,
  });

  assert.match(loans, /Example Book/);
  assert.match(fines, /₹5\.00/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.params[0] === 37));
});

test('no-key local agent answers borrowed-book count questions directly', async () => {
  const answer = await answerWithLocalAgent({
    message: 'How many books do I have?',
    query: async () => ({
      rows: [
        { title: 'One', status: 'ISSUED' },
        { title: 'Two', status: 'RETURNED' },
      ],
    }),
    userId: 9,
  });

  assert.equal(answer, 'You currently have 1 active borrowed book(s).');
});
