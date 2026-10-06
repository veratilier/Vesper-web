export type ChatQuote = {
  messageId: string;
  partId?: string;
  conversationId: string;
  role: string;
  text: string;
};
export type ChatBubble = { text: string; replyTo?: ChatQuote };
export function splitChatBubbles(text: string): string[] {
  // Code fences and lists retain their structure. Ordinary paragraphs become bubbles.
  if (/```/.test(text)) return [text];
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (
        part.length <= 120 ||
        /[\n`\[\]“"]|\*\*/.test(part) ||
        /^[-*>] /.test(part)
      )
        return [part];
      const result: string[] = [];
      let current = "";
      for (const character of part) {
        current += character;
        if ("。！？".includes(character) && current.length >= 45) {
          result.push(current);
          current = "";
        }
      }
      if (current) result.push(current);
      return result;
    });
}
export function verifiedChatQuote(
  messages: { id: string; content: string; role: string }[],
  messageId: string,
  excerpt: string,
  conversationId: string,
): ChatQuote {
  const original = messages.find(
    (item) => item.id === messageId && item.role !== "system",
  );
  if (
    !original ||
    !excerpt.trim() ||
    excerpt.length > 1000 ||
    !original.content.includes(excerpt)
  )
    throw new Error(
      "Quote must be an exact excerpt of a saved message in this conversation.",
    );
  return { messageId, conversationId, role: original.role, text: excerpt };
}
export const webBubbleTool = {
  type: "function" as const,
  name: "send_web_bubbles",
  description:
    "Deliver a few natural chat bubbles, optionally quoting an exact saved message. Use this only when you need a quoted reply. For ordinary replies use blank lines between short paragraphs. Do not repeat delivered bubbles in your final response.",
  inputSchema: {
    type: "object",
    properties: {
      bubbles: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            replyTo: {
              type: "object",
              properties: {
                messageId: { type: "string" },
                text: { type: "string" },
              },
              required: ["messageId", "text"],
            },
          },
          required: ["text"],
        },
      },
    },
    required: ["bubbles"],
  },
};

export const webVoiceTool = {
  type: "function" as const,
  name: "send_web_voice",
  description:
    "Send an audio message using the voice service configured in this browser. Include the exact spoken text in the desired language (up to 4000 characters). Success confirms saved audio plus transcript, not that it was listened to. Do not claim success if voice configuration is missing.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", minLength: 1, maxLength: 4000 } },
    required: ["text"],
    additionalProperties: false,
  },
};
