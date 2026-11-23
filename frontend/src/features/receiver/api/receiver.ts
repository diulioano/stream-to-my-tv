/** The TV opens the receiver through the LAN panel origin, never through loopback. */
export function receiverUrlFor(panelUrl: string): string {
  return new URL("receiver", panelUrl).toString();
}
