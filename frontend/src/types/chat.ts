export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
}

export interface ChatToolCall {
  id: string;
  name: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  status?: "streaming" | "done" | "error";
  attachments?: ChatAttachment[];
  reasoning?: string;
  tools?: ChatToolCall[];
  error?: string;
  model?: string;
  durationMs?: number;
}
