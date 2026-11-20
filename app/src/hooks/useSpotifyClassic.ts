import { useRef, useState } from 'react';
import { isSpotifyClientConfigured } from '../services/spotify';
import { connectSpotifySpeaker } from '../services/tableAudio';
import { useGameStore } from '../store';

export function useSpotifyClassicAvailable() {
  return useGameStore((state) => state.spotifyClassicAvailable) && isSpotifyClientConfigured();
}

export function useSpotifyClassic() {
  const available = useSpotifyClassicAvailable();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(roomCode: string, playerId: string) {
    if (!available || inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await connectSpotifySpeaker(roomCode, playerId);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not connect Spotify. Try again.');
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { available, connect, error, pending };
}
