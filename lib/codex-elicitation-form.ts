type Field = { type?: string; title?: string; description?: string; enum?: unknown[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; format?: string };
export type ElicitationSchema = { type?: string; properties?: Record<string, Field>; required?: string[] };
export function elicitationContent(schema: ElicitationSchema, values: Record<string, string>) {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties || {})) {
    if (!['string', 'number', 'integer', 'boolean'].includes(field.type || '')) throw Error("This request has unsupported fields. Cancel and ask for a simpler form.");
    const raw = Object.hasOwn(values, key) ? values[key] : undefined;
    if (raw == null || raw === '') { if (schema.required?.includes(key)) throw Error(`Enter ${field.title || key}`); continue; }
    let value: unknown = raw;
    if (field.type === 'boolean') { if (!['true','false'].includes(raw)) throw Error("Select yes or no."); value = raw === 'true'; }
    if (field.type === 'number' || field.type === 'integer') {
      value = Number(raw);
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw Error("Enter a valid number.");
      if ((field.minimum != null && Number(value) < field.minimum) || (field.maximum != null && Number(value) > field.maximum)) throw Error("Number is outside the allowed range.");
    }
    if (typeof value === 'string' && ((field.minLength != null && value.length < field.minLength) || (field.maxLength != null && value.length > field.maxLength))) throw Error("Text length does not meet the requirements.");
    if (field.enum && !field.enum.includes(value)) throw Error("Select one of the available options.");
    Object.defineProperty(result, key, {value, enumerable:true});
  }
  if (schema.required?.some(key => !Object.hasOwn(result, key))) throw Error("The request is missing required input fields. Cancel and try again.");
  return result;
}
