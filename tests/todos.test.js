'use strict';

const request = require('supertest');
const app = require('../src/app');
const todosRouter = require('../src/routes/todos');

beforeEach(() => {
  todosRouter.reset();
});

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /todos', () => {
  it('creates a todo', async () => {
    const res = await request(app).post('/todos').send({ title: 'Buy milk' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, title: 'Buy milk', done: false });
  });

  it('rejects missing title', async () => {
    const res = await request(app).post('/todos').send({});
    expect(res.status).toBe(400);
  });

  it('rejects blank title', async () => {
    const res = await request(app).post('/todos').send({ title: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /todos', () => {
  it('returns empty list initially', async () => {
    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns created todos', async () => {
    await request(app).post('/todos').send({ title: 'Task 1' });
    await request(app).post('/todos').send({ title: 'Task 2' });
    const res = await request(app).get('/todos');
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /todos/:id', () => {
  it('returns a single todo', async () => {
    await request(app).post('/todos').send({ title: 'Single task' });
    const res = await request(app).get('/todos/1');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Single task');
  });

  it('returns 404 for missing todo', async () => {
    const res = await request(app).get('/todos/999');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /todos/:id', () => {
  beforeEach(async () => {
    await request(app).post('/todos').send({ title: 'Original' });
  });

  it('updates title', async () => {
    const res = await request(app).patch('/todos/1').send({ title: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
  });

  it('marks as done', async () => {
    const res = await request(app).patch('/todos/1').send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
  });

  it('rejects non-boolean done', async () => {
    const res = await request(app).patch('/todos/1').send({ done: 'yes' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing todo', async () => {
    const res = await request(app).patch('/todos/999').send({ done: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /todos/:id', () => {
  it('deletes a todo', async () => {
    await request(app).post('/todos').send({ title: 'Delete me' });
    const res = await request(app).delete('/todos/1');
    expect(res.status).toBe(204);
    const check = await request(app).get('/todos/1');
    expect(check.status).toBe(404);
  });

  it('returns 404 for missing todo', async () => {
    const res = await request(app).delete('/todos/999');
    expect(res.status).toBe(404);
  });
});

describe('404 route', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/unknown');
    expect(res.status).toBe(404);
  });
});
