import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

/**
 * Argon2id at the OWASP baseline (19 MiB, t=2, p=1), via a WebAssembly
 * implementation so there is no native build step on any deployment target.
 *
 * Passwords are never stored, logged or compared in plaintext.
 */
const MEMORY_KIB = 19456;
const ITERATIONS = 2;
const PARALLELISM = 1;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return argon2id({
    password,
    salt: randomBytes(16),
    memorySize: MEMORY_KIB,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
