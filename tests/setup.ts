// UI readiness has the same bounded wait on local and hosted runners.
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}

export {};
