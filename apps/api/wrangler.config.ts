// Build settings for cf's documented static-assets builder. Use cf for all CLI commands.
import { defineWranglerConfig } from 'wrangler/experimental-config';
export default defineWranglerConfig({ assetsDirectory: '../web/out' });
