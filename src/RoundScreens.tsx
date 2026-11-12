import type { Action, RoomView } from '../shared/protocol';
import { Arrow, Fingerprint } from './CaseArtwork';
import { formatTime } from './formatTime';
function Timer({ deadline, now, answering = false }: { deadline: number | null; now: number; answering?: boolean }) {
  return <div className={`timer ${answering && (deadline ?? now) - now <= 15_000 ? 'is-urgent' : ''}`} role="timer" aria-label={answering ? 'Answer time remaining' : 'Round time remaining'} aria-live="off">
    <span className="timer-label">{answering ? 'TIME TO ANSWER' : 'CASE CLOSES IN'}</span><strong>{formatTime(deadline, now)}</strong>
  </div>;
}
function DocumentHeader({ code, label }: { code: string; label: string }) {
  return <div className="document-header"><span>{label}</span><span>FILE / {code}</span></div>;
}
export function AnswerList({ room }: { room: RoomView }) {
  const reveal = room.phase === 'revealed' ? room.reveal : null;
  return <ul className="answer-list">{room.answers?.map((answer, index) => <li key={answer.playerId} className={`evidence-card ${reveal?.imposterId === answer.playerId ? 'imposter-answer' : ''} ${answer.answer === null ? 'missing-answer' : ''}`}>
    <div className="evidence-header"><span className="evidence-number">{String(index + 1).padStart(2, '0')}</span><span className="witness-name">{answer.nickname}{answer.playerId === room.you ? ' (you)' : ''}</span>{reveal?.imposterId === answer.playerId && <b>IMPOSTER</b>}</div>
    <p className="evidence-answer">{answer.answer ?? 'No answer'}</p><span className="evidence-label">{answer.answer === null ? 'STATEMENT NOT RECEIVED' : 'STATEMENT ON RECORD'}</span>
  </li>)}</ul>;
}
export function RoundScreens({ room, serverNow, busy, isHost, onlineCount, answer, setAnswer, send, onReveal }: {
  room: RoomView; serverNow: number; busy: boolean; isHost: boolean; onlineCount: number;
  answer: string; setAnswer: (answer: string) => void; send: (action: Action) => void; onReveal: () => void;
}) {
  const me = room.players.find(player => player.id === room.you);
  const round = String(room.roundNumber).padStart(2, '0');
  const submittedCount = room.players.filter(player => room.participantIds.includes(player.id) && player.submitted).length;
  return <div className="game-column">
    {room.phase === 'lobby' && <section className="paper stage-card lobby-document" aria-labelledby="lobby-title">
      <DocumentHeader code={room.code} label="CASE STATUS / ASSEMBLING" />
      <div className="lobby-heading"><h1 id="lobby-title">Good company.<br /><span>Bad alibis.</span></h1><span className="stamp lobby-stamp" aria-hidden="true">OPEN<br />CASE</span></div>
      <p className="document-intro">Get everyone in the room. One of you will have a different question. None of you will know who.</p>
      <div className="lobby-count"><strong>{String(onlineCount).padStart(2, '0')}</strong><div><b>suspects connected</b><span>3–12 players · One shared investigation</span></div></div>
      {isHost ? <button className="primary full" disabled={busy || onlineCount < 3} aria-busy={busy} onClick={() => send({ type: 'start' })}>Start round <Arrow /></button>
        : <p className="waiting-label" role="status"><span className="status-dot" />Waiting for {room.players.find(player => player.id === room.hostId)?.nickname ?? 'the host'} to start…</p>}
      <div className="document-footnote"><span>90 seconds to answer</span><span>20 minutes to close the case</span></div>
    </section>}
    {room.phase === 'answering' && <section className="paper stage-card question-document" aria-labelledby="question-title">
      <DocumentHeader code={room.code} label={`CASE ${round} / CONFIDENTIAL`} />
      <div className="assignment-meta"><span className="classification">For your eyes only</span><Timer deadline={room.answerDeadline} now={serverNow} answering /></div>
      {room.question ? <>
        <span className="eyebrow">YOUR PRIVATE QUESTION</span><h1 id="question-title" className="question">{room.question}</h1>
        {me?.submitted ? <div className="submitted" role="status"><div className="seal-mark"><Fingerprint /><span className="stamp">STATEMENT<br />SEALED</span></div>
          <p className="your-answer">{room.yourAnswer}</p><p className="muted">Your answer is on record. Keep your question to yourself while the others finish.</p>
        </div> : <form onSubmit={event => { event.preventDefault(); send({ type: 'answer', answer, round: room.roundNumber }); }}>
          <label htmlFor="answer">Your answer</label><input id="answer" autoComplete="off" maxLength={160} required placeholder="A short answer. A convincing story." value={answer} onChange={event => setAnswer(event.target.value)} disabled={busy || serverNow >= room.answerDeadline!} aria-describedby="answer-note" />
          <div className="input-note" id="answer-note"><span>One statement. No edits once sealed.</span><span>{answer.length}/160</span></div>
          <button className="primary full" disabled={busy || !answer.trim() || serverNow >= room.answerDeadline!} aria-busy={busy}>Submit Answer <Arrow /></button>
        </form>}
      </> : <><h1 id="question-title" className="question">Observe this case.</h1><p className="muted">You weren’t connected when it began. You can play the next round.</p></>}
      <div className="submission-progress"><span className="progress-track" aria-hidden="true">{room.participantIds.map(id => <i key={id} className={room.players.some(player => player.id === id && player.submitted) ? 'complete' : ''} />)}</span>
        <p>{submittedCount} of {room.participantIds.length} statements sealed{serverNow >= room.answerDeadline! ? ' · Waiting for the server to reveal…' : ''}</p></div>
    </section>}
    {room.phase === 'discussion' && <section className="discussion-stage" aria-labelledby="discussion-title">
      <div className="stage-heading"><div><span className="eyebrow">CASE {round} / EVIDENCE UNLOCKED</span><h1 id="discussion-title">Read between<br /><span>the alibis.</span></h1></div><Timer deadline={room.roundDeadline} now={serverNow} /></div>
      <p className="stage-intro">All statements are on the table. Who answered a different question? Talk it out.</p>
      <AnswerList room={room} /><p className="small muted case-end-note">The truth comes out when the host reveals, or when the 20-minute case deadline expires.</p>
    </section>}
    {room.phase === 'revealed' && room.reveal && <section className="final-stage" aria-labelledby="reveal-title">
      <div className="reveal-verdict"><div className="verdict-meta"><span>CASE {round} / IDENTITY CONFIRMED</span><span className="verdict-cross" aria-hidden="true">✳</span></div>
        <span className="imposter-badge">THE IMPOSTER WAS…</span><h1 id="reveal-title" className="imposter-name">{room.reveal.imposterName}</h1>
        <div className="reveal-bottom"><span className="stamp">CASE CLOSED</span><Fingerprint /></div>
      </div>
      <p className="reveal-attribution" role="status">{room.reveal.reason === 'host' ? `${room.reveal.revealedBy} (host) revealed the imposter.` : 'Time’s up. The server revealed the imposter.'}</p>
      <div className="paper revealed-questions"><div className="revealed-question"><span className="eyebrow">EVERYONE ELSE’S QUESTION</span><h2>{room.reveal.normalQuestion}</h2></div>
        <div className="revealed-question alternate"><span className="eyebrow">THE IMPOSTER’S QUESTION</span><h2>{room.reveal.imposterQuestion}</h2></div></div>
      <div className="evidence-section-label"><h2>Statements on record</h2><span className="eyebrow">THE CASE FILE</span></div><AnswerList room={room} />
      <div className="next-case"><div><span className="eyebrow">A FRESH START. SAME SUSPECTS.</span><h2>Open a new case.</h2></div>
        {isHost ? <button className="primary" disabled={busy || onlineCount < 3} aria-busy={busy} onClick={() => send({ type: 'start' })}>Next round <Arrow /></button> : <p className="waiting-label" role="status">Waiting for the host to start the next round…</p>}
        {onlineCount < 3 && <p className="small muted">At least 3 connected players needed for the next round.</p>}
      </div>
    </section>}
    {room.phase === 'revealed' && !room.reveal && <section className="paper stage-card"><h1>Receiving the verdict…</h1><p>Waiting for the public case result from the server.</p></section>}
    {isHost && ['answering', 'discussion'].includes(room.phase) && <section className="host-controls" aria-label="Host reveal controls"><div><span className="eyebrow">HOST AUTHORITY</span><h2>Ready to name names?</h2><p>Publicly reveals the imposter and ends the round.</p></div><button className="danger-outline" disabled={busy} onClick={onReveal}>Reveal Imposter <Arrow /></button></section>}
  </div>;
}
