import { useEffect, useState, type FormEvent } from 'react';
import { OFFLINE_REMOVAL_MS, type PublicPlayer, type Session } from '../shared/protocol';
import { ApiError, getSession, newToken, post, saveSession, useRoom } from './useRoom';
import { existingSessionMessage, readInvite } from './invites';
import { InviteModal } from './InviteModal';
import { Confirm } from './Modal';
import { RoomNotice } from './RoomNotice';
import { Arrow, CaseArtwork, Fingerprint } from './CaseArtwork';
import { PlayerRoster } from './PlayerRoster';
import { RoundScreens } from './RoundScreens';
import { formatTime } from './formatTime';

export function App() {
  const [session, setSession] = useState<Session | null>(getSession);
  const [invite] = useState(() => readInvite(window.location.search));
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [mode, setMode] = useState<'home' | 'create' | 'join'>(() => !session && invite.code ? 'join' : 'home');
  const [name, setName] = useState('');
  const [code, setCode] = useState(invite.code ?? '');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [removePlayer, setRemovePlayer] = useState<PublicPlayer | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const exit = () => { saveSession(null); setSession(null); setMode(invite.code && !inviteDismissed ? 'join' : 'home'); setConfirmLeave(false); setConfirmReveal(false); setShowInvite(false); setRemovePlayer(null); setRemoveOpen(false); };
  const { room, connection, error, setError, pending, send, clockOffset } = useRoom(session, exit);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => { setNow(Date.now()); }, [room?.serverNow]);
  useEffect(() => { setAnswer(''); setConfirmReveal(false); }, [room?.roundNumber, room?.phase]);
  const serverNow = now + clockOffset;
  const connected = connection === 'Connected';
  const isHost = !!room && room.hostId === room.you;
  const activePlayers = room?.players.filter(p => !p.left) ?? [];
  const onlineCount = activePlayers.filter(p => p.connected).length;
  const busy = pending || !connected;
  const canInvite = isHost && (room?.phase === 'lobby' || room?.phase === 'revealed');
  useEffect(() => { if (!canInvite) setShowInvite(false); }, [canInvite]);
  useEffect(() => {
    if (!isHost) { setConfirmReveal(false); setRemoveOpen(false); }
  }, [isHost]);
  const removalTarget = room?.players.find(player => player.id === removePlayer?.id && !player.left);
  const removalStillValid = !!removalTarget && !removalTarget.connected
    && removalTarget.disconnectedAt === removePlayer?.disconnectedAt
    && removalTarget.disconnectedAt != null && serverNow >= removalTarget.disconnectedAt + OFFLINE_REMOVAL_MS;
  async function enter(event: FormEvent) {
    event.preventDefault(); setLoading(true); setFormError('');
    try {
      // Verify session persistence before creating membership so refresh is reliable.
      sessionStorage.setItem('imposter.storage-check', 'ok'); sessionStorage.removeItem('imposter.storage-check');
      const token = newToken();
      const result = await post(mode === 'create' ? '/api/rooms' : `/api/rooms/${code.toUpperCase()}/join`, { nickname: name, token });
      const next = { code: result.code, token };
      saveSession(next); setSession(next); setInviteDismissed(true);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not join. Try again.');
    } finally { setLoading(false); }
  }
  async function leave() {
    if (!session) return;
    setLoading(true);
    try { await post(`/api/rooms/${session.code}/leave`, { token: session.token }); exit(); }
    catch (cause) {
      if (cause instanceof ApiError && [400, 404].includes(cause.status)) exit();
      else setError('Could not leave yet. Reconnect and try again.');
    } finally { setLoading(false); }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(session!.code); setCopied(true); }
    catch { setError(`Copy this room code: ${session!.code}`); }
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="Imposter home">IMP<span className="wordmark-zero">0</span>STER<span className="wordmark-square" /></a>
      <span className="top-label">A SOCIAL DECEPTION CASE FILE</span>
      {session ? <button className="text-button leave-button" onClick={() => setConfirmLeave(true)}>Leave room <Arrow direction="up" /></button>
        : <span className="header-edition"><span className="status-dot" /> TRUST UNDER REVIEW</span>}
    </header>
    <main id="main-content" tabIndex={-1}>
      {!inviteDismissed && (invite.error || (session && invite.code)) && <div className="notice invite-notice" role="status">
        <span>{invite.error ?? existingSessionMessage(session!, invite.code!)}</span>
        <button className="text-button" onClick={() => setInviteDismissed(true)} aria-label="Dismiss invite notice">Dismiss</button>
      </div>}
      {!session ? <>
        {mode === 'home' ? <section className="home screen-enter">
          <div className="hero"><div className="hero-copy">
            <div className="eyebrow hero-kicker"><span className="crosshair" aria-hidden="true">+</span> SAME FRIENDS. DIFFERENT STORIES.</div>
            <h1>Every friend.<br /><span>A suspect.</span></h1>
            <p className="lead">You all get a question. One of you gets a different one.<br className="desktop-break" /> The answers are evidence. The rest is a very good lie.</p>
            <div className="home-actions"><button className="primary" onClick={() => { setMode('create'); setFormError(''); }}>Create Room <Arrow direction="up" /></button>
              <button className="secondary" onClick={() => { setMode('join'); setFormError(''); }}>Join Room <Arrow /></button></div>
            <div className="game-facts"><span>3–12 PLAYERS</span><span>20 MIN / CASE</span><span>IN PERSON</span></div>
          </div><CaseArtwork /></div>
          <div className="how-to" aria-label="How to play"><div><span className="step-number">01</span><div><h2>Make your statement.</h2><p>Answer your private question. Nobody knows their role.</p></div></div>
            <div><span className="step-number">02</span><div><h2>Follow the evidence.</h2><p>Read everyone’s answers. Question the suspicious ones.</p></div></div>
            <div><span className="step-number">03</span><div><h2>Close the case.</h2><p>The host reveals the imposter. Friendships may recover.</p></div></div></div>
        </section> : <section className="entry screen-enter">
          <div className="entry-intro"><button className="text-button back" onClick={() => setMode('home')}>← Back</button><span className="eyebrow">CASE FILE / REGISTRATION</span>
            <h1>{mode === 'create' ? <>Good friends.<br /><span>Prime suspects.</span></> : <>Consider yourself<br /><span>a person of interest.</span></>}</h1>
            <p className="lead">{mode === 'create' ? 'Open a case. Invite your people. Someone’s story won’t add up.' : 'Enter the room code, choose your name, and take your place in the investigation.'}</p>
            <div className="registration-note"><Fingerprint /><span>No accounts. No downloads.<br />Just a little reasonable doubt.</span></div>
          </div>
          <form className="paper entry-form" onSubmit={enter} aria-busy={loading}>
            <div className="document-header"><span>PERSONNEL RECORD</span><span>{mode === 'create' ? 'NEW CASE' : 'ADMISSION'}</span></div>
            <h2>{mode === 'create' ? 'Create your room.' : 'Join the investigation.'}</h2><p className="muted form-description">{mode === 'create' ? 'You’ll be the host. Choose a name your friends will recognise.' : 'Your host has the six-character room code.'}</p>
            <label htmlFor="nickname">Your nickname</label><input id="nickname" autoComplete="nickname" autoFocus maxLength={24} required placeholder="Your name. Or your best alias." value={name} onChange={event => setName(event.target.value)} aria-invalid={!!formError} aria-describedby={formError ? 'entry-error' : undefined} />
            {mode === 'join' && <><label htmlFor="room-code">Room code</label><input className="code-input" id="room-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" minLength={6} maxLength={6} pattern="[A-Za-z2-9]{6}" required placeholder="ABC234" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} aria-invalid={!!formError} aria-describedby={formError ? 'entry-error' : undefined} /></>}
            {formError && <p className="error" id="entry-error" role="alert">{formError}</p>}
            <button className="primary full" disabled={loading}>{loading ? <><span className="button-spinner" aria-hidden="true" />Gathering suspects…</> : <>{mode === 'create' ? 'Create Room' : 'Join Room'}<Arrow /></>}</button>
            <p className="form-footnote">Every player needs their own screen.<br />Best played in the same room.</p>
          </form>
        </section>}
      </> : <section className="room">
        <div className="room-bar"><div className="case-reference"><span className="eyebrow">INVESTIGATION / ROOM CODE</span><div className="room-code"><span>{session.code}</span><button className="copy-button" aria-label="Copy room code" onClick={copyCode}>{copied ? 'Copied ✓' : 'Copy code'}<span aria-hidden="true">⧉</span></button></div></div>
          <div className="room-actions">{canInvite && <button className="secondary invite-button" onClick={() => setShowInvite(true)}><span aria-hidden="true">▦</span> Show QR Code</button>}
            <div className={`connection ${connected ? 'online' : ''}`} role="status"><span className="status-dot" />{connection}</div></div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <RoomNotice notice={room?.notice} serverNow={serverNow} />
        {room?.hostReconnectAt && <div className="notice" role="status">The host disconnected. Holding their place for {formatTime(room.hostReconnectAt, serverNow)}.</div>}
        <p className="sr-only" role="status" aria-atomic="true">{room ? { lobby: 'Lobby. Gathering suspects.', answering: 'Private questions received. Submit your answer.', discussion: 'Evidence unlocked. All answers are public.', revealed: 'Case closed. The server has revealed the result.' }[room.phase] : 'Connecting to your room.'}</p>
        {!room ? <div className="paper loading-state"><div className="spinner" aria-hidden="true" /><span className="eyebrow">ESTABLISHING CONTACT</span><h1>Gathering suspects…</h1><p className="muted">Your room and answers are saved on the server.</p></div> : <>
          {room.phase !== 'lobby' && <ol className="case-steps" aria-label="Round progress">{(['answering', 'discussion', 'revealed'] as const).map((phase, index) => <li key={phase} aria-current={room.phase === phase ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{['Statements', 'Discussion', 'Verdict'][index]}</li>)}</ol>}
          <div className="room-layout"><div className="round-view screen-enter" key={`${room.roundNumber}:${room.phase}`}>
            <RoundScreens room={room} serverNow={serverNow} busy={busy} isHost={isHost} onlineCount={onlineCount} answer={answer} setAnswer={setAnswer} send={send} onReveal={() => setConfirmReveal(true)} />
          </div><PlayerRoster room={room} serverNow={serverNow} isHost={isHost} busy={busy} onRemove={player => { setRemovePlayer(player); setRemoveOpen(true); }} /></div>
        </>}
        {!connected && <button className="text-button return-home" onClick={exit}>Return home on this tab <Arrow /></button>}
      </section>}
    </main>
    <footer><span className="footer-wordmark">IMP0STER<span aria-hidden="true"> / </span><span>CASE FILE</span></span><span>KEEP YOUR FRIENDS CLOSE. YOUR QUESTION CLOSER.</span></footer>
    <Confirm open={confirmReveal && !!room && isHost} title="Time to close the case?" message="Everyone will immediately see the imposter’s name and both questions. This ends the round for everyone." confirm="Reveal to everyone" onCancel={() => setConfirmReveal(false)} onConfirm={() => { if (room) send({ type: 'reveal', round: room.roundNumber }); setConfirmReveal(false); }} disabled={busy} />
    <Confirm open={confirmLeave} title="Leave this room?" message={isHost ? 'Host privileges will immediately pass to the earliest-joined remaining player. Leaving removes your reconnection session.' : 'You will leave this room and remove your reconnection session.'} confirm="Leave room" onCancel={() => setConfirmLeave(false)} onConfirm={() => void leave()} disabled={loading} />
    {canInvite && session && <InviteModal open={showInvite} code={session.code} onClose={() => setShowInvite(false)} />}
    {removePlayer && <Confirm open={removeOpen && isHost} title={`Remove ${removePlayer.nickname}?`}
      message={removalStillValid ? 'This player has been offline for at least 90 seconds. Removing them frees their nickname and slot and prevents this session from reconnecting. Their current round answers and history are preserved.' : 'This player’s connection changed or they have already left. They cannot be removed with this confirmation. Cancel and check the room.'}
      confirm="Remove offline player" disabled={busy || !removalStillValid} onCancel={() => setRemoveOpen(false)}
      onConfirm={() => { if (removalStillValid) send({ type: 'removeOffline', playerId: removePlayer.id, disconnectedAt: removePlayer.disconnectedAt! }); setRemoveOpen(false); }} />}
  </div>;
}
