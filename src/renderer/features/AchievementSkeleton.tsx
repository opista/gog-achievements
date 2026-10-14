/** Visual placeholders have no controls or account data; only the status is announced. */
export function AchievementSkeleton({ label = 'Loading achievements…' }: { label?: string }) {
  return (
    <div className="achievement-skeleton">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div aria-hidden="true" className="skeleton-content">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="skeleton-row">
            <span className="skeleton-block skeleton-icon" />
            <div className="skeleton-copy">
              <span className="skeleton-block skeleton-title" />
              <span className="skeleton-block skeleton-description" />
              <span className="skeleton-block skeleton-description skeleton-description-short" />
            </div>
            <span className="skeleton-block skeleton-status" />
          </div>
        ))}
      </div>
    </div>
  );
}
