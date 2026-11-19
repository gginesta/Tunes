import { useGameStore } from '../store';
import { getSocket } from './socket';
import type { CueAction, RoundAudio } from '@tunes/shared';
import { isSpotifyClientConfigured, openSpotifyLogin } from './spotify';
import {
  clearTableSpotifyCredential, getTableSpotifyToken, hasTableSpotifyCredential, saveTableSpotifyCredential,
} from './tableSpotifyCredential';
import { SpotifyGestureRequired, TableSpotifyPlayer } from './tableSpotifyPlayer';

let player: HTMLAudioElement | null = null;
let cue: string | null = null;
let generation = 0;
let lastInterrupted: string | null = null;
let currentRound: string | null = null;
let spotify: { player: TableSpotifyPlayer; roomCode: string; playerId: string } | null = null;
let spotifySignIn: { roomCode: string; playerId: string; promise: Promise<void> } | null = null;

function canConnectSpotify(roomCode: string, playerId: string, allowLobbySelection = false): boolean {
  const { connected, room, myId } = useGameStore.getState();
  if (!connected || room?.code !== roomCode || myId !== playerId) return false;
  if (room.gameState.phase === 'lobby') return allowLobbySelection && room.hostId === myId;
  const audio = room.gameState.audio;
  return room.playbackMode === 'spotify' && audio?.operatorId === myId && audio.kind === 'automatic' &&
    ['awaiting_audio', 'playing', 'paused'].includes(audio.status);
}

export async function connectSpotifySpeaker(roomCode: string, playerId: string): Promise<void> {
  if (!canConnectSpotify(roomCode, playerId, true)) throw new Error('This device is not the table speaker.');
  if (spotifySignIn) {
    if (spotifySignIn.roomCode === roomCode && spotifySignIn.playerId === playerId) return spotifySignIn.promise;
    throw new Error('Finish or close the current Spotify sign-in first.');
  }
  const promise = openSpotifyLogin().then(credential => {
    if (!canConnectSpotify(roomCode, playerId, true)) throw new Error('The speaker seat changed during sign-in.');
    saveTableSpotifyCredential(roomCode, playerId, credential);
    closeSpotifySpeaker();
    if (speakerState()?.audio.source?.spotifyTrackId) pauseSpeakerAudio();
    useGameStore.setState({ spotifyError: null });
    syncSpeakerAudio();
  }).finally(() => { spotifySignIn = null; });
  spotifySignIn = { roomCode, playerId, promise };
  return promise;
}

export function disconnectSpotifySpeaker(roomCode: string, playerId: string): void {
  if (!canConnectSpotify(roomCode, playerId, true)) return;
  clearTableSpotifyCredential(roomCode, playerId);
  closeSpotifySpeaker();
  useGameStore.setState({ spotifyError: 'Connect Spotify on this speaker device.' });
  if (speakerState()?.audio.source?.spotifyTrackId) interruptSpeaker();
}

function speakerState() {
  const { room, myId, connected } = useGameStore.getState();
  const game = room?.gameState;
  const audio = game?.audio;
  if (!connected || !game?.matchId || game.roundId == null || !audio?.cueId ||
      audio.kind !== 'automatic' || audio.operatorId !== myId) return null;
  return { audio, ref: { matchId: game.matchId, roundId: game.roundId, cueId: audio.cueId } };
}

function closeSpotifySpeaker() {
  const previous = spotify;
  spotify = null;
  previous?.player.close();
}

function spotifySpeaker(): TableSpotifyPlayer {
  const { room, myId, volume } = useGameStore.getState();
  if (!room || !canConnectSpotify(room.code, myId)) throw new Error('This device is not the table speaker.');
  if (!isSpotifyClientConfigured()) throw new Error('Spotify playback is unavailable on this deployment.');
  const roomCode = room.code;
  if (!hasTableSpotifyCredential(roomCode, myId)) throw new Error('Connect Spotify on this speaker device.');
  if (spotify?.roomCode === roomCode && spotify.playerId === myId) return spotify.player;
  closeSpotifySpeaker();
  const sdk: TableSpotifyPlayer = new TableSpotifyPlayer(
    rejectedToken => getTableSpotifyToken(roomCode, myId, () => spotify?.player === sdk &&
      canConnectSpotify(roomCode, myId), rejectedToken),
    message => { if (spotify?.player === sdk) reportSpotifyFailure(message); },
    volume,
  );
  spotify = { player: sdk, roomCode, playerId: myId };
  sdk.prepare();
  return sdk;
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
  pauseSpeakerAudio();
  closeSpotifySpeaker();
}

function pauseSpeakerAudio(): void {
  generation++;
  cue = null;
  player?.pause();
  spotify?.player.pause();
}

export function interruptSpeaker(): void {
  const active = speakerState();
  pauseSpeakerAudio();
  useGameStore.setState({ isPlaying: false, autoplayBlocked: false });
  if (!active || !['awaiting_audio', 'playing'].includes(active.audio.status) || lastInterrupted === active.ref.cueId) return;
  lastInterrupted = active.ref.cueId;
  getSocket().emit('audio-interrupted', active.ref);
}

function reportSpotifyFailure(message: string) {
  closeSpotifySpeaker();
  useGameStore.setState({ spotifyError: message });
  interruptSpeaker();
}

function spotifyAttemptCurrent(attempt: number, ref: CueAction): boolean {
  const active = speakerState();
  return attempt === generation && !document.hidden && active?.ref.cueId === ref.cueId &&
    active.ref.matchId === ref.matchId && active.ref.roundId === ref.roundId &&
    ['awaiting_audio', 'playing'].includes(active.audio.status);
}

async function playSpotify(trackId: string, ref: CueAction, gesture: boolean) {
  if (!gesture && cue === ref.cueId) return;
  if (cue !== ref.cueId) useGameStore.setState({ isPlaying: false, autoplayBlocked: false });
  const attempt = ++generation;
  cue = ref.cueId;
  try {
    const sdk = spotifySpeaker();
    if (gesture) sdk.activate();
    const ready = await sdk.play(trackId, ref.matchId + '/' + ref.roundId, () => spotifyAttemptCurrent(attempt, ref));
    if (!ready || !spotifyAttemptCurrent(attempt, ref)) return;
    useGameStore.setState({ isPlaying: true, autoplayBlocked: false, spotifyError: null });
    if (spotifyAttemptCurrent(attempt, ref) && speakerState()?.audio.status === 'awaiting_audio') {
      getSocket().emit('audio-ready', ref);
    }
  } catch (error) {
    if (!spotifyAttemptCurrent(attempt, ref)) return;
    if (error instanceof SpotifyGestureRequired) {
      spotify?.player.pause();
      useGameStore.setState({ autoplayBlocked: true, isPlaying: false });
    } else {
      reportSpotifyFailure(error instanceof Error ? error.message : 'Spotify could not play this recording.');
    }
  }
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
    if (active.audio.source?.spotifyTrackId) {
      try {
        spotifySpeaker().activate();
      } catch (error) {
        useGameStore.setState({ spotifyError: error instanceof Error ? error.message : 'Connect Spotify on this speaker device.' });
        return;
      }
    }
    getSocket().emit('resume-audio', active.ref);
    if (active.audio.source?.url) void playCurrent(active.audio, active.ref, true);
    return;
  }
  if (lastInterrupted !== active.ref.cueId && (active.audio.status === 'awaiting_audio' || active.audio.status === 'playing')) {
    if (active.audio.source?.spotifyTrackId) void playSpotify(active.audio.source.spotifyTrackId, active.ref, true);
    else void playCurrent(active.audio, active.ref, true);
  }
}

export function syncSpeakerAudio(): void {
  const state = useGameStore.getState();
  if (player) player.volume = state.volume;
  if (spotify && !canConnectSpotify(spotify.roomCode, spotify.playerId)) closeSpotifySpeaker();
  spotify?.player.setVolume(state.volume);
  const active = speakerState();
  if (!active || document.hidden || lastInterrupted === active.ref.cueId || !['awaiting_audio','playing'].includes(active.audio.status)) {
    if (cue) pauseSpeakerAudio();
    if (state.isPlaying || state.autoplayBlocked) useGameStore.setState({isPlaying: false, autoplayBlocked: false});
    if (active?.audio.status === 'paused' && active.audio.source?.spotifyTrackId && !document.hidden &&
        state.room && hasTableSpotifyCredential(state.room.code, state.myId) && !state.spotifyError) {
      try { spotifySpeaker(); } catch (error) {
        useGameStore.setState({ spotifyError: error instanceof Error ? error.message : 'Spotify is unavailable.' });
      }
    }
    return;
  }
  if (active.audio.source?.spotifyTrackId) void playSpotify(active.audio.source.spotifyTrackId, active.ref, false);
  else void playCurrent(active.audio, active.ref, false);
}
