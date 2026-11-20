export const appBase = import.meta.env.BASE_URL;

export function appPath(path: string): string {
  return appBase + path;
}

export function joinCodeFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith(appBase)) return;
  return /^join\/([A-Za-z]{4})\/?$/.exec(pathname.slice(appBase.length))?.[1].toUpperCase();
}

export function appStorageKey(key: string): string {
  return appBase === '/' ? key : appBase + ':' + key;
}
