// Netlify runs this every hour by itself (scheduled functions): reminders, the evening digest, the daily backup.
import { hourly } from '../../server/serverless.js';

export default () => hourly();
export const config = { schedule: '@hourly' };
