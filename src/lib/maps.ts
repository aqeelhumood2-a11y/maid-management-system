/**
 * customerLocation is a free-typed address description, not a URL, so
 * every place it's shown as a clickable link builds a Google Maps search
 * URL from the text instead of expecting a stored link.
 */
export function mapsLinkFor(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
