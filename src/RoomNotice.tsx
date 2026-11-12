import { useEffect, useState } from 'react';
import { NOTICE_MS, type RoomNotice as Notice } from '../shared/protocol';

export function RoomNotice({ notice, serverNow }: { notice: Notice | null | undefined; serverNow: number }) {
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const remaining = notice ? Math.max(0, notice.at + NOTICE_MS - serverNow) : 0;
  useEffect(() => {
    if (!notice || remaining <= 0) { setVisibleId(null); return; }
    setVisibleId(notice.id);
    const timer = setTimeout(() => setVisibleId(null), remaining);
    return () => clearTimeout(timer);
    // Same-event roster broadcasts must not restart the lifetime.
  }, [notice?.id]);
  return notice && visibleId === notice.id && remaining > 0
    ? <div className="notice" role="status">{notice.text}</div> : null;
}
