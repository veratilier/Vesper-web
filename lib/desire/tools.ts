// Shared schemas for the Vesper MCP and built-in Codex tools; no bindings/secrets.
import { z } from 'zod';
import { encounterShape } from './encounter-input';
export const desireTools = [
  { name: 'desire_status', description: "Read Vesper's independent private Desire state and real-interaction timestamps. Reading never scores an encounter.", schema: z.object({}) },
  { name: 'desire_history', description: 'Read Vesper Desire history, newest first, with stable pagination.', schema: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(256).optional() }) },
  { name: 'desire_encounter', description: 'Update Desire for an actual relationship event or elapsed absence. Do not save routine browsing, task steps, tool output or execution reports here; put activity notes in Atlas. Omit note when there is no new personal observation. Only a new Vera message permits interaction_source=user; autonomous work uses automation. Reuse the exact request_id on every retry. Notes are preserved verbatim; never invent a past interaction.', schema: z.object(encounterShape) },
  { name: 'desire_set_style', description: 'Choose how the private Desire signal speaks.', schema: z.object({ style: z.enum(['quiet', 'playful', 'clingy']) }) },
  { name: 'desire_express', description: 'Generate an expression, or record an expression already sent without generating or sending it again.', schema: z.object({ surface: z.enum(['chat', 'frontend']).optional(), mode: z.enum(['generate', 'record']).optional() }) },
];
export const desireToolDefinitions = desireTools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.schema) }));
