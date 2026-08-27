import bcrypt from 'bcrypt';
import supertest from 'supertest';

import app from '../../src/app.js';
import { Role, User } from '../../src/models/index.js';

export const TEST_PASSWORD = 'TestPassw0rd!2026';

interface CreateTestUserOptions {
  roleKey?: 'agent' | 'supervisor' | 'admin';
  email?: string;
  fullName?: string;
  password?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

let sequence = 0;

/**
 * Lets a test say what it means — "an agent exists" — instead of repeating a
 * create-then-sign-in dance in every file.
 */
export async function createTestUser(options: CreateTestUserOptions = {}): Promise<User> {
  const {
    roleKey = 'agent',
    email = `user${(sequence += 1)}@test.local`,
    fullName = 'Test User',
    password = TEST_PASSWORD,
    isActive = true,
    mustChangePassword = false,
  } = options;

  const role = await Role.findOne({ where: { key: roleKey } });

  if (!role) {
    throw new Error(`Role "${roleKey}" is not seeded; the test database is not set up correctly.`);
  }

  return User.create({
    email,
    full_name: fullName,
    password_hash: await bcrypt.hash(password, 12),
    role_id: role.id,
    is_active: isActive,
    must_change_password: mustChangePassword,
    failed_login_attempts: 0,
    locked_until: null,
  });
}

/** Signs in through the real endpoint, so tests exercise the same path users do. */
export async function signInAs(user: User, password: string = TEST_PASSWORD): Promise<string> {
  const response = await supertest(app)
    .post('/api/auth/login')
    .send({ email: user.email, password });

  if (response.status !== 200) {
    throw new Error(`Sign-in failed for ${user.email}: ${response.status} ${response.text}`);
  }

  return response.body.accessToken as string;
}

export interface AuthedAgent {
  get: (url: string) => supertest.Test;
  post: (url: string) => supertest.Test;
  patch: (url: string) => supertest.Test;
  put: (url: string) => supertest.Test;
  delete: (url: string) => supertest.Test;
}

/** supertest with the Authorization header pre-set. */
export function agentFor(token: string): AuthedAgent {
  const auth = (test: supertest.Test) => test.set('Authorization', `Bearer ${token}`);

  return {
    get: (url) => auth(supertest(app).get(url)),
    post: (url) => auth(supertest(app).post(url)),
    patch: (url) => auth(supertest(app).patch(url)),
    put: (url) => auth(supertest(app).put(url)),
    delete: (url) => auth(supertest(app).delete(url)),
  };
}

/** Convenience: create a user of the given role and return a ready agent. */
export async function agentAs(
  roleKey: 'agent' | 'supervisor' | 'admin',
): Promise<{ user: User; agent: AuthedAgent }> {
  const user = await createTestUser({ roleKey });
  return { user, agent: agentFor(await signInAs(user)) };
}
