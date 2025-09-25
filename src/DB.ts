import { Sequelize, DataTypes, Op, } from 'sequelize';
import { Store } from 'express-session'
import { notStupidParseInt } from './Web.ts';
import type { ModelStatic, Filterable } from 'sequelize';
import type { LogType } from './BuildController.ts';
import type { SessionData } from 'express-session'

type Status = 'queued' | 'running' | 'cancelled' | 'success' | 'error';
type Dependencies = 'stable' | 'testing' | 'staging';
type Callback = (err?: unknown, data?: any) => any

interface DBConfig {
    db?: string;
    user?: string;
    password?: string;
    host?: string;
    port?: number;
}

interface Build {
    id: number;
    repo: string;
    commit?: string;
    patch?: string;
    distro: string;
    dependencies: Dependencies;
    startTime?: Date;
    endTime?: Date;
    status: Status;
    pid?: number;
    sqid?: string;
    uuid: string;
}

interface User {
    id: string;
    username: string;
    displayName?: string;
}

interface LogChunk {
    id: number
    buildId: number
    type: LogType,
    chunk: string
}

const MONTH = 1000 * 60 * 60 * 24 * 30;
const FRESH = {
    [Op.or]: [
        { startTime: { [Op.gt]: new Date(Date.now() - MONTH) } },
        { startTime: { [Op.is]: null } }
    ]
}
const SELECT = ['id', 'repo', 'commit', 'distro', 'dependencies', 'startTime', 'endTime', 'status'];

function handleCallback<T>(err: unknown, data: T, cb?: Callback): T {
    if (cb) {
        cb(err, data);
    }
    if (err) {
        throw err;
    }
    return data;
}

class DB extends Store {
    private build: ModelStatic<any>;
    private logChunk: ModelStatic<any>;
    private user: ModelStatic<any>;
    private session: ModelStatic<any>;
    private sequelize: Sequelize;
    private ttl: number;

    constructor(config: DBConfig = {}) {
        super();
        this.ttl = notStupidParseInt(process.env['COOKIETTL']) || 1000 * 60 * 60 * 24 * 30;
        this.sequelize = new Sequelize(config.db || 'archery', config.user || 'archery', process.env.PASSWORD || config.password || '', {
            host: config.host || 'localhost',
            port: config.port || 5432,
            dialect: 'postgres',
            logging: false
        });
        this.build = this.sequelize.define('builds', {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
            repo: {
                type: DataTypes.STRING,
                allowNull: false
            },
            commit: {
                type: DataTypes.STRING,
                allowNull: true
            },
            patch: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            distro: {
                type: DataTypes.STRING,
                allowNull: false
            },
            dependencies: {
                type: DataTypes.ENUM('stable', 'testing', 'staging'),
                allowNull: false,
                defaultValue: 'stable'
            },
            startTime: {
                type: DataTypes.DATE,
                allowNull: true
            },
            endTime: {
                type: DataTypes.DATE,
                allowNull: true
            },
            status: {
                type: DataTypes.ENUM('queued', 'running', 'cancelled', 'success', 'error'),
                allowNull: false,
                defaultValue: 'queued'
            },
            pid: {
                type: DataTypes.INTEGER,
                allowNull: true
            },
            uuid: {
                type: DataTypes.STRING,
                unique: true
            }
        });

        this.logChunk = this.sequelize.define('logChunk', {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
            buildId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'builds',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            type: {
                type: DataTypes.ENUM('std', 'err'),
                allowNull: false,
                defaultValue: 'std'
            },
            chunk: {
                type: DataTypes.TEXT,
                allowNull: false
            }
        });

        this.user = this.sequelize.define('users', {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            username: {
                type: DataTypes.STRING,
            },
            displayName: {
                type: DataTypes.STRING,
                allowNull: true
            }
        });

        this.session = this.sequelize.define('session', {
            sid: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            sessionData: {
                type: DataTypes.JSONB,
            }
        });

        this.build.belongsTo(this.user);
        this.user.hasMany(this.build);

        this.sync();
    }

    private async sync(): Promise<void> {
        await this.user.sync();
        await this.build.sync();
        await this.logChunk.sync();
        await this.session.sync();

        if (!(await this.getUser('-1'))) {
            await this.createUser({
                id: '-1',
                username: '???',
                displayName: 'Anonymous User'
            });
        }
    }

    public async getUser(id: string): Promise<User> {
        return await this.user.findByPk(id);
    }

    public async createUser(user: User): Promise<string> {
        await this.user.create({
            id: user.id,
            username: user.username,
            displayName: user.displayName || null
        });
        return user.id;
    }

    public async createBuild(repo: string, commit: string, patch: string, distro: string, dependencies: string, author: string, uuid: string): Promise<number> {
        const buildRec = await this.build.create({
            repo,
            commit: commit || null,
            patch: patch || null,
            distro,
            dependencies,
            uuid,
            userId: author || '-1'
        });
        return buildRec.id;
    }

    public async startBuild(id: number, pid: number): Promise<void> {
        await this.build.update({
            startTime: new Date(),
            status: 'running',
            pid,
            log: ''
        }, {
            where: {
                id
            }
        });
    }

    public async finishBuild(id: number, status: Status): Promise<void> {
        await this.build.update({
            endTime: new Date(),
            status
        }, {
            where: {
                id
            }
        });
    }

    public async appendLog(buildId: number, type: LogType, chunk: string): Promise<void> {
        await this.logChunk.create({
            buildId,
            type,
            chunk
        });
    }

    public async getLog(buildId: number): Promise<LogChunk[]> {
        return await this.logChunk.findAll({
            order: [['id', 'ASC']],
            where: {
                buildId
            }
        });
    }

    public async getBuild(id: number): Promise<Build> {
        return await this.build.findByPk(id, {
            include: this.user
        });
    }

    public async getBuildByUuid(uuid: string): Promise<Build> {
        return await this.build.findOne({
            where: {
                uuid
            },
            include: this.user
        });
    }

    public async getBuilds(): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: FRESH,
            include: this.user
        });
    }

    public async getBuildsByStatus(status: Status): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                ...FRESH,
                status
            },
            include: this.user
        });
    }

    public async getBuildsByDistro(distro: string): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                ...FRESH,
                distro
            },
            include: this.user
        });
    }

    public async getBuildsBy(filterable: Filterable): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                ...FRESH,
                ...filterable
            },
            include: this.user
        });
    }

    public async dequeue(): Promise<Build> {
        return await this.build.findOne({
            order: [['id', 'ASC']],
            where: {
                status: 'queued'
            },
            limit: 1
        });
    }

    public async searchBuilds(query: string): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                [Op.or]: [
                    { repo: { [Op.iLike]: `%${query}%` } }
                ]
            },
            limit: 100,
            include: this.user
        });
    }

    public async cleanup(): Promise<void> {
        await this.build.destroy({
            where: {
                startTime: { [Op.lt]: new Date(Date.now() - MONTH * 6) }
            },
            force: true
        });
        await this.session.destroy({
            where: {
                updatedAt: { [Op.lt]: new Date(Date.now() - this.ttl) }
            },
            force: true
        });
    }

    public getTTL(sessionData: SessionData) {
        if (sessionData?.cookie?.expires) {
            const ms = Number(new Date(sessionData.cookie.expires)) - Date.now();
            return ms;
        }
        else {
            return this.ttl;
        }
    }

    public async set(sid: string, sessionData: SessionData, cb?: Callback): Promise<void> {
        const ttl = this.getTTL(sessionData);
        try {
            if (ttl > 0) {
                await this.session.upsert({
                    sid,
                    sessionData
                });
                handleCallback(null, null, cb);
                return;
            }
            await this.destroy(sid, cb);
        }
        catch (err) {
            return handleCallback(err, null, cb);
        }
    }

    public async get(sid: string, cb?: Callback): Promise<SessionData> {
        try {
            return handleCallback(null, ((await this.session.findByPk(sid))?.sessionData) as SessionData || null, cb);
        }
        catch (err) {
            return handleCallback(err, null, cb);
        }
    }

    public async destroy(sid: string, cb?: Callback): Promise<void> {
        try {
            await this.session.destroy({
                where: {
                    sid
                },
                force: true
            });
            handleCallback(null, null, cb);
        }
        catch (err) {
            handleCallback(err, null, cb);
        }
    }

    public async clear(cb?: Callback): Promise<void> {
        try {
            await this.session.destroy({
                truncate: true,
                force: true
            });
            handleCallback(null, null, cb);
        }
        catch (err) {
            handleCallback(err, null, cb);
        }
    }

    public async length(cb?: Callback): Promise<number> {
        try {
            return handleCallback(null, await this.session.count(), cb);
        }
        catch (err) {
            handleCallback(err, null, cb);
        }
    }

    public async touch(sid: string, sessionData: SessionData, cb?: Callback): Promise<void> {
        try {
            await this.session.update({},
                {
                    where: {
                        sid
                    }
                }
            );
            handleCallback(null, null, cb);
        }
        catch (err) {
            handleCallback(err, null, cb);
        }
    }

    public async all(cb?: Callback): Promise<SessionData[]> {
        try {
            const all = await this.session.findAll({
                attributes: ['sessionData']
            });
            return handleCallback(null, all.map(row => row.sessionData as SessionData), cb);
        }
        catch (err) {
            handleCallback(err, null, cb);
        }
    }

    public async close(): Promise<void> {
        await this.sequelize.close();
    }
}

export default DB;
export { DB };
export type { DBConfig, Status, Build, LogChunk, User };
