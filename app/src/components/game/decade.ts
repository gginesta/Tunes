const DECADE_CLASS: Record<number, string> = {
  1930: 'dec-1930s',
  1940: 'dec-1940s',
  1950: 'dec-1950s',
  1960: 'dec-1960s',
  1970: 'dec-1970s',
  1980: 'dec-1980s',
  1990: 'dec-1990s',
  2000: 'dec-2000s',
  2010: 'dec-2010s',
  2020: 'dec-2020s',
};

export function getDecadeClass(year: number): string {
  const decade = Math.floor(year / 10) * 10;
  return DECADE_CLASS[decade] || 'dec-1980s';
}
