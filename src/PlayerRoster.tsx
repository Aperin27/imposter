import { OFFLINE_REMOVAL_MS, type PublicPlayer, type RoomView } from '../shared/protocol';
import { formatTime } from './formatTime';

export function PlayerRoster({ room, serverNow, isHost, busy, onRemove }: {
  room: RoomView; serverNow: number; isHost: boolean; busy: boolean; onRemove: (player: PublicPlayer) => void;
}) {
  const players = room.players.filter(player => !player.left);
  return <aside className="players-card" aria-labelledby="roster-title">
    <div className="section-label"><div><span className="eyebrow">PERSONS OF INTEREST</span><h2 id="roster-title">The suspects</h2></div><span className="count-tag">{players.length}<span> / 12</span></span></div>
    <ul className="suspect-list">{players.map(player => {
      const removeAt = player.disconnectedAt == null ? null : player.disconnectedAt + OFFLINE_REMOVAL_MS;
      const submitted = room.phase === 'answering' && room.participantIds.includes(player.id) && player.submitted;
      const host = player.id === room.hostId;
      return <li className={`suspect-card ${!player.connected ? 'is-offline' : ''}`} key={player.id}>
        <span className="suspect-avatar" aria-hidden="true"><span>{Array.from(player.nickname)[0].toUpperCase()}</span><small>ID</small></span>
        <div className="player-info"><strong>{player.nickname}{player.id === room.you && <small> (you)</small>}</strong>
          <span className="player-connection"><span className={`player-dot ${player.connected ? 'active' : ''}`} />{!player.connected ? 'Disconnected' : submitted ? 'Statement sealed' : room.phase === 'answering' && room.participantIds.includes(player.id) ? 'Writing a statement' : 'Connected'}</span>
          {isHost && !player.connected && removeAt !== null && <button className="remove-player" aria-label={`Remove offline player ${player.nickname}`}
            disabled={busy || serverNow < removeAt} onClick={() => onRemove(player)}>
            {serverNow < removeAt ? `Removable in ${formatTime(removeAt, serverNow)}` : 'Remove offline player'}
          </button>}
        </div>
        {host && <span className="host-tag">Host</span>}
      </li>;
    })}</ul>
    <div className="roster-note"><span aria-hidden="true">↳</span><p>{isHost ? 'You lead this case. Offline players can be removed after 90 seconds.' : 'The best alibi? A convincing answer.'}</p></div>
  </aside>;
}
