/**
 * Base page for the mutation harness (design §15.2). Every heal target
 * carries data-truth="<key>" — the ground-truth identity used ONLY by the
 * harness for verification. The engine never reads it: it is not part of
 * the fingerprint property set, so it cannot leak into scoring.
 *
 * The page deliberately includes hard cases: near-identical sibling buttons
 * (list-item deletes), same-text links in different sections, and decoy
 * elements that stay stable across mutations.
 */

export const BASE_APP = `
<html>
<head><style>
  body { font-family: sans-serif; margin: 0; }
  nav a, footer a { margin: 0 12px; }
  section { padding: 16px 24px; }
  li { padding: 4px; }
  button { padding: 6px 10px; }
</style></head>
<body>
  <nav id="main-nav" class="nav navbar">
    <a data-truth="nav-home" id="nav-home" class="nav-link active" href="/">Home</a>
    <a data-truth="nav-products" id="nav-products" class="nav-link" href="/products">Products</a>
    <a data-truth="nav-contact" id="nav-contact" class="nav-link" href="/contact">Contact</a>
    <a class="nav-link" href="/about">About</a>
  </nav>

  <section id="login" class="card login-card">
    <h2>Sign in</h2>
    <label for="email">Email address</label>
    <input data-truth="login-email" id="email" name="email" type="email"
           class="input input-lg" placeholder="you@example.com" data-testid="login-email" />
    <label for="password">Password</label>
    <input data-truth="login-password" id="password" name="password" type="password"
           class="input input-lg" data-testid="login-password" />
    <label><input data-truth="login-remember" id="remember" name="remember" type="checkbox"
           class="checkbox" /> Remember me</label>
    <div class="actions">
      <button data-truth="login-submit" id="submit-btn" type="submit"
              class="btn btn-primary" data-testid="login-submit">Sign in</button>
      <button data-truth="login-reset" id="reset-btn" type="reset"
              class="btn btn-ghost">Clear form</button>
    </div>
  </section>

  <section id="tasks" class="card task-card">
    <h2>Tasks</h2>
    <input data-truth="task-search" id="task-search" class="input search"
           placeholder="Filter tasks" />
    <button data-truth="task-add" id="add-task" class="btn btn-primary"
            data-testid="add-task">Add task</button>
    <ul id="task-list" class="tasks">
      <li class="task">Buy groceries
        <button data-truth="del-groceries" class="btn btn-del" aria-label="Delete buy groceries">Delete</button>
      </li>
      <li class="task">Write report
        <button data-truth="del-report" class="btn btn-del" aria-label="Delete write report">Delete</button>
      </li>
      <li class="task">Call dentist
        <button data-truth="del-dentist" class="btn btn-del" aria-label="Delete call dentist">Delete</button>
      </li>
    </ul>
  </section>

  <footer id="footer" class="footer">
    <a data-truth="footer-privacy" class="footer-link" href="/privacy">Privacy</a>
    <a data-truth="footer-terms" class="footer-link" href="/terms">Terms</a>
    <a data-truth="footer-contact" class="footer-link" href="/contact-us">Contact</a>
  </footer>
</body>
</html>`;

export const TRUTH_ATTR = 'data-truth';
