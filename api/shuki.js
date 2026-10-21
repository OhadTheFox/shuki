// Vercel: every /api/* and /mcp/* request comes here (vercel.json). See server/serverless.js.
import { handle } from '../server/serverless.js';

export const GET = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle, OPTIONS = handle;
