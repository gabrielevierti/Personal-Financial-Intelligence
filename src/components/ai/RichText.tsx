/** Rende il markdown minimo dei modelli (grassetto, elenchi, paragrafi) senza HTML arbitrario. */
export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l.replace(/^#+\s*/, ''))}{j < lines.length - 1 && <br />}</span>)}</p>;
      })}
    </>
  );
}
