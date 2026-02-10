import crypto from 'crypto';

export function generateId(content: string): string {
  const timestamp = Date.now().toString() + Math.random().toString();
  const hash = crypto
    .createHash('sha256')
    .update(`${content}|${timestamp}`)
    .digest('hex');
  return `kt-${hash.substring(0, 6)}`;
}
