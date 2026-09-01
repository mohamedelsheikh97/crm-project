import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { KbCategory } from '../../src/models/index.js';
import { agentAs } from '../helpers/auth.js';
import { closeTestDatabase, setupTestDatabase, truncateAll } from '../helpers/database.js';
import { ENGLISH_ARTICLE, createArticle, createCategory } from './helpers.js';

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * Categories (User Story 5, FR-012 to FR-015).
 *
 * The one that matters here is FR-015, and specifically the SHAPE of the
 * refusal. Refusing to delete a category that still holds articles is the
 * requirement; NAMING HOW MANY is what turns a dead end into an instruction.
 * An administrator told "you cannot delete this" learns nothing and tries
 * again. One told "eleven articles are filed here" knows exactly what to do.
 */

describe('creating and organising categories', () => {
  it('creates a category with a name in one language (FR-012)', async () => {
    // Names are DATA, not locale keys: an administrator creating a category at
    // runtime cannot add a key to a locale file.
    const admin = await agentAs('admin');

    const created = await admin.agent
      .post('/api/knowledge/categories')
      .send({ nameEn: 'Hardware', ticketCategory: 'technical' });

    expect(created.status).toBe(201);
    expect(created.body.nameEn).toBe('Hardware');
    expect(created.body.slug).toBe('hardware');
    expect(created.body.ticketCategory).toBe('technical');
  });

  it('refuses a category with no name in either language', async () => {
    const admin = await agentAs('admin');

    const created = await admin.agent.post('/api/knowledge/categories').send({});

    expect(created.status).toBe(400);
    expect(created.body.error.details[0].message).toBe('kb.error.categoryNameRequired');
  });

  it('refuses a ticket-category mapping that is not one of Phase 3s categories', async () => {
    // Validated against the fixed list rather than stored as an ENUM (research
    // D6), so a mistyped mapping is caught here rather than silently never
    // matching a ticket.
    const admin = await agentAs('admin');

    const created = await admin.agent
      .post('/api/knowledge/categories')
      .send({ nameEn: 'Hardware', ticketCategory: 'hardware' });

    expect(created.status).toBe(400);
    expect(created.body.error.details[0].message).toBe('kb.error.ticketCategoryUnknown');
  });

  it('accepts a null mapping, which is the honest answer for some categories', async () => {
    const admin = await agentAs('admin');

    const created = await admin.agent
      .post('/api/knowledge/categories')
      .send({ nameEn: 'Getting started' });

    expect(created.status).toBe(201);
    expect(created.body.ticketCategory).toBeNull();
  });

  it('lists categories in position order, with their article counts', async () => {
    const admin = await agentAs('admin');

    const second = await createCategory({ slug: 'second', position: 2 });
    const first = await createCategory({ slug: 'first', position: 1 });

    await createArticle(first.id);
    await createArticle(first.id);

    const listed = await admin.agent.get('/api/knowledge/categories');

    // POSITION order, not creation order — browse order is an editorial
    // decision, and `second` was created first precisely to prove that.
    expect(listed.body.items.map((c: { id: number }) => c.id)).toEqual([first.id, second.id]);
    expect(listed.body.items[0].articleCount).toBe(2);
    expect(listed.body.items[1].articleCount).toBe(0);
  });

  it('does NOT rederive the slug when a category is renamed', async () => {
    // A public URL already exists. Renaming a heading must not break it — the
    // same rule an article's slug follows (research D10).
    const admin = await agentAs('admin');

    const created = await admin.agent
      .post('/api/knowledge/categories')
      .send({ nameEn: 'Hardware' });

    const renamed = await admin.agent
      .patch(`/api/knowledge/categories/${created.body.id}`)
      .send({ nameEn: 'Terminals and readers', version: created.body.version });

    expect(renamed.status).toBe(200);
    expect(renamed.body.nameEn).toBe('Terminals and readers');
    expect(renamed.body.slug).toBe('hardware');
  });
});

describe('a category holding articles cannot be deleted (FR-015)', () => {
  it('refuses, and says HOW MANY articles stand in the way', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    const admin = await agentAs('admin');
    const category = await createCategory();

    await createArticle(category.id, { titleEn: 'One' });
    await createArticle(category.id, { titleEn: 'Two' });
    await createArticle(category.id, { titleEn: 'Three' });

    const deleted = await admin.agent.delete(`/api/knowledge/categories/${category.id}`);

    expect(deleted.status).toBe(409);
    expect(deleted.body.error.code).toBe('CATEGORY_IN_USE');
    expect(deleted.body.error.details[0].message).toBe('kb.error.categoryHasArticles');
    // The count rides BESIDE the envelope, following the precedent Phase 2 set
    // with `duplicates`: {field, message} has a defined meaning a number does
    // not fit.
    expect(deleted.body.articleCount).toBe(3);

    expect(await KbCategory.findByPk(category.id)).not.toBeNull();
  });

  it('counts ARCHIVED articles too, because they are still filed there', async () => {
    // An archived article is not destroyed (FR-007). Deleting its category
    // would orphan a record that can still be restored.
    const admin = await agentAs('admin');
    const category = await createCategory();

    const article = await createArticle(category.id);
    await article.update({ status: 'archived' });

    const deleted = await admin.agent.delete(`/api/knowledge/categories/${category.id}`);

    expect(deleted.status).toBe(409);
    expect(deleted.body.articleCount).toBe(1);
  });

  it('deletes an EMPTY category without complaint', async () => {
    const admin = await agentAs('admin');
    const category = await createCategory();

    const deleted = await admin.agent.delete(`/api/knowledge/categories/${category.id}`);

    expect(deleted.status).toBe(204);
    expect(await KbCategory.findByPk(category.id)).toBeNull();
  });

  it('lets the administrator reassign the articles and then delete it', async () => {
    // The route out of the refusal, walked end to end — a refusal that names an
    // obstacle is only useful if the obstacle can actually be removed.
    const admin = await agentAs('admin');
    const from = await createCategory({ slug: 'from' });
    const to = await createCategory({ slug: 'to' });

    const article = await createArticle(from.id, ENGLISH_ARTICLE);
    const view = await admin.agent.get(`/api/knowledge/articles/${article.id}`);

    await admin.agent
      .patch(`/api/knowledge/articles/${article.id}`)
      .send({ categoryId: to.id, version: view.body.version });

    expect((await admin.agent.delete(`/api/knowledge/categories/${from.id}`)).status).toBe(204);
  });
});

describe('managing the structure needs kb:manage', () => {
  it('refuses an agent, who may author but not reorganise', async () => {
    // Writing one article and deciding how everything is filed are different
    // jobs — the same distinction as templates:use against templates:manage.
    const author = await agentAs('agent');

    const created = await author.agent
      .post('/api/knowledge/categories')
      .send({ nameEn: 'Hardware' });

    expect(created.status).toBe(403);
  });

  it('still lets that agent READ the categories, because filing is mandatory', async () => {
    // FR-010 makes every article carry a category, so every author needs this
    // list. A permission that refused it would make authoring impossible.
    const author = await agentAs('agent');
    await createCategory();

    const listed = await author.agent.get('/api/knowledge/categories');

    expect(listed.status).toBe(200);
    expect(listed.body.items.length).toBe(1);
  });
});
