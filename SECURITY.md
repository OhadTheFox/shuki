# Security

Found a security issue in Shuki? Please report it privately, not in a public issue:
GitHub → this repository → **Security** → **Report a vulnerability**.

Include what you found, how to reproduce it, and which install path it affects (Cloudflare, Docker, Node, Vercel,
Netlify).

What is in scope: the server (`worker/`, `server/`), the app (`public/`), and the install scripts. Keys you paste into
the app stay on your server; the model provider (Anthropic or OpenAI) sees the messages Shuki sends it, as described
in the README's Privacy section.
