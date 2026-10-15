import { LoaderCircle } from 'lucide-react';

export function ApplyProgress({
  signedIn,
  recovering,
}: {
  signedIn: boolean;
  recovering: boolean;
}) {
  const checking = !signedIn || recovering;
  return (
    <div className="active-state" role="status">
      <LoaderCircle size={42} className="spinner" />
      <h2>{checking ? 'Checking previous changes…' : 'Applying changes…'}</h2>
      <p>
        {checking
          ? 'Please keep the app open while this check finishes.'
          : 'Keep the app open until the result is available.'}
      </p>
      {!checking ? <p className="muted">This cannot be cancelled.</p> : null}
    </div>
  );
}
