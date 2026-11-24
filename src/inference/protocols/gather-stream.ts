import {
  type AssistantContentPart,
  type InferenceResponse,
  type InferenceStreamEvent,
  type StopReason,
  UNREPORTED_USAGE,
} from "@/inference/models/internal-format.js";

export async function gatherStream(
  events: AsyncIterable<InferenceStreamEvent>,
): Promise<InferenceResponse> {
  const content: AssistantContentPart[] = [];
  const toolCalls = new Map<number, Extract<AssistantContentPart, { type: "tool-call" }>>();
  let stopReason: StopReason = "end";
  let usage = UNREPORTED_USAGE;
  let servedTierValue: string | undefined;
  for await (const event of events) {
    const last = content.at(-1);
    switch (event.type) {
      case "text-delta":
        if (last?.type === "text") {
          last.text += event.text;
        } else {
          content.push({ type: "text", text: event.text });
        }
        break;
      case "reasoning-delta":
        if (last?.type === "reasoning" && last.signature === undefined) {
          last.text += event.text;
        } else {
          content.push({ type: "reasoning", text: event.text });
        }
        break;
      case "reasoning-signature":
        if (last?.type === "reasoning" && last.signature === undefined) {
          last.signature = event.signature;
        } else {
          content.push({ type: "reasoning", text: "", signature: event.signature });
        }
        break;
      case "tool-call-start": {
        const call = { type: "tool-call" as const, id: event.id, name: event.name, arguments: "" };
        toolCalls.set(event.index, call);
        content.push(call);
        break;
      }
      case "tool-call-delta": {
        const call = toolCalls.get(event.index);
        if (call) {
          call.arguments += event.argumentsDelta;
        }
        break;
      }
      case "finish":
        stopReason = event.stopReason;
        break;
      case "usage":
        usage = event.usage;
        servedTierValue = event.servedTierValue;
        break;
    }
  }
  return { content, stopReason, usage, ...(servedTierValue && { servedTierValue }) };
}
