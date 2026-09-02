/** Mix two already-opaque #rrggbb colors in gamma-encoded sRGB. */
export function mixOpaqueHex(foreground: string, foregroundWeight: number, background: string): string {
  const weight = Math.max(0, Math.min(1, foregroundWeight));
  const channels = [1, 3, 5].map((offset) => {
    const front = parseInt(foreground.slice(offset, offset + 2), 16);
    const back = parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(front * weight + back * (1 - weight)).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}
