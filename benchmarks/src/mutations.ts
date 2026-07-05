/**
 * Scripted DOM mutations (design §15.2): the classic selector-rot menu,
 * applied in-page after recording. Each mutation returns the list of truth
 * keys it REMOVED (for those, the correct engine behavior is to refuse to
 * heal — healing anything counts as a false heal).
 */

export interface Mutation {
  name: string;
  description: string;
  /** Serialized into the page; returns truth keys of removed targets. */
  apply: () => string[];
}

export const MUTATIONS: Mutation[] = [
  {
    name: 'id-rename',
    description: 'every id gets a new suffix (build-hash churn)',
    apply: () => {
      document.querySelectorAll('[id]').forEach((el) => {
        el.id = `${el.id}-9f3a`;
      });
      return [];
    },
  },
  {
    name: 'testid-removal',
    description: 'all data-testid attributes deleted',
    apply: () => {
      document.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));
      return [];
    },
  },
  {
    name: 'class-hash',
    description: 'all class lists replaced with CSS-in-JS style hashes',
    apply: () => {
      let i = 17;
      document.querySelectorAll('[class]').forEach((el) => {
        i = (i * 33 + 7) % 46656;
        el.className = `css-${i.toString(36)}`;
      });
      return [];
    },
  },
  {
    name: 'div-wrap',
    description: 'every target wrapped in an extra div (component library swap)',
    apply: () => {
      document.querySelectorAll('[data-truth]').forEach((el) => {
        const wrap = document.createElement('div');
        wrap.className = 'wrapper-x';
        el.parentNode!.insertBefore(wrap, el);
        wrap.appendChild(el);
      });
      return [];
    },
  },
  {
    name: 'sibling-reorder',
    description: 'nav links, task list, and footer links reversed',
    apply: () => {
      for (const selector of ['#main-nav', '#task-list', '#footer']) {
        const parent = document.querySelector(selector);
        if (!parent) continue;
        [...parent.children].reverse().forEach((child) => parent.appendChild(child));
      }
      return [];
    },
  },
  {
    name: 'text-tweak',
    description: 'button labels and link texts lightly reworded',
    apply: () => {
      const rewrites: Record<string, string> = {
        'Sign in': 'Log in',
        'Clear form': 'Reset form',
        'Add task': 'New task',
        Delete: 'Remove',
        Home: 'Start',
        Privacy: 'Privacy policy',
      };
      document.querySelectorAll('button, a').forEach((el) => {
        const text = (el.textContent ?? '').trim();
        if (rewrites[text]) el.textContent = rewrites[text]!;
      });
      return [];
    },
  },
  {
    name: 'combo',
    description: 'id-rename + testid-removal + class-hash at once (hard case)',
    apply: () => {
      document.querySelectorAll('[id]').forEach((el) => {
        el.id = `${el.id}-9f3a`;
      });
      document.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));
      let i = 17;
      document.querySelectorAll('[class]').forEach((el) => {
        i = (i * 33 + 7) % 46656;
        el.className = `css-${i.toString(36)}`;
      });
      return [];
    },
  },
  {
    name: 'removal',
    description: 'some targets truly deleted (siblings remain) — must NOT heal',
    apply: () => {
      const removed = ['nav-products', 'del-report', 'login-reset', 'footer-terms'];
      for (const key of removed) {
        document.querySelector(`[data-truth='${key}']`)?.remove();
      }
      return removed;
    },
  },
];
