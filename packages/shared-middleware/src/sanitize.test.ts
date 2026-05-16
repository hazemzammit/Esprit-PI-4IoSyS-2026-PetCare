import { describe, it, expect } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { mongoSanitize, xssSanitize } from './sanitize';

function createMockReq(body: any = {}, query: any = {}, params: any = {}): Partial<Request> {
  return { body, query, params };
}

function createMockRes(): Partial<Response> {
  return {};
}

const noop: NextFunction = () => {};

describe('mongoSanitize', () => {
  const middleware = mongoSanitize();

  it('should strip keys starting with "$" from body', () => {
    const req = createMockReq({ email: 'test@test.com', $gt: '' });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toEqual({ email: 'test@test.com' });
  });

  it('should strip nested "$" keys', () => {
    const req = createMockReq({ filter: { age: { $gte: 18 } } });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toEqual({ filter: { age: {} } });
  });

  it('should strip dot-notation keys', () => {
    const req = createMockReq({ 'user.role': 'admin' });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toEqual({});
  });

  it('should sanitize query params', () => {
    const req = createMockReq({}, { email: { $gt: '' } });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.query).toEqual({ email: {} });
  });

  it('should handle arrays', () => {
    const req = createMockReq({ tags: ['safe', { $ne: null }] });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toEqual({ tags: ['safe', {}] });
  });

  it('should pass through clean data unchanged', () => {
    const req = createMockReq({ name: 'Max', age: 3 });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toEqual({ name: 'Max', age: 3 });
  });

  it('should handle null/undefined body', () => {
    const req = createMockReq(null);
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toBeNull();
  });
});

describe('xssSanitize', () => {
  const middleware = xssSanitize();

  it('should strip HTML tags from body strings', () => {
    const req = createMockReq({ name: '<script>alert("xss")</script>Hello' });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body.name).toBe('alert("xss")Hello');
  });

  it('should strip angle brackets', () => {
    const req = createMockReq({ comment: 'a > b < c' });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body.comment).not.toContain('<');
    expect(req.body.comment).not.toContain('>');
  });

  it('should handle nested objects', () => {
    const req = createMockReq({ profile: { bio: '<b>bold</b>' } });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body.profile.bio).toBe('bold');
  });

  it('should not modify numbers or booleans', () => {
    const req = createMockReq({ age: 5, active: true });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body).toEqual({ age: 5, active: true });
  });

  it('should handle arrays of strings', () => {
    const req = createMockReq({ tags: ['<img src=x onerror=alert(1)>', 'safe'] });
    middleware(req as Request, createMockRes() as Response, noop);
    expect(req.body.tags[0]).not.toContain('<');
    expect(req.body.tags[1]).toBe('safe');
  });
});
