import { useEffect, useState } from 'react';
import { detectTimeZone } from './date-time';

export function useLocalTimeZone(): string {
  const [zone, setZone] = useState(detectTimeZone);
  useEffect(() => {
    const refresh = () => setZone(detectTimeZone());
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  return zone;
}
