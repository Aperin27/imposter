export function formatTime(deadline: number | null, now: number) {
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
