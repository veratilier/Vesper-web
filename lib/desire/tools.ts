// Shared schemas for the Vesper MCP and built-in Codex tools; no bindings/secrets.
import { z } from 'zod';
import { encounterShape } from './encounter-input';
export const desireTools = [
  { name: 'desire_status', description: "Read Vesper's committed eight emotions (0–100 independently), version, brief reason and timing suggestion. Missing values mean not yet assessed. Reading does not change values.", schema: z.object({}) },
  { name: 'desire_history', description: 'Read committed Vesper emotion history; legacy=true reads preserved six-dimensional history separately.', schema: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(256).optional(), legacy: z.boolean().optional() }) },
  { name: 'desire_encounter', description: 'Legacy compatibility: record a genuine new observation as pending evidence for the periodic semantic assessment. This does not change numbers. Do not call it for a chat turn with an attached emotion candidate. Reuse request_id on retries; distinguish user messages from autonomous activity. Never invent completed activity.', schema: z.object(encounterShape) },
  { name: 'desire_set_style', description: 'Choose how the private Desire signal speaks.', schema: z.object({ style: z.enum(['quiet', 'playful', 'clingy']) }) },
  { name: 'desire_express', description: 'Generate an expression, or record an expression already sent without generating or sending it again.', schema: z.object({ surface: z.enum(['chat', 'frontend']).optional(), mode: z.enum(['generate', 'record']).optional() }) },
];
export const desireToolDefinitions = desireTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.schema) }));
