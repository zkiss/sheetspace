export function FormatIcon({ kind }: { kind: 'align-left' | 'align-center' | 'align-right' | 'reset' }) {
  if (kind === 'reset') {
    return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 7a5 5 0 1 1 1.4 3.5M3 3v4h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
  }
  return <svg aria-hidden="true" viewBox="0 0 16 16">
    {[12, 8, 12, 8].map((width, index) => {
      const left = kind === 'align-left' ? 2 : kind === 'align-center' ? (16 - width) / 2 : 14 - width;
      return <path d={`M${left} ${3 + index * 3}h${width}`} key={index} stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />;
    })}
  </svg>;
}

export function NoColourIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><rect height="9" rx="1" width="9" x="3.5" y="3.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="m3 13 10-10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>;
}
