import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { Confirm } from '../src/Modal';
import { InviteModal } from '../src/InviteModal';
import { RoomNotice } from '../src/RoomNotice';
import { inviteLink, readInvite } from '../src/invites';
import { post, useRoom } from '../src/useRoom';
import { NOTICE_MS, type RoomView } from '../shared/protocol';
import { QRCodeSVG } from 'qrcode.react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../src/useRoom', async importOriginal => ({ ...await importOriginal<typeof import('../src/useRoom')>(),
  post: vi.fn(), useRoom: vi.fn(),
}));
const token = 'a'.repeat(64);
const T = 1_000_000;
function room(): RoomView {
  return { code: 'ABC234', you: 'host', hostId: 'host', hostReconnectAt: null, hostNotice: null, notice: null,
    players: [{ id: 'host', nickname: 'Alex', connected: true, left: false, submitted: false },
      { id: 'other', nickname: 'Blair', connected: false, left: false, submitted: false, disconnectedAt: T - 90_000 }],
    phase: 'lobby', roundNumber: 0, serverNow: T, answerDeadline: null, roundDeadline: null,
    participantIds: [], question: null, yourAnswer: null, answers: null, reveal: null };
}
const send = vi.fn();
function withRoom(state: RoomView | null = null) {
  vi.mocked(useRoom).mockReturnValue({ room: state, connection: 'Connected', error: '', setError: vi.fn(), pending: false, send, clockOffset: 0 });
}
beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState({}, '', '/');
  withRoom();
  vi.mocked(post).mockResolvedValue({ code: 'ABC234' });
});
function savePlayer() { sessionStorage.setItem('imposter.session.v1', JSON.stringify({ code: 'ABC234', token })); }

describe('QR invites and joining', () => {
  it('builds links from the current origin with only a public code, across domain changes', () => {
    expect(inviteLink('https://first.example/private?token=secret#fragment', 'ABC234')).toBe('https://first.example/?join=ABC234');
    expect(inviteLink('https://new.example:8443', 'ABC234')).toBe('https://new.example:8443/?join=ABC234');
    expect(() => inviteLink('https://imposter.test', '<evil>')).toThrow('Invalid');
    expect(readInvite('?join=abc234')).toEqual({ code: 'ABC234', error: null });
  });
  it.each(['?join=', '?join=ABC234&join=DEF234', '?join=%3Cscript%3E', '?join=https://evil.test'])('rejects malformed invite %s', search => {
    expect(readInvite(search).code).toBeNull(); expect(readInvite(search).error).toContain('invalid');
  });
  it('prefills the Join form but requires a nickname and explicit submission', async () => {
    history.replaceState({}, '', '/?join=abc234');
    render(<App />);
    expect((screen.getByLabelText('Room code') as HTMLInputElement).value).toBe('ABC234');
    const nickname = screen.getByLabelText('Your nickname') as HTMLInputElement;
    expect(nickname.required).toBe(true); expect(nickname.value).toBe('');
    expect(post).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    fireEvent.change(nickname, { target: { value: 'New friend' } });
    await act(async () => fireEvent.submit(nickname.closest('form')!));
    expect(post).toHaveBeenCalledWith('/api/rooms/ABC234/join', { nickname: 'New friend', token: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it.each(['ABC234', 'DEF234'])('keeps the active session when an invite for %s opens', code => {
    savePlayer(); const saved = sessionStorage.getItem('imposter.session.v1');
    history.replaceState({}, '', `/?join=${code}`); withRoom(room());
    render(<App />);
    expect(screen.queryByLabelText('Your nickname')).toBeNull();
    expect(screen.getByText(/current.*session has been kept/)).toBeTruthy();
    expect(sessionStorage.getItem('imposter.session.v1')).toBe(saved);
    expect(post).not.toHaveBeenCalled(); expect(useRoom).toHaveBeenCalledWith({ code: 'ABC234', token }, expect.any(Function));
  });
  it('allows explicit leave before opening a different invited room form', async () => {
    savePlayer(); history.replaceState({}, '', '/?join=DEF234'); withRoom(room());
    render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Leave room' }));
    await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave room' })));
    expect(post).toHaveBeenCalledWith('/api/rooms/ABC234/leave', { token });
    expect(sessionStorage.getItem('imposter.session.v1')).toBeNull();
    expect((screen.getByLabelText('Room code') as HTMLInputElement).value).toBe('DEF234');
  });
  it('renders a high-contrast local SVG QR and copies exactly the displayed invite URL', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    const { container } = render(<InviteModal code="ABC234" onClose={vi.fn()} />);
    expect(container.querySelector('svg title')?.textContent).toBe('Join Imposter room ABC234');
    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('280');
    const expected = document.createElement('div');
    expected.innerHTML = renderToStaticMarkup(<QRCodeSVG value="https://imposter.test/?join=ABC234"
      size={280} level="M" marginSize={4} bgColor="#ffffff" fgColor="#101218" />);
    expect([...container.querySelectorAll('svg path')].map(path => path.getAttribute('d')))
      .toEqual([...expected.querySelectorAll('svg path')].map(path => path.getAttribute('d')));
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toBe('https://imposter.test/?join=ABC234');
    expect(container.querySelectorAll('img, iframe')).toHaveLength(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy Invite Link' })));
    expect(copy).toHaveBeenCalledWith('https://imposter.test/?join=ABC234');
    expect(screen.getByRole('status').textContent).toBe('Invite link copied.');
  });
  it('explains clipboard failure and leaves a selectable read-only link', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<InviteModal code="ABC234" onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy Invite Link' })));
    expect(screen.getByRole('status').textContent).toContain('Clipboard unavailable');
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).readOnly).toBe(true);
  });
  it.each(['lobby', 'revealed', 'answering', 'discussion'] as const)('restricts the QR control to the host between rounds (%s)', phase => {
    savePlayer(); const state = { ...room(), phase }; withRoom(state);
    const { rerender } = render(<App />);
    expect(!!screen.queryByRole('button', { name: 'Show QR Code' })).toBe(phase === 'lobby' || phase === 'revealed');
    withRoom({ ...state, hostId: 'other' }); rerender(<App />);
    expect(screen.queryByRole('button', { name: 'Show QR Code' })).toBeNull();
  });
});

describe('dialog and notice stability', () => {
  it('wraps Tab and Shift+Tab within the modal controls', () => {
    render(<Confirm title="Confirm" message="Public action" confirm="Reveal" onConfirm={vi.fn()} onCancel={vi.fn()} disabled={false} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Reveal' });
    confirm.focus(); fireEvent.keyDown(confirm, { key: 'Tab' }); expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(confirm);
  });
  it('closes a retained native modal immediately and never reopens it on ordinary rerenders', () => {
    const props = { title: 'Confirm', message: 'First', confirm: 'Reveal', onConfirm: vi.fn(), onCancel: vi.fn(), disabled: false };
    const { rerender } = render(<Confirm {...props} open />);
    const opens = vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls.length;
    rerender(<Confirm {...props} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    rerender(<Confirm {...props} open={false} message="A clock or roster update" />);
    expect(vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls).toHaveLength(opens);
    rerender(<Confirm {...props} open />);
    expect(vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls).toHaveLength(opens + 1);
  });
  it('keeps a modal mounted and focused across parent rerenders, then restores focus on close', () => {
    const trigger = document.createElement('button'); trigger.textContent = 'Trigger'; document.body.appendChild(trigger); trigger.focus();
    const props = { title: 'Confirm', message: 'First', confirm: 'Reveal', onConfirm: vi.fn(), onCancel: vi.fn(), disabled: false };
    const { rerender, unmount } = render(<Confirm {...props} />);
    const openCount = vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls.length;
    const confirm = screen.getByRole('button', { name: 'Reveal' }); confirm.focus();
    rerender(<Confirm {...props} message="Updated roster" />);
    expect(vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls).toHaveLength(openCount);
    expect(document.activeElement).toBe(confirm);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    unmount(); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe(''); trigger.remove();
  });
  it('dismisses succession notices once without restarting on roster broadcasts', () => {
    vi.useFakeTimers();
    const notice = { id: 'event-1', text: 'Blair is now the host.', at: T, kind: 'host' as const };
    const { rerender } = render(<RoomNotice notice={notice} serverNow={T} />);
    act(() => vi.advanceTimersByTime(NOTICE_MS - 100));
    rerender(<RoomNotice notice={{ ...notice }} serverNow={T + NOTICE_MS - 100} />);
    act(() => vi.advanceTimersByTime(100)); expect(screen.queryByRole('status')).toBeNull();
    rerender(<RoomNotice notice={{ ...notice }} serverNow={T + NOTICE_MS + 1} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<RoomNotice notice={{ ...notice, id: 'event-2', at: T + NOTICE_MS }} serverNow={T + NOTICE_MS + 1} />);
    expect(screen.getByRole('status').textContent).toBe(notice.text);
  });
  it('shows timed removal controls only to hosts and disables stale confirmations after reconnect', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T); savePlayer(); const state = room(); withRoom(state);
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove offline player Blair' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove offline player' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    withRoom({ ...state, players: state.players.map(p => ({ ...p, connected: true, disconnectedAt: null })) }); rerender(<App />);
    expect(confirm.disabled).toBe(true); expect(screen.getByText(/connection changed or they have already left/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
  it('sends the exact confirmed disconnect timestamp when removing an eligible player', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T); savePlayer(); withRoom(room()); render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove offline player Blair' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove offline player' }));
    expect(send).toHaveBeenCalledWith({ type: 'removeOffline', playerId: 'other', disconnectedAt: T - 90_000 });
  });
});

describe('CASE FILE gameplay presentation', () => {
  const normalQuestion = 'Private question only for this player?';
  const otherQuestion = 'A different private question?';
  function playing(): RoomView {
    const state = room();
    return { ...state, phase: 'answering', roundNumber: 1,
      question: normalQuestion, participantIds: ['host', 'other', 'third'], answerDeadline: T + 90_000, roundDeadline: T + 1_200_000,
      players: [...state.players.map(p => ({ ...p, connected: true, disconnectedAt: null })),
        { id: 'third', nickname: 'Casey', connected: true, left: false, submitted: false }] };
  }
  const reveal = { imposterId: 'other', imposterName: 'Blair', normalQuestion, imposterQuestion: otherQuestion,
    reason: 'host' as const, revealedBy: 'Alex' };
  it('runs home → create → lobby → private answer → discussion → server reveal → next round', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(T);
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    const nickname = screen.getByLabelText('Your nickname'); fireEvent.change(nickname, { target: { value: 'Alex' } });
    await act(async () => fireEvent.submit(nickname.closest('form')!));
    const state = playing(); withRoom({ ...state, phase: 'lobby' }); rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start round' })); expect(send).toHaveBeenLastCalledWith({ type: 'start', round: 1 });
    withRoom(state); rerender(<App />);
    expect(screen.getByRole('heading', { name: normalQuestion })).toBeTruthy();
    expect(screen.queryByText(otherQuestion)).toBeNull(); expect(screen.queryByText('THE IMPOSTER WAS…')).toBeNull();
    expect(screen.getByRole('timer', { name: 'Answer time remaining' }).textContent).toContain('1:30');
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Seven' } });
    fireEvent.submit(screen.getByLabelText('Your answer').closest('form')!);
    expect(send).toHaveBeenLastCalledWith({ type: 'answer', answer: 'Seven', round: 1 });
    withRoom({ ...state, yourAnswer: 'Seven', players: state.players.map(p => ({ ...p, submitted: p.id === 'host' })) }); rerender(<App />);
    expect(screen.getByText(/STATEMENT.*SEALED/)).toBeTruthy(); expect(screen.queryByLabelText('Your answer')).toBeNull();
    const answers = [{ playerId: 'host', nickname: 'Alex', answer: 'Seven' }, { playerId: 'other', nickname: 'Blair', answer: 'Eight' }, { playerId: 'third', nickname: 'Casey', answer: null }];
    const discussion = { ...state, phase: 'discussion' as const, question: null, answers };
    withRoom(discussion); rerender(<App />);
    expect(screen.getByText('Eight')).toBeTruthy(); expect(screen.getByText('No answer')).toBeTruthy();
    expect(screen.queryByText(normalQuestion)).toBeNull(); expect(screen.queryByText(otherQuestion)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Imposter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal to everyone' }));
    expect(send).toHaveBeenLastCalledWith({ type: 'reveal', round: 1 });
    expect(screen.queryByText('THE IMPOSTER WAS…')).toBeNull();
    withRoom({ ...discussion, phase: 'revealed', reveal }); rerender(<App />);
    expect(screen.getByRole('heading', { name: 'Blair' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: normalQuestion })).toBeTruthy(); expect(screen.getByRole('heading', { name: otherQuestion })).toBeTruthy();
    expect(screen.getByText('Seven')).toBeTruthy(); expect(screen.getByText('Eight')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next round' })); expect(send).toHaveBeenLastCalledWith({ type: 'start', round: 1 });
    withRoom({ ...state, roundNumber: 2, question: 'A fresh assignment?' }); rerender(<App />);
    expect(screen.getByRole('heading', { name: 'A fresh assignment?' })).toBeTruthy();
    expect((screen.getByLabelText('Your answer') as HTMLInputElement).value).toBe(''); expect(screen.queryByText('Eight')).toBeNull();
  });
  it('does not display a verdict or role styling outside the server-authorized reveal phase', () => {
    savePlayer(); const state = playing();
    withRoom({ ...state, phase: 'discussion', answers: [{ playerId: 'other', nickname: 'Blair', answer: 'Eight' }], reveal });
    const { container, rerender } = render(<App />);
    expect(screen.queryByText('THE IMPOSTER WAS…')).toBeNull(); expect(container.querySelector('.imposter-answer')).toBeNull();
    expect(screen.queryByRole('heading', { name: otherQuestion })).toBeNull();
    withRoom({ ...state, phase: 'revealed', reveal: null }); rerender(<App />);
    expect(screen.queryByText('THE IMPOSTER WAS…')).toBeNull(); expect(screen.getByText(/Receiving the verdict/)).toBeTruthy();
  });
  it('does not reopen the invitation after another game transition or host loss', () => {
    savePlayer(); const state = playing(); withRoom({ ...state, phase: 'lobby' });
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Show QR Code' })); expect(screen.getByRole('dialog')).toBeTruthy();
    withRoom(state); rerender(<App />); expect(screen.queryByRole('dialog')).toBeNull();
    withRoom({ ...state, phase: 'revealed', reveal }); rerender(<App />); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show QR Code' }));
    withRoom({ ...state, phase: 'revealed', reveal, hostId: 'other' }); rerender(<App />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByRole('button', { name: 'Next round' })).toBeNull();
  });
});
