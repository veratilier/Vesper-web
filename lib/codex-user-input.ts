export type UserInputRequest = { id: string | number; method: string; params: Record<string, unknown> };
export function userInputAnswer(request: UserInputRequest, answers: Record<string, string>) {
  const questions = request.params.questions;
  if (!Array.isArray(questions) || !questions.length) throw Error("No questions to answer.");
  const result: Record<string, { answers: string[] }> = {};
  for (const question of questions) {
    if (!question || typeof question.id !== 'string' || !answers[question.id]?.trim()) throw Error("Answer every question.");
    if (!question.isOther && Array.isArray(question.options) && question.options.length && !question.options.some((option: { label?: string }) => option.label === answers[question.id])) throw Error("Select an option provided in the request.");
    Object.defineProperty(result, question.id, { value: { answers: [answers[question.id]] }, enumerable: true });
  }
  return { answers: result };
}
