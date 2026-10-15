import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, OperationRecord } from '../../../shared/api';

export function useHistory(
  api: Pick<DesktopApi, 'history'>,
  assertOwner: (userId: string) => void,
) {
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [api],
  );

  async function load(): Promise<void> {
    const stamp = ++generation.current;
    const values = await api.history({});
    if (stamp !== generation.current) return;
    for (const value of values) assertOwner(value.user_id);
    setRecords(values);
  }

  function clear(): void {
    generation.current += 1;
    setRecords([]);
  }

  return { records, load, clear };
}
