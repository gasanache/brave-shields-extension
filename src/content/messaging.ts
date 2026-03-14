// Utility for content script <-> service worker communication

export async function sendMessage<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

export async function getHiddenSelectors(
  classes: string[],
  ids: string[],
  exceptions: string[] = []
): Promise<string[]> {
  const response = await sendMessage<{ selectors: string[] }>({
    type: 'GET_HIDDEN_SELECTORS',
    classes,
    ids,
    exceptions,
  });
  return response?.selectors ?? [];
}
