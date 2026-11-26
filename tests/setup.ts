// Exercise normal first-run identity creation through the owner-only local API.
// Browser suites share an isolated server; never change the developer's installation.
export default async function setup() {
  const base = 'http://127.0.0.1:5174/api/shared/identity';
  const identity = await (await fetch(base)).json();
  if (!identity.name) {
    const result = await fetch(base, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Browser test operator' }),
    });
    if (!result.ok) throw new Error('Could not initialize isolated browser identity');
  }
}
