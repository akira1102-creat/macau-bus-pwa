import { CircleAlert, LoaderCircle } from 'lucide-react';

interface StateMessageProps {
  kind: 'loading' | 'error' | 'empty';
  children: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function StateMessage({ kind, children, actionLabel, onAction }: StateMessageProps) {
  const Icon = kind === 'loading' ? LoaderCircle : CircleAlert;
  return (
    <div className={`state-message state-message-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon aria-hidden="true" className={kind === 'loading' ? 'spin' : undefined} size={24} strokeWidth={1.8} />
      <p>{children}</p>
      {actionLabel && onAction ? <button type="button" className="text-button" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}
