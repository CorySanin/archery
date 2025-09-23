import { Sequelize, DataTypes, Op, } from 'sequelize';
import type { ModelStatic, Filterable } from 'sequelize';
import type { LogType } from './BuildController.ts';

type Status = 'queued' | 'running' | 'cancelled' | 'success' | 'error';
type Dependencies = 'stable' | 'testing' | 'staging';

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

const MONTH = 1000 * 60 * 60 * 24 * 24;
const FRESH = {
    [Op.or]: [
        { startTime: { [Op.gt]: new Date(Date.now() - MONTH) } },
        { startTime: { [Op.is]: null } }
    ]
}
const SELECT = ['id', 'repo', 'commit', 'distro', 'dependencies', 'startTime', 'endTime', 'status'];

class DB {
    private build: ModelStatic<any>;
    private logChunk: ModelStatic<any>;
    private user: ModelStatic<any>;
    private sequelize: Sequelize;

    constructor(config: DBConfig = {}) {
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

        this.sync();
    }

    private async sync(): Promise<void> {
        await this.build.sync();
        await this.logChunk.sync();
        await this.user.sync();
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

    public async createBuild(repo: string, commit: string, patch: string, distro: string, dependencies: string): Promise<number> {
        const buildRec = await this.build.create({
            repo,
            commit: commit || null,
            patch: patch || null,
            distro,
            dependencies
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
        return await this.build.findByPk(id);
    }

    public async getBuilds(): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: FRESH
        });
    }

    public async getBuildsByStatus(status: Status): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                ...FRESH,
                status
            }
        });
    }

    public async getBuildsByDistro(distro: string): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                ...FRESH,
                distro
            }
        });
    }

    public async getBuildsBy(filterable: Filterable): Promise<Build[]> {
        return await this.build.findAll({
            attributes: SELECT,
            order: [['id', 'DESC']],
            where: {
                ...FRESH,
                ...filterable
            }
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
            limit: 100
        });
    }

    public async cleanup(): Promise<void> {
        await this.build.destroy({
            where: {
                startTime: { [Op.lt]: new Date(Date.now() - MONTH * 6) }
            }
        });
    }

    public async close(): Promise<void> {
        await this.sequelize.close();
    }
}

export default DB;
export { DB };
export type { DBConfig, Status, Build, LogChunk, User };
