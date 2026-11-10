const endpoint = 'https://api.openai.com/v1/responses';

function strictSchema(schema) {
  // The pre-stay schemas are flat objects. OpenAI strict mode requires every
  // property to be present, so omitted Gemini fields become nullable here.
  const required = new Set(schema.required);
  return {
    ...schema,
    required: Object.keys(schema.properties),
    properties: Object.fromEntries(Object.entries(schema.properties).map(([name, field]) => [
      name, required.has(name) ? field : { anyOf: [field, { type: 'null' }] },
    ])),
    additionalProperties: false,
  };
}

async function generateOpenAiReply({ instruction, context, schema, timeoutMs }, {
  apiKey = process.env.OPENAI_API_KEY, fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey?.trim()) throw Error('OpenAI API key is missing.');
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: process.env.WHATSAPP_OPENAI_BACKUP_MODEL?.trim() || 'gpt-5.6-terra',
        instructions: instruction,
        input: JSON.stringify(context),
        reasoning: { effort: 'none' },
        store: false,
        max_output_tokens: 650,
        text: { format: { type: 'json_schema', name: 'sesora_guest_turn', strict: true, schema: strictSchema(schema) } },
      }),
    });
    if (!response.ok) throw Object.assign(Error('OpenAI request failed.'), { status: response.status });
    const data = await response.json();
    const text = data.status === 'completed' && data.output
      ?.filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content)
      .find(part => part.type === 'output_text')?.text;
    if (typeof text !== 'string') throw Error('OpenAI did not return a complete structured response.');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Invalid OpenAI structured response.');
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== null));
  } catch (error) {
    if (signal.aborted) throw Object.assign(Error('OpenAI deadline exceeded.'), { name: 'AiDeadlineError' });
    throw error;
  }
}

function configuredBackup() {
  return process.env.WHATSAPP_OPENAI_FAILOVER_ENABLED === 'true' && process.env.OPENAI_API_KEY?.trim()
    ? generateOpenAiReply : undefined;
}

module.exports = { configuredBackup, generateOpenAiReply };
