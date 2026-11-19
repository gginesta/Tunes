import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePhase, RoundAudio } from '@tunes/shared';

type TestState = {
  myId: string;
  connected: boolean;
  room: { gameState: { matchId: string; roundId: number; phase: GamePhase; audio: RoundAudio } } | null;
  volume: number;
  isPlaying: boolean;
  autoplayBlocked: boolean;
  wakeLockStatus: 'active' | 'off' | 'unavailable';
};
type StoreListener = (state: TestState, old: TestState) => void;

const mocks = vi.hoisted(() => ({
  emit: vi.fn(), getState: vi.fn(), setState: vi.fn(), subscribe: vi.fn(), useEffect: vi.fn(),
}));

vi.mock('../../app/src/store', () => ({
  useGameStore: Object.assign(
    (select: (state: TestState) => unknown) => select(mocks.getState()),
    { getState: mocks.getState, setState: mocks.setState, subscribe: mocks.subscribe },
  ),
}));
vi.mock('../../app/src/services/socket', () => ({ getSocket: () => ({ emit: mocks.emit }) }));
vi.mock('react', () => ({ useEffect: mocks.useEffect }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  playAttempts: ReturnType<typeof deferred<void>>[] = [];
  pauseCount = 0;
  paused = true;
  src = '';
  currentTime = 0;
  volume = 1;
  error: unknown = null;

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }

  play() {
    this.paused = false;
    const attempt = deferred<void>();
    this.playAttempts.push(attempt);
    return attempt.promise;
  }

  pause() {
    this.pauseCount++;
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
}

class FakeWakeLock extends EventTarget {
  release = vi.fn(async () => this.dispatchEvent(new Event('release')));
}

let state: TestState;
let listeners: Set<StoreListener>;
let page: EventTarget & { hidden: boolean };
let screen: EventTarget & { location: { origin: string } };
let effects: (() => void)[];
let requestWakeLock: ReturnType<typeof vi.fn>;

function setState(patch: Partial<TestState>) {
  const previous = state;
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state, previous);
}

function cue(
  status: RoundAudio['status'], cueId: string, url = '/listening/one.mp3', operatorId = 'speaker', roundId = 1,
) {
  setState({
    room: { gameState: {
      matchId: 'match-1', roundId, phase: 'playing',
      audio: { kind: 'automatic', status, cueId, operatorId, source: { url } },
    } },
  });
}

function visibility(hidden: boolean) {
  page.hidden = hidden;
  page.dispatchEvent(new Event('visibilitychange'));
}

function firstAudio() {
  expect(FakeAudio.instances).toHaveLength(1);
  return FakeAudio.instances[0];
}

async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state = {
    myId: 'speaker', connected: true, room: null, volume: 0.4, isPlaying: false,
    autoplayBlocked: false, wakeLockStatus: 'off',
  };
  listeners = new Set();
  page = Object.assign(new EventTarget(), { hidden: false });
  screen = Object.assign(new EventTarget(), { location: { origin: 'https://tunes.test' } });
  effects = [];
  FakeAudio.instances = [];
  requestWakeLock = vi.fn();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', screen);
  vi.stubGlobal('navigator', { wakeLock: { request: requestWakeLock } });
  mocks.getState.mockImplementation(() => state);
  mocks.setState.mockImplementation(setState);
  mocks.subscribe.mockImplementation((listener: StoreListener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  mocks.useEffect.mockImplementation((run: () => void | (() => void)) => {
    const cleanup = run();
    if (cleanup) effects.push(cleanup);
  });
});

afterEach(() => {
  for (const cleanup of effects) cleanup();
  vi.unstubAllGlobals();
});

describe('speaker playback', () => {
  it('reports ready only after a successful play promise and handles a blocked autoplay gesture', async () => {
    const service = await import('../../app/src/services/tableAudio');
    cue('awaiting_audio', 'cue-1');
    service.syncSpeakerAudio();
    const speaker = firstAudio();
    expect(speaker.volume).toBe(0.4);
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(state.isPlaying).toBe(false);

    speaker.playAttempts[0].reject(new DOMException('Playback needs a gesture', 'NotAllowedError'));
    await settled();
    expect(state.autoplayBlocked).toBe(true);
    expect(mocks.emit).not.toHaveBeenCalled();

    service.startSpeakerAudio();
    expect(speaker.playAttempts).toHaveLength(2);
    speaker.playAttempts[1].resolve();
    await settled();
    expect(state.isPlaying).toBe(true);
    expect(state.autoplayBlocked).toBe(false);
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith('audio-ready', { matchId: 'match-1', roundId: 1, cueId: 'cue-1' });
  });

  it('ignores stale play completion after changing songs or losing the speaker role', async () => {
    const service = await import('../../app/src/services/tableAudio');
    cue('awaiting_audio', 'old-cue');
    service.syncSpeakerAudio();
    const speaker = firstAudio();
    cue('awaiting_audio', 'new-cue', '/listening/two.mp3', 'speaker', 2);
    service.syncSpeakerAudio();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(speaker.src).toBe('https://tunes.test/listening/two.mp3');

    speaker.playAttempts[0].resolve();
    await settled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(state.isPlaying).toBe(false);
    speaker.playAttempts[1].resolve();
    await settled();
    expect(state.isPlaying).toBe(true);
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith('audio-ready', { matchId: 'match-1', roundId: 2, cueId: 'new-cue' });

    cue('awaiting_audio', 'handoff-cue', '/listening/two.mp3', 'other-speaker', 2);
    service.syncSpeakerAudio();
    expect(speaker.paused).toBe(true);
    expect(state.isPlaying).toBe(false);
    expect(speaker.playAttempts).toHaveLength(2);
  });

  it('interrupts a hidden device even when the ready confirmation has not reached its local snapshot', async () => {
    requestWakeLock.mockResolvedValue(new FakeWakeLock());
    cue('awaiting_audio', 'cue-before-hide');
    const { useTableAudio } = await import('../../app/src/hooks/useTableAudio');
    useTableAudio();
    const speaker = firstAudio();
    speaker.playAttempts[0].resolve();
    await settled();
    expect(mocks.emit.mock.calls.map(([event]) => event)).toEqual(['audio-ready']);

    visibility(true);
    screen.dispatchEvent(new Event('pagehide'));
    expect(speaker.paused).toBe(true);
    expect(mocks.emit.mock.calls.map(([event]) => event)).toEqual(['audio-ready', 'audio-interrupted']);
    expect(mocks.emit).toHaveBeenLastCalledWith('audio-interrupted', { matchId: 'match-1', roundId: 1, cueId: 'cue-before-hide' });
    expect(state.isPlaying).toBe(false);
    visibility(false);
    expect(speaker.playAttempts).toHaveLength(1);
  });

  it('reports a missing clip as an interruption before readiness instead of an autoplay block', async () => {
    const service = await import('../../app/src/services/tableAudio');
    cue('awaiting_audio', 'broken-cue');
    service.syncSpeakerAudio();
    firstAudio().playAttempts[0].reject(new DOMException('No supported media', 'NotSupportedError'));
    await settled();
    expect(state.autoplayBlocked).toBe(false);
    expect(state.isPlaying).toBe(false);
    expect(mocks.emit).toHaveBeenCalledExactlyOnceWith('audio-interrupted', { matchId: 'match-1', roundId: 1, cueId: 'broken-cue' });
  });

  it('uses one resume gesture, keeps position within a cue round and acknowledges only its fresh cue', async () => {
    const service = await import('../../app/src/services/tableAudio');
    cue('playing', 'cue-start');
    service.syncSpeakerAudio();
    const speaker = firstAudio();
    speaker.playAttempts[0].resolve();
    await settled();
    speaker.currentTime = 12.25;
    service.interruptSpeaker();
    cue('paused', 'cue-start');
    service.syncSpeakerAudio();

    service.startSpeakerAudio();
    expect(mocks.emit).toHaveBeenLastCalledWith('resume-audio', { matchId: 'match-1', roundId: 1, cueId: 'cue-start' });
    expect(speaker.playAttempts).toHaveLength(2);
    cue('awaiting_audio', 'cue-resumed');
    service.syncSpeakerAudio();
    speaker.playAttempts[1].resolve();
    speaker.playAttempts[2].resolve();
    await settled();
    expect(speaker.currentTime).toBe(12.25);
    expect(mocks.emit).toHaveBeenLastCalledWith('audio-ready', { matchId: 'match-1', roundId: 1, cueId: 'cue-resumed' });
    expect(mocks.emit.mock.calls.filter(([event]) => event === 'audio-ready')).toHaveLength(1);

    cue('awaiting_audio', 'same-track-new-round', undefined, 'speaker', 2);
    service.syncSpeakerAudio();
    expect(speaker.currentTime).toBe(0);
  });
});

describe('speaker wake lock', () => {
  it('reacquires after a browser release on visibility change and releases on exit', async () => {
    const first = new FakeWakeLock();
    const second = new FakeWakeLock();
    requestWakeLock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    cue('paused', 'cue-1');
    const { useTableAudio } = await import('../../app/src/hooks/useTableAudio');
    useTableAudio();
    await settled();
    expect(requestWakeLock).toHaveBeenCalledExactlyOnceWith('screen');
    expect(state.wakeLockStatus).toBe('active');

    visibility(true);
    first.dispatchEvent(new Event('release'));
    expect(state.wakeLockStatus).toBe('unavailable');
    expect(requestWakeLock).toHaveBeenCalledTimes(1);

    visibility(false);
    await settled();
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(state.wakeLockStatus).toBe('active');

    const unmount = effects.splice(0);
    for (const cleanup of unmount) cleanup();
    await settled();
    expect(second.release).toHaveBeenCalledTimes(1);
    expect(state.wakeLockStatus).toBe('off');
  });

  it('releases a pending wake lock if the speaker exits before the browser grants it', async () => {
    const pending = deferred<FakeWakeLock>();
    const granted = new FakeWakeLock();
    requestWakeLock.mockReturnValueOnce(pending.promise);
    cue('paused', 'cue-1');
    const { useTableAudio } = await import('../../app/src/hooks/useTableAudio');
    useTableAudio();
    const unmount = effects.splice(0);
    for (const cleanup of unmount) cleanup();
    pending.resolve(granted);
    await settled();
    expect(granted.release).toHaveBeenCalledTimes(1);
    expect(state.wakeLockStatus).toBe('off');
  });

  it('tries the foreground request if a pending request fails after a visibility round trip', async () => {
    const background = deferred<FakeWakeLock>();
    const foreground = new FakeWakeLock();
    requestWakeLock.mockReturnValueOnce(background.promise).mockResolvedValueOnce(foreground);
    cue('paused', 'cue-1');
    const { useTableAudio } = await import('../../app/src/hooks/useTableAudio');
    useTableAudio();
    visibility(true);
    visibility(false);
    background.reject(new DOMException('The document was hidden', 'NotAllowedError'));

    await settled();
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(state.wakeLockStatus).toBe('active');
  });

  it('releases a wake lock granted after the speaker went into the background', async () => {
    const pending = deferred<FakeWakeLock>();
    const granted = new FakeWakeLock();
    requestWakeLock.mockReturnValueOnce(pending.promise);
    cue('paused', 'cue-1');
    const { useTableAudio } = await import('../../app/src/hooks/useTableAudio');
    useTableAudio();
    visibility(true);
    pending.resolve(granted);

    await settled();
    expect(granted.release).toHaveBeenCalledTimes(1);
    expect(state.wakeLockStatus).not.toBe('active');
  });
});
