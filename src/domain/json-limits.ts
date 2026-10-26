// Serialized JSON bytes in UTF-8, not UTF-16 characters or base64 length.
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_APP_BODY_BYTES = MAX_JSON_BYTES + 65536;
export const MAX_TEXT_LENGTH = 100000;
export interface SizeDetails { file: string; bytes: number; limitBytes: number; scope?: 'document' | 'request'; exact?: boolean }
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export function documentFile(path: string): string {
  if (/\/techniques$/.test(path)) return 'tecnics.json';
  if (/\/profile$/.test(path)) return 'user_data.json';
  if (/\/comments$/.test(path)) return 'trainer_comments.json';
  return path.split('/').pop() || 'documento.json';
}
export function sizeMessage(size: SizeDetails): string {
  return `${size.file}: ${size.exact === false ? 'al menos ' : ''}${size.bytes.toLocaleString('es-ES')} bytes; límite ${size.limitBytes.toLocaleString('es-ES')} bytes${size.scope === 'request' ? ' por petición' : ' por archivo'}. No se ha truncado el contenido. Los cambios locales se conservan; reduce o reparte el texto y vuelve a sincronizar.`;
}
