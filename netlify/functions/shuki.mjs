// Netlify: every /api/* and /mcp/* request comes here. See server/serverless.js.
import { handle } from '../../server/serverless.js';

export default (req) => handle(req);
export const config = { path: ['/api/*', '/mcp', '/mcp/*'] };
