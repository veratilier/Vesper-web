'use client';
import { useEffect, useRef, useState } from 'react';
import { userInputAnswer, type UserInputRequest } from '@/lib/codex-user-input';
import { elicitationContent, type ElicitationSchema } from '@/lib/codex-elicitation-form';
export type { UserInputRequest };
type Question = { id: string; header?: string; question: string; options?: { label: string; description?: string }[]; isSecret?: boolean; isOther?: boolean };
export function CodexUserInput({ request, onRespond }: { request: UserInputRequest; onRespond: (result: Record<string, unknown>) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const elicitation = request.method === 'mcpServer/elicitation/request';
  const schema = (request.params.requestedSchema || {}) as ElicitationSchema;
  const fields = Object.entries(schema.properties || {});
  const questions: Question[] = elicitation ? fields.map(([id, field]) => ({ id, question: field.title || id, header: field.description, options: (field.enum || (field.type === 'boolean' ? [true,false] : [] )).map(value => ({label: String(value), description: value === true ? "Yes" : value === false ? "No" : undefined})) })) : (Array.isArray(request.params.questions) ? request.params.questions : []) as Question[];
  const question = questions[Math.min(step, questions.length - 1)];
  const field = question && elicitation ? schema.properties?.[question.id] : undefined;
  const unsupported = elicitation && (schema.type !== 'object' || fields.some(([,f]) => !['string','number','integer','boolean'].includes(f.type || '')));
  const url = typeof request.params.url === 'string' && /^https:\/\//i.test(request.params.url) ? request.params.url : undefined;
  const cancel = () => onRespond(elicitation ? { action: 'cancel', content: null } : { answers: {} });
  const setAnswer = (value: string) => { setAnswers(current => ({...current, [question.id]: value})); setError(''); };
  const submit = () => {
    try {
      if (elicitation) {
        if (request.params.mode === 'url') { if (!url) throw Error("The authorization URL is unavailable. Cancel and try again."); onRespond({action:'accept',content:null}); }
        else { if (unsupported) throw Error("This request cannot be displayed as a form. Cancel and ask the tool for simpler questions."); onRespond({ action:'accept', content:elicitationContent(schema,answers) }); }
      } else onRespond(userInputAnswer(request,answers));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Complete your selection"); }
  };
  return <dialog ref={dialog} className="codex-input-dialog question-dialog" onCancel={event => {event.preventDefault();cancel();}} aria-label="Answer questions">
    <header><span>{elicitation ? "Tool confirmation" : "Answer questions"}</span><button type="button" onClick={cancel} aria-label="Cancel and close">×</button></header>
    {questions.length > 1 && <nav aria-label="Question progress">{questions.map((q,i) => <button type="button" key={q.id} aria-current={step === i ? 'step' : undefined} aria-label={`Question ${i+1}`} onClick={() => {setStep(i);setError('');}}>{i+1}</button>)}</nav>}
    {elicitation && <p>{String(request.params.message || "Confirm this request")}</p>}
    {request.params.mode === 'url' ? (url ? <a className="question-option" href={url} target="_blank" rel="noreferrer">Open authorization page ↗</a> : <p role="alert">Authorization URL unavailable</p>) : unsupported ? <p role="alert">This request cannot be displayed as a form. Cancel and ask the tool for simpler questions.</p> : question && <fieldset key={question.id}><legend>{question.question}</legend>{question.header && <p className="question-hint">{question.header}</p>}
      <div className="question-options">{question.options?.map((option,i) => <label className="question-option" key={option.label} data-selected={!other[question.id] && answers[question.id] === option.label}><input type="radio" name={question.id} checked={!other[question.id] && answers[question.id] === option.label} onChange={() => {setOther(current => ({...current,[question.id]:false}));setAnswer(option.label);}}/><span className="question-number">{i+1}</span><span><b>{option.description && field?.type === 'boolean' ? option.description : option.label}</b>{option.description && field?.type !== 'boolean' && <small>{option.description}</small>}</span></label>)}</div>
      {question.isOther && <button type="button" className="question-other" aria-pressed={!!other[question.id]} onClick={() => {setOther(current => ({...current,[question.id]:true}));setAnswer('');}}>Other answer</button>}
      {(!question.options?.length || other[question.id]) && <label className="question-text-label">Your answer<input autoFocus type={question.isSecret ? 'password' : field?.type === 'number' || field?.type === 'integer' ? 'number' : 'text'} min={field?.minimum} max={field?.maximum} step={field?.type === 'integer' ? 1 : 'any'} maxLength={field?.maxLength} value={answers[question.id] || ''} placeholder="Write your answer…" onChange={event => setAnswer(event.target.value)} /></label>}
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={step > 0 ? () => {setStep(step-1);setError('');} : cancel}>{step > 0 ? "Previous" : "Cancel"}</button><small>{questions.length > 1 ? `${step+1} / ${questions.length}` : "Submit this answer only"}</small>{step < questions.length-1 ? <button type="button" className="question-submit" onClick={() => {setStep(step+1);setError('');}}>Next →</button> : <button type="button" className="question-submit" disabled={unsupported && request.params.mode !== 'url'} onClick={submit}>Submit ↑</button>}</footer>
  </dialog>;
}
