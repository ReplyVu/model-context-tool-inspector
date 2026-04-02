/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class OpenRouterChat {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
    this.messages = [];
    this._pendingToolCallIds = {};
  }

  async sendMessage({ message, config }) {
    // Inject system prompt on first message
    if (this.messages.length === 0 && config?.systemInstruction) {
      this.messages.push({
        role: 'system',
        content: config.systemInstruction.join('\n'),
      });
    }

    if (typeof message === 'string') {
      this.messages.push({ role: 'user', content: message });
    } else {
      // Tool responses: array of { functionResponse: { name, response } }
      // Match by position (index) to handle duplicate tool names correctly
      message.forEach(({ functionResponse }, i) => {
        this.messages.push({
          role: 'tool',
          tool_call_id: this._pendingToolCallIds[i],
          content: JSON.stringify(functionResponse.response),
        });
      });
    }

    // Convert Gemini tool declarations to OpenAI format
    const tools = config?.tools?.[0]?.functionDeclarations?.map((fn) => ({
      type: 'function',
      function: {
        name: fn.name,
        description: fn.description,
        parameters: fn.parametersJsonSchema,
      },
    }));

    const body = { model: this.model, messages: this.messages };
    if (tools?.length) body.tools = tools;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`);
    const data = await res.json();

    const msg = data.choices[0].message;
    this.messages.push(msg);

    // Normalize to Gemini-like response shape so promptAI() works unchanged
    if (msg.tool_calls?.length) {
      // Store IDs as array indexed by position to handle duplicate tool names
      this._pendingToolCallIds = msg.tool_calls.map((tc) => tc.id);
      const functionCalls = msg.tool_calls.map((tc) => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      }));
      return { functionCalls, text: null };
    }
    return { functionCalls: [], text: msg.content };
  }

  getHistory() {
    // Return Gemini-like format for suggestUserPrompt compatibility.
    // Skip assistant messages with no text (tool calls have content: null).
    return this.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }
}
