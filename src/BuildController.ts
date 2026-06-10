import spawn from 'child_process';
import EventEmitter from 'events';
import type { Build, DB } from "./DB.ts";

export type Distro = 'arch' | 'artix';

const docker_images: Record<Distro, string>  = {
    arch: 'corysanin/archery:arch',
    artix: 'corysanin/archery:artix',
}

export type LogType = 'std' | 'err' | 'finish';

export interface BuildEvent {
    id: number;
    type: LogType;
    message: any;
}

export interface ControllerConfig {
    "arch-mirror"?: string;
    "artix-mirror"?: string;
}

function getContainerName(id: number) {
    return `archery-build-${id}`;
}

export class BuildController extends EventEmitter {
    private db: DB;
    private running: boolean = false;
    private interval: NodeJS.Timeout;
    private cancelled: boolean = false;
    private config: ControllerConfig;

    constructor(config: ControllerConfig = {}) {
        super();
        this.config = config;
        this.db = null!;
        this.interval = null!;
        // this.interval = setInterval(this.triggerBuild, 60000);
    }

    triggerBuild = () => {
        if (!this.running) {
            this.running = true;
            this.kickOffBuild();
            return true;
        }
        return false;
    }

    private kickOffBuild = async () => {
        this.running = true;
        this.cancelled = false;
        const build = await this.db.dequeue();
        if (build === null) {
            this.running = false;
            return;
        }
        try {
            await this.pullImage(build.distro);
            await this.build(build);
        }
        catch (e) {
            console.error(e);
            this.db.finishBuild(build.id, 'error');
        }
        this.kickOffBuild();
    }

    private pullImage = (distro: Distro) => {
        return new Promise<void>((resolve, reject) => {
            if (!(distro in docker_images) || typeof docker_images[distro] !== 'string') {
                return reject();
            }
            const docker = spawn.spawn('docker', ['pull', docker_images[distro]]);
            docker.stdout.on('data', (data) => {
                console.log(`${data}`);
            });
            docker.stderr.on('data', (data) => {
                console.error(`${data}`);
            });
            docker.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(code);
                }
            });
            docker.on('error', (err) => {
                reject(err);
            });
        });
    }

    private build = async (build: Build) => {
        return new Promise<void>((resolve, _) => {
            const docker = spawn.spawn('docker', this.createBuildParams(build));
            docker.on('spawn', () => {
                const remainder: Record<LogType, string> = {
                    std: '',
                    err: '',
                    finish: ''
                }
                docker.pid && this.db.startBuild(build.id, docker.pid);

                let createLogFunction = (type: LogType) => {
                    return (data: Buffer | string) => {
                        const str = data.toString();
                        const readyToLog = remainder[type] + str.substring(0, str.lastIndexOf('\n'));
                        remainder[type] = str.substring(str.lastIndexOf('\n') + 1);
                        this.db.appendLog(build.id, type, readyToLog);
                        this.emitLog({
                            id: build.id,
                            type: type,
                            message: readyToLog
                        });
                    };
                };

                docker.stdout.on('data', createLogFunction('std'));
                docker.stderr.on('data', createLogFunction('err'));
            });
            docker.on('close', (code) => {
                const status = code === 0 ? 'success' : (this.cancelled ? 'cancelled' : 'error');
                this.emitLog({
                    id: build.id,
                    type: 'finish',
                    message: status
                });
                this.db.finishBuild(build.id, status);

                resolve();
            });
        });
    }

    private emitLog = (msg: BuildEvent) => {
        this.emit('log', msg);
    }

    private createBuildParams = (build: Build) => {
        const customMirror = this.config?.[`${build.distro}-mirror`];
        const params = ['run', '--rm', '-e', `REPO=${build.repo}`];
        if (build.dependencies) {
            params.push('-e', `DEP=${build.dependencies}`);
        }
        if (build.commit) {
            params.push('-e', `COMMIT=${build.commit}`);
        }
        if (build.patch) {
            params.push('-e', `PATCH=${build.patch}`);
        }
        if (customMirror && typeof customMirror === 'string' && customMirror.length > 0) {
            params.push('-e', `MIRROR=${customMirror}`);
        }
        params.push('--name', getContainerName(build.id));
        params.push(docker_images[build.distro]);
        return params;
    }

    cancelBuild = async (id: number, force: boolean = false) => {
        const running = this.running;
        const build = await this.db.getBuild(id);
        if (running && build.status === 'queued') {
            await this.db.finishBuild(id, 'cancelled');
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const dockerPs = spawn.spawn('docker', ['ps', '--filter', `name=${getContainerName(id)}`, '--format', '{{.ID}}']);
            let output = '';
            dockerPs.on('spawn', () => {
                dockerPs.stdout.on('data', (data: Buffer | string) => {
                    output += data.toString();
                });
            });
            dockerPs.on('close', (code) => {
                if (code == null || code > 0) {
                    return reject('failed to get container id');
                }
                this.cancelled = true;
                const dockerKill = spawn.spawn('docker', ['stop', output.trim()]);
                dockerKill.on('close', (code) => {
                    if (code == null || code > 0) {
                        if (force) {
                            this.db.finishBuild(id, 'cancelled');
                        }
                        return reject('failed to kill container');
                    }
                    resolve();
                });
            });
        });
    }

    setDB = (db: DB) => {
        this.db = db;
    }

    close = () => {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}

export default BuildController;
