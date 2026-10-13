export class Fault extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fail = (status: number, message: string): never => { throw new Fault(status, message); };
export function mail(value: unknown): string {
  if (typeof value !== 'string') return fail(400, 'Correo inválido');
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/.test(normalized)
      || normalized.includes('..') || normalized.length > 180) return fail(400, 'Correo inválido');
  return normalized;
}
const bytes = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
export const random = (): string => bytes(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export async function digest(value: string): Promise<string> {
  return bytes(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export async function hashPassword(password: unknown, salt = random()): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) return fail(400, 'Contraseña: entre 12 y 128 caracteres para la prueba');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 600000}, key, 256);
  return `pbkdf2-sha256$600000$${salt}$${bytes(new Uint8Array(result))}`;
}
export function constantEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export async function verifyPassword(password: unknown, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '600000') return false;
  return constantEqual(await hashPassword(password, parts[2]), stored);
}
export async function seal(value: unknown, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(value)));
  return `${bytes(iv)}.${bytes(new Uint8Array(encrypted))}`;
}
export async function unseal<T>(value: string, secret: string): Promise<T> {
  const [iv, encrypted] = value.split('.');
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret), c => c.charCodeAt(0)), 'AES-GCM', false, ['decrypt']);
  const result = await crypto.subtle.decrypt({name: 'AES-GCM', iv: Uint8Array.from(atob(iv), c => c.charCodeAt(0))}, key, Uint8Array.from(atob(encrypted), c => c.charCodeAt(0)));
  return JSON.parse(new TextDecoder().decode(result)) as T;
}
export function requireOwnMail(identity: string, requested: string): void {
  if (mail(identity) !== mail(requested)) fail(403, 'Acceso cruzado rechazado');
}
