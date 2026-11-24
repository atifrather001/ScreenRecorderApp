// AI notes with the Claude API. The API key is encrypted with the OS keychain and never sent to the renderer.
import Anthropic from '@anthropic-ai/sdk';
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

const keyFile = () => join(app.getPath('userData'), 'anthropic-key.bin');

export function hasApiKey(): boolean {
  return existsSync(keyFile());
}

export function setApiKey(key: string | null): void {
  if (!key) {
    if (existsSync(keyFile())) unlinkSync(keyFile());
    return;
  }
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key.trim()) : Buffer.from(`plain:${key.trim()}`);
  writeFileSync(keyFile(), data, { mode: 0o600 });
}

function getApiKey(): string | null {
  if (!existsSync(keyFile())) return null;
  const buf = readFileSync(keyFile());
  const plain = buf.toString('utf8');
  if (plain.startsWith('plain:')) return plain.slice(6);
  return safeStorage.decryptString(buf);
}

const SYSTEM = `You turn the transcript of a screen recording (a meeting, demo, lesson or walkthrough) into clear notes for the person who recorded it.

Write GitHub-flavoured Markdown with these sections, in this order, leaving out any section that would be empty:
# <a short, specific title>
## Summary — 2 to 4 sentences.
## Key points — bullets; put the [mm:ss] timestamp where each point is discussed at the start of the bullet.
## Decisions
## Action items — "- [ ] who: what" (use "Unassigned" when no owner is said).
## Questions and follow-ups

Use only what the transcript says; do not invent names, numbers or commitments. Transcripts come from speech recognition and may contain misheard words: correct obvious ones from context, otherwise keep the wording. Reply with the notes only, in the transcript's language.`;

export async function generateNotes(input: { title: string; transcript: string; durationSec: number }): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings › AI to generate notes.');
  if (!input.transcript.trim()) throw new Error('There is no transcript yet. Generate captions first.');
  const client = new Anthropic({ apiKey });
  const mins = Math.max(1, Math.round(input.durationSec / 60));
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Recording: "${input.title}" (${mins} min)\n\n<transcript>\n${input.transcript}\n</transcript>`,
        },
      ],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write notes for this transcript.');
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('Claude returned no notes.');
    return text;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check it in Settings › AI.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The Claude API is rate limiting requests. Try again in a minute.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Claude API. Check your internet connection.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude API error ${err.status ?? ''}: ${err.message}`);
    throw err;
  }
}
