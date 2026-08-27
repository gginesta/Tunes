export interface HostSpotifyCredential {
  hostId: string;
  token: string;
}

/** Return a room credential only while it still belongs to the current host. */
export function spotifyTokenForHost(
  currentHostId: string,
  credential: HostSpotifyCredential | undefined,
): string | undefined {
  return credential?.hostId === currentHostId ? credential.token : undefined;
}
