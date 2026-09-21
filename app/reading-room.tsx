'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import './reading-room.css';

export type ReadingBook = { id: string; title: string; text: string; page: number; notes: { id: string; page: number; quote: string; text: string; author: string; date: string }[] };
export function ReadingRoom({ books, setBooks }: { books: ReadingBook[]; setBooks: Dispatch<SetStateAction<ReadingBook[]>> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const book = books.find(item => item.id === selected);
  const pages = book?.text.match(/[\s\S]{1,1800}/g) || [];
  const page = Math.min(book?.page || 0, Math.max(0, pages.length - 1));
  function turn(next: number) {
    setBooks(items => items.map(item => item.id === selected ? { ...item, page: next } : item));
    setQuote(''); setNote('');
  }
  if (book) return <section className="reading-room">
    <button onClick={() => setSelected(null)}>‹ Bookshelf</button>
    <h2>{book.title}</h2>
    <div className="reading-pagination"><button disabled={page === 0} onClick={() => turn(page - 1)}>Previous</button><span>{page + 1} / {pages.length}</span><button disabled={page >= pages.length - 1} onClick={() => turn(page + 1)}>Next</button></div>
    <article className="reading-paper">{pages[page]}</article>
    <form className="reading-note" onSubmit={event => {
      event.preventDefault();
      if (!note.trim()) return;
      const entry = { id: crypto.randomUUID(), page, quote, text: note.trim(), author: 'Vera', date: new Date().toISOString() };
      setBooks(items => items.map(item => item.id === book.id ? { ...item, notes: [...item.notes, entry] } : item));
      setNote(''); setQuote('');
    }}>
      <h3>In the margins</h3>
      <label>Passage<input value={quote} onChange={event => setQuote(event.target.value)} placeholder="Paste a passage to keep with your note" /></label>
      <label>Your note<textarea required value={note} onChange={event => setNote(event.target.value)} placeholder="What stayed with you?" /></label>
      <button type="submit">Save note</button>
    </form>
    <div className="reading-notes">{book.notes.map(entry => <article key={entry.id}><small>{entry.author} · Page {entry.page + 1}</small>{entry.quote && <blockquote>{entry.quote}</blockquote>}<p>{entry.text}</p><button onClick={() => turn(Math.min(entry.page, pages.length - 1))}>Go to page</button></article>)}</div>
  </section>;
  return <section className="reading-room">
    <div className="reading-heading"><h2>Our bookshelf</h2><button onClick={() => setAdding(value => !value)}>{adding ? 'Cancel' : 'Add a book'}</button></div>
    {adding && <form className="reading-note" onSubmit={event => {
      event.preventDefault();
      if (!title.trim() || !text.trim()) return;
      if (text.length > 500000) { setError('Please split this book into files under 500,000 characters.'); return; }
      const id = crypto.randomUUID();
      setBooks(items => [...items, { id, title: title.trim(), text, page: 0, notes: [] }]);
      setSelected(id); setAdding(false); setTitle(''); setText(''); setError('');
    }}>
      <label>Import TXT or Markdown<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        if (file.size > 1500000) { setError('Choose a text file smaller than 1.5 MB.'); return; }
        try { setText(await file.text()); setTitle(file.name.replace(/\.(txt|md)$/i, '')); setError(''); } catch { setError('Could not read this file. Please try again.'); }
      }} /></label>
      <label>Title<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Book text<textarea required value={text} onChange={event => setText(event.target.value)} placeholder="Or paste your reading here" /></label>
      {error && <p role="alert">{error}</p>}<button type="submit">Open book</button>
    </form>}
    {!books.length && !adding && <p className="reading-empty">A quiet place to turn the next page together. Add your first book to begin.</p>}
    <div className="reading-books">{books.map(item => <button key={item.id} onClick={() => setSelected(item.id)}><strong>{item.title}</strong><small>Page {item.page + 1} · {item.notes.length} notes</small><span>Continue reading →</span></button>)}</div>
  </section>;
}
