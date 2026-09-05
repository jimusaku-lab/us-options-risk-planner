export const SAXO_OAUTH_RETURN_MARKER = "saxoConnected";
export type SaxoOauthReturnFocusState = "idle" | "scheduled" | "consumed";

/** A UI-only marker added by the local read-only OAuth return route. */
export function isSaxoOauthReturn(search: string): boolean {
  return new URLSearchParams(search).get(SAXO_OAUTH_RETURN_MARKER) === "1";
}

/** Keeps React StrictMode/re-renders from scheduling the one-shot return twice. */
export function shouldScheduleSaxoOauthReturnFocus(pending: boolean, state: SaxoOauthReturnFocusState): boolean {
  return pending && state === "idle";
}

/**
 * Removes only the one-shot UI marker.  OAuth return must not discard a
 * caller's path, unrelated query parameters, or hash navigation state.
 */
export function consumeSaxoOauthReturnMarker(location: Pick<Location, "pathname" | "search" | "hash">): string {
  const params = new URLSearchParams(location.search);
  params.delete(SAXO_OAUTH_RETURN_MARKER);
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
}
