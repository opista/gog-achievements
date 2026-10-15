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
    <div className="apply-progress" role="status">
      <LoaderCircle size={36} className="spinner" aria-hidden="true" />
      <p>
        {checking
          ? 'Please keep the app open while this check finishes.'
          : 'Keep the app open until the result is available.'}
      </p>
      {!checking ? <p className="muted">This cannot be cancelled.</p> : null}
    </div>
  );
}
