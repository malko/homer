import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { userQueries, sessionQueries } from '../db/index.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/status', async (request, reply) => {
    const count = userQueries.count();
    const userCount = count['count(*)'];
    
    if (userCount === 0) {
      return reply.send({ needsSetup: true, mustChangePassword: false, authenticated: false });
    }
    
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.send({ needsSetup: false, mustChangePassword: false, authenticated: false });
    }
    
    const session = sessionQueries.getByToken(token);
    if (!session) {
      return reply.send({ needsSetup: false, mustChangePassword: false, authenticated: false });
    }
    
    const user = userQueries.getByUsername(session.username);
    return reply.send({
      needsSetup: false,
      mustChangePassword: user?.must_change_password === 1,
      authenticated: true,
      username: session.username,
    });
  });

  fastify.post('/api/auth/setup', async (request, reply) => {
    const count = userQueries.count();
    
    if (count['count(*)'] > 0) {
      return reply.status(403).send({ error: 'Setup already completed' });
    }

    const body = createUserSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    
    userQueries.create(body.username, passwordHash);
    
    const token = crypto.randomUUID();
    sessionQueries.create(token, body.username);
    
    return {
      token,
      username: body.username,
      mustChangePassword: false,
    };
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    
    const user = userQueries.getByUsername(body.username);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = crypto.randomUUID();
    sessionQueries.create(token, user.username);
    
    return {
      token,
      username: user.username,
      mustChangePassword: user.must_change_password === 1,
    };
  });

  fastify.post('/api/auth/change-password', async (request, reply) => {
    const authHeader = request.headers.authorization?.replace('Bearer ', '');
    const session = authHeader ? sessionQueries.getByToken(authHeader) : null;
    
    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = changePasswordSchema.parse(request.body);
    const user = userQueries.getByUsername(session.username);
    
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    if (user.must_change_password === 0 && body.currentPassword) {
      const valid = await bcrypt.compare(body.currentPassword, user.password_hash);
      if (!valid) {
        return reply.status(400).send({ error: 'Current password is incorrect' });
      }
    }

    const newHash = await bcrypt.hash(body.newPassword, 10);
    userQueries.updatePassword(newHash, user.id);
    
    return { success: true };
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (token) {
      sessionQueries.delete(token);
    }
    return { success: true };
  });
}
