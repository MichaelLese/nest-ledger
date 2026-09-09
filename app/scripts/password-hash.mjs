// Read from stdin, so the password is never a command-line argument.
import { randomBytes, scryptSync } from 'node:crypto';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1026) throw new Error('Password too long');
}
const password = input.replace(/\r?\n$/, '');
if (password.length < 12 || password.length > 1024) throw new Error('Use a password of 12–1024 characters');
const salt = randomBytes(16).toString('hex');
console.log(salt + ':' + scryptSync(password, salt, 64).toString('hex'));
