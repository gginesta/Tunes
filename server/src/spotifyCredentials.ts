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

/**
 * Restore a persisted credential only when the database also proves its owner.
 * Legacy Tunes rows contain a token but no owner ID, so they fail closed.
 */
export function restoreHostSpotifyCredential(
  token: string | null,
  ownerHostId: string | undefined,
): HostSpotifyCredential | undefined {
  if (!token || !ownerHostId) return undefined;
  return { hostId: ownerHostId, token };
}
