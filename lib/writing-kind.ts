// Existing rows have no kind field. Recipient/scheduling/reply metadata
// identifies historical letters without rewriting any saved content or marks.
type Writing = { kind?: unknown; recipient?: unknown; unlockAt?: unknown; replyTo?: unknown };
export function isLetter(value: Writing): boolean {
  if (value.kind != null) return value.kind === 'letter';
  return [value.recipient, value.unlockAt, value.replyTo].some(field => typeof field === 'string' && field.length > 0);
}
// Only fixed internal column names are supplied. Apply this before pagination.
export function letterKindSql(column = 'value') {
  return `(CASE WHEN json_extract(${column},'$.kind') IS NOT NULL THEN json_extract(${column},'$.kind')='letter'
    ELSE COALESCE(json_extract(${column},'$.recipient'),'')!='' OR COALESCE(json_extract(${column},'$.unlockAt'),'')!='' OR COALESCE(json_extract(${column},'$.replyTo'),'')!='' END)`;
}
