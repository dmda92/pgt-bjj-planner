import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export interface PrivatePackage {
    format: 'pgt-migration-encrypted-v1';
    iv: string;
    tag: string;
    ciphertext: string;
}
const aad = Buffer.from('PGT migration package v1', 'utf8');
export function encryptPackage(value: unknown, key: Uint8Array): PrivatePackage {
    if (key.byteLength !== 32)
        throw Error('MIGRATION_KEY_MUST_BE_32_BYTES');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { format: 'pgt-migration-encrypted-v1', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
export function decryptPackage<T = unknown>(pack: PrivatePackage, key: Uint8Array): T {
    if (key.byteLength !== 32 || pack.format !== 'pgt-migration-encrypted-v1')
        throw Error('MIGRATION_PACKAGE_INVALID');
    try {
        const iv = Buffer.from(pack.iv, 'base64'), tag = Buffer.from(pack.tag, 'base64');
        if (iv.length !== 12 || tag.length !== 16)
            throw Error();
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(pack.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T;
    }
    catch {
        throw Error('MIGRATION_PACKAGE_AUTHENTICATION');
    }
}
