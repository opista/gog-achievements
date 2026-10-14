/** Visual placeholders have no controls or account data; only the status is announced. */
export function AchievementSkeleton() {
  return (
    <div className="achievement-skeleton">
      <p className="sr-only" role="status">
        Loading achievements…
      </p>
      <div aria-hidden="true" className="skeleton-content">
        <div className="skeleton-toolbar">
          <span className="skeleton-block skeleton-filter" />
          <span className="skeleton-block skeleton-filter" />
          <span className="skeleton-block skeleton-filter" />
          <span className="skeleton-block skeleton-action" />
        </div>
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
