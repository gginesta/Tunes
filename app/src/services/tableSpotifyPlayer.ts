import { loadSpotifyPlaybackSDK } from './spotifyPlayer';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class SpotifyGestureRequired extends Error {}

export class TableSpotifyPlayer {
  private player: Spotify.Player | null = null;
  private deviceId: string | null = null;
  private initializing: Promise<void> | null = null;
  private closed = false;
  private active = false;
  private failure: Error | null = null;
  private confirmedTrack: string | null = null;
  private wantedTrack: string | null = null;
  private round: string | null = null;
  private position = 0;
  private volume: number;
  private command: Promise<void> = Promise.resolve();
  private requestAbort: AbortController | null = null;

  constructor(
    private readonly getToken: (rejectedToken?: string) => Promise<string>,
    private readonly onInterruption: (message: string) => void,
    volume: number,
  ) {
    this.volume = volume;
  }

  prepare(): void {
    this.initializing ??= this.initialize().catch(error => {
      if (!this.closed) this.fail(error instanceof Error ? error.message : 'Spotify could not start.');
    });
  }

  private async initialize(): Promise<void> {
    await loadSpotifyPlaybackSDK();
    if (this.closed) return;
    const player = new window.Spotify.Player({
      name: 'Tunes Table Speaker',
      getOAuthToken: cb => { void this.getToken().then(cb, error => {
        if (!this.closed) this.fail(error instanceof Error ? error.message : 'Connect Spotify on this speaker device.');
        cb('');
      }); },
      volume: this.volume,
    });
    this.player = player;
    player.addListener('ready', ({device_id}) => { if (!this.closed) this.deviceId = device_id; });
    player.addListener('not_ready', ({device_id}) => {
      if (this.deviceId !== device_id || this.closed) return;
      this.deviceId = null;
      this.fail('Spotify lost the table speaker connection.');
    });
    player.addListener('initialization_error', () => this.fail('Spotify could not start on this browser.'));
    player.addListener('authentication_error', () => this.fail('Spotify sign-in failed. Connect again on this speaker device.'));
    player.addListener('account_error', () => this.fail('Spotify Premium is required on the speaker device.'));
    player.addListener('playback_error', () => this.fail('Spotify could not play this recording.'));
    player.addListener('autoplay_failed', () => {
      if (this.active) this.fail('The browser blocked Spotify playback.');
      else if (this.wantedTrack && !this.closed) this.failure = new SpotifyGestureRequired();
    });
    player.addListener('player_state_changed', state => {
      if (this.closed) return;
      const track = state?.track_window.current_track.id;
      if (state && !state.paused && !this.wantedTrack) {
        // This SDK instance belongs to this table only. Silence late playback
        // from an in-flight request if the room was paused while it resolved.
        void player.pause().catch(() => {});
      }
      if (state && track && track === this.confirmedTrack) this.position = state.position;
      if (this.active && this.confirmedTrack &&
          (!state || state.paused || track !== this.confirmedTrack)) {
        this.fail('Spotify playback on the table speaker stopped.');
      }
    });
    if (!(await player.connect()) && !this.closed) this.fail('Spotify could not connect to the table speaker.');
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.failure ??= new Error(message);
    if (this.active) this.onInterruption(message);
  }

  activate(): void {
    this.prepare();
    if (this.failure instanceof SpotifyGestureRequired) this.failure = null;
    if (this.player) void Promise.resolve(this.player.activateElement()).catch(() => {});
  }

  setVolume(volume: number): void {
    if (volume === this.volume) return;
    this.volume = volume;
    void this.player?.setVolume(volume).catch(() => {});
  }

  pause(): void {
    this.active = false;
    this.wantedTrack = null;
    this.confirmedTrack = null;
    this.requestAbort?.abort();
    void this.player?.pause().catch(() => {});
  }

  close(): void {
    this.pause();
    this.closed = true;
    this.player?.disconnect();
  }

  play(trackId: string, round: string, isCurrent: () => boolean): Promise<boolean> {
    this.prepare();
    const stopPreviousTrack = this.confirmedTrack && this.player;
    this.active = false;
    this.confirmedTrack = null;
    this.requestAbort?.abort();
    const previousPause = stopPreviousTrack ? stopPreviousTrack.pause().catch(() => {}) : null;
    const result = this.command.then(async () => {
      const current = () => !this.closed && isCurrent();
      if (previousPause) await Promise.race([previousPause, delay(500)]);
      const readyBy = Date.now() + 12_000;
      while (current() && !this.deviceId && !this.failure && Date.now() < readyBy) await delay(100);
      if (!current()) return false;
      if (this.failure) throw this.failure;
      const deviceId = this.deviceId;
      if (!deviceId || !this.player) throw new Error('Spotify did not register this browser as the table speaker.');
      this.wantedTrack = trackId;
      if (this.round !== round) this.position = 0;
      this.round = round;
      let token = await this.getToken();
      const controller = new AbortController();
      this.requestAbort = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        let refreshed = false;
        // The SDK device may take a moment to register with the playback API.
        for (let attempt = 0; current() && attempt < 4; attempt++) {
          const response = await fetch(
            `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
            {
              method: 'PUT',
              signal: controller.signal,
              referrerPolicy: 'no-referrer',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: this.position }),
            },
          );
          if (!current()) return false;
          if (response.ok) break;
          if (response.status === 401 && !refreshed) {
            if (attempt === 3) throw new Error('Spotify sign-in failed. Connect again on this speaker device.');
            refreshed = true;
            token = await this.getToken(token);
            continue;
          }
          if (response.status === 404 && attempt < 3) { await delay(500); continue; }
          throw new Error(response.status === 401
            ? 'Spotify sign-in failed. Connect again on this speaker device.'
            : 'Spotify could not play this recording on the table speaker.');
        }
      } finally {
        clearTimeout(timeout);
        if (this.requestAbort === controller) this.requestAbort = null;
      }

      const confirmBy = Date.now() + 5000;
      while (current() && Date.now() < confirmBy) {
        if (this.failure) throw this.failure;
        const state = await Promise.race([this.player.getCurrentState(), delay(500).then(() => null)]);
        if (!current()) return false;
        if (this.failure) throw this.failure;
        if (state && !state.paused && state.track_window.current_track.id === trackId) {
          this.confirmedTrack = trackId;
          this.position = state.position;
          this.active = true;
          return true;
        }
        await delay(150);
      }
      if (!current()) return false;
      throw new Error('Spotify did not confirm playback on the table speaker.');
    });
    this.command = result.then(() => {}, () => {});
    return result;
  }
}
