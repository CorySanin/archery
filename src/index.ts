import fs from 'fs';
import path from 'path';
import { Web } from './Web.ts';
import { DB } from './DB.ts';
import { BuildController } from './BuildController.ts';
import type { WebConfig } from './Web.ts';
import type { DBConfig } from './DB.ts';
import type { ControllerConfig } from './BuildController.ts';

interface compositeConfig {
    web?: WebConfig,
    db?: DBConfig,
    controller?: ControllerConfig,
}

const config: compositeConfig = JSON.parse(await fs.promises.readFile(process.env.config || process.env.CONFIG || path.join(process.cwd(), 'config', 'config.json'), 'utf-8'));

const web = new Web(config.web);
const buildController = new BuildController(config.controller);
await new Promise((resolve) => setTimeout(resolve, 1500));
const db = new DB(config.db);
web.setDB(db);
web.setBuildController(buildController);
web.initialize();
buildController.setDB(db);

process.on('SIGTERM', () => {
    web.close();
    db.close();
    buildController.close();
});
