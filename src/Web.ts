import * as http from "http";
import crypto from 'crypto';
import type { Express } from "express";
import express from 'express';
import expressWs from "express-ws";
import bodyParser from "body-parser";
import Sqids from 'sqids';
import type { DB, LogChunk } from "./DB.ts";
import type { BuildController, BuildEvent } from "./BuildController.ts";

interface WebConfig {
    port?: number;
}

/**
 * I still hate typescript.
 */
function notStupidParseInt(v: string | undefined): number {
    return v === undefined ? NaN : parseInt(v);
}

function timeElapsed(date1: Date, date2: Date) {
    if (!date2 || !date1) {
        return '-';
    }
    const ms = Math.abs(date2.getTime() - date1.getTime());
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return `${hours}:${minutes}:${seconds}`;
}

function splitLines(lines: LogChunk[]) {
    return lines.map(logChunk => logChunk.chunk.split('\n')).flat().map(line => line.substring(line.lastIndexOf('\r') + 1));
}

class Web {
    private _webserver: http.Server | null = null;
    private db: DB;
    private buildController: BuildController;
    private app: expressWs.Application;
    private port: number;

    constructor(options: WebConfig = {}) {
        const sqids = new Sqids({
            minLength: 6,
            alphabet: 'abcdefghijkmnprstuvwxyz'
        });
        const app: Express = express();
        const wsApp = this.app = expressWs(app).app;
        this.port = notStupidParseInt(process.env.PORT) || options['port'] as number || 8080;

        app.set('trust proxy', 1);
        app.set('view engine', 'ejs');
        app.set('view options', { outputFunctionName: 'echo' });
        app.use('/assets', express.static('assets', { maxAge: '30 days' }));
        app.use(bodyParser.json());
        app.use(bodyParser.urlencoded({ extended: true }));
        app.use((_req, res, next) => {
            crypto.randomBytes(32, (err, randomBytes) => {
                if (err) {
                    console.error(err);
                    next(err);
                } else {
                    res.locals.cspNonce = randomBytes.toString("hex");
                    next();
                }
            });
        });

        app.get('/', async (req, res) => {
            try {
                const builds = 'q' in req.query ? await this.db.searchBuilds(req.query.q as string) : await this.db.getBuildsBy(req.query);
                builds.forEach(b => {
                    b.sqid = sqids.encode([b.id]);
                });
                res.render('index', {
                    page: {
                        title: 'Archery',
                        titlesuffix: 'Dashboard',
                        description: 'PKGBUILD central'
                    },
                    builds,
                    timeElapsed
                });
            }
            catch (err) {
                console.error(err);
                res.sendStatus(400);
            }
        });

        app.get('/build{/}', (_, res) => {
            res.render('build-new', {
                page: {
                    title: 'Archery',
                    titlesuffix: 'New Build',
                    description: 'Kick off a build'
                }
            });
        });

        app.post('/build{/}', async (req, res) => {
            const buildId = await this.db.createBuild(
                req.body.repo,
                req.body.commit || null,
                req.body.patch || null,
                req.body.distro || 'arch',
                req.body.dependencies || 'stable'
            );
            res.redirect(`/build/${sqids.encode([buildId])}`);
            this.buildController.triggerBuild();
        });

        app.get('/build/:id{/}', async (req, res) => {
            const build = await this.db.getBuild(sqids.decode(req.params.id)?.[0]);
            if (!build) {
                res.sendStatus(404);
                return;
            }
            build.sqid = sqids.encode([build.id]);
            const log = splitLines(await this.db.getLog(build.id));

            res.render('build', {
                page: {
                    title: 'Archery',
                    titlesuffix: `Build #${build.id}`,
                    description: `Building ${build.repo} on ${build.distro}`
                },
                build,
                log,
                ended: build.status !== 'queued' && build.status !== 'running'
            });
        });

        app.get('/build/:id/cancel', async (req, res) => {
            const build = await this.db.getBuild(sqids.decode(req.params.id)?.[0]);
            if (!build) {
                res.sendStatus(404);
                return;
            }
            try {
                await this.buildController.cancelBuild(build.id);
            }
            catch (ex) {
                console.error(ex);
            }
            res.redirect(`/build/${req.params.id}`);
        });

        app.get('/build/:id/logs{/}', async (req, res) => {
            const build = await this.db.getBuild(sqids.decode(req.params.id)?.[0]);
            if (!build) {
                res.sendStatus(404);
                return;
            }
            const log = (await this.db.getLog(build.id)).map(logChunk => logChunk.chunk).join('\n');
            res.set('Content-Type', 'text/plain').send(log);
        });

        app.get('/build/:id/patch{/}', async (req, res) => {
            const build = await this.db.getBuild(sqids.decode(req.params.id)?.[0]);
            if (!build || !build.patch) {
                res.sendStatus(404);
                return;
            }
            res.set('Content-Type', 'text/plain').send(build.patch);
        });

        app.get('/healthcheck', (_, res) => {
            res.send('Healthy');
        });

        wsApp.ws('/build/:id/ws', (ws, req) => {
            console.log('WS Opened');
            const eventListener = (be: BuildEvent) => {
                if (be.id === sqids.decode(req.params.id)?.[0]) {
                    ws.send(JSON.stringify(be));
                }
            };
            this.buildController.on('log', eventListener);

            ws.on('close', () => {
                console.log('WS Closed');
                this.buildController.removeListener('log', eventListener);
            });
        });

    }

    close = () => {
        if (this._webserver) {
            this._webserver.close();
        }
    }

    setDB = (db: DB) => {
        this.db = db;
        if (!this._webserver) {
            this._webserver = this.app.listen(this.port, () => console.log(`archery is running on port ${this.port}`));
        }
    }

    setBuildController = (buildController: BuildController) => {
        this.buildController = buildController;
    }
}

export default Web;
export { Web };
export type { WebConfig };
