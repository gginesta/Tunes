import { useGameStore } from '../store';
import { getSocket } from './socket';
import type { CueAction, RoundAudio } from '@tunes/shared';

let player: HTMLAudioElement | null = null;
let cue: string | null = null;
let generation = 0;
let lastInterrupted: string | null = null;
let currentRound: string | null = null;

function speakerState() {
  const { room, myId, connected } = useGameStore.getState();
  const game = room?.gameState;
  const audio = game?.audio;
  if (!connected || !game?.matchId || game.roundId == null || !audio?.cueId ||
      audio.kind !== 'automatic' || audio.operatorId !== myId) return null;
  return { audio, ref: { matchId: game.matchId, roundId: game.roundId, cueId: audio.cueId } };
}

function element(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.loop = true;
    player.addEventListener('error', () => { if (player?.error) interruptSpeaker(); });
    player.addEventListener('pause', () => { if (cue && player?.paused) interruptSpeaker(); });
  }
  return player;
}

export function stopSpeakerAudio(): void {
  generation++;
  cue = null;
  player?.pause();
}

export function interruptSpeaker(): void {
  const active = speakerState();
  stopSpeakerAudio();
  useGameStore.setState({ isPlaying: false, autoplayBlocked: false });
  if (!active || !['awaiting_audio', 'playing'].includes(active.audio.status) || lastInterrupted === active.ref.cueId) return;
  lastInterrupted = active.ref.cueId;
  getSocket().emit('audio-interrupted', active.ref);
}

async function playCurrent(audio: RoundAudio, ref: CueAction, force: boolean) {
  if (!audio.source?.url || (!force && cue === ref.cueId)) return;
  const media = element();
  const attempt = ++generation;
  cue = ref.cueId;
  media.volume = useGameStore.getState().volume;
  const url = new URL(audio.source.url, window.location.origin).href;
  const round = ref.matchId + '/' + ref.roundId;
  if (media.src !== url) media.src = url;
  else if (currentRound !== round) media.currentTime = 0;
  currentRound = round;
  try {
    await media.play();
    if (attempt !== generation || speakerState()?.ref.cueId !== ref.cueId) return;
    useGameStore.setState({ autoplayBlocked: false, isPlaying: true });
    if (speakerState()?.audio.status === 'awaiting_audio') getSocket().emit('audio-ready', ref);
  } catch (error) {
    if (attempt !== generation) return;
    if (error instanceof DOMException && error.name === 'NotAllowedError' && speakerState()?.audio.status === 'awaiting_audio') {
      useGameStore.setState({ autoplayBlocked: true, isPlaying: false });
    } else {
      interruptSpeaker();
    }
  }
}

/** Called directly from the speaker's button, so iOS can authorize the element. */
export function startSpeakerAudio(): void {
  const active = speakerState();
  if (!active || document.hidden) return;
  if (active.audio.status === 'paused') {
    getSocket().emit('resume-audio', active.ref);
    if (active.audio.source?.url) void playCurrent(active.audio, active.ref, true);
    return;
  }
  if (lastInterrupted !== active.ref.cueId && (active.audio.status === 'awaiting_audio' || active.audio.status === 'playing')) {
    void playCurrent(active.audio, active.ref, true);
  }
}

export function syncSpeakerAudio(): void {
  const state = useGameStore.getState();
  if (player) player.volume = state.volume;
  const active = speakerState();
  if (!active || document.hidden || lastInterrupted === active.ref.cueId || !['awaiting_audio','playing'].includes(active.audio.status)) {
    if (cue) stopSpeakerAudio();
    if (state.isPlaying || state.autoplayBlocked) useGameStore.setState({isPlaying: false, autoplayBlocked: false});
    return;
  }
  void playCurrent(active.audio, active.ref, false);
}
