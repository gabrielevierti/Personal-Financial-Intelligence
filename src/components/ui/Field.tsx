import { useId, type ReactNode } from 'react';

interface Props {
  label: string;
  help?: ReactNode;
  error?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, help, error, children }: Props) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}
