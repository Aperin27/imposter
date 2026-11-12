import { useEffect, useState, type FormEvent } from 'react';
import type { RoomView, Session } from '../shared/protocol';
import { ApiError, getSession, newToken, post, saveSession, useRoom } from './useRoom';

function formatTime(deadline: number | null, now: number) {
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function App() {
  const [session, setSession] = useState<Session | null>(getSession);
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const exit = () => { saveSession(null); setSession(null); setMode('home'); setConfirmLeave(false); setConfirmReveal(false); };
  const { room, connection, error, setError, pending, send, clockOffset } = useRoom(session, exit);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setNow(Date.now()); }, [room?.serverNow]);
  useEffect(() => { setAnswer(''); setConfirmReveal(false); }, [room?.roundNumber, room?.phase]);
  const serverNow = now + clockOffset;
  const connected = connection === 'Connected';
  const isHost = !!room && room.hostId === room.you;
  const me = room?.players.find(p => p.id === room.you);
  const activePlayers = room?.players.filter(p => !p.left) ?? [];
  const onlineCount = activePlayers.filter(p => p.connected).length;
  const busy = pending || !connected;
  async function enter(event: FormEvent) {
    event.preventDefault(); setLoading(true); setFormError('');
    try {
      // Verify session persistence before creating membership so refresh is reliable.
      sessionStorage.setItem('imposter.storage-check', 'ok'); sessionStorage.removeItem('imposter.storage-check');
      const token = newToken();
      const result = await post(mode === 'create' ? '/api/rooms' : `/api/rooms/${code.toUpperCase()}/join`, { nickname: name, token });
      const next = { code: result.code, token };
      saveSession(next); setSession(next);
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
    try { await navigator.clipboard.writeText(session!.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError(`Copy this room code: ${session!.code}`); }
  }
  return <div className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="Imposter home">IMP<span>0</span>STER<span className="logo-dot">.</span></a>
      <span className="top-label">A GAME OF QUESTIONABLE TRUST</span>
      {session && <button className="text-button" onClick={() => setConfirmLeave(true)}>Leave room <span aria-hidden="true">↗</span></button>}
    </header>
    <main>
      {!session ? <>
        {mode === 'home' ? <section className="home">
          <div className="eyebrow"><span className="live-dot" /> SAME ROOM. DIFFERENT STORIES.</div>
          <h1>You know<br />your friends.<br /><span>Or do you?</span></h1>
          <p className="lead">Everyone gets a question. One gets a different one.<br className="desktop-break" /> Spot the imposter hiding in plain sight.</p>
          <div className="home-actions">
            <button className="primary" onClick={() => { setMode('create'); setFormError(''); }}>Create Room <span aria-hidden="true">↗</span></button>
            <button className="secondary" onClick={() => { setMode('join'); setFormError(''); }}>Join Room <span aria-hidden="true">→</span></button>
          </div>
          <div className="game-facts"><span>03—12 PLAYERS</span><span>20 MIN / ROUND</span><span>ZERO DOWNLOADS</span></div>
          <div className="how-to"><div><b>01</b><h3>Answer privately</h3><p>Keep your question to yourself. Nobody knows their role.</p></div><div><b>02</b><h3>Read the room</h3><p>Answers go public. Compare, question, and make your case.</p></div><div><b>03</b><h3>Reveal the imposter</h3><p>The host reveals the truth. Trust issues are optional.</p></div></div>
        </section> : <section className="entry narrow">
          <button className="text-button back" onClick={() => setMode('home')}>← Back</button>
          <div className="eyebrow">GET EVERYONE TOGETHER</div>
          <h1>{mode === 'create' ? <>Make some<br /><span>suspicions.</span></> : <>Got a code?<br /><span>You’re in.</span></>}</h1>
          <p className="muted">{mode === 'create' ? 'Create a room and share the code with your friends.' : 'Ask your host for the six-character room code.'}</p>
          <form className="card entry-form" onSubmit={enter}>
            <label htmlFor="nickname">Your nickname</label>
            <input id="nickname" autoComplete="nickname" autoFocus maxLength={24} required placeholder="What should we call you?" value={name} onChange={e => setName(e.target.value)} />
            {mode === 'join' && <><label htmlFor="room-code">Room code</label><input className="code-input" id="room-code" autoComplete="off" minLength={6} maxLength={6} pattern="[A-Za-z2-9]{6}" required placeholder="ABC123" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} /></>}
            {formError && <p className="error" role="alert">{formError}</p>}
            <button className="primary full" disabled={loading}>{loading ? 'Getting your room…' : mode === 'create' ? 'Create Room ↗' : 'Join Room →'}</button>
          </form>
          <p className="small muted">Play together in person. Each player needs their own screen.</p>
        </section>}
      </> : <section className="room">
        <div className="room-bar"><div><span className="eyebrow">YOUR ROOM</span><div className="room-code">{session.code}<button className="copy-button" aria-label="Copy room code" onClick={copyCode}>{copied ? 'Copied ✓' : 'Copy code ⧉'}</button></div></div><div className={`connection ${connected ? 'online' : ''}`} role="status"><span className="live-dot" />{connection}</div></div>
        {error && <div className="error" role="alert">{error}</div>}
        {room?.hostNotice && <div className="notice" role="status">{room.hostNotice}</div>}
        {room?.hostReconnectAt && <div className="notice" role="status">The host disconnected. Holding their place for {formatTime(room.hostReconnectAt, serverNow)}.</div>}
        {!room ? <div className="card loading-state"><div className="spinner" /><h2>Finding your people…</h2><p className="muted">Your room and answers are saved on the server.</p></div> : <>
          <div className="room-layout"><div className="game-column">
            {room.phase === 'lobby' && <div className="card stage-card">
              <div className="eyebrow">THE LOBBY</div><h1>One of you<br /><span>won’t fit in.</span></h1>
              <p className="muted">Share the code. Gather your friends. Keep your screen to yourself once the round starts.</p>
              <div className="lobby-count"><strong>{onlineCount.toString().padStart(2, '0')}</strong><span>/ 12 players connected<br />At least 3 to start</span></div>
              {isHost ? <button className="primary full" disabled={busy || onlineCount < 3} onClick={() => send({ type: 'start' })}>Start round <span aria-hidden="true">→</span></button> : <p className="waiting-label">Waiting for {room.players.find(p => p.id === room.hostId)?.nickname ?? 'the host'} to start…</p>}
              <p className="small muted">90 seconds to answer · 20 minutes for the whole round</p>
            </div>}
            {room.phase === 'answering' && <div className="card stage-card">
              <div className="stage-top"><div className="eyebrow">ROUND {String(room.roundNumber).padStart(2, '0')} / KEEP IT PRIVATE</div><span className="timer" aria-label="Answer time remaining">{formatTime(room.answerDeadline, serverNow)}</span></div>
              {room.question ? <>
                <div className="question-tag">YOUR QUESTION <span aria-hidden="true">↘</span></div><h2 className="question">{room.question}</h2>
                {me?.submitted ? <div className="submitted" role="status"><span className="check">✓</span><h3>Answer locked in.</h3><p className="your-answer">{room.yourAnswer}</p><p className="muted">Watch the room, not their screens. Answers reveal together.</p></div> : <form onSubmit={e => { e.preventDefault(); send({ type: 'answer', answer, round: room.roundNumber }); }}>
                  <label htmlFor="answer">Your answer</label><input id="answer" autoComplete="off" maxLength={160} required placeholder="Keep it short. Make it believable." value={answer} onChange={e => setAnswer(e.target.value)} disabled={busy || serverNow >= room.answerDeadline!} />
                  <div className="input-note"><span>One answer. No edits after submitting.</span><span>{answer.length}/160</span></div>
                  <button className="primary full" disabled={busy || !answer.trim() || serverNow >= room.answerDeadline!}>Lock in answer <span aria-hidden="true">→</span></button>
                </form>}
              </> : <><h2>You’re watching this round.</h2><p className="muted">You weren’t connected when it began. You can play the next one.</p></>}
              <p className="small muted">{room.players.filter(p => room.participantIds.includes(p.id) && p.submitted).length} / {room.participantIds.length} answers submitted{serverNow >= room.answerDeadline! ? ' · Waiting for the server to reveal…' : ''}</p>
            </div>}
            {room.phase === 'discussion' && <div className="card stage-card">
              <div className="stage-top"><div className="eyebrow">ROUND {String(room.roundNumber).padStart(2, '0')} / THE DISCUSSION</div><span className="timer" aria-label="Round time remaining">{formatTime(room.roundDeadline, serverNow)}</span></div>
              <h1>Something<br /><span>doesn’t add up.</span></h1><p className="muted">These are the answers. Who got a different question? Talk it out together.</p>
              <AnswerList room={room} />
              <p className="small muted">The imposter reveals automatically when the round ends.</p>
            </div>}
            {room.phase === 'revealed' && <div className="card stage-card reveal-card">
              <div className="eyebrow">ROUND {String(room.roundNumber).padStart(2, '0')} / THE TRUTH IS OUT</div>
              <p className="reveal-attribution" role="status">{room.reveal?.reason === 'host' ? `${room.reveal.revealedBy} (host) revealed the imposter.` : 'Time’s up. The server revealed the imposter.'}</p>
              <div className="imposter-badge">THE IMPOSTER WAS</div><h1 className="imposter-name">{room.reveal?.imposterName}</h1>
              <div className="revealed-question"><span>EVERYONE ELSE’S QUESTION</span><h3>{room.reveal?.normalQuestion}</h3></div>
              <div className="revealed-question alternate"><span>THE IMPOSTER’S QUESTION</span><h3>{room.reveal?.imposterQuestion}</h3></div>
              <AnswerList room={room} />
              {isHost ? <button className="primary full" disabled={busy || onlineCount < 3} onClick={() => send({ type: 'start' })}>Next round <span aria-hidden="true">→</span></button> : <p className="waiting-label">Waiting for the host to start the next round…</p>}
              {onlineCount < 3 && <p className="small muted">At least 3 connected players needed for the next round.</p>}
            </div>}
            {isHost && ['answering', 'discussion'].includes(room.phase) && <div className="host-controls"><p>You’re the host. Ready to call it?</p><button className="danger-outline" disabled={busy} onClick={() => setConfirmReveal(true)}>Reveal Imposter</button><p className="small muted">Ends the round and reveals the truth to everyone.</p></div>}
          </div>
          <aside className="card players-card"><div className="section-label"><h2>The room</h2><span>{activePlayers.length}/12</span></div><ul>{activePlayers.map((player, index) => <li key={player.id}><span className={`avatar avatar-${index % 4}`}>{player.nickname.slice(0, 1).toUpperCase()}</span><div className="player-info"><strong>{player.nickname}{player.id === room.you && <small> (you)</small>}</strong><span className="small muted">{player.id === room.hostId ? 'Host' : 'Player'}{!player.connected ? ' · offline' : me && room.phase === 'answering' && room.participantIds.includes(player.id) ? player.submitted ? ' · answered' : ' · thinking' : ' · connected'}</span></div><span className={`player-dot ${player.connected ? 'active' : ''}`} aria-label={player.connected ? 'Connected' : 'Disconnected'} /></li>)}</ul><p className="small muted">{isHost ? 'You’re in charge. The reveal is always public.' : 'Stay curious. Trust nobody.'}</p></aside>
          </div>
        </>}
        {!connected && <button className="text-button return-home" onClick={exit}>Return home on this tab</button>}
      </section>}
    </main>
    <footer><span>IMP0STER</span><span>A LITTLE DOUBT. A LOT OF FUN.</span></footer>
    {confirmReveal && room && <Confirm title="Ready to reveal?" message="Everyone will immediately see the imposter’s name and both questions. This ends the round for everyone." confirm="Reveal to everyone" onCancel={() => setConfirmReveal(false)} onConfirm={() => { send({ type: 'reveal', round: room.roundNumber }); setConfirmReveal(false); }} disabled={busy} />}
    {confirmLeave && <Confirm title="Leave this room?" message={isHost ? 'Host privileges will immediately pass to the earliest-joined remaining player. Leaving removes your reconnection session.' : 'You will leave this room and remove your reconnection session.'} confirm="Leave room" onCancel={() => setConfirmLeave(false)} onConfirm={() => void leave()} disabled={loading} />}
  </div>;
}
function AnswerList({ room }: { room: RoomView }) {
  return <ul className="answer-list">{room.answers?.map(answer => <li key={answer.playerId} className={room.reveal?.imposterId === answer.playerId ? 'imposter-answer' : ''}><div><span>{answer.nickname}{answer.playerId === room.you ? ' (you)' : ''}</span>{room.reveal?.imposterId === answer.playerId && <b>IMPOSTER</b>}</div><strong>{answer.answer ?? 'No answer'}</strong></li>)}</ul>;
}
function Confirm({ title, message, confirm, onConfirm, onCancel, disabled }: { title: string; message: string; confirm: string; onConfirm: () => void; onCancel: () => void; disabled: boolean }) {
  return <dialog open aria-labelledby="dialog-title" className="dialog" ref={element => { if (element && !element.matches(':modal')) { element.close(); element.showModal(); } }} onCancel={e => { e.preventDefault(); onCancel(); }}>
    <h2 id="dialog-title">{title}</h2><p className="muted">{message}</p><div className="dialog-actions"><button className="secondary" autoFocus onClick={onCancel}>Keep playing</button><button className="primary" disabled={disabled} onClick={onConfirm}>{confirm}</button></div>
  </dialog>;
}
