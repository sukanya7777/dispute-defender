// Amazon Nova through the Bedrock Converse API, adapted to the same message
// shape the agent loop uses for Claude, so the loop itself does not change.
import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";

let client: BedrockRuntimeClient | undefined;

function toConverse(messages: Beta.BetaMessageParam[]): Message[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: [{ text: m.content }] };
    const content: ContentBlock[] = [];
    for (const b of m.content ?? []) {
      if (b.type === "text" && b.text.trim()) content.push({ text: b.text });
      else if (b.type === "tool_use") content.push({ toolUse: { toolUseId: b.id, name: b.name, input: (b.input ?? {}) as never } });
      else if (b.type === "tool_result") {
        content.push({
          toolResult: {
            toolUseId: b.tool_use_id,
            content: [{ text: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "") }],
            status: b.is_error ? "error" : "success",
          },
        });
      }
    }
    return { role: m.role, content };
  });
}

export async function novaCreate(opts: { model: string; region: string; system: string; tools: Beta.BetaTool[]; messages: Beta.BetaMessageParam[] }): Promise<Beta.BetaMessage> {
  client ??= new BedrockRuntimeClient({ region: opts.region });
  const tools: Tool[] = opts.tools.map((t) => ({
    toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.input_schema as never } },
  }));
  const res = await client.send(
    new ConverseCommand({
      modelId: opts.model,
      system: [{ text: opts.system }],
      messages: toConverse(opts.messages),
      toolConfig: { tools },
      // Low temperature keeps tool calls well-formed and decisions repeatable.
      inferenceConfig: { maxTokens: 4096, temperature: 0.2 },
    }),
  );

  const content: unknown[] = [];
  for (const b of res.output?.message?.content ?? []) {
    if (b.text) {
      // Nova writes its working-out inline as <thinking> tags; split it out so
      // the trace shows it as reasoning rather than as the answer.
      let rest = b.text;
      for (const m of b.text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/g)) {
        if (m[1].trim()) content.push({ type: "thinking", thinking: m[1].trim(), signature: "" });
        rest = rest.replace(m[0], "");
      }
      if (rest.trim()) content.push({ type: "text", text: rest.trim() });
    } else if (b.toolUse) {
      content.push({ type: "tool_use", id: b.toolUse.toolUseId, name: b.toolUse.name, input: b.toolUse.input ?? {} });
    }
  }
  const stop = res.stopReason === "tool_use" ? "tool_use" : res.stopReason === "max_tokens" ? "max_tokens" : res.stopReason === "content_filtered" || res.stopReason === "guardrail_intervened" ? "refusal" : "end_turn";
  return {
    id: res.$metadata.requestId ?? "nova",
    type: "message",
    role: "assistant",
    model: opts.model,
    content,
    stop_reason: stop,
    usage: { input_tokens: res.usage?.inputTokens ?? 0, output_tokens: res.usage?.outputTokens ?? 0 },
  } as unknown as Beta.BetaMessage;
}
