const DEFAULT_SLACK_TIMEOUT_MS = 15000;

export async function sendSlackMessage(
  webhookUrl: string,
  text: string,
  timeoutMs = DEFAULT_SLACK_TIMEOUT_MS
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook returned ${response.status}: ${body}`);
  }
}
