'use client';

/**
 * The caddie's note. Two eyebrows, always both, always in that order —
 * an identical silhouette on every puzzle, so by the fortieth the eye
 * jumps to THE MOVE without reading a word. A recurring character needs a
 * recognisable shape before it needs content.
 *
 * No Caslon: that is the folio's identity voice, reserved for headers and
 * band stamps. The note is instruction, so it is Archivo on paper.
 */

import type { Claim, Note, Token } from '@/lib/explain/types';

function renderTokens(tokens: Token[]) {
  return tokens.map((tok, i) =>
    tok.mono ? (
      <span key={i} className={`sg-note-num${tok.key ? ' sg-note-key' : ''}`}>
        {tok.text}
      </span>
    ) : (
      <span key={i}>{tok.text}</span>
    ),
  );
}

export default function CaddieNote({ note, on }: { note: Note | null; on: boolean }) {
  if (!note || note.read.length === 0) return null;
  return (
    <section className="sg-note" data-on={on || undefined} aria-live="polite">
      <span className="sr-only">{note.srPrefix}</span>
      <p className="sg-note-eyebrow">The read</p>
      {note.read.map((c: Claim) => (
        <p key={c.ruleId} className="sg-note-body">
          {renderTokens(c.tokens)}
        </p>
      ))}
      {note.move && (
        <>
          <hr className="sg-note-rule" />
          <p className="sg-note-eyebrow">
            <span className="sg-note-glyph" aria-hidden="true">
              ⊕
            </span>
            The move
          </p>
          <p className="sg-note-body">{renderTokens(note.move.tokens)}</p>
        </>
      )}
    </section>
  );
}
