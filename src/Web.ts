import * as http from "http";
import crypto from 'crypto';
import type { Express } from 'express';
import express from 'express';
import expressWs from 'express-ws';
import session from 'express-session';
import ky from 'ky';
import passport from 'passport';
import OpenIDConnectStrategy from 'passport-openidconnect';
import bodyParser from 'body-parser';
import Sqids from 'sqids';
import type { DB, LogChunk, Build, User } from "./DB.ts";
import type { BuildController, BuildEvent } from "./BuildController.ts";

interface WebConfig {
    sessionSecret?: string;
    port?: number;
    secure?: boolean;
    oidc?: {
        server: string;
        clientId: string;
        clientSecret: string;
        appBaseUrl: string;
    };
}

interface OpenIdConfiguration {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
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

function resolvePackageRepo(repo: string) {
    if (/^[a-zA-Z]+:\/\//.test(repo) || repo.toLowerCase().endsWith('.git')) {
        return repo;
    }
    return `https://gitlab.archlinux.org/archlinux/packaging/packages/${repo}.git`;
}

class Web {
    private _webserver: http.Server | null = null;
    private db: DB;
    private buildController: BuildController;
    private app: expressWs.Application;
    private port: number;
    private options: WebConfig;

    constructor(options: WebConfig = {}) {
        this.options = options;
    }

    initialize = async () => {
        const options = this.options;
        const sessionSecret = process.env['SESSIONSECRET'] || options.sessionSecret;
        const sqids = new Sqids({
            minLength: 6,
            alphabet: 'abcdefghijkmnprstuvwxyz'
        });
        const app: Express = express();
        const wsApp = this.app = expressWs(app).app;
        const oidc = await this.initializeOIDC(options);
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

        const createBuildPages = (slug: string, getBuildFn: (str: string) => Promise<Build>) => {
            app.get(`/${slug}/:id/`, async (req, res) => {
                const build = await getBuildFn(req.params.id);
                if (!build) {
                    res.sendStatus(404);
                    return;
                }
                build.sqid = sqids.encode([build.id]);
                const log = splitLines(await this.db.getLog(build.id));

                if (req?.user) {
                    res.locals.shareable = `${req.protocol}://${req.host}/b/${build.uuid}/`;
                }

                res.render('build', {
                    page: {
                        title: 'Archery',
                        titlesuffix: `Build #${build.id}`,
                        description: `Building ${build.repo} on ${build.distro}`,
                    },
                    user: req?.user,
                    build,
                    log,
                    ended: build.status !== 'queued' && build.status !== 'running',
                    public: !!oidc && !req?.user
                });
            });

            app.get(`/${slug}/:id/logs{/}`, async (req, res) => {
                const build = await getBuildFn(req.params.id);
                if (!build) {
                    res.sendStatus(404);
                    return;
                }
                const log = (await this.db.getLog(build.id)).map(logChunk => logChunk.chunk).join('\n');
                res.set('Content-Type', 'text/plain').send(log);
            });

            app.get(`/${slug}/:id/patch{/}`, async (req, res) => {
                const build = await getBuildFn(req.params.id);
                if (!build || !build.patch) {
                    res.sendStatus(404);
                    return;
                }
                res.set('Content-Type', 'text/plain').send(build.patch);
            });

            wsApp.ws(`/${slug}/:id/ws`, async (ws, req) => {
                const build = await getBuildFn(req.params.id);
                if (!build || (build.status !== 'queued' && build.status !== 'running')) {
                    return ws.close();
                }
                console.log('WS Opened');
                const eventListener = (be: BuildEvent) => {
                    if (be.id === build.id) {
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

        app.get('/healthcheck', (_, res) => {
            res.send('Healthy');
        });

        if (oidc) {
            if (!sessionSecret) {
                throw new Error('sessionSecret must be set.');
            }
            app.use(session({
                name: 'sessionId',
                secret: sessionSecret,
                resave: true,
                saveUninitialized: false,
                store: this.db,
                cookie: {
                    maxAge: notStupidParseInt(process.env['COOKIETTL']) || 1000 * 60 * 60 * 24 * 30, // 30 days
                    httpOnly: true,
                    secure: !!options.secure
                }
            }));
            passport.use(oidc);
            app.use(passport.initialize());
            app.use(passport.session());
            passport.serializeUser(function (user: User, done) {
                done(null, user.id);
            });

            passport.deserializeUser(async (id: string, done) => {
                const user = await this.db.getUser(id);
                done(null, {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName
                });
            });
            app.get('/login', (req, res) => {
                if (req?.user) {
                    return res.redirect('/');
                }
                res.append('X-Robots-Tag', 'none');
                res.render('login-required', {
                    page: {
                        title: 'Archery',
                        titlesuffix: 'Log In',
                        description: 'Authentication required',
                    }
                });
            });
            app.post('/login', passport.authenticate('openidconnect'));
            app.get('/cb', passport.authenticate('openidconnect', { successRedirect: '/', failureRedirect: '/login', failureMessage: true }));
            app.get('/logout', (req, res) => {
                req.logOut((err) => {
                    if (err) {
                        console.error(`Failed to log out user: ${err}`);
                    }
                    res.redirect('/login');
                });
            });
            createBuildPages('b', (id) => this.db.getBuildByUuid(id));
            app.use((req, res, next) => {
                if (!req?.user) {
                    res.redirect('/login');
                    return;
                }
                next();
            });
        }

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
                    user: req?.user,
                    builds,
                    timeElapsed
                });
            }
            catch (err) {
                console.error(err);
                res.sendStatus(400);
            }
        });

        app.get('/build{/}', async (req, res) => {
            const query = ('id' in req.query && typeof req.query.id === 'string' && await this.db.getBuild(sqids.decode(req.query.id)?.[0])) || req.query;
            res.render('build-new', {
                page: {
                    title: 'Archery',
                    titlesuffix: 'New Build',
                    description: 'Kick off a build',
                },
                user: req?.user,
                query
            });
        });

        app.post('/build{/}', async (req, res) => {
            const buildId = await this.db.createBuild(
                resolvePackageRepo(req.body.repo),
                req.body.commit || null,
                req.body.patch || null,
                req.body.distro || 'arch',
                req.body.dependencies || 'stable',
                req?.user?.['id'],
                crypto.randomUUID()
            );
            res.redirect(`/build/${sqids.encode([buildId])}/`);
            this.buildController.triggerBuild();
        });

        createBuildPages('build', (id) => this.db.getBuild(sqids.decode(id)?.[0]));

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
            res.redirect(`/build/${req.params.id}/`);
        });

        app.post('/build/:id/persist', async (req, res) => {
            const build = await this.db.getBuild(sqids.decode(req.params.id)?.[0]);
            const persist = !!req?.body?.persist;
            if (!build) {
                res.sendStatus(404);
                return;
            }
            await this.db.persist(build.id, persist);
            res.sendStatus(200);
        })

        this._webserver = this.app.listen(this.port, () => console.log(`archery is running on port ${this.port}`));
    }

    close = () => {
        if (this._webserver) {
            this._webserver.close();
        }
    }

    setDB = (db: DB) => {
        this.db = db;
    }

    initializeOIDC = async (options: WebConfig): Promise<OpenIDConnectStrategy | false> => {
        if (!options.oidc || !options.oidc.server || !options.oidc.clientId || !options.oidc.clientSecret) {
            return false;
        }
        const server = options.oidc.server.endsWith('/') ? options.oidc.server : `${options.oidc.server}/`;
        const baseUrl = options.oidc.appBaseUrl.endsWith('/') ? options.oidc.appBaseUrl : `${options.oidc.appBaseUrl}/`;
        const openidconf = await ky.get(`${server}.well-known/openid-configuration`).json<OpenIdConfiguration>();
        return new OpenIDConnectStrategy({
            issuer: openidconf.issuer,
            authorizationURL: openidconf.authorization_endpoint,
            tokenURL: openidconf.token_endpoint,
            userInfoURL: openidconf.userinfo_endpoint,
            clientID: options.oidc.clientId,
            clientSecret: options.oidc.clientSecret,
            callbackURL: `${baseUrl}cb`,
            scope: 'profile'
        }, async (_: string, profile: passport.Profile, cb: OpenIDConnectStrategy.VerifyCallback) => {
            const userObj: User = {
                id: profile.id,
                username: profile.username,
                displayName: profile.displayName
            };
            await this.db.upsertUser(userObj);
            return cb(null, userObj);
        });
    }

    setBuildController = (buildController: BuildController) => {
        this.buildController = buildController;
    }
}

export default Web;
export { Web, notStupidParseInt };
export type { WebConfig };
