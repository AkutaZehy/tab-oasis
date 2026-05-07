// @ts-check
/**
 * p1-todos.spec.js — P1 Playwright tests for Todo management.
 *
 * Covers:
 *   1. Adding a todo (type text, press Enter)
 *   2. Completing a todo (checkbox → strikethrough)
 *   3. Uncompleting a todo (uncheck → normal)
 *   4. Deleting a todo
 *   5. Clearing completed todos
 *   6. Drag-sort reordering todos
 *
 * These tests run in serial (shared extension state) using Firefox.
 */

import path from 'node:path';
import { test, expect, firefox } from '@playwright/test';
import {
  loadExtension,
  waitForSidebarLoaded,
  cleanup,
} from '../helpers/extension-test-helper.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path to the unpacked extension root (where manifest.json lives). */
const extensionPath = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('P1 - Todos', () => {
  test.describe.configure({ mode: 'serial' });

  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  /** @type {import('@playwright/test').Page} */
  let sidebarPage;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  test.beforeAll(async () => {
    const loaded = await loadExtension(firefox, extensionPath);
    context = loaded.context;
    sidebarPage = loaded.sidebarPage;
    await waitForSidebarLoaded(sidebarPage);
  });

  test.afterAll(async () => {
    await cleanup(context);
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Type text into the todo input and press Enter.
   * Waits for the new item to appear in the DOM.
   * @param {string} text
   */
  async function addTodo(text) {
    const input = sidebarPage.locator('#todo-add-input');
    await input.fill(text);
    await input.press('Enter');
    await sidebarPage.waitForSelector(
      `.todo-item .todo-text:text("${text}")`,
      { state: 'visible', timeout: 5000 },
    );
  }

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  test('adds a todo', async () => {
    await addTodo('Buy groceries');

    const item = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Buy groceries' }),
    });
    await expect(item).toBeVisible();
    await expect(item).not.toHaveClass(/completed/);

    // Counter: 1 active / 1 total
    await expect(sidebarPage.locator('#todo-count')).toHaveText('1/1');
  });

  test('completes a todo', async () => {
    await addTodo('Walk the dog');

    const item = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Walk the dog' }),
    });

    // Check the checkbox
    const checkbox = item.locator('.todo-checkbox');
    await checkbox.check();
    await sidebarPage.waitForTimeout(300);

    // After re-render, item should have .completed class (strikethrough)
    const completed = sidebarPage.locator('.todo-item.completed', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Walk the dog' }),
    });
    await expect(completed).toBeVisible();

    // Counter: 0 active / 1 total
    await expect(sidebarPage.locator('#todo-count')).toHaveText('0/1');
  });

  test('uncompletes a todo', async () => {
    await addTodo('Read a book');

    const item = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Read a book' }),
    });
    const checkbox = item.locator('.todo-checkbox');

    // Complete first
    await checkbox.check();
    await sidebarPage.waitForTimeout(300);

    // Re-query after re-render and uncheck
    const reRendered = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Read a book' }),
    });
    await reRendered.locator('.todo-checkbox').uncheck();
    await sidebarPage.waitForTimeout(300);

    // Should no longer have .completed class
    await expect(
      sidebarPage.locator('.todo-item.completed', {
        has: sidebarPage.locator('.todo-text', { hasText: 'Read a book' }),
      }),
    ).toBeHidden();

    // Counter back to 1/1
    await expect(sidebarPage.locator('#todo-count')).toHaveText('1/1');
  });

  test('deletes a todo', async () => {
    await addTodo('Temporary task');

    const item = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Temporary task' }),
    });
    const todoId = await item.getAttribute('data-todo-id');

    // Click delete button
    await item.locator('[data-action="delete-todo"]').click();

    // Verify removed
    await expect(
      sidebarPage.locator(`.todo-item[data-todo-id="${todoId}"]`),
    ).toBeHidden({ timeout: 5000 });
  });

  test('clears completed todos', async () => {
    await addTodo('Task A');
    await addTodo('Task B');
    await addTodo('Task C');

    // Complete 'Task B'
    const taskB = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Task B' }),
    });
    await taskB.locator('.todo-checkbox').check();
    await sidebarPage.waitForTimeout(300);

    // Counter: 2/3
    await expect(sidebarPage.locator('#todo-count')).toHaveText('2/3');

    // Click "Clear Completed"
    await sidebarPage.locator('#todo-clear-completed').click();
    await sidebarPage.waitForTimeout(300);

    // Completed gone, in-progress remain
    await expect(
      sidebarPage.locator('.todo-text', { hasText: 'Task B' }),
    ).toBeHidden({ timeout: 5000 });
    await expect(sidebarPage.locator('.todo-item')).toHaveCount(2);

    // Counter: 2/2
    await expect(sidebarPage.locator('#todo-count')).toHaveText('2/2');
  });

  test('drag-sorts todos', async () => {
    await addTodo('First Todo');
    await addTodo('Second Todo');

    const firstItem = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'First Todo' }),
    });
    const secondItem = sidebarPage.locator('.todo-item', {
      has: sidebarPage.locator('.todo-text', { hasText: 'Second Todo' }),
    });

    // Drag first below second
    await firstItem.dragTo(secondItem, {
      targetPosition: { x: 10, y: 30 },
    });

    // Verify DOM order changed
    const items = sidebarPage.locator('#todos-list .todo-item');
    const first = await items.first();
    const firstText = await first.locator('.todo-text').textContent();
    expect(firstText).toBe('Second Todo');
  });
});
